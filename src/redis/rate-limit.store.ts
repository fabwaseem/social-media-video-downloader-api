import type { RedisService } from "./redis.service";

const WINDOW_MS = 60_000;

const CONSUME_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)
if count >= limit then
  redis.call('PEXPIRE', key, window)
  return -1
end
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window)
return limit - (count + 1)
`;

/** Sliding window. Returns remaining quota, or -1 when the call is over the limit. */
export class MemoryRateLimitStore {
  private readonly windows = new Map<string, number[]>();

  consume(id: string, limit: number, now = Date.now()): number {
    if (this.windows.size > 1000) {
      for (const [key, stamps] of this.windows) {
        if (stamps.every((stamp) => now - stamp >= WINDOW_MS)) this.windows.delete(key);
      }
    }
    const stamps = (this.windows.get(id) ?? []).filter((stamp) => now - stamp < WINDOW_MS);
    if (stamps.length >= limit) {
      this.windows.set(id, stamps);
      return -1;
    }
    stamps.push(now);
    this.windows.set(id, stamps);
    return limit - stamps.length;
  }
}

export class RedisRateLimitStore {
  constructor(
    private readonly redis: RedisService,
    private readonly fallback: MemoryRateLimitStore,
  ) {}

  async consume(id: string, limit: number, now = Date.now()): Promise<number> {
    const client = this.redis.clientOrNull;
    if (!client) return this.fallback.consume(id, limit, now);
    try {
      const remaining = await client.eval(
        CONSUME_SCRIPT,
        1,
        `ratelimit:apikey:${id}`,
        String(now),
        String(WINDOW_MS),
        String(limit),
        `${now}:${Math.random().toString(16).slice(2)}`,
      );
      const value = typeof remaining === "number" ? remaining : Number(remaining);
      return Number.isFinite(value) ? value : this.fallback.consume(id, limit, now);
    } catch {
      return this.fallback.consume(id, limit, now);
    }
  }
}
