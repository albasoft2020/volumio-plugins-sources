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


var LastfmAPI = module.exports = function (options) {
	this.api = new LastFmNode(options);
	this.sessionCredentials = null;
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
	this.lastfm.api.request('artist.getSimilar', options);
    return defer.promise;
};

// Routines for using a persistent cache----------------------------------------------------------------------------------
// e.g. options {base:'.', name:'scrobbles'}
LastfmAPI.prototype.initCache = function (options) {
    options = options || { name:'scrobbles' };
    scrobbleCache = cache(options);
};

LastfmAPI.prototype.scrobbleToCache = function (track) {
    return new Promise((resolve, reject) => {
        if (track && track.artist && track.track) { // enough data for scrobbling
            track.timestamp = track.timestamp || Math.floor(Date.now() / 1000);  // if timestamp is missing use 'now'
            // add to cache using timestamp as the key
            scrobbleCache.put(track.timestamp, track, function(err) {
                //check err for errors
                if (err) reject('Failed to add track to cache');
                else resolve('Added track to cache');
            });
        } 
        else reject('Not enough data in track to be a valid scrobble.');
    });
};

LastfmAPI.prototype.scrobbleCachedData = function (options) {
    let self = this;
    if (!scrobbleCache) self.initCache(options);  // Make sure cache is set up!
    return new Promise((resolve, reject) => {
        scrobbleCache.keys(function(err, keys) {
            //Handle errors
            if (err) return reject(err);
            
            console.log("Scrobble cache keys: ", keys); 
            if (keys.length > 0) {
                keys.forEach(key => {
                    console.log(JSON.stringify(scrobbleCache.getSync(key)));
                    self.scrobble(scrobbleCache.getSync(key))
                        .then(resp => {
                            scrobbleCache.deleteSync(key);
            //                console.log('Appected: ' + resp['@attr']['accepted']);
                            if (resp['@attr'].accepted > 0){
//                                console.log(resp.scrobble.artist['#text']+ ' - ' + (resp.scrobble.track['#text'] || 'unknown'));// + ' (' +(resp.scrobble.album['#text'] || 'unknown' ));
                                resolve(resp.scrobble.artist['#text']+ ' - ' + (resp.scrobble.track['#text'] || 'unknown'));
                            }
                            else {
//                                console.log('Failed ');
                                reject('Failed');
                            }
                        })
                        .fail(err => {
                            // If it is a lastFM error then err.error should be defined and a number code. If not there has been some other error, such as network connection down.
                             if (!err.error || retryOnErrors.includes(err.error)) console.log('Failed to scrobble; keep in cache');
                             else  {
//                                console.log('Failed to scrobble. Will remove track from cache');
                                reject('Failed to scrobble. Will remove track from cache');
                                scrobbleCache.deleteSync(key);
                            } 
                        });  
                });
            } else resolve('Cache was empty. No tracks scrobbled.')
        });
    });
};    
