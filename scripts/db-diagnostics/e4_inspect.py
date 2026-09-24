"""E4:损坏库取证——定位「Tree N」对应的表/索引,输出结论与建议。

用法:
  uv run python scripts/db-diagnostics/e4_inspect.py /tmp/损坏.db [--wal x-wal --shm x-shm]
  # 只读打开(mode=ro);损坏严重时自动降级尝试可恢复的检查项。
"""

import argparse
import sqlite3


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("db")
    ap.add_argument("--wal")
    ap.add_argument("--shm")
    args = ap.parse_args()

    print(f"[E4] inspect {args.db}")
    conn = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)

    # 1. integrity_check 全文
    try:
        rows = conn.execute("PRAGMA integrity_check").fetchall()
        msgs = [str(r[0]) for r in rows]
        bad = [m for m in msgs if m != "ok"]
        print(f"integrity_check: {len(msgs)} 行,异常 {len(bad)} 条")
        for m in bad[:10]:
            print(f"  - {m}")
        # 解析 Tree N
        trees = sorted({int(m.split("bad tree")[0].split("Tree")[1].strip()) for m in bad if "Tree" in m})
    except Exception as e:
        print(f"integrity_check 失败: {e}")
        trees = []

    # 2. rootpage → 表/索引映射
    try:
        mapping = {}
        for typ, name, root in conn.execute("SELECT type,name,rootpage FROM sqlite_master"):
            mapping[root] = f"{typ}:{name}"
        print("rootpage 映射(部分):")
        for root in sorted(mapping)[:20]:
            print(f"  page {root} → {mapping[root]}")
        for t in trees:
            print(f">>> Tree {t} = {mapping.get(t, '(不在 sqlite_master,可能为内部/溢出页或已损坏映射)')}")
            if t in mapping:
                kind = mapping[t]
                if "index" in kind:
                    print(f"    → 结论:索引损坏,可 REINDEX {kind.split(':',1)[1]} 自愈,数据本体无损")
                else:
                    print(f"    → 结论:表本体页损坏,较严重,建议从源数据重迁")
    except Exception as e:
        print(f"sqlite_master 查询失败(损坏较重): {e}")
        print(">>> 请保存 db/-wal/-shm 四件套副本,用 sqlite3 CLI(3.46) 与 PRAGMA dump 做离线分析")

    # 3. 建议
    print("\n建议:")
    print("  1. 立即复制四件套(db/-wal/-shm/-journal)留存")
    print("  2. 记录当时写入方(RustTracker/server)与读者的打开方式(ro URI? rw? 有无文件操作)")
    print("  3. 跑 E1/E2/E3 二分定位复现路径")


if __name__ == "__main__":
    main()
