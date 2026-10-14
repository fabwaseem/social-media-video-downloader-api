import { Injectable } from "@nestjs/common";
import { ThrottlerStorageService } from "@nestjs/throttler";
import type { ThrottlerStorage } from "@nestjs/throttler";

type StorageRecord = Awaited<ReturnType<ThrottlerStorage["increment"]>>;
import { RedisService } from "./redis.service";

/**
 * Global IP throttler backed by Redis INCR. Falls back to Nest's in-memory
 * storage when REDIS_URL is unset or Redis cannot be reached.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly memory = new ThrottlerStorageService();

  constructor(private readonly redis: RedisService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<StorageRecord> {
    const client = this.redis.clientOrNull;
    if (!client) return this.memory.increment(key, ttl, limit, blockDuration, throttlerName);

    const redisKey = `throttle:${throttlerName}:${key}`;
    const blockKey = `${redisKey}:block`;
    try {
      const blockedFor = await client.pttl(blockKey);
      if (blockedFor > 0) {
        const hits = Number((await client.get(redisKey)) ?? limit + 1);
        return {
          totalHits: hits,
          timeToExpire: Math.ceil(ttl / 1000),
          isBlocked: true,
          timeToBlockExpire: Math.ceil(blockedFor / 1000),
        };
      }

      const hits = await client.incr(redisKey);
      if (hits === 1) await client.pexpire(redisKey, ttl);
      const pttl = await client.pttl(redisKey);
      const timeToExpire = Math.max(1, Math.ceil((pttl > 0 ? pttl : ttl) / 1000));
      if (hits > limit) {
        const blockMs = blockDuration > 0 ? blockDuration : ttl;
        await client.set(blockKey, "1", "PX", blockMs);
        return {
          totalHits: hits,
          timeToExpire,
          isBlocked: true,
          timeToBlockExpire: Math.ceil(blockMs / 1000),
        };
      }
      return { totalHits: hits, timeToExpire, isBlocked: false, timeToBlockExpire: 0 };
    } catch {
      return this.memory.increment(key, ttl, limit, blockDuration, throttlerName);
    }
  }
}
