---
title: CLI 参考
description: trailer 命令行工具的使用:up / list / delete / archive / copy
---

`trailer` 命令行工具管理本地服务端与 run。

## 全局用法

```bash
trailer <command> [options]
```

## trailer up

启动本地服务端 + UI。

```bash
trailer up
trailer up --port 9090 --host 0.0.0.0
trailer up --storage file --data-dir data
trailer up --no-open          # 不自动打开浏览器
trailer up --db /path/to/trailer.db
```

| 选项 | 说明 |
|------|------|
| `--port` | 监听端口(默认 5120) |
| `--host` | 监听地址(默认 127.0.0.1) |
| `--db` | SQLite 路径或 `postgres://` URL |
| `--storage` | `sqlite` / `file` / `pg`(默认自动判断 → **SQLite**) |
| `--data-dir` | 文件模式数据目录 |
| `--frontend-dir` | 前端静态资源目录 |
| `--no-open` | 不打开浏览器 |

按 `Ctrl+C` 优雅关闭,数据无损。

## trailer list

列出 run(需要服务端运行):

```bash
trailer list
trailer list --project demo
trailer list --limit 50
```

## trailer delete / archive / copy

```bash
trailer delete run_xxx      # 删除 run(需输入确认)
trailer archive run_xxx     # 归档 run
trailer copy run_xxx        # 复制 run
```

## 认证

CLI 本地自动以 `admin/admin` 登录;远程模式需设置:

```bash
export TRAILER_HOST=http://team-server:5120
export TRAILER_TOKEN=rt_xxxx
```
