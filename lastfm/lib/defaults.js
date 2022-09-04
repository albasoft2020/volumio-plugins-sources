//var libQ = require('kew');

var promiseOptions = function (params, defer, key) {
	var options = params || {};
//    var defer = libQ.defer(); 
    
	options.handlers = {
		'success' : function (rsp) {
			if (key) { rsp = rsp[key]; }
            console.log("success. Response: " + JSON.stringify(rsp));
			if (rsp) {
				return defer.resolve(rsp);
			} else {
				return defer.reject(new Error("Key not found"));
			}
		},
		'error' : function (err) {
                console.log("Error. Response: " + JSON.stringify(err))
				return defer.reject(err);
		}
	};

	return options;
};

exports.promiseOptions = promiseOptions;
