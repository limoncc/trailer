---
title: CLI Reference
description: The trailer command-line tool — up / list / delete / archive / copy
---

The `trailer` command manages the local server and runs.

## Global usage

```bash
trailer <command> [options]
```

## trailer up

Start the local server and UI.

```bash
trailer up
trailer up --port 9090 --host 0.0.0.0
trailer up --storage file --data-dir data
trailer up --no-open          # do not open the browser
trailer up --db /path/to/trailer.db
```

| Option | Purpose |
|--------|---------|
| `--port` | Listen port (default 5120) |
| `--host` | Listen address (default 127.0.0.1) |
| `--db` | SQLite path or `postgres://` URL |
| `--storage` | `sqlite` / `file` / `pg` (default: auto-detected → **SQLite**) |
| `--data-dir` | File-mode data directory |
| `--frontend-dir` | Frontend static assets directory |
| `--no-open` | Do not open the browser |

Press `Ctrl+C` to shut down gracefully — data is safe.

## trailer list

List runs (requires a running server):

```bash
trailer list
trailer list --project demo
trailer list --limit 50
```

## trailer delete / archive / copy

```bash
trailer delete run_xxx      # delete a run (type to confirm)
trailer archive run_xxx     # archive a run
trailer copy run_xxx        # copy a run
```

## Authentication

The CLI auto-logs-in as `admin/admin` locally; for remote mode set:

```bash
export TRAILER_HOST=http://team-server:5120
export TRAILER_TOKEN=rt_xxxx
```
