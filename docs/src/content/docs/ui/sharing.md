---
title: Sharing and permissions
description: Anonymous share links, admin / experimenter roles, and API token management
---

In Server mode, Trailer supports multiple users, role-based permissions, and anonymous sharing of a single resource with people who don't have an account.

## Users and roles

| Role | Permissions |
|------|-------------|
| `admin` | Manage all projects and runs, view all shares, manage users |
| `experimenter` (default) | Read and write data in their own projects; manage their own runs and shares |

- Newly registered users default to `experimenter`; the first user (local mode `admin/admin`) is the admin
- Permissions are enforced server-side: reads require sign-in (admin or the run's owner), writes require project write access

## API tokens (Profile page)

Remote data logging and CLI access to the server both need a token. Manage them self-service on the **Profile** page (`/profile`):

- **Create a token**: give it a name and optionally pick an expiry (never / 30 days / 90 days, etc.); permanent tokens require a second confirmation at creation
- **View / delete**: the list shows all tokens; deletion takes effect immediately

Use the token in the SDK or CLI:

```python
t = Tracker(project="demo", host="http://team-server:5120", token="rt_xxxx")
```

```bash
export TRAILER_HOST=http://team-server:5120
export TRAILER_TOKEN=rt_xxxx
```

> A token is equivalent to write access — guard it like a password, and never commit it to a repository or paste it into public logs.

## Anonymous share links

Share a run, an Explore analysis, or a Report read-only — no account required on the other side.

**Create**: use the share entry point on the corresponding page; the server generates a random token with an optional expiry in days (`expires_in_days`).

**Supported resource types**:

| resource_type | What is shared | Where |
|---------------|----------------|-------|
| `run` | All data of a single run (metrics, charts, media, etc.) | Run detail page |
| `explore` | A saved Explore analysis dashboard | Explore page |
| `report` | A Markdown report | Reports page |

**Access**: anyone with the link can open it read-only; data is authorized via `?token=` and only served when the token matches the specific resource and hasn't expired. Anonymous tokens are read-only and can't write or modify anything.

**Manage**: admins can view and revoke all shares; `experimenter` can only manage shares of their own runs. Expired or revoked links stop working immediately.

## Related

- [Deployment](/deployment/) — multi-user server mode and PostgreSQL
- [Local / remote / file modes](/sdk/modes/) — how the SDK connects to a remote server
