# Finance Dashboard Electron

Electron wrapper for the Finance Dashboard with USB pendrive auto-login.

## How It Works

1. User opens the app — it loads the dashboard from `DASHBOARD_URL`
2. App polls for removable USB drives every 2 seconds
3. When a provisioned drive is detected, reads `.monday-token` + drive hardware serial
4. Computes `SHA256(uuid + drive_serial)` and sends to backend for validation
5. Auto-login completes — no manual input needed

Copying `.monday-token` to another drive won't work — different serial = different hash.

## Setup

```bash
pnpm install
cp .env.example .env
```

Edit `.env`:

```
DASHBOARD_URL=https://findash.sykventure.com
```

## Commands

| Command | What it does |
|---------|-------------|
| `pnpm dev` | Compiles + launches the app |
| `pnpm build` | Compiles + packages into `.app` (Mac) or `.exe` (Windows) |
| `pnpm watch` | Auto-recompile on file changes |

## Build

```bash
pnpm build
```

- **macOS**: `release/mac-arm64/Monday Finance.app`
- **Windows**: `release/win-unpacked/Monday Finance.exe`

Double-click to open. No terminal needed.

## USB Token Provisioning

Provisioning is handled by a separate admin-only app: **FinanceTokenProvisioner**. Do not bundle provisioning with this user-facing app.

## Project Structure

```
src/
├── main.ts          — Electron main process: loads dashboard, starts USB watcher
├── preload.ts       — Context bridge (exposes window.electronAPI for auto-login)
├── usb-watcher.ts   — Polls removable drives, reads token, computes derived hash
├── drives.ts        — Cross-platform removable drive enumeration (no native deps)
└── drive-serial.ts  — Reads USB hardware serial (system_profiler / wmic)
```
