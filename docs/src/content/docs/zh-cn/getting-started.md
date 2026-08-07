---
title: 快速开始
description: 5 分钟上手 Trailer — 安装、记录第一个实验、打开看板
---

## 1. 安装

发布版直接通过 pip 安装(内含 Rust 服务端二进制):

```bash
pip install trailer-sdk
```

从源码构建(开发模式):

```bash
# 编译 Rust 服务端 + 打包前端
python build.py
# 编译 PyO3 扩展(可编辑安装)
uv run maturin develop
```

## 2. 记录你的第一个实验

```python
from trailer import Tracker

t = Tracker(project="demo")
for step in range(10):
    t.log({"loss": 1.0 / (step + 1), "lr": 0.01}, step=step)
t.finish()
```

- `Tracker(project=...)` 指定项目名,自动生成 run_id
- `t.log({...}, step=step)` 记录一组标量指标
- `t.finish()` 标记 run 结束(状态变为 finished)

## 3. 打开看板

```bash
trailer up
```

浏览器自动打开 `http://127.0.0.1:5120`,你能看到刚才的 `demo` 项目和 loss 曲线。

## 4. 记录更多类型

Trailer 支持完整的数据类型:

```python
t.log_text("summary", "这是实验结果总结")              # 文本
t.log_figure(fig, name="my-plot")                     # matplotlib 图 / G2 spec
t.log_table({"epoch": [1, 2], "acc": [0.8, 0.9]})     # 表格
t.log_image(img, name="sample")                       # PIL / numpy / 路径
t.log_histogram(weights, name="w1")                   # 权重分布
t.log_pca(vectors, name="embeddings")                 # PCA 3D 散点
t.log_model(model, name="my-net")                     # PyTorch 模型结构图
```

详见 [高级数据类型](/zh-cn/sdk/advanced-data/)。

## 5. 高级参数

```python
t = Tracker(
    project="advanced-demo",
    config={"lr": 0.01, "batch": 32},# 记录超参
    metric_directions={"accuracy": "max"},  # 声明指标方向,best 按语义计算
)
```

## 远程写数据

```python
t = Tracker(
    project="demo",
    host="http://team-server:5120",
    token="rt_xxxx",                 # profile 生成的 API token
)
```

详见 [本地 / 远程 / 文件模式](/zh-cn/sdk/modes/)。
