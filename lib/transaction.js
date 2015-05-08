'use strict';

var Pipeline = require('./pipeline');
var utils = require('./utils');

exports.addTransactionSupport = function (redis) {
  redis.pipeline = function () {
    var pipeline = new Pipeline(this);
    return pipeline;
  };

  var multi = redis.multi;
  redis.multi = function (options) {
    if (options && options.pipeline === false) {
      return multi.call(this);
    }
    var pipeline = new Pipeline(this);
    pipeline.multi();
    var exec = pipeline.exec;
    pipeline.exec = function (callback) {
      exec.call(pipeline);
      var promise = exec.call(pipeline);
      return promise.then(function (result) {
        var execResult = result[result.length - 1];
        if (execResult[0]) {
          execResult[0].previousErrors = [];
          for (var i = 0; i < result.length - 1; ++i) {
            if (result[i][0]) {
              execResult[0].previousErrors.push(result[i][0]);
            }
          }
          throw execResult[0];
        }
        return utils.wrapMultiResult(execResult[1]);
      }).nodeify(callback);
    };
    return pipeline;
  };

  var exec = redis.exec;
  redis.exec = function (callback) {
    var wrapper = function (err, results) {
      if (Array.isArray(results)) {
        results = utils.wrapMultiResult(results);
      }
      callback(err, results);
    };
    exec.call(this, wrapper);
  };
};
