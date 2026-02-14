# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Multi-project repository for Cloudflare CDN "best IP" selection. Collects Cloudflare IP addresses from public sources, tests them via ITDog batch ping from Chinese ISP nodes, and serves results through a web UI.

## Repository Structure

Three independent sub-projects (each with its own `.git`):

- **`CF-Worker-BestIP-collector/`** — Main Cloudflare Worker (V2.9), single file `_workers.js` (~1500 lines). Collects IPs, runs ITDog batch ping server-side, serves web UI.
- **`itdog-batch-ping/`** — Standalone Python scripts (`itdog_ping.py`, `itdog_http.py`) for ITDog batch ping/HTTP testing. Dependencies: `requests`, `websockets`.
- **`itdog-skill/`** — Clawdbot skill plugin wrapping ITDog client. Entry point: `scripts/itdog_client.py`. Has its own `SKILL.md` and `CLAUDE.md`.

## Development & Deployment

No build tooling, package.json, or wrangler.toml is checked in. No tests, linting, or CI/CD.

- **Deploy Worker**: Create `wrangler.toml` with KV binding `IP_STORAGE`, then `npx wrangler deploy`
- **Local dev**: `npx wrangler dev` (requires wrangler.toml)
- **Dashboard**: Paste `_workers.js` into Cloudflare Workers editor
- **Python scripts**: `pip install requests websockets`, then `python itdog_ping.py` or `python itdog_http.py`

## Worker Architecture (`_workers.js`)

Single-file Cloudflare Worker using module syntax (`export default { scheduled, fetch }`).

**Entry points:**
- `scheduled()` — Cron trigger. Runs `updateAllIPs()` then `runItdogBatchPing()` to collect and test IPs.
- `fetch()` — HTTP handler. Routes via `switch` on `url.pathname`.

**Key routes:**
- `GET /` — Inline SPA served by `serveHTML()` (lines ~76–910, entire HTML/CSS/JS as template string)
- `POST /update` — Manual IP collection + ITDog speed test
- `GET /ips`, `/ip.txt` — Plain text IP list
- `GET /raw` — Raw JSON from KV
- `GET /fast-ips`, `/fast-ips.txt` — Speed-tested results (JSON or text)
- `GET /itdog-data` — IP list formatted for ITDog batch TCPing
- `POST /itdog-batch-ping` — Trigger server-side ITDog batch ping
- `GET /itdog-batch-ping-result` — Fetch stored ITDog ping results

**IP collection** (`updateAllIPs`, line ~1321): Fetches from 7 hardcoded URLs in batches of 3, extracts IPv4 via regex, validates (excludes private/reserved ranges), deduplicates, sorts numerically.

**Speed testing** (`runItdogBatchPing`, line ~1019): V2.9 replaced the old `speedTestAndStore` (which downloaded from `speed.cloudflare.com`) with ITDog batch ping. The Worker acts as an ITDog client: bypasses anti-bot cookies (guard/guardret via XOR + `"PTNo2n3Ev5"`), creates a ping task, derives `task_token` via MD5 with salt `"token_20230313000136kwyktxb0tgspm00yo5"`, then collects results over WebSocket. Fast IPs computed by averaging ping latency across nodes, top 25 stored.

**KV keys** (namespace `IP_STORAGE`):
- `cloudflare_ips` — All collected IPs + metadata
- `cloudflare_fast_ips` — Top 25 IPs by average ITDog ping latency
- `itdog_ping_results` — Raw ITDog batch ping results

**Frontend**: Entire web UI is an inline HTML template string inside `serveHTML()` — vanilla HTML/CSS/JS SPA. UI changes require editing this large string.

## Key Considerations

- All endpoints are public (no authentication since V2.7)
- ITDog anti-bot constants (`GUARD_XOR_SUFFIX`, `ITDOG_SALT`) are hardcoded and may need updating if ITDog changes them
- ITDog limits: max 200 IPs per batch ping task
- WebSocket collection uses 5-second per-message timeout
- Cron trigger recommended every 5–12 hours
