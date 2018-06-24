module.exports = class MaxRetriesPerRequestError extends Error {
  constructor (maxRetriesPerRequest) {
    var message = `Reached the max retries per request limit (which is ${maxRetriesPerRequest}). Refer to "maxRetriesPerRequest" option for details.`;

    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
};

