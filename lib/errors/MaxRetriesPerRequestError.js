const {AbortError} = require('redis-errors')

module.exports = class MaxRetriesPerRequestError extends AbortError {
  constructor (maxRetriesPerRequest) {
    var message = `Reached the max retries per request limit (which is ${maxRetriesPerRequest}). Refer to "maxRetriesPerRequest" option for details.`;

    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
};

