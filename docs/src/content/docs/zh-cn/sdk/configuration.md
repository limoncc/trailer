---
title: 配置与超参
description: 记录超参:config 捕获、指标方向
---

## 记录 config

```python
t = Tracker(project="demo", config={"lr": 0.01, "batch": 32})
```

config 随 run 存储，在 Run 详情页的 **Config** 标签展示，也是 [Compare](/zh-cn/ui/compare/) 页 config diff 的数据来源。

- 任意嵌套的 JSON dict，创建后不可变
- 原则：**凡是影响结果的都是超参**——seed、数据版本、框架版本、git commit 都值得记

## 指标方向

声明指标"越大越好"还是"越小越好"，`best` 按语义计算：

```python
t = Tracker(
    project="demo",
    metric_directions={
        "accuracy": "max",
        "loss": "min",
        "f1": "max",      # 对应 val/f1 或 test/f1 —— 见下方说明
    },
)
```

summary（`best` / `best_step`）会遵循这些方向。

> ⚠️ key 匹配的是**拆分 context 后的指标名**：`train/loss` 的 key 是 `loss`、`val/accuracy` 的 key 是 `accuracy`。所以这里写 `"accuracy"` 而不是 `"val/accuracy"`——写带 `/` 的全名不生效。完整的方向解析优先级（显式 > 命名约定 > 默认）见 [指标、超参与 best 语义](/zh-cn/tutorial/beyond-loss/)。
