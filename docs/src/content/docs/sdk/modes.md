---
title: Local / Remote / File Modes
description: How Tracker connects — PyO3 local write, HTTP remote, and file storage
---

The SDK supports two backends and three storage kinds.

## Local mode (default)

Without a `host`, `Tracker` writes directly through PyO3 to local storage:

```python
from trailer import Tracker
t = Tracker(project="demo")
```

- Zero external dependencies, zero network overhead
- Data lands in local SQLite (`trailer.db`) or file mode
- Runs belong to the `admin` user

## Remote mode

Set a `host` (or `TRAILER_HOST`) to write to a running server:

```python
import os
os.environ["TRAILER_HOST"] = "http://team-server:5120"
os.environ["TRAILER_TOKEN"] = "rt_xxxx"   # API token from /profile

t = Tracker(project="demo")               # data goes to the server
```

- Batches are msgpack/HTTP encoded to `/api/v1/ingest`
- Runs belong to the token's account

## Storage backends

| Storage | How to trigger | Best for |
|---------|----------------|----------|
| SQLite | default | Single machine |
| File mode | `storage="file"`, `data_dir="data"` | TensorBoard-style, versionable JSON |

```python
t = Tracker(project="exp", storage="file", data_dir="data")
```

Or via environment: `TRAILER_STORAGE=file TRAILER_DATA_DIR=data`.

## Which mode to pick

| Scenario | Mode |
|----------|------|
| Solo local experiments | Local mode (zero config) |
| Team, centralized data | Remote mode against a shared server |
| Reproducible, backup-friendly runs | File mode |
| Multi-user with access control | Server mode + Remote SDK |
