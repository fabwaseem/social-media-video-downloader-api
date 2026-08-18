import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { join } from "path";
import type { Env } from "./env.validation";

/** Typed accessor over validated environment configuration. */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get nodeEnv(): string {
    return this.config.get("NODE_ENV", { infer: true });
  }

  get isProduction(): boolean {
    return this.nodeEnv === "production";
  }

  get port(): number {
    return this.config.get("PORT", { infer: true });
  }

  get allowedOrigins(): string[] {
    return this.config
      .get("ALLOWED_ORIGINS", { infer: true })
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean);
  }

  get frontendSecret(): string {
    return this.config.get("FRONTEND_SECRET", { infer: true });
  }

  get adminToken(): string {
    return this.config.get("ADMIN_TOKEN", { infer: true });
  }

  get swaggerEnabled(): boolean {
    return !this.isProduction || this.config.get("SWAGGER_ENABLED", { infer: true });
  }

  get throttleTtlSeconds(): number {
    return this.config.get("THROTTLE_TTL_SECONDS", { infer: true });
  }

  get throttleLimit(): number {
    return this.config.get("THROTTLE_LIMIT", { infer: true });
  }

  get maxConcurrentJobs(): number {
    return this.config.get("MAX_CONCURRENT_JOBS", { infer: true });
  }

  get maxDurationSeconds(): number {
    return this.config.get("MAX_DURATION_SECONDS", { infer: true });
  }

  get authMaxDurationSeconds(): number {
    return this.config.get("AUTH_MAX_DURATION_SECONDS", { infer: true });
  }

  get betterAuthSecret(): string {
    return this.config.get("BETTER_AUTH_SECRET", { infer: true });
  }

  get betterAuthUrl(): string {
    return this.config.get("BETTER_AUTH_URL", { infer: true });
  }

  get googleClientId(): string {
    return this.config.get("GOOGLE_CLIENT_ID", { infer: true });
  }

  get googleClientSecret(): string {
    return this.config.get("GOOGLE_CLIENT_SECRET", { infer: true });
  }

  get githubClientId(): string {
    return this.config.get("GITHUB_CLIENT_ID", { infer: true });
  }

  get githubClientSecret(): string {
    return this.config.get("GITHUB_CLIENT_SECRET", { infer: true });
  }

  get smtp(): { host: string; port: number; user: string; pass: string; from: string } {
    return {
      host: this.config.get("SMTP_HOST", { infer: true }),
      port: this.config.get("SMTP_PORT", { infer: true }),
      user: this.config.get("SMTP_USER", { infer: true }),
      pass: this.config.get("SMTP_PASS", { infer: true }),
      from: this.config.get("SMTP_FROM", { infer: true }),
    };
  }

  get fileTtlMinutes(): number {
    return this.config.get("FILE_TTL_MINUTES", { infer: true });
  }

  get storageDriver(): "local" | "r2" {
    return this.config.get("STORAGE_DRIVER", { infer: true });
  }

  get r2(): {
    accountId: string;
    endpoint: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
  } {
    return {
      accountId: this.config.get("R2_ACCOUNT_ID", { infer: true }),
      endpoint: this.config.get("R2_ENDPOINT", { infer: true }),
      accessKeyId: this.config.get("R2_ACCESS_KEY_ID", { infer: true }),
      secretAccessKey: this.config.get("R2_SECRET_ACCESS_KEY", { infer: true }),
      bucket: this.config.get("R2_BUCKET", { infer: true }),
    };
  }

  get storageQuotaBytes(): number {
    return this.config.get("STORAGE_QUOTA_BYTES", { infer: true });
  }

  get signedUrlTtlSeconds(): number {
    return this.config.get("SIGNED_URL_TTL_SECONDS", { infer: true });
  }

  /** FILE_TTL_MINUTES expressed in whole days, for the bucket lifecycle rule. */
  get fileRetentionDays(): number {
    return Math.max(1, Math.ceil(this.fileTtlMinutes / (60 * 24)));
  }

  get mediaCacheTtlMs(): number {
    return this.config.get("MEDIA_CACHE_TTL_SECONDS", { infer: true }) * 1000;
  }

  get downloadsDir(): string {
    return this.config.get("DOWNLOADS_DIR", { infer: true }) || join(process.cwd(), "downloads");
  }

  get binDir(): string {
    return this.config.get("BIN_DIR", { infer: true }) || join(process.cwd(), "bin");
  }

  get cookiesFile(): string {
    return this.config.get("COOKIES_FILE", { infer: true });
  }

  get cookiesB64(): string {
    return this.config.get("COOKIES_B64", { infer: true });
  }

  get ytdlpPath(): string {
    return this.config.get("YTDLP_PATH", { infer: true });
  }

  get ffmpegPathOverride(): string {
    return this.config.get("FFMPEG_PATH", { infer: true });
  }

  get ytdlpProxy(): string {
    return this.config.get("YTDLP_PROXY", { infer: true });
  }

  get ytdlpExtraArgs(): string[] {
    return this.config
      .get("YTDLP_EXTRA_ARGS", { infer: true })
      .split(/\s+/)
      .filter(Boolean);
  }

  get ytdlpForceIpv4(): boolean {
    return this.config.get("YTDLP_FORCE_IPV4", { infer: true });
  }

  get ytdlpJsRuntime(): string {
    return this.config.get("YTDLP_JS_RUNTIME", { infer: true }).trim();
  }

  get ytdlpPotBaseUrl(): string {
    return this.config.get("YTDLP_POT_BASE_URL", { infer: true }).trim().replace(/\/+$/, "");
  }

  get ytdlpVerbose(): boolean {
    return this.config.get("YTDLP_VERBOSE", { infer: true });
  }

  get ytdlpAutoUpdate(): boolean {
    return this.config.get("YTDLP_AUTO_UPDATE", { infer: true });
  }

  get ytdlpConcurrentFragments(): number {
    return this.config.get("YTDLP_CONCURRENT_FRAGMENTS", { infer: true });
  }

  get ytdlpMaxAttempts(): number {
    return this.config.get("YTDLP_MAX_ATTEMPTS", { infer: true });
  }

  get ytdlpRetryBaseMs(): number {
    return this.config.get("YTDLP_RETRY_BASE_MS", { infer: true });
  }
}
