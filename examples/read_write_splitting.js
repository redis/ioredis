const Redis = require("../built/index.js").default;

// Example 1: Using read/write splitting with ElastiCache read replicas (array format)
const redis = new Redis({
  // Primary endpoint (for writes)
  host: 'primary.cache.amazonaws.com',
  port: 6379,
  
  // Read replicas (for reads) - same API as cluster!
  scaleReads: [
    { host: 'replica1.cache.amazonaws.com', port: 6379 },
    { host: 'replica2.cache.amazonaws.com', port: 6379 }
  ]
});

// Example 2: Using cluster-style scaleReads (when you manage instances separately)
const redisWithClusterStyle = new Redis({
  host: 'primary.cache.amazonaws.com',
  port: 6379,
  scaleReads: 'all' // Same as cluster - routes reads to available read instances
});

async function example() {
  try {
    // Write operations go to primary
    await redis.set('user:1', JSON.stringify({ name: 'John', age: 30 }));
    await redis.hset('counters', 'views', 100);
    
    // Read operations are distributed across read replicas
    const user = await redis.get('user:1');
    const views = await redis.hget('counters', 'views');
    const keys = await redis.keys('user:*');
    
    console.log('User:', JSON.parse(user));
    console.log('Views:', views);
    console.log('User keys:', keys);
    
    // Mixed operations
    await redis.incr('counters:visits'); // Write - goes to primary
    const visits = await redis.get('counters:visits'); // Read - goes to replica
    
    console.log('Visits:', visits);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    redis.disconnect();
  }
}

// For demonstration with localhost (when you don't have ElastiCache)
async function localExample() {
  const localRedis = new Redis({
    host: '127.0.0.1',
    port: 6379,
    scaleReads: [
      { host: '127.0.0.1', port: 6379 } // Same instance for demo
    ]
  });
  
  try {
    await localRedis.set('demo', 'value');
    const result = await localRedis.get('demo'); // This will use read endpoint
    console.log('Demo result:', result);
  } catch (error) {
    console.error('Local example error:', error);
  } finally {
    localRedis.disconnect();
  }
}

// Run examples
if (require.main === module) {
  console.log('Running read/write splitting examples...');
  
  // Uncomment the example you want to run:
  
  // For ElastiCache (update hostnames):
  // example();
  
  // For local testing:
  localExample();
}

module.exports = { example, localExample };