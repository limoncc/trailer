---
title: 记录指标与数据
description: Tracker API 的核心用法:初始化、log()、step、finish
---

## Tracker 初始化

```python
from trailer import Tracker

t = Tracker(project="demo")
t = Tracker(project="demo", resume_from="run_a1b2c3")     # 恢复历史 run
t = Tracker(project="demo", config={"lr": 0.01})          # 记录超参
t = Tracker(project="demo", metric_directions={"accuracy": "max"})
```

## 记录标量指标

```python
t.log({"loss": 0.5, "accuracy": 0.91}, step=10)
```

- 一次可记录多个指标,字典 key 为指标名
- `step` 可选;不传时自动递增
- 支持 TensorBoard 风格分组命名:`train/loss`、`val/accuracy`,前端自动分组

## Step 语义

- 显式 `step`:精确控制 x 轴
- 自动步进:连续 `log` 会自动 +1
- 指标与硬件监控采样在 x 轴(step)上对齐,可切 Step / Wall Time 视图

## 断点续训(resume)

```python
t = Tracker(project="demo", resume_from="run_a1b2c3")                # 恢复:复用 run_id,从 last_step 继续
t = Tracker(project="demo", resume_from="run_a1b2c3", from_step=50)  # 从 50 步 checkpoint 重训:删除 step>50 的旧数据
```

- 传同一个 `run_id` 给 `resume_from`,新数据会追加到旧 run 而不是新建。首次运行时把 `t.run_id` 持久化(如写入 checkpoint 文件),以便日后恢复
- 恢复时 SDK 取该 run 的 last step,自动步进从 `last_step + 1` 继续;若用显式 `step=`,x 轴起点由你自己控制
- `from_step=N`(可选):**截断续训** —— 删除该 run 中 **step > N** 的全部时序数据(metrics / histograms / texts / figures / tables / media)并重算 run summary,再从 `N + 1` 继续。对应"训练到 84 步、从 50 步 checkpoint 重新开始"的场景:不截断的话旧的 51..84 会与新数据在同一步重叠,出图 / Compare / Explore 都会错乱
- resume 协商:远程模式走 HTTP(`POST /api/v1/runs/{id}/resume` + `GET /api/v1/runs/{id}/last_step`);本地模式经 PyO3 直连 Rust 存储(同库截断 + 查 last step),**不再依赖先 `trailer up`**
- 三种本地存储后端都支持续训(含截断):SQLite(`storage="sqlite"`,默认)、文件模式(`storage="file", data_dir="data"`)、PostgreSQL(`storage="postgres"`)

## 生命周期

```python
t.finish()   # 标记 run 完成(state → finished)
```

- SDK 后台每 30s 自动心跳;异常退出 60s 后 server 标记 `crashed`
- `finish()` 会刷新剩余缓冲并唤醒采样线程,确保最后一步不丢失

## 性能特性

- 写入走线程安全 `RingBuffer`(10 万条,P99 < 100µs),`log()` 不阻塞训练
- 后台 FlushThread 攒批(500 条 / 1s)批量写入,本地模式经 PyO3 直写,零网络
