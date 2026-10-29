import Redis, { type RedisOptions } from "ioredis";
import { Cache } from "./cache.interface";
import logger from "logger";

export interface RedisCacheOptions {
  redis?: Redis;
  redisUrl?: string;
  redisOptions?: RedisOptions;
  defaultTtlMs?: number;
  keyPrefix?: string;
}

export class RedisCache implements Cache {
  private redis: Redis;
  private defaultTtlMs: number;
  private keyPrefix: string;

  constructor(options: RedisCacheOptions = {}) {
    logger.info("RedisCache constructor");
    if (options.redis) {
      this.redis = options.redis;
    } else if (options.redisUrl) {
      this.redis = new Redis(options.redisUrl, options.redisOptions || {});
    } else {
      this.redis = new Redis(options.redisOptions || {});
    }

    this.defaultTtlMs = options.defaultTtlMs ?? Infinity;
    this.keyPrefix = options.keyPrefix ?? "";
  }

  private getKey(key: string): string {
    return this.keyPrefix + key;
  }

  async get<T>(key: string): Promise<T | undefined> {
    const value = await this.redis.get(this.getKey(key));
    if (!value) return undefined;

    try {
      return JSON.parse(value) as T;
    } catch {
      return value as T;
    }
  }

  async set(key: string, value: unknown, ttlMs?: number): Promise<void> {
    const ttl = ttlMs ?? this.defaultTtlMs;
    const serialized = JSON.stringify(value);

    if (isFinite(ttl)) {
      await this.redis.psetex(this.getKey(key), ttl, serialized);
    } else {
      await this.redis.set(this.getKey(key), serialized);
    }
  }

  async has(key: string): Promise<boolean> {
    const exists = await this.redis.exists(this.getKey(key));
    return exists === 1;
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(this.getKey(key));
  }

  async clear(): Promise<void> {
    if (this.keyPrefix) {
      const keys = await this.redis.keys(this.keyPrefix + "*");
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } else {
      await this.redis.flushdb();
    }
  }

  async getAll(): Promise<Map<string, unknown>> {
    const result = new Map<string, unknown>();
    const pattern = this.keyPrefix ? this.keyPrefix + "*" : "*";
    const keys = await this.redis.keys(pattern);

    if (keys.length === 0) return result;

    const values = await this.redis.mget(...keys);

    keys.forEach((key, index) => {
      const value = values[index];
      if (value !== null) {
        const cleanKey = this.keyPrefix
          ? key.slice(this.keyPrefix.length)
          : key;
        try {
          result.set(cleanKey, JSON.parse(value));
        } catch {
          result.set(cleanKey, value);
        }
      }
    });

    return result;
  }

  async disconnect(): Promise<void> {
    this.redis.disconnect();
  }
}
