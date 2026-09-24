# 本地模式 SQLite 访问约束（含损坏排查指南）

> 背景：迁移场景（26 Tracker + Python 只读轮询连接）出现 `database disk image is malformed`。
> 纯单写（无第二连接）零损坏；损坏与高频只读轮询强相关但根因未定罪。
> 本文记录已核实的约束、正确姿势与二分实验工具（`scripts/db-diagnostics/`）。

## 已核实的配置事实

| 项 | 值 | 说明 |
|---|---|---|
| journal_mode | WAL | sqlite.rs 连接选项 |
| synchronous | NORMAL | 断电/kill -9 存在理论丢失窗口（WAL 帧有校验，不会写坏已 fsync 内容） |
| busy_timeout | **5s**（sqlx 默认，现已显式化） | 并发写者遇 BUSY 等待而非立即报错 |
| 连接池 | max_connections=5 | 同进程多连接写属 SQLite 支持场景 |
| 周期 checkpoint | 10s `PRAGMA wal_checkpoint(TRUNCATE)`，失败静默重试 | `TRAILER_NO_CHECKPOINT=1` 可跳过（实验开关） |
| Rust bundled SQLite | **3.46.0**（libsqlite3-sys 0.30.1 bundled） | 与 Python 系统 sqlite3（如 3.43.1）WAL 格式兼容 |

## 外部脚本访问活跃库的正确姿势

1. **必须用只读 URI 打开**：
   ```python
   conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
   conn.execute("PRAGMA query_only = 1")   # 双保险
   ```
   ❌ `sqlite3.connect(db_path)`（默认 rw）——可写连接对活跃库的任何意外写入都可能干扰 checkpoint。
2. **禁止对活跃库做文件操作**：cp/mv/覆盖 `db`/`-wal`/`-shm` 任一文件。
   带着陈旧 `-wal`/`-shm` 拷贝主文件是经典损坏途径（仓库里的 `trailer_back.db` 即拷贝产物）。
   备份请走：先 `PRAGMA wal_checkpoint(TRUNCATE)`，再拷主文件；或直接拷四件套。
3. **双进程各自开连接池**（trainer PyO3 + `trailer up` server）是支持场景，
   但同机建议同一时刻只保留一个写方进程。

## 二分实验工具（`scripts/db-diagnostics/`）

| 脚本 | 作用 | 退出码 |
|---|---|---|
| `e1_ro_poll.py` | 写 + Python 只读轮询（复现主实验），`--open-mode rw` 为故意非 ro 对照 | 0=PASS / 3=REPRO |
| `e2_no_poll.py` | 同写负载无轮询对照（必须 PASS，否则结论推翻） | 同上 |
| `e3_rust_read_poll.py` | 轮询走 Rust bundled 3.46 读路径（区分双 SQLite 版本 vs 纯并发） | 同上 |
| `e4_inspect.py` | 损坏库取证：解析 integrity_check 的 Tree N → rootpage 映射（索引损坏可 REINDEX 自愈） | — |

判定矩阵：
- E1 REPRO + E2 PASS → 轮询相关
- E1 REPRO + E3 PASS → **双 SQLite 版本并发**问题（Python 3.43 vs bundled 3.46）
- E1/E3 都 REPRO → 纯读写并发问题（与版本无关，需修并发或文档禁令 + pool=1）
- E1（非 ro 打开）REPRO 而 ro 不复现 → 原轮询脚本未用只读 URI

```bash
# 典型二分流程
uv run python scripts/db-diagnostics/e2_no_poll.py --duration-s 60
uv run python scripts/db-diagnostics/e1_ro_poll.py --duration-s 120
# 复现后:
uv run python scripts/db-diagnostics/e4_inspect.py /tmp/e1.db
```

复现时**立即保存 db/-wal/-shm/-journal 四件套副本**（脚本会打印指纹与提示）。
