# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Python scripts that automate batch ping and HTTP speed testing via itdog.cn's WebSocket-based protocol. Reverse-engineers itdog.cn's anti-bot cookie verification and WebSocket task authentication to programmatically run network tests from ISP nodes across China. Primary use case: selecting optimal Cloudflare CDN nodes.

## Running

```bash
python itdog_ping.py    # batch ping test
python itdog_http.py    # HTTP speed test
```

Dependencies (no requirements.txt exists): `requests`, `websockets`

No build, test, or lint tooling is configured. Black formatter is referenced in IDE settings but not enforced.

## Architecture

Both scripts share an identical structure:

1. **Anti-bot bypass** (`x()` + `set_ret()`): Computes a `guardret` cookie from the `guard` cookie using XOR encryption with hardcoded key suffix `"PTNo2n3Ev5"`, arithmetic transformation, and base64 encoding.

2. **Task initiation** (`cloudflare_hit()`): POSTs to `itdog.cn/http/` (or `/batch_ping/`), extracts `wss_url` and `task_id` from the HTML response via regex, then derives `task_token` using MD5 with salt `"token_20230313000136kwyktxb0tgspm00yo5"`.

3. **WebSocket data collection** (`get_data()`): Connects to the extracted WSS URL, authenticates with `task_id`/`task_token`, and receives JSON results until a `"finished"` message arrives. 5-second timeout per message.

## Known Issues

- `itdog_ping.py` and `itdog_http.py` currently contain identical code (both target the `/http/` endpoint). The README describes `itdog_ping.py` as having a distinct `itdog_batch_ping()` function targeting `/batch_ping/`, but the checked-in file doesn't match.

## Reference Data

- `JavaScript_sample/` — Captured and minified JS from itdog.cn (pre/post 2023-12-23 versions) used for reverse-engineering the WebSocket protocol.
- `Cloudflare_Data/` — Sample Excel output files with node speed test results.
- README contains a full node ID reference table for itdog.cn ISP test nodes.
