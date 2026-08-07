# Trailer 部署（Docker）

`deploy/` 提供 trailer-server 的 Docker 镜像构建与带 PostgreSQL 的编排。

## 快速开始（推荐）

```bash
cd deploy
docker compose up -d --build
```

- 启动 **PostgreSQL 16**（`db` 服务）+ **trailer-server**（`trailer` 服务）
- 访问看板：http://localhost:5120
- PG 镜像初始化时自动创建 `trailer_db` 空库；**表结构由 server 首启自动迁移**
- 数据持久化在 Docker volume `pgdata`

停止：`docker compose down`（加 `-v` 同时删除数据卷）。

## 单镜像构建

```bash
# 在项目根
docker build -f deploy/Dockerfile -t trailer-server .
docker run -p 5120:5120 \
  -e TRAILER_DATABASE_URL=postgres://trailer:trailer@host:5432/trailer_db \
  trailer-server
```

## 镜像说明

多阶段构建：
1. **frontend**（node:20-alpine）→ `pnpm build` 生成 `trailer-ui/build`
2. **builder**（rust:1-slim）→ `cargo build --release --features pg,embed-frontend`（前端内嵌 + PG 支持）
3. **runtime**（debian:bookworm-slim）→ 仅拷入二进制 + ca-certificates

产物是**自包含二进制**（前端编译进二进制，无需外部前端目录）。

## 配置

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `TRAILER_DATABASE_URL` | `postgres://trailer:trailer@db:5432/trailer_db` | 数据库连接串 |
| `TRAILER_HOST` / `TRAILER_PORT` | `127.0.0.1` / `5120` | 监听地址/端口（compose 映射 5120） |
| `TRAILER_STORAGE` | 自动 | `sqlite` / `file` / `pg` |

> 修改端口或 PG 凭据：编辑 `docker-compose.yml` 中对应服务的 `ports` 与 `environment`。
