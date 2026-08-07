---
title: 部署
description: 本地模式、Server 模式、PostgreSQL 与文件模式的部署方式
---

Trailer 支持两种运行形态和三种存储后端,按需选择。

## 本地模式(单机,推荐入门)

`trailer up` 一条命令启动 Rust 服务端 + 前端看板:

```bash
trailer up                    # 默认 SQLite 于 trailer.db,端口 5120
trailer up --port 9090        # 自定义端口
trailer up --storage file --data-dir data   # 文件模式
```

SDK 本地写数据时走 PyO3 直写,零 HTTP 开销。

## Server 模式(团队)

独立二进制运行,多用户共享。默认存储为 SQLite:

```bash
cargo build --release -p trailer-server
./target/release/trailer-server
```

### PostgreSQL 后端

使用 PostgreSQL 需要**满足三件事**:

**1. 编译时带 `pg` feature** —— 否则遇到 `postgres://` 连接串会直接 panic:

```bash
cargo build --release --features pg -p trailer-server
```

**2. 运行中的 PostgreSQL + 角色 + 数据库。** 连接串通过 **`TRAILER_DATABASE_URL`** 设置 —— ⚠️ **不是** `TRAILER_PG_URL`(那个变量会被忽略,server 静默回退到本地 `trailer.db`):

```bash
# 一次性初始化:创建角色和数据库
psql -U postgres -c "CREATE ROLE trailer WITH LOGIN PASSWORD 'trailer'"
psql -U postgres -c "CREATE DATABASE trailer_db OWNER trailer"

# 用 PostgreSQL 启动 server
TRAILER_DATABASE_URL=postgres://trailer:trailer@127.0.0.1:5432/trailer_db \
    ./target/release/trailer-server
```

`trailer_db` 数据库本身需先存在(按上面命令建一次空库即可);表结构由 server 首次启动自动迁移。若数据库缺失,server 会打印建库提示(不会自动建库)。

**3. 验证确实在用 PostgreSQL** —— 工作目录不应出现本地 `trailer.db*` 文件。所有数据都在 `trailer_db` 数据库中。

### 自包含二进制(内嵌前端)

把前端**编译进**二进制,运行时无需前端目录:

```bash
cd trailer-ui && pnpm build                       # ① 先构建前端(必须)
cargo build --release --features embed-frontend -p trailer-server   # ② 编译
./target/release/trailer-server                   # 单文件自包含,UI 内置
```

> ⚠️ 带 `embed-frontend` 编译时,`trailer-ui/build` **必须存在** —— rust-embed 在编译期嵌入它。前端变更后需重建,否则编译报 `folder does not exist`。

**与 PostgreSQL 组合使用** —— 两个 feature 可并存:

```bash
cd trailer-ui && pnpm build                                   # ① 先构建前端
cargo build --release --features pg,embed-frontend -p trailer-server   # ② 同时启用
TRAILER_DATABASE_URL=postgres://trailer:trailer@127.0.0.1:5432/trailer_db \
    ./target/release/trailer-server
```

前端服务优先级:显式 `--frontend-dir` / `TRAILER_FRONTEND_DIR`(磁盘) > 编译时嵌入(`embed-frontend`) > 默认 `trailer-ui/build`(磁盘)。磁盘模式保留开发热更新;嵌入模式用于发布/分发。

- 前端资源来自 `TRAILER_FRONTEND_DIR`(磁盘)或编译时内嵌(`--features embed-frontend`)
- 默认管理员账号 `admin/admin`,登录后建议在 `/profile` 修改密码并生成 API token

## Docker 部署

用 Docker 一键部署完整栈(trailer-server + PostgreSQL):

```bash
cd deploy
docker compose up -d --build
```

- 看板:http://localhost:5120
- 运行 **PostgreSQL 16** + **trailer-server**;数据持久化在 `pgdata` volume
- Postgres 镜像自动创建空库 `trailer_db`;表结构首启自动迁移

**单镜像构建:**

```bash
docker build -f deploy/Dockerfile -t trailer-server .
docker run -p 5120:5120 \
  -e TRAILER_DATABASE_URL=postgres://trailer:trailer@host:5432/trailer_db \
  trailer-server
```

镜像为**自包含** —— 前端编译进二进制(`embed-frontend`)+ 启用 PostgreSQL(`pg`),无需外部前端目录。

## 存储后端

| 后端 | 触发 | 适用 |
|------|------|------|
| SQLite | 默认 | 单机,零配置 |
| PostgreSQL | `--features pg` 编译 + `--database-url postgres://...` | 团队,多用户并发 |
| 文件模式 | `--storage file --data-dir data` | TensorBoard 风格,数据可读 JSON,易备份/版本控制 |

文件模式数据结构:

```
data/[project]/[run_id]/
  run.json              ← RunMeta(config/env/owner/state)
  metrics/<key>@<ctx>.json
  histograms/<key>@<ctx>.json
  texts/<name>.json
  figures/<name>@<step>.json
  tables/<name>_<id>.json
  media/<name>_<id>.json
```

## 环境变量

| 变量 | 说明 |
|------|------|
| `TRAILER_HOST` | SDK 远程模式服务端地址(默认 127.0.0.1:5120) |
| `TRAILER_TOKEN` | SDK 远程模式认证 token |
| `TRAILER_DB` | SQLite 路径(默认 `trailer.db`) |
| `TRAILER_STORAGE` | `sqlite` / `file` / `pg`(默认 **sqlite**) |
| `TRAILER_DATA_DIR` | 文件模式数据目录(默认 `data`) |
| `TRAILER_DATABASE_URL` | 数据库 URL(SQLite 路径或 PostgreSQL 连接串) |
| `TRAILER_FRONTEND_DIR` | 前端构建产物目录 |
| `RUST_LOG` | 日志级别(默认 `info`;如 `debug`、`warn`) |
| `TRAILER_LOG_DIR` | 按天轮转日志目录(默认 `logs`) |

配置优先级:CLI 参数 > 环境变量 > 配置文件 > 默认值。

## 多用户与权限

- `admin`:查看全部数据,管理用户
- `experimenter`:只能看到自己(`owner_id`)的 run
- 写操作仅 admin / 项目 owner
- 匿名共享:run 页 / Explore 页生成 `?token=` 链接,只读访问
