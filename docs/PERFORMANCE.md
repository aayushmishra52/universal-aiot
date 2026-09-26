# Performance Notes — Universal AIoT Platform

Measurements taken 2026-09-26 on Node v24.20.0 (Linux container), from the
production build (`npm run build`), backend run as `node apps/backend/dist/index.js`
against a throwaway `DATABASE_URL=file:/tmp/...`.

## Measured numbers

| Metric | Value |
|---|---|
| Backend idle RSS (booted, no traffic) | **96 MB** |
| Backend RSS after 100× `GET /api/health` (all 200) | **97 MB** |
| Dashboard `dist/` total | **348 KB** (JS 324 KB · CSS 20 KB · HTML 0.8 KB) |
| Backend `dist/` | 536 KB |
| Repo without `node_modules` | 2.9 MB |
| `node_modules` (all workspaces) | 184 MB |
| Chart libraries in dashboard bundle | **none** (grep for `chart.js` / `recharts` / `d3` → 0 hits) |

## Notes

- The 96 MB baseline is essentially V8 + Fastify + aedes + better-sqlite3;
  100 sequential health checks moved RSS by ~1 MB, so steady-state small-device
  traffic is cheap.
- SQLite runs in WAL mode at runtime (verified: `-wal`/`-shm` sidecar files).
- The command-expiry sweeper runs every `SWEEP_INTERVAL_MS` (default 10 s) but
  only flips `PENDING`/`SENT` → `EXPIRED` — it does not prune telemetry.
- No stress/load test was run (no concurrent-connection or sustained-publish
  benchmark); the numbers above are idle + light smoke traffic only.
