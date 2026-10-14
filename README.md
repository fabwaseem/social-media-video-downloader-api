# Social Media Video Downloader API

A robust, production-ready open-source API for downloading videos from social media platforms. Built with NestJS, powered by yt-dlp, with async job queuing, live SSE progress streaming, file storage (local or S3/R2), and optional user authentication.

## Features

- **Multi-platform support** — YouTube, Instagram, TikTok, X/Twitter, Facebook
- **Async download jobs** — queue-based processing with real-time Server-Sent Events (SSE) progress
- **Batch downloads** — submit up to 50 URLs in a single request
- **Quality & format selection** — video (highest/1080p/720p/480p/360p/lowest) and audio (mp3/m4a/opus)
- **Clip extraction** — trim to a time range at download time
- **Media info endpoint** — fetch title, thumbnail, duration, available formats before downloading
- **Playlist & channel listing** — paginated flat listing without individual extractions
- **API key authentication** — per-key rate limits and duration caps
- **User authentication** — Better Auth with Google/GitHub OAuth and email OTP (optional)
- **Storage backends** — local disk or any S3-compatible bucket (Cloudflare R2, AWS S3, MinIO, Backblaze B2)
- **Auto binary management** — yt-dlp and ffmpeg resolved automatically at startup
- **Resilient extraction** — per-platform retry ladder, TikTok embed fallback, alternate URL forms
- **Admin API** — key management, download history, usage stats
- **OpenAPI/Swagger docs** — interactive docs at `/docs`
- **Health endpoint** — binary versions, engine status

## API Overview

All endpoints are versioned under `/v2`.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v2/health` | Engine health and binary versions |
| `GET` | `/v2/media/info?url=` | Fetch media info (title, duration, formats) |
| `GET` | `/v2/media/collection?url=` | List playlist/channel entries |
| `POST` | `/v2/downloads` | Create a download job |
| `POST` | `/v2/downloads/batch` | Queue multiple URLs |
| `GET` | `/v2/downloads/:id` | Get job status |
| `GET` | `/v2/downloads?ids=` | Get many jobs at once |
| `GET` | `/v2/downloads/:id/events` | SSE live progress stream |
| `DELETE` | `/v2/downloads/:id` | Cancel a job |
| `GET` | `/v2/files/:jobId?exp=&sig=` | Download a finished file (signed link) |
| `POST` | `/v2/admin/keys` | Create API key (admin) |
| `GET` | `/v2/admin/keys` | List API keys (admin) |
| `POST` | `/v2/admin/keys/:id/block` | Block an API key (admin) |
| `DELETE` | `/v2/admin/keys/:id` | Delete an API key (admin) |
| `GET` | `/v2/admin/downloads` | Download history (admin) |
| `GET` | `/v2/admin/stats` | Aggregate usage stats (admin) |

Full interactive documentation at `http://localhost:3001/docs` (always available outside production; set `SWAGGER_ENABLED=true` in production to expose it).

## Prerequisites

- Node.js 22+
- PostgreSQL
- pnpm
- yt-dlp and ffmpeg are **auto-downloaded** at startup — no manual install needed

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/fabwaseem/social-media-video-downloader-api.git
cd social-media-video-downloader-api
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Configure environment

```bash
cp .env.example .env
```

At minimum, set `DATABASE_URL`:

```env
DATABASE_URL="postgresql://postgres:password@localhost:5432/downloader"
```

See [Environment Variables](#environment-variables) for the full reference.

### 4. Run database migrations

```bash
pnpm prisma:migrate
```

### 5. Start the server

```bash
# Development (watch mode)
pnpm dev

# Production
pnpm build
pnpm start:prod
```

The API will be available at `http://localhost:3001`.

## Creating Your First API Key

API keys are managed via the admin endpoint, protected by `ADMIN_TOKEN`.

1. Set `ADMIN_TOKEN` in your `.env`:
   ```env
   ADMIN_TOKEN=your-secret-admin-token
   ```

2. Create a key:
   ```bash
   curl -X POST http://localhost:3001/v2/admin/keys \
     -H "X-Admin-Token: your-secret-admin-token" \
     -H "Content-Type: application/json" \
     -d '{"name": "My Key", "rateLimitPerMinute": 60}'
   ```

3. The response includes the key once — store it safely.

## Authentication

Every request to non-public endpoints must include one of:

| Method | Header |
|--------|--------|
| API key | `X-API-Key: vz_...` |
| API key as Bearer | `Authorization: Bearer vz_...` |
| Frontend proxy secret | `X-Frontend-Key: <FRONTEND_SECRET>` |
| Signed file link | `exp` and `sig` on `GET /v2/files/:jobId` (no API key required) |

Authentication is required in every environment. `NODE_ENV=development` does not open the API. Set `AUTH_DISABLED=true` only when you intentionally want to run without a key (local experiments). An invalid key is still rejected when that flag is set. See [Authentication opt-out](#authentication-opt-out).

## Authentication opt-out

`AUTH_DISABLED=true` is the only switch that allows a request through with neither an API key nor `X-Frontend-Key`. It is independent of `NODE_ENV`: a development process with the flag unset returns 401, and a production process with the flag set is open. Leave it unset on any deploy that is reachable beyond your own machine. Invalid keys are rejected even when the flag is on, and admin routes still require `ADMIN_TOKEN`.

Finished files use a separate signed URL (`fileUrl` on the job). That link does not require an API key; the signature expires with `SIGNED_URL_TTL_SECONDS`.

## Quick Usage Examples

### Fetch media info

```bash
curl "http://localhost:3001/v2/media/info?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ" \
  -H "X-API-Key: vz_your_key"
```

### Start a download

```bash
curl -X POST http://localhost:3001/v2/downloads \
  -H "X-API-Key: vz_your_key" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "kind": "video", "quality": "720p", "format": "mp4"}'
```

Response (202 Accepted):
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "QUEUED",
  "platform": "youtube",
  "kind": "video",
  ...
}
```

### Subscribe to progress via SSE

```bash
curl -N "http://localhost:3001/v2/downloads/550e8400.../events" \
  -H "X-API-Key: vz_your_key"
```

Events emitted: `status`, `progress`, `complete`, `error`, `ping` (heartbeat).

### Download the finished file

Completed jobs return a `fileUrl` that names the job id and a short-lived HMAC (`exp`, `sig`). The filename is not part of the URL, so guessing a title does not download the file.

```bash
curl -L -O -J "http://localhost:3001/v2/files/550e8400-e29b-41d4-a716-446655440000?exp=1710000000&sig=..."
```

### Batch download

```bash
curl -X POST http://localhost:3001/v2/downloads/batch \
  -H "X-API-Key: vz_your_key" \
  -H "Content-Type: application/json" \
  -d '{
    "urls": [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com/watch?v=9bZkp7q19f0"
    ],
    "kind": "audio",
    "format": "mp3"
  }'
```

## Download Options

| Field | Type | Values | Default |
|-------|------|--------|---------|
| `url` | string | Any supported URL | required |
| `kind` | string | `video`, `audio` | required |
| `quality` | string | `highest`, `1080p`, `720p`, `480p`, `360p`, `240p`, `144p`, `lowest`, `best` | `highest` / `best` |
| `format` | string | `mp4`, `mkv`, `webm` (video) · `mp3`, `m4a`, `opus`, `wav`, `flac` (audio) | `mp4` / `mp3` |
| `embedThumbnail` | boolean | — | — |
| `embedSubtitles` | boolean | — | — |
| `subtitleLang` | string | e.g. `en`, `en.*` | — |
| `clipStart` | number | seconds | — |
| `clipEnd` | number | seconds | — |

## Project Structure

```
src/
├── app.module.ts               # Root module
├── main.ts                     # Bootstrap (CORS, Swagger, validation)
├── auth/                       # API key guard, admin guard, Better Auth
├── cleanup/                    # TTL-based file cleanup scheduler
├── common/                     # Errors, filters, interceptors, middleware, utils
├── config/                     # Typed env config (Zod validation)
├── downloads/                  # Job queue, SSE events, download controller/service
├── engine/                     # yt-dlp service, binary management, extraction, resilience
│   └── providers/              # Per-platform fallback extractors (TikTok embed)
├── files/                      # File serving controller/service
├── health/                     # Health check endpoint
├── media/                      # Media info and collection listing
├── prisma/                     # Prisma client module/service
├── storage/                    # Local + S3/R2 storage with quota management
└── generated/prisma/           # Prisma client, generated by `prisma generate` (not committed)

packages/
└── shared/                     # Shared TypeScript types and platform detection
    └── src/
        ├── platforms.ts        # detectPlatform(), supported URL patterns
        ├── media.ts            # MediaInfo, Platform, VideoQuality, etc.
        ├── jobs.ts             # DownloadJob, JobEvent, JobStatus types
        └── index.ts
```

## Environment Variables

Copy `.env.example` to `.env` and adjust. Every variable has a sensible default except `DATABASE_URL`.

### Core

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | `development` \| `production` |
| `AUTH_DISABLED` | `false` | Allow requests with no API key. Explicit opt-out; `NODE_ENV` does not do this |
| `PORT` | `3001` | HTTP port |
| `DATABASE_URL` | — | PostgreSQL connection string (**required**) |
| `ALLOWED_ORIGINS` | `` | Comma-separated origins allowed by CORS |
| `FRONTEND_SECRET` | `` | Shared secret injected by a frontend proxy (`X-Frontend-Key`) |
| `ADMIN_TOKEN` | `` | Token for `/v2/admin` endpoints; empty = admin disabled |
| `SWAGGER_ENABLED` | `false` | Expose `/docs` in production |

### Authentication (optional)

| Variable | Description |
|----------|-------------|
| `BETTER_AUTH_SECRET` | Signing secret for sessions. Generate: `openssl rand -hex 32` |
| `BETTER_AUTH_URL` | Public frontend origin for OAuth callbacks |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth (omit to disable) |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub OAuth (omit to disable) |
| `SMTP_HOST/PORT/USER/PASS/FROM` | Email OTP/verification (omit = codes logged to console) |

### Rate limiting

| Variable | Default | Description |
|----------|---------|-------------|
| `THROTTLE_TTL_SECONDS` | `60` | Rate limit window |
| `THROTTLE_LIMIT` | `60` | Requests per window per IP |
| `MAX_CONCURRENT_JOBS` | `3` | Concurrent download workers |
| `MAX_DURATION_SECONDS` | `3600` | Duration cap for unauthenticated requests |
| `AUTH_MAX_DURATION_SECONDS` | `14400` | Duration cap for signed-in users |

### Storage

| Variable | Default | Description |
|----------|---------|-------------|
| `STORAGE_DRIVER` | `local` | `local` or `r2` |
| `FILE_TTL_MINUTES` | `4320` | How long finished files are kept (3 days) |
| `R2_ACCOUNT_ID` | `` | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | `` | R2 access key |
| `R2_SECRET_ACCESS_KEY` | `` | R2 secret key |
| `R2_BUCKET` | `downloads` | Bucket name |
| `R2_ENDPOINT` | `` | Override endpoint (for S3, MinIO, B2, etc.) |
| `SIGNED_URL_TTL_SECONDS` | `21600` | Presigned URL lifetime (6 hours) |
| `STORAGE_QUOTA_BYTES` | `8589934592` | Max bucket size before eviction (8 GiB) |
| `DOWNLOADS_DIR` | `./downloads` | Local download directory |
| `BIN_DIR` | `./bin` | Directory for managed yt-dlp/ffmpeg binaries |

### yt-dlp

| Variable | Default | Description |
|----------|---------|-------------|
| `YTDLP_PATH` | `` | Explicit yt-dlp binary path (skip auto-detection) |
| `YTDLP_VERSION` | pinned | yt-dlp release downloaded when no binary is installed (`2026.08.19` by default) |
| `DIRECT_DOWNLOAD_TIMEOUT_MS` | `300000` | Timeout for provider direct downloads |
| `DIRECT_DOWNLOAD_MAX_BYTES` | `2147483648` | Size cap for provider direct downloads (2 GiB) |
| `FILE_LINK_SECRET` | `` | HMAC secret for file links (falls back to `BETTER_AUTH_SECRET`, then `DATABASE_URL`) |
| `FFMPEG_PATH` | `` | Explicit ffmpeg binary path |
| `YTDLP_JS_RUNTIME` | `` | JS runtime for YouTube's `n` challenge — auto-detects deno or Node 22+ |
| `YTDLP_POT_BASE_URL` | `` | bgutil proof-of-origin token provider URL |
| `COOKIES_FILE` | `` | Path to Netscape cookies.txt |
| `COOKIES_B64` | `` | Base64-encoded cookies.txt (for ephemeral hosts) |
| `YTDLP_PROXY` | `` | Proxy URL for yt-dlp (residential proxies defeat IP blocks) |
| `YTDLP_EXTRA_ARGS` | `` | Extra whitespace-separated yt-dlp arguments |
| `YTDLP_FORCE_IPV4` | `false` | Force IPv4 (some datacenter IPv6 ranges are blocked) |
| `YTDLP_AUTO_UPDATE` | `true` | Auto-update yt-dlp daily at 04:00 |
| `YTDLP_CONCURRENT_FRAGMENTS` | `4` | Parallel fragment downloads (1–16) |
| `YTDLP_MAX_ATTEMPTS` | `2` | Retry attempts per extraction/download |
| `YTDLP_RETRY_BASE_MS` | `800` | Exponential backoff base (ms) |

## Deployment

### Docker

The image is multi-stage: Node 22 builds the app, and the runtime installs ffmpeg, a pinned yt-dlp binary, and uses that same Node as the JavaScript runtime YouTube needs. Postgres is required. bgutil (YouTube proof-of-origin tokens) and MinIO are optional profiles.

Set `POSTGRES_PASSWORD` to any local database password, then:

```bash
docker compose up --build
```

The API listens on `http://localhost:3001`. Compose sets `AUTH_DISABLED=true` so a local container can be tried without creating a key — unset that variable before exposing the port. Migrations run on startup.

```bash
# YouTube token provider
docker compose --profile bgutil up --build
# then set YTDLP_POT_BASE_URL=http://bgutil:4416 on the api service

# S3-compatible storage
docker compose --profile minio up --build
```

With the MinIO profile, set `MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD`, then point the API at the bucket with `STORAGE_DRIVER=r2`, `R2_ENDPOINT=http://minio:9000`, the same access key and secret, and `R2_BUCKET=downloads` (create the bucket in the MinIO console on port 9001).

### Railway / Render / Fly.io

Set the required environment variables and run:

```bash
pnpm prisma:deploy
pnpm start:prod
```

### Notes

- yt-dlp and ffmpeg are downloaded automatically on first run if not present; on read-only filesystems set `YTDLP_PATH` and `FFMPEG_PATH` to pre-installed binaries.
- For persistent cookie sessions across restarts, use `STORAGE_DRIVER=r2` — the API persists the refreshed cookie jar to the bucket automatically.
- The `X-Frontend-Key` / `FRONTEND_SECRET` mechanism lets you lock down the API to requests that come through your own frontend proxy without issuing an API key to every browser session.

## Contributing

Pull requests are welcome. For significant changes, please open an issue first to discuss what you'd like to change.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes
4. Push and open a pull request

## License

MIT
