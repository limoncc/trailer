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

## 生命周期

```python
t.finish()   # 标记 run 完成(state → finished)
```

- SDK 后台每 30s 自动心跳;异常退出 60s 后 server 标记 `crashed`
- `finish()` 会刷新剩余缓冲并唤醒采样线程,确保最后一步不丢失

## 性能特性

- 写入走线程安全 `RingBuffer`(10 万条,P99 < 100µs),`log()` 不阻塞训练
- 后台 FlushThread 攒批(500 条 / 1s)批量写入,本地模式经 PyO3 直写,零网络
