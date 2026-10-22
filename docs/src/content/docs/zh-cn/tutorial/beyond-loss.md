---
title: 指标、超参与 best 语义
description: train/val 自动分组、config 快照、metric_directions 优先级、Step 与 Wall Time 视图
---

这一页把前两页用到的机制讲透：指标怎么命名才好用、超参怎么记才有对比价值、best 到底怎么算、step 是什么。

## 指标命名：`分组/名字` 自动分组

```python
tracker.log({"train/loss": 0.31, "val/loss": 0.42, "val/accuracy": 0.87}, step=epoch)
```

Trailer 采用 TensorBoard 风格拆分：`train/loss` 存为 **key=`loss` + context=`train`**。

- 看板 Metrics 页按 context 自动分组：`train/*` 一组、`val/*` 一组，折叠展开
- Compare / Explore 的"Metrics 分组筛选"也按 context 过滤（如只看 `val/*`）
- 不带 `/` 的指标（如 `loss`）context 为空，不进任何分组——**建议始终带分组前缀**

常见约定：`train/*` 训练集指标、`val/*` 验证集指标、`test/*` 测试集指标；也可以自定义分组如 `eval/f1`、`system/gpu_mem`。

## config：超参快照

```python
tracker = Tracker(project="exp", config={"lr": 0.01, "batch": 32, "seed": 42})
```

- `config` 是一个任意嵌套的 JSON dict，创建后不可变（Compare 的 config diff 以它为准）
- 会记录进 run 元数据，实验表格与 Compare 页直接展示
- 原则：**凡是影响结果的都是超参**——seed、数据版本、框架版本、git commit 都值得记

## metric_directions：best 怎么算

run 表格里的 best 列按指标方向（越大越好 / 越小越好）从全训练过程挑出最优值。方向按以下优先级解析：

1. **显式声明**：`Tracker(metric_directions={"accuracy": "max"})`，值支持 `max`/`maximize` 与 `min`/`minimize`
2. **命名约定**：指标名含 `acc`/`accuracy`/`auc`/`f1`/`recall`/`precision`/`score` 等 → maximize；其余 → minimize
3. **默认**：minimize

两个容易踩的点：

- `metric_directions` 的 key 匹配的是**拆分 context 后的指标名**：`val/accuracy` 的 key 是 `accuracy`，所以写 `{"accuracy": "max"}` 即可，写 `{"val/accuracy": "max"}` 不生效
- 同一个 key 在不同 context 各自独立计算 best：`train/loss` 与 `val/loss` 的 best 互不影响

`metric_directions` 会合并进 `config` 持久化，断点续训时方向声明依然有效。

## Step 语义

```python
tracker.log({"loss": 0.5}, step=10)   # 显式 step: x 轴 = 10
tracker.log({"loss": 0.4})            # 不传 step: 自动递增(首次为 0)
```

- **显式 step**：自己控制 x 轴，训练/验证共用同一刻度
- **自动步进**：连续 `log` 自动 +1，适合"每调用一次就是一步"的简单循环
- **混合使用要小心**：一旦用过显式 step，后续不传 step 会从当前内部计数继续，可能与你的刻度错位——同一 run 内建议只用一种方式
- 硬件监控（CPU / 内存 / GPU）按 step 对齐采样，在看板里与指标同轴展示；也可切到 **Wall Time** 视图看真实时间轴（调试"哪一步特别慢"很有用）

## 从 step 到 run summary

每个 `(run, 指标, context)` 会增量维护一行 summary：

| 字段 | 含义 |
|------|------|
| `last` | 最新一步的值 |
| `min` / `max` | 全过程极值 |
| `best` / `best_step` | 按方向语义的最优值与所在 step |

这就是实验表格 best / last 列的数据来源——不是每次查询重算，而是写入时增量维护，所以表格打开即出。

## 下一步

- 想记录曲线之外的数据（图像 / 表格 / 嵌入 / 损失景观）→ [高级数据类型](/zh-cn/sdk/advanced-data/)
- 多机协作与存储后端 → [本地 / 远程 / 文件模式](/zh-cn/sdk/modes/)
- 训练中断了想接着跑 → [断点续训 resume](/zh-cn/sdk/logging/#断点续训resume)
