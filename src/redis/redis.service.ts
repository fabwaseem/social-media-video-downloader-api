import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";
import { AppConfigService } from "../config/app-config.service";

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;

  constructor(private readonly config: AppConfigService) {}

  get enabled(): boolean {
    return this.config.redisUrl.length > 0;
  }

  /** Shared client for cache and rate limits. Null when REDIS_URL is unset. */
  get clientOrNull(): Redis | null {
    if (!this.enabled) return null;
    if (!this.client) {
      this.client = new Redis(this.config.redisUrl, {
        maxRetriesPerRequest: 2,
        connectTimeout: 2_000,
        lazyConnect: true,
      });
      this.client.on("error", (err: Error) => {
        this.logger.warn(`Redis client error: ${err.message}`);
      });
    }
    return this.client;
  }

  async ping(): Promise<boolean> {
    const client = this.clientOrNull;
    if (!client) return false;
    try {
      if (client.status === "wait") await client.connect();
      return (await client.ping()) === "PONG";
    } catch (error) {
      this.logger.warn(`Redis ping failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.client) return;
    await this.client.quit().catch(() => undefined);
    this.client = null;
  }
}
