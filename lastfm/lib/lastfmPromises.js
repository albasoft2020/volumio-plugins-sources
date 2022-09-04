'use strict';

// Inspired by https://github.com/maxkueng/node-lastfmapi
// Simplified it a bit and include only the few API methods that I am actually using
// Make it return promises to make it similar to the rest of Volumio

var defaults = require('./defaults');
var LastFmNode = require('lastfm').LastFmNode;
var libQ = require('kew');

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
    var options = defaults.promiseOptions(tracks, defer, 'scrobbles');
	options.sk = this.sessionCredentials.key;
	this.api.request('track.scrobble', options);
    return defer.promise;
};

LastfmAPI.prototype.getArtistInfo = function (artist) {
	var defer = libQ.defer();
    var options = defaults.promiseOptions(artist, defer, 'artist');
	this.api.request('artist.getInfo', options);
    return defer.promise;
};


LastfmAPI.prototype.getSimilarArtists = function (artist) {
	var defer = libQ.defer();
    var options = defaults.promiseOptions(artist, defer, 'similarartists');
	this.lastfm.api.request('artist.getSimilar', options);
    return defer.promise;
};
