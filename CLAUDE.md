# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Cloudflare Workers application (V2.7) that collects Cloudflare "best IP" addresses from public sources, runs server-side speed tests, and serves results via a built-in web UI. The entire application lives in a single file: `CF-Worker-BestIP-collector/_workers.js` (~1400 lines).

## Development & Deployment

No build tooling, package.json, or wrangler.toml is checked in. Deployment options:

- **Wrangler CLI**: Create a `wrangler.toml` with a KV namespace binding for `IP_STORAGE`, then `npx wrangler deploy`
- **Local dev**: `npx wrangler dev` (requires wrangler.toml)
- **Dashboard**: Paste `_workers.js` directly into the Cloudflare Workers editor

There are no tests, linting, or CI/CD pipelines.

## Architecture

Single-file Worker using Cloudflare Workers module syntax (`export default { scheduled, fetch }`).

**Two entry points:**
- `scheduled()` — Cron trigger. Calls `updateAllIPs()` to scrape IPs from 7 public sources, then `speedTestAndStore()` to test up to 25 IPs.
- `fetch()` — HTTP handler. Routes via `switch` on `url.pathname`.

**Key routes:**
- `GET /` — Full inline SPA served by `serveHTML()` (lines ~177–1145)
- `POST /update` — Manual IP collection + speed test
- `GET /ips`, `/ip.txt` — Plain text IP list
- `GET /raw` — Raw JSON from KV
- `GET /fast-ips`, `/fast-ips.txt` — Speed-tested results (JSON or text)
- `GET /itdog-data` — IP list formatted for ITDog batch TCPing
- `POST /manual-speedtest` — Server-side speed test trigger

**IP collection** (`updateAllIPs`): Fetches from 7 hardcoded URLs in batches of 3, extracts IPv4 via regex, validates (excludes private/reserved ranges), deduplicates, sorts numerically.

**Speed testing** (`speedTestAndStore`): Downloads 300KB from `speed.cloudflare.com/__down` using `cf: { resolveOverride: ip }`, batches of 2 with 1500ms delay. Results sorted by latency then bandwidth; top 25 stored as "fast IPs".

**Storage**: Cloudflare KV (`env.IP_STORAGE`) with two keys: `cloudflare_ips` (all collected IPs + metadata) and `cloudflare_fast_ips` (speed test results).

**Frontend**: Entire web UI is an inline HTML string inside `serveHTML()` — vanilla HTML/CSS/JS SPA that calls the Worker's own API endpoints.

## Key Considerations

- V2.7 removed all authentication (admin login, API tokens) for simplicity — all endpoints are public
- The frontend is embedded as a template string, not a separate file — UI changes require editing the large string in `serveHTML()`
- Speed test parameters are conservative (batch size 2, 1500ms delay) to avoid Cloudflare anomaly detection
- Cron trigger recommended every 5–12 hours
