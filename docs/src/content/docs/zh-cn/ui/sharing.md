---
title: 分享与权限
description: 匿名分享链接、admin / experimenter 角色、API token 管理
---

Server 模式下，Trailer 支持多用户、角色权限，以及把单个资源匿名分享给没有账号的人。

## 用户与角色

| 角色 | 权限 |
|------|------|
| `admin` | 管理所有项目与 run、查看全部分享、管理用户 |
| `experimenter`（默认） | 读写自己项目的数据，管理自己的 run 与分享 |

- 新注册用户默认为 `experimenter`；首个用户（本地模式 `admin/admin`）为管理员
- 权限在服务端校验：读需登录（admin 或 run owner），写需项目写权限

## API Token（Profile 页）

远程写数据、CLI 访问服务端都需要 token。在 **Profile** 页（`/profile`）自助管理：

- **生成 token**：可命名、可选有效期（永久 / 30 天 / 90 天等）；永久 token 生成时需二次确认
- **查看 / 删除**：列表展示所有 token，删除即时失效

生成后在 SDK 或 CLI 里使用：

```python
t = Tracker(project="demo", host="http://team-server:5120", token="rt_xxxx")
```

```bash
export TRAILER_HOST=http://team-server:5120
export TRAILER_TOKEN=rt_xxxx
```

> Token 等同于写入权限，请像密码一样保管，不要提交进仓库或公开日志。

## 匿名分享链接

无需对方注册账号，即可只读分享一个 run、一个 Explore 分析或一份 Report。

**创建**：在对应页面的分享入口创建链接；服务端生成随机 token 并可选过期天数（`expires_in_days`）。

**支持的资源类型**：

| resource_type | 分享内容 | 入口 |
|---------------|---------|------|
| `run` | 单个 run 的全部数据（指标、图表、媒体等） | Run 详情页 |
| `explore` | 一个已保存的 Explore 分析看板 | Explore 页 |
| `report` | 一份 Markdown 报告 | Reports 页 |

**访问**：拿到链接的人打开即可只读查看，数据经 `?token=` 校验——token 绑定具体资源且未过期才放行。匿名 token 只读，不能写入或修改。

**管理**：admin 可查看和撤销全部分享；`experimenter` 只能管理自己 run 的分享。过期或被撤销后链接立即失效。

## 相关

- [部署](../deployment/)——多用户 server 模式与 PostgreSQL
- [本地 / 远程 / 文件模式](../sdk/modes/)——SDK 如何连接远程 server
