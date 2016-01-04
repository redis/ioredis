'use strict';

var Pipeline = require('./pipeline');
var utils = require('./utils');

exports.addTransactionSupport = function (redis) {
  redis.pipeline = function (commands) {
    var pipeline = new Pipeline(this);
    if (Array.isArray(commands)) {
      pipeline.addBatch(commands);
    }
    return pipeline;
  };

  var multi = redis.multi;
  redis.multi = function (commands, options) {
    if (typeof options === 'undefined' && !Array.isArray(commands)) {
      options = commands;
      commands = null;
    }
    if (options && options.pipeline === false) {
      return multi.call(this);
    }
    var pipeline = new Pipeline(this);
    pipeline.multi();
    if (Array.isArray(commands)) {
      pipeline.addBatch(commands);
    }
    var exec = pipeline.exec;
    pipeline.exec = function (callback) {
      if (this._transactions > 0) {
        exec.call(pipeline);
      }
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

    var execBuffer = pipeline.execBuffer;
    pipeline.execBuffer = function (callback) {
      if (this._transactions > 0) {
        execBuffer.call(pipeline);
      }
      return pipeline.exec(callback);
    };
    return pipeline;
  };

  var exec = redis.exec;
  redis.exec = function (callback) {
    return exec.call(this).then(function (results) {
      if (Array.isArray(results)) {
        results = utils.wrapMultiResult(results);
      }
      return results;
    }).nodeify(callback);
  };
};
