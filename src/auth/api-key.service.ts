import { Injectable } from "@nestjs/common";
import { randomBytes } from "crypto";
import { PrismaService } from "../prisma/prisma.service";

export interface ValidatedKey {
  id: string;
  name: string;
  rateLimitPerMinute: number;
  maxDurationSeconds: number;
}

const VALIDATION_CACHE_TTL_MS = 30_000;
const VALIDATION_CACHE_MAX = 1000;

@Injectable()
export class ApiKeyService {
  /** In-memory sliding window: keyId -> request timestamps (ms). */
  private readonly windows = new Map<string, number[]>();
  /** Short-lived validation cache: raw key -> result. Saves a DB hit per request. */
  private readonly cache = new Map<string, { value: ValidatedKey | null; expires: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async createKey(input: {
    name: string;
    rateLimitPerMinute?: number;
    maxDurationSeconds?: number;
    expiresAt?: Date;
  }) {
    const key = `vz_${randomBytes(24).toString("hex")}`;
    return this.prisma.apiKey.create({
      data: {
        key,
        name: input.name,
        rateLimitPerMinute: input.rateLimitPerMinute ?? 100,
        maxDurationSeconds: input.maxDurationSeconds ?? 3600,
        expiresAt: input.expiresAt ?? null,
      },
    });
  }

  async listKeys() {
    const keys = await this.prisma.apiKey.findMany({ orderBy: { createdAt: "desc" } });
    // Never expose full secrets on list.
    return keys.map((k) => ({ ...k, key: `${k.key.slice(0, 8)}…${k.key.slice(-4)}` }));
  }

  async blockKey(id: string, reason: string) {
    this.cache.clear();
    return this.prisma.apiKey.update({
      where: { id },
      data: { isBlocked: true, blockReason: reason },
    });
  }

  async deleteKey(id: string) {
    this.cache.clear();
    return this.prisma.apiKey.delete({ where: { id } });
  }

  /** Returns the key record when valid, or null. */
  async validate(rawKey: string): Promise<ValidatedKey | null> {
    if (!rawKey || rawKey.length > 128) return null;

    // Cache hits skip the DB entirely — including misses, so garbage keys
    // can't be used to hammer the database.
    const cached = this.cache.get(rawKey);
    if (cached && cached.expires > Date.now()) return cached.value;

    const record = await this.prisma.apiKey.findUnique({ where: { key: rawKey } });
    const valid =
      record &&
      !record.isBlocked &&
      (!record.expiresAt || record.expiresAt.getTime() >= Date.now());

    const value: ValidatedKey | null = valid
      ? {
          id: record.id,
          name: record.name,
          rateLimitPerMinute: record.rateLimitPerMinute,
          maxDurationSeconds: record.maxDurationSeconds,
        }
      : null;

    if (this.cache.size >= VALIDATION_CACHE_MAX) {
      // Drop the oldest entry (Map preserves insertion order).
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(rawKey, { value, expires: Date.now() + VALIDATION_CACHE_TTL_MS });

    if (value && record) {
      void this.prisma.apiKey
        .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
        .catch(() => undefined);
    }

    return value;
  }

  /** Per-key sliding-window rate limit. Returns remaining quota or -1 when exceeded. */
  consumeQuota(key: ValidatedKey): number {
    const now = Date.now();
    const windowMs = 60_000;

    // Opportunistic pruning keeps the map from growing with dead keys.
    if (this.windows.size > 1000) {
      for (const [id, stamps] of this.windows) {
        if (stamps.every((t) => now - t >= windowMs)) this.windows.delete(id);
      }
    }

    const stamps = (this.windows.get(key.id) ?? []).filter((t) => now - t < windowMs);
    if (stamps.length >= key.rateLimitPerMinute) {
      this.windows.set(key.id, stamps);
      return -1;
    }
    stamps.push(now);
    this.windows.set(key.id, stamps);
    return key.rateLimitPerMinute - stamps.length;
  }
}
