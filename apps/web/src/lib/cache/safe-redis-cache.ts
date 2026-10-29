import { Cache } from "./cache.interface";
import { RedisCache, type RedisCacheOptions } from "./redis-cache";
import { MemoryCache } from "./memory-cache";
import logger from "logger";

export interface SafeRedisCacheOptions extends RedisCacheOptions {
  fallbackToMemory?: boolean;
  serverCache?: Cache;
  maxRetries?: number;
  retryDelay?: number;
}

export class SafeRedisCache implements Cache {
  private redisCache: RedisCache | null = null;
  private serverCache: Cache;
  private isRedisFailed = false;
  private retryCount = 0;
  private maxRetries: number;
  private retryDelay: number;
  private lastRetryTime = 0;

  constructor(options: SafeRedisCacheOptions = {}) {
    const {
      fallbackToMemory = true,
      serverCache,
      maxRetries = 3,
      retryDelay = 60000,
      ...redisOptions
    } = options;

    this.serverCache = serverCache || new MemoryCache();
    this.maxRetries = maxRetries;
    this.retryDelay = retryDelay;

    if (fallbackToMemory) {
      try {
        this.redisCache = new RedisCache(redisOptions);
        logger.info("SafeRedisCache: Redis initialized successfully");
      } catch (error) {
        logger.error(
          "SafeRedisCache: Failed to initialize Redis, using memory cache",
          error,
        );
        this.isRedisFailed = true;
      }
    } else {
      this.redisCache = new RedisCache(redisOptions);
    }
  }

  private async executeWithFallback<T>(
    operation: () => Promise<T>,
    fallbackOperation: () => Promise<T>,
    operationName: string,
  ): Promise<T> {
    if (this.isRedisFailed) {
      // Check if we should retry Redis connection
      const now = Date.now();
      if (
        this.retryCount < this.maxRetries &&
        now - this.lastRetryTime > this.retryDelay
      ) {
        this.lastRetryTime = now;
        this.retryCount++;
        logger.info(
          `SafeRedisCache: Retrying Redis connection (attempt ${this.retryCount}/${this.maxRetries})`,
        );

        try {
          // Test Redis connection with a simple operation
          if (this.redisCache) {
            await this.redisCache.has("__test__");
            this.isRedisFailed = false;
            this.retryCount = 0;
            logger.info("SafeRedisCache: Redis connection restored");
          }
        } catch (error) {
          logger.warn(`SafeRedisCache: Redis retry failed`, error);
        }
      }
    }

    if (!this.isRedisFailed && this.redisCache) {
      try {
        return await operation();
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        // Check for rate limit errors
        if (
          errorMessage.includes("rate limit") ||
          errorMessage.includes("quota exceeded") ||
          errorMessage.includes("too many requests") ||
          errorMessage.includes("OOM") // Redis out of memory
        ) {
          logger.warn(
            `SafeRedisCache: Redis rate limit/quota exceeded for ${operationName}`,
            error,
          );
        } else {
          logger.error(
            `SafeRedisCache: Redis operation failed for ${operationName}`,
            error,
          );
        }

        this.isRedisFailed = true;
        return fallbackOperation();
      }
    }

    return fallbackOperation();
  }

  async get<T>(key: string): Promise<T | undefined> {
    return this.executeWithFallback(
      () => this.redisCache!.get<T>(key),
      () => this.serverCache.get<T>(key),
      `get(${key})`,
    );
  }

  async set(key: string, value: unknown, ttlMs?: number): Promise<void> {
    return this.executeWithFallback(
      async () => {
        await this.redisCache!.set(key, value, ttlMs);
        // Also set in memory cache as backup
        await this.serverCache.set(key, value, ttlMs);
      },
      () => this.serverCache.set(key, value, ttlMs),
      `set(${key})`,
    );
  }

  async has(key: string): Promise<boolean> {
    return this.executeWithFallback(
      () => this.redisCache!.has(key),
      () => this.serverCache.has(key),
      `has(${key})`,
    );
  }

  async delete(key: string): Promise<void> {
    return this.executeWithFallback(
      async () => {
        await this.redisCache!.delete(key);
        // Also delete from memory cache
        await this.serverCache.delete(key);
      },
      () => this.serverCache.delete(key),
      `delete(${key})`,
    );
  }

  async clear(): Promise<void> {
    return this.executeWithFallback(
      async () => {
        await this.redisCache!.clear();
        // Also clear memory cache
        await this.serverCache.clear();
      },
      () => this.serverCache.clear(),
      "clear()",
    );
  }

  async getAll(): Promise<Map<string, unknown>> {
    return this.executeWithFallback(
      () => this.redisCache!.getAll(),
      () => this.serverCache.getAll(),
      "getAll()",
    );
  }

  async disconnect(): Promise<void> {
    if (this.redisCache) {
      await this.redisCache.disconnect();
    }
  }

  isUsingRedis(): boolean {
    return !this.isRedisFailed && this.redisCache !== null;
  }

  getCacheStatus(): { redis: boolean; retries: number; lastError?: string } {
    return {
      redis: this.isUsingRedis(),
      retries: this.retryCount,
    };
  }
}
