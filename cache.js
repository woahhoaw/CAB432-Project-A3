// cache.js
const Redis = require('ioredis');
const redis = new Redis(process.env.REDIS_URL); // point to Elasticache endpoint
module.exports = {
  async cachedGet(key, ttlSec, loader) {
    const hit = await redis.get(key);
    if (hit) return JSON.parse(hit);
    const val = await loader();
    await redis.setex(key, ttlSec, JSON.stringify(val));
    return val;
  }
};
