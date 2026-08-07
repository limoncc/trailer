# syntax=docker/dockerfile:1
# Trailer server 多阶段构建
# 产物:自包含二进制(前端内嵌 embed-frontend + PostgreSQL 支持 pg)
# 注:使用国内镜像源加速(pnpm/npm → npmmirror,crates.io → rsproxy)

# ── 阶段 1:构建前端(trailer-ui/build,供 embed-frontend 编译期嵌入) ──
FROM node:22-alpine AS frontend
ENV COREPACK_NPM_REGISTRY=https://registry.npmmirror.com
RUN corepack enable
WORKDIR /app/trailer-ui
COPY trailer-ui/package.json trailer-ui/pnpm-lock.yaml trailer-ui/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --registry=https://registry.npmmirror.com
COPY trailer-ui/ ./
RUN pnpm build

# ── 阶段 2:编译 trailer-server(embed-frontend + pg) ──
FROM rust:1-slim AS builder
RUN apt-get update && apt-get install -y pkg-config && rm -rf /var/lib/apt/lists/*
# Rust crates.io 国内镜像(rsproxy.cn,sparse 协议)
RUN printf '[source.crates-io]\nreplace-with = "rsproxy-sparse"\n[source.rsproxy-sparse]\nregistry = "sparse+https://rsproxy.cn/index/"\n[net]\ngit-fetch-with-cli = true\n' > /usr/local/cargo/config.toml
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY crates/ ./crates/
COPY --from=frontend /app/trailer-ui/build ./trailer-ui/build
RUN cargo build --release --features pg,embed-frontend -p trailer-server

# ── 阶段 3:最小运行镜像 ──
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/trailer-server /usr/local/bin/trailer-server
EXPOSE 5120
ENTRYPOINT ["trailer-server"]
