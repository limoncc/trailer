---
title: Deployment
description: Local mode, server mode, PostgreSQL and file-mode storage
---

Trailer supports two run modes and three storage backends.

## Local mode (single machine, recommended to start)

`trailer up` starts the Rust server and web UI in one command:

```bash
trailer up                    # SQLite at trailer.db, port 5120
trailer up --port 9090        # custom port
trailer up --storage file --data-dir data   # file mode
```

Local SDK writes go through PyO3 directly — zero HTTP overhead.

## Server mode (team)

Run the standalone binary for multi-user sharing. Default storage is SQLite:

```bash
cargo build --release -p trailer-server
./target/release/trailer-server
```

### PostgreSQL backend

To use PostgreSQL, **three things are required**:

**1. Build with the `pg` feature** — without it the server panics on a `postgres://` URL:

```bash
cargo build --release --features pg -p trailer-server
```

**2. A running PostgreSQL with a role and database.** The connection URL is set via **`TRAILER_DATABASE_URL`** — ⚠️ **not** `TRAILER_PG_URL` (that name is ignored; the server silently falls back to local `trailer.db`):

```bash
# One-time setup: create the role and database
psql -U postgres -c "CREATE ROLE trailer WITH LOGIN PASSWORD 'trailer'"
psql -U postgres -c "CREATE DATABASE trailer_db OWNER trailer"

# Start the server against PostgreSQL
TRAILER_DATABASE_URL=postgres://trailer:trailer@127.0.0.1:5432/trailer_db \
    ./target/release/trailer-server
```

The `trailer_db` database itself must exist — create it once as an empty database (see the commands above). The schema (tables) is auto-migrated on first start. If the database is missing, the server prints the setup command instead of creating it automatically.

**3. Verify it's really on PostgreSQL** — no local `trailer.db*` file should appear in the working directory. All data lives in the `trailer_db` database.

### Self-contained binary (embed the frontend)

Compile the frontend **into** the binary, so no frontend directory is needed at runtime:

```bash
cd trailer-ui && pnpm build                       # ① build the frontend first (required)
cargo build --release --features embed-frontend -p trailer-server   # ② compile
./target/release/trailer-server                   # single self-contained binary
```

> ⚠️ `trailer-ui/build` **must exist** when compiling with `embed-frontend` — rust-embed embeds it at compile time. Rebuild the frontend whenever it changes; otherwise compilation fails with `folder does not exist`.

**Combine with PostgreSQL** — both features work together:

```bash
cd trailer-ui && pnpm build                                   # ① frontend first
cargo build --release --features pg,embed-frontend -p trailer-server   # ② both features
TRAILER_DATABASE_URL=postgres://trailer:trailer@127.0.0.1:5432/trailer_db \
    ./target/release/trailer-server
```

Frontend serving priority: explicit `--frontend-dir` / `TRAILER_FRONTEND_DIR` (disk) > embedded (`embed-frontend`) > default `trailer-ui/build` (disk). Disk mode keeps hot-reload for development; embed mode is for distribution and deployment.

- Frontend assets come from `TRAILER_FRONTEND_DIR` (disk) or are embedded at compile time (`--features embed-frontend`)
- Default admin account `admin/admin`; change the password and create API tokens from `/profile`

## Docker deployment

Deploy the full stack (trailer-server + PostgreSQL) with Docker:

```bash
cd deploy
docker compose up -d --build
```

- Web UI at http://localhost:5120
- Runs **PostgreSQL 16** + **trailer-server**; data persisted in the `pgdata` volume
- The Postgres image auto-creates the empty `trailer_db` database; tables are auto-migrated on first start

**Single-image build:**

```bash
docker build -f deploy/Dockerfile -t trailer-server .
docker run -p 5120:5120 \
  -e TRAILER_DATABASE_URL=postgres://trailer:trailer@host:5432/trailer_db \
  trailer-server
```

The image is **self-contained** — the frontend is compiled into the binary (`embed-frontend`) and PostgreSQL is enabled (`pg`), so no external frontend directory is needed.

## Storage backends

| Backend | How to use | Best for |
|---------|------------|----------|
| SQLite | default | Single machine, zero config |
| PostgreSQL | build with `--features pg` + `--database-url postgres://...` | Teams, concurrent multi-user |
| File mode | `--storage file --data-dir data` | TensorBoard-style, human-readable JSON, easy backup/versioning |

File mode layout:

```
data/[project]/[run_id]/
  run.json              ← RunMeta (config/env/owner/state)
  metrics/<key>@<ctx>.json
  histograms/<key>@<ctx>.json
  texts/<name>.json
  figures/<name>@<step>.json
  tables/<name>_<id>.json
  media/<name>_<id>.json
```

## Environment variables

| Variable | Purpose |
|----------|---------|
| `TRAILER_HOST` | Remote SDK server address (default 127.0.0.1:5120) |
| `TRAILER_TOKEN` | Remote SDK auth token |
| `TRAILER_DB` | SQLite path (default `trailer.db`) |
| `TRAILER_STORAGE` | `sqlite` / `file` / `pg` (default: **sqlite**) |
| `TRAILER_DATA_DIR` | File-mode data directory (default `data`) |
| `TRAILER_DATABASE_URL` | Database URL (SQLite path or PostgreSQL connection string) |
| `TRAILER_FRONTEND_DIR` | Frontend build directory |
| `RUST_LOG` | Log level (default `info`; e.g. `debug`, `warn`) |
| `TRAILER_LOG_DIR` | Rolling daily log directory (default `logs`) |

Precedence: CLI args > environment variables > config file > defaults.

## Multi-user and permissions

- `admin`: sees everything, manages users
- `experimenter`: sees only runs owned by them (`owner_id`)
- Writes require admin or project owner
- Anonymous sharing: run / Explore pages generate `?token=` links for read-only access
