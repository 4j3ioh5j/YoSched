# YoSched — Handoff Document

## What is YoSched

YoSched is a web application for scheduling hospital staff. Currently in early development — a landing page is deployed while architecture and feature requirements are defined.

**Current state:** Landing page only. Dark-themed single-page site ("YoSched is on its way") deployed via Python HTTP server + ngrok.

**Working directory:** `/home/devbox.guest/Projects/YoSched`

**Repository:** https://github.com/4j3ioh5j/YoSched

**Deployed URL:** https://clustered-ajar-default.ngrok-free.dev

**VM:** `DPH-devbox-YoSched` (Tailscale IP: 100.107.118.122, Postgres available, ngrok active on port 3000)

---

## Session Protocol

- **Start of session:** Read this file. Start the coordination bus monitor (register as `yosched`, check directives/changes/concerns).
- **During session:** Track multi-step work with task tools as needed.
- **End of session:** Update this document if scope or architecture changed. Commit and push when approved.

---

## Infrastructure

| Component | Detail |
|-----------|--------|
| VM | `DPH-devbox-YoSched` |
| Tailscale IP | 100.107.118.122 |
| Public URL | https://clustered-ajar-default.ngrok-free.dev |
| Tunnel | ngrok → port 3000 |
| Web server | Python `http.server` serving `~/app/` |
| Database | PostgreSQL 17 (available, not yet configured) |
| Repo | https://github.com/4j3ioh5j/YoSched |
| Branch | `main` |
| Coordination bus | Registered as `yosched` |

---

## Recent Work

- **May 16, 2026.** Project initialized. Landing page created and deployed. GitHub repo created. Coordination bus registered.

---

## Rules

1. Files are located in `/home/devbox.guest/Projects/YoSched`.
2. Deploy to `DPH-devbox-YoSched` VM via SSH; ngrok exposes port 3000 publicly.
3. Keep this document updated with architecture decisions, infrastructure changes, and recent work.
4. Use the coordination bus (`yosched` service) to communicate cross-project changes.
