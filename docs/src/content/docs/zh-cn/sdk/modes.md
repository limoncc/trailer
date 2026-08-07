---
title: 本地 / 远程 / 文件模式
description: Tracker 的连接方式 — PyO3 本地直写、HTTP 远程、文件存储
---

SDK 支持两种后端和三种存储。

## 本地模式(默认)

不传 `host` 时,`Tracker` 通过 PyO3 直写本地存储:

```python
from trailer import Tracker
t = Tracker(project="demo")
```

- 零外部依赖、零网络开销
- 数据落到本地 SQLite(`trailer.db`)或文件模式
- run 归属 `admin` 用户

## 远程模式

设置 `host`(或 `TRAILER_HOST`)连接运行中的 server:

```python
import os
os.environ["TRAILER_HOST"] = "http://team-server:5120"
os.environ["TRAILER_TOKEN"] = "rt_xxxx"   # /profile 生成的 API token

t = Tracker(project="demo")               # 数据写到 server
```

- 批次经 msgpack/HTTP 发送到 `/api/v1/ingest`
- run 归属该 token 对应的账号

## 存储后端

| 存储 | 触发 | 适用 |
|------|------|------|
| SQLite | 默认 | 单机 |
| 文件模式 | `storage="file"`, `data_dir="data"` | TensorBoard 风格,可版本化 JSON |

```python
t = Tracker(project="exp", storage="file", data_dir="data")
```

或用环境变量:`TRAILER_STORAGE=file TRAILER_DATA_DIR=data`。

## 选哪种模式

| 场景 | 模式 |
|------|------|
| 单机本地实验 | 本地模式(零配置) |
| 团队、数据集中 | 远程模式连接共享 server |
| 可复现、易备份 | 文件模式 |
| 多用户 + 权限隔离 | Server 模式 + 远程 SDK |
