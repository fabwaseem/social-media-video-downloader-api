# Social Media Video Downloader API

[![CI](https://github.com/fabwaseem/social-media-video-downloader-api/actions/workflows/ci.yml/badge.svg)](https://github.com/fabwaseem/social-media-video-downloader-api/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node 22](https://img.shields.io/badge/node-22-339933.svg)](https://nodejs.org)

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template?template=https://github.com/fabwaseem/social-media-video-downloader-api)

Open-source NestJS API that downloads public videos and audio with yt-dlp. Jobs are queued, progress streams over SSE, and finished files are served through signed links.

## Quick start

```bash
git clone https://github.com/fabwaseem/social-media-video-downloader-api.git
cd social-media-video-downloader-api
pnpm install
cp .env.example .env
# set DATABASE_URL, then:
pnpm exec prisma migrate deploy
pnpm dev
```

Or with Docker (Postgres and Redis included). Copy `.env.example` to `.env` and set `BETTER_AUTH_SECRET` first (`openssl rand -hex 32`). Compose refuses to start without it.

```bash
cp .env.example .env
POSTGRES_PASSWORD=postgres docker compose up --build
```

- API: `http://localhost:3001`
- Playground: `http://localhost:3001/`
- Swagger: `http://localhost:3001/docs`
- OpenAPI: `http://localhost:3001/openapi.json`
- Metrics: `http://localhost:3001/metrics`

Compose sets `AUTH_DISABLED=true` for a local trial. Unset it before the port is reachable by anyone else.

```bash
curl -X POST http://localhost:3001/v2/downloads \
  -H 'content-type: application/json' \
  -d '{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ","kind":"video","format":"mp4"}'
```

## Platforms

| Platform | Example |
|----------|---------|
| YouTube | `https://www.youtube.com/watch?v=…` |
| Instagram | `https://www.instagram.com/reel/…` |
| TikTok | `https://www.tiktok.com/@user/video/…` |
| X / Twitter | `https://x.com/user/status/…` |
| Facebook | `https://www.facebook.com/watch?v=…` |
| Reddit | `https://www.reddit.com/r/…/comments/…` |
| Vimeo | `https://vimeo.com/…` |
| Bluesky | `https://bsky.app/profile/…/post/…` |
| Threads | `https://www.threads.net/@user/post/…` |
| Pinterest | `https://www.pinterest.com/pin/…` |
| Twitch clips | `https://clips.twitch.tv/…` |
| SoundCloud | `https://soundcloud.com/artist/track` |
| Snapchat | `https://www.snapchat.com/spotlight/…` |

Set `ALLOW_GENERIC_URLS=true` to accept any other public http(s) URL yt-dlp supports. Private, loopback, and link-local addresses are still rejected.

## Architecture

```mermaid
flowchart LR
  client[Client or playground] --> api[NestJS API]
  api --> queue[Redis queue or in-memory fallback]
  queue --> worker[Job runner]
  worker --> ytdlp[yt-dlp and ffmpeg]
  worker --> db[(Postgres)]
  worker --> files[Signed file link]
  worker --> hook[HMAC webhook]
  api --> metrics[/metrics]
```

## What you can ask for

`POST /v2/downloads` accepts `kind` (`video` or `audio`), `quality`, and `format` (`mp4`, `webm`, `mkv`, `gif`, `mp3`, `m4a`, `opus`, `wav`, `flac`).

- `embedSubtitles` / `writeSubtitles` and `subtitleLang`
- `writeThumbnail` plus `embedThumbnail` and `embedMetadata` for cover art and tags
- `videoCodec: "h264"` to re-encode to H.264
- `callbackUrl` receives a JSON POST when the job completes or fails, signed with `X-Downloader-Signature: sha256=…` (`WEBHOOK_SECRET`)

yt-dlp failures use stable `code` values: `BLOCKED`, `PRIVATE`, `GEO_RESTRICTED`, `LOGIN_REQUIRED`, `UNAVAILABLE`, `UNSUPPORTED`.

## Authentication

Requests need `X-API-Key`, `X-Frontend-Key`, or `AUTH_DISABLED=true`. `NODE_ENV` does not open the API. See `.env.example`.

Redis (`REDIS_URL`) backs the job queue, per-key rate limits, the IP throttler, and the media cache. Without it, those stay in memory and interrupted jobs are resumed from Postgres on the next boot.

## Legal

This project downloads media you already have the right to access. You are responsible for complying with the terms of each site and with copyright law. The authors do not grant any license to third-party content.

## Development

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
