const Redis = require('redis');
const { promisify } = require('util');

class RedisClient {
  constructor() {
    this.client = null;
    this.isConnected = false;
  }

  async connect() {
    try {
      this.client = Redis.createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379',
        retry_strategy: (options) => {
          if (options.error && options.error.code === 'ECONNREFUSED') {
            return new Error('The server refused the connection');
          }
          if (options.total_retry_time > 1000 * 60 * 60) {
            return new Error('Retry time exhausted');
          }
          if (options.attempt > 10) {
            return undefined;
          }
          return Math.min(options.attempt * 100, 3000);
        }
      });

      await this.client.connect();
      
      this.client.on('connect', () => {
        this.isConnected = true;
        console.log('Redis connected successfully');
      });

      this.client.on('error', (err) => {
        this.isConnected = false;
        console.error('Redis error:', err);
      });

      this.client.on('end', () => {
        this.isConnected = false;
        console.warn('Redis connection closed');
      });

      // Promisify methods
      this.get = promisify(this.client.get).bind(this.client);
      this.set = promisify(this.client.set).bind(this.client);
      this.del = promisify(this.client.del).bind(this.client);
      this.expire = promisify(this.client.expire).bind(this.client);
      this.hget = promisify(this.client.hGet).bind(this.client);
      this.hset = promisify(this.client.hSet).bind(this.client);
      this.hdel = promisify(this.client.hDel).bind(this.client);
      this.hgetall = promisify(this.client.hGetAll).bind(this.client);

    } catch (error) {
      console.error('Failed to connect to Redis:', error);
    }
  }

  async setCache(key, value, ttl = 3600) {
    try {
      if (!this.isConnected) return null;
      const stringValue = JSON.stringify(value);
      await this.client.set(key, stringValue, { EX: ttl });
      return true;
    } catch (error) {
      console.error('Redis setCache error:', error);
      return null;
    }
  }

  async getCache(key) {
    try {
      if (!this.isConnected) return null;
      const data = await this.client.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('Redis getCache error:', error);
      return null;
    }
  }

  async deleteCache(key) {
    try {
      if (!this.isConnected) return null;
      await this.client.del(key);
      return true;
    } catch (error) {
      console.error('Redis deleteCache error:', error);
      return null;
    }
  }

  async clearPattern(pattern) {
    try {
      if (!this.isConnected) return null;
      const keys = await this.client.keys(pattern);
      if (keys.length > 0) {
        await this.client.del(keys);
      }
      return true;
    } catch (error) {
      console.error('Redis clearPattern error:', error);
      return null;
    }
  }
}

module.exports = new RedisClient();