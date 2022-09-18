'use strict';

// Inspired by https://github.com/maxkueng/node-lastfmapi
// Simplified it a bit and include only the few API methods that I am actually using
// Make it return promises to make it similar to the rest of Volumio

var defaults = require('./defaults');
var LastFmNode = require('lastfm').LastFmNode;
var libQ = require('kew');

// Added persistent caching of scrobbles
var cache = require('persistent-cache');
const retryOnErrors = [
      11,                 // Service offline
      16,                 // Temporarily unavailable
      29                  // Rate limit exceeded
    ];
var scrobbleCache;

const status = {
    timestamp : 0,
    cached : 0,
    accepted : 0,
    ignored : 0
};

var LastfmAPI = module.exports = function (options) {
	this.api = new LastFmNode(options);
	this.sessionCredentials = null;
    status.timestamp = Math.floor(Date.now() / 1000);
};


LastfmAPI.prototype.setSessionCredentials = function (username, key) {
	this.sessionCredentials = {
		'username' : username,
		'key' : key
	};
};


LastfmAPI.prototype.getMobileSession = function (username, password) {
	var defer = libQ.defer();
    var options = defaults.promiseOptions({
		'username' : username,
		'password' : password,
        'write' : true
	}, defer, 'session');
	this.api.request('auth.getMobileSession', options);
    return defer.promise;
};

LastfmAPI.prototype.getStatus = function () {
    return status;
};

LastfmAPI.prototype.updateNowPlaying = function (track) {
	var defer = libQ.defer();
    var options = defaults.promiseOptions(track, defer, 'nowplaying');	
	options.sk = this.sessionCredentials.key;
	this.api.request('track.updateNowPlaying', options);
    return defer.promise;
};

LastfmAPI.prototype.getTrackInfo = function (track) {
	var defer = libQ.defer();
    var options = defaults.promiseOptions(track, defer, 'track');
    if (this.sessionCredentials && this.sessionCredentials.username) options.username = this.sessionCredentials.username;
	this.api.request('track.getInfo', options);
    return defer.promise;
};


LastfmAPI.prototype.getSimilarTracks = function (track) {
	var defer = libQ.defer();
    var options = defaults.promiseOptions(track, defer, 'similartracks');
	this.api.request('track.getSimilar', options);
    return defer.promise;
};


LastfmAPI.prototype.scrobble = function (tracks) {
	var i, len, key, newParams = {};
	if (Array.isArray(tracks)) {
		for (i = 0, len = tracks.length; i < len; i++) {
			for (key in tracks[i]) {
				newParams[key + '[' + i + ']'] = tracks[i][key];
			}
		}
		tracks = newParams;
	}
    var defer = libQ.defer();
//    var defer = new Promise();
    var options = defaults.promiseOptions(tracks, defer, 'scrobbles');
	options.sk = this.sessionCredentials.key;
	this.api.request('track.scrobble', options);
    return defer.promise;
};

LastfmAPI.prototype.getArtistInfo = function (artist) {
	var defer = libQ.defer();
    var options = defaults.promiseOptions(artist, defer, 'artist');
    if (this.sessionCredentials && this.sessionCredentials.username) options.username = this.sessionCredentials.username;
	this.api.request('artist.getInfo', options);
    return defer.promise;
};


LastfmAPI.prototype.getSimilarArtists = function (artist) {
	var defer = libQ.defer();
    var options = defaults.promiseOptions(artist, defer, 'similarartists');
	this.api.request('artist.getSimilar', options);
    return defer.promise;
};

// Routines for using a persistent cache----------------------------------------------------------------------------------
// 
// When starting these functions I noiced that kew is by now actually deprecated
// So tried using node internal Promise instead...
// Not the most consistent; seeing that most of Volumio is still using kew I should just stick with it here as well?
// ------------------------------------------------------------------------------------------------------------------------

// e.g. options {base:'.', name:'scrobbles'}
LastfmAPI.prototype.initCache = function (options) {
    options = options || { name:'scrobbles' };
    scrobbleCache = cache(options);
};

LastfmAPI.prototype.scrobbleToCache = function (track) {
    return new Promise((resolve, reject) => {
        if (!scrobbleCache) reject("Scrobble cache not configured yet!");  
        else {
            if (track && track.artist && track.track) { // enough data for scrobbling
                track.timestamp = track.timestamp || Math.floor(Date.now() / 1000);  // if timestamp is missing use 'now'
                // add to cache using timestamp as the key
                scrobbleCache.put(track.timestamp, track, function(err) {
                    //check err for errors
                    if (err) reject('Failed to add track to cache');
                    else {
                        status.cached++;
                        resolve(track);
                    }
                });
            } 
            else reject('Not enough data in track to be a valid scrobble.');
        }
    });
};

LastfmAPI.prototype.scrobbleCachedData = function () {
    let self = this;
    if (!scrobbleCache) return Promise.reject("Scrobble cache not configured yet!");  
    
    const info = {
        submitted : 0,
        accepted : 0,
        remaining : 0,
        track : {}
    };
    
    return new Promise((resolve, reject) => {
        scrobbleCache.keys(function(err, keys) {
            //Handle errors
            if (err) return reject(err);
            
            console.log("Scrobble cache keys: ", keys); 
            let cacheSize = keys.length;
            if (cacheSize > 0) {
                let cnt = 0;
                let submittedTracks = [], submittedKeys = [];
                if (cacheSize === 1) {  // just one track: don't submit track as an array
                    submittedKeys = keys[0];
                    submittedTracks = scrobbleCache.getSync(submittedKeys);
                    cnt = 1;
                }
                else {
                    keys.forEach(key => {
                        if (cnt < 49) {  // 50 is the LastFM hard limit for tracks in an array
                            submittedKeys.push(key);
                            submittedTracks.push(scrobbleCache.getSync(key));
                            cnt++;
                        }
                        // TO-DO: properly deal with caches with more than 50 entries. At the moment just leave 
                        // 'excess' tracks in cache and deal with them next time routine is called...
                    });
                    console.log(cnt + ' out of ' + cacheSize);
                    if (cnt < cacheSize) info.remaining = cacheSize - cnt;
                }
                info.submitted = cnt;
                self.scrobble(submittedTracks)
                        .then(resp => {
                            info.accepted = resp['@attr'].accepted;
                            status.accepted += info.accepted;
                            status.ignored += resp['@attr'].ignored;
                            status.cached = info.remaining;
                            
                            if (cnt === 1){
                                scrobbleCache.deleteSync(submittedKeys);
                                if (info.accepted > 0){
                                    info.track.artist = resp.scrobble.artist['#text'];
                                    info.track.track = resp.scrobble.track['#text'];
                                    info.track.timestamp = resp.scrobble.timestamp;
                                    if (resp.scrobble.album['#text']) info.track.album = resp.scrobble.album['#text'];
                                    
                                    resolve(info);
                                }
                                else {
                                    reject('Server ignored scrobble request');
                                }                                
                            } else {
                                submittedKeys.forEach(key => { scrobbleCache.deleteSync(key); });
                                if (info.accepted > 0){
                                    let i = cnt - 1;
                                    // find last accepted entry
                                    while((i > 0) && (resp.scrobble[i].ignoredMessage.code > 0)){i--};
                                    console.log(i, resp.scrobble[i].ignoredMessage.code);
                                    info.track.artist = resp.scrobble[i].artist['#text'];
                                    info.track.track = resp.scrobble[i].track['#text'];
                                    info.track.timestamp = resp.scrobble[i].timestamp;
                                    if (resp.scrobble[i].album['#text']) info.track.album = resp.scrobble[i].album['#text'];

                                    resolve(info);
                                }
                                else {
                                    reject('Server ignored all ' + cnt + ' scrobble requests');
                                }                                
                            }
                        })
                        .fail(err => {
                            // If it is a lastFM error then err.error should be defined and a number code. If not there has been some other error, such as network connection down.
                             if (!err.error || retryOnErrors.includes(err.error)) reject('Failed to scrobble; keep in cache');
                             else  {
                                submittedKeys.forEach(key => { scrobbleCache.deleteSync(key); });
                                status.cached = info.remaining;
                                reject('Failed to scrobble. Will remove ' + cnt + ' tracks from cache');
                            } 
                        });  
            } else resolve(info);
        });
    });
};    
