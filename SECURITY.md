# Snagbox security

## Reporting

Please report Snagbox vulnerabilities privately to the repository owner. Do not open a public issue that includes exploit details, cookies, or live credentials. Give a few days for a response before discussing it publicly.

## What this API already refuses

- Authentication stays on unless `AUTH_DISABLED=true`. `NODE_ENV` is not an opt-out.
- Server-side fetches reject private, loopback, and link-local addresses, including after redirects.
- Finished files use expiring HMAC links. Webhooks use a separate HMAC header.
- Direct downloads have a timeout and a size cap.

## Secrets

`DATABASE_URL`, `FILE_LINK_SECRET`, `WEBHOOK_SECRET`, `BETTER_AUTH_SECRET`, API keys, and cookie jars must stay out of git and out of issue reports.
