import { Cache } from "./cache.interface";

type Entry<V> = { value: V; expiresAt: number };
interface MemoryCacheOptions {
  defaultTtlMs?: number;
  cleanupIntervalMs?: number;
}

export class MemoryCache implements Cache {
  private store = new Map<string, Entry<JsonValue>>();
  private defaultTtlMs: number;
  constructor(opts: MemoryCacheOptions = {}) {
    this.defaultTtlMs = opts.defaultTtlMs ?? Infinity;
    const interval = opts.cleanupIntervalMs ?? 60_000;
    if (isFinite(interval) && interval > 0) {
      setInterval(() => this.sweep(), interval).unref();
    }
  }

  async get<T>(key: string): Promise<T | undefined> {
    const e = this.store.get(key);
    if (!e) return undefined;
    if (Date.now() > e.expiresAt) {
      this.store.delete(key);
      return undefined;
    }

    return e.value as T;
  }

  async set(key: string, value: any, ttlMs = this.defaultTtlMs) {
    const expiresAt = isFinite(ttlMs) ? Date.now() + ttlMs : Infinity;
    this.store.set(key, { value, expiresAt });
  }

  async has(key: string) {
    return (await this.get(key)) !== undefined;
  }
  async delete(key: string) {
    this.store.delete(key);
  }
  async clear() {
    this.store.clear();
  }

  async getAll(): Promise<Map<string, unknown>> {
    const result = new Map<string, unknown>();
    const now = Date.now();

    for (const [key, entry] of this.store) {
      if (now <= entry.expiresAt) {
        result.set(key, entry.value);
      } else {
        // Clean up expired entries while we're iterating
        this.store.delete(key);
      }
    }

    return result;
  }

  private sweep() {
    const now = Date.now();
    for (const [k, { expiresAt }] of this.store)
      if (now > expiresAt) this.store.delete(k);
  }
}
