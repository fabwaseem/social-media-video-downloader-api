# Contributing

Thanks for helping. Issues and pull requests are welcome.

## Setup

Node.js 22, pnpm, and PostgreSQL. Redis is optional.

```bash
pnpm install
cp .env.example .env
pnpm exec prisma migrate deploy
pnpm test
```

## Adding a platform

1. Add one object to `PLATFORM_PLUGINS` in `packages/shared/src/platform-plugins.ts` (id, domains, URL patterns, example).
2. Add a detection case in `packages/shared/src/platforms.spec.ts`.
3. Mention it in the README matrix.

`ALLOW_GENERIC_URLS` already covers sites yt-dlp supports that do not have a plugin. A plugin is still worth adding when the URL shape is stable.

## Pull requests

- Keep changes focused.
- `pnpm lint`, `pnpm typecheck`, and `pnpm test` should pass.
- Do not commit secrets, cookie jars, or generated Prisma output.
- Prefer short commit subjects. Releases are cut by release-please from conventional titles (`feat:`, `fix:`) when you want a changelog entry.

## Reporting a broken platform

Use the "Platform broken" issue template and include the URL shape (not a private link), the HTTP status, and the `code` from the JSON error.
