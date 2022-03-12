const Redis = require("ioredis");
const redis = new Redis();

// Create a shared Redis instance for the entire application.
// Redis is single-thread so you don't need to create multiple instances
// or use a connection pool.
module.exports = redis;
