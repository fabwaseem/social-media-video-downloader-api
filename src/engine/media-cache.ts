import { Injectable } from "@nestjs/common";
import type { MediaInfo } from "@downloader/shared";
import { RedisService } from "../redis/redis.service";

interface Entry<T> {
  value: T;
  expires: number;
}

/** Small TTL map that drops the oldest key once it is full. */
export class LruTtlCache<T> {
  private readonly map = new Map<string, Entry<T>>();

  constructor(private readonly max: number) {}

  get size(): number {
    return this.map.size;
  }

  get(key: string, now = Date.now()): T | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expires <= now) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  set(key: string, value: T, ttlMs: number, now = Date.now()): void {
    if (ttlMs <= 0) return;
    if (this.map.has(key)) this.map.delete(key);
    if (this.map.size >= this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { value, expires: now + ttlMs });
  }
}

@Injectable()
export class MediaCache {
  private readonly lru = new LruTtlCache<MediaInfo>(500);

  constructor(private readonly redis: RedisService) {}

  async get(url: string): Promise<MediaInfo | null> {
    const local = this.lru.get(url);
    if (local) return local;
    const client = this.redis.clientOrNull;
    if (!client) return null;
    try {
      const raw = await client.get(this.key(url));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as MediaInfo;
      this.lru.set(url, parsed, 30_000);
      return parsed;
    } catch {
      return null;
    }
  }

  async set(url: string, info: MediaInfo, ttlMs: number): Promise<void> {
    this.lru.set(url, info, ttlMs);
    const client = this.redis.clientOrNull;
    if (!client || ttlMs <= 0) return;
    try {
      await client.set(this.key(url), JSON.stringify(info), "PX", ttlMs);
    } catch {
      // The in-memory entry is already stored.
    }
  }

  private key(url: string): string {
    return `media:${url}`;
  }
}
