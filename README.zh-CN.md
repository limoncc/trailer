[English](README.md) | **中文**

# Trailer

> 新一代 **ML 实验追踪** — 高性能 Rust 核心 + Python SDK + 丰富 Web UI，本地优先。

深度学习实验的终极 trailer — 融合 TensorBoard 的深度、Aim 的流畅与 W&B 的生态，由高性能 Rust 核心驱动。

## 特性

- ⚡ **高性能 Rust 核心** — LTTB 降采样、批量写入、10 万级环形缓冲（P99 < 100µs）
- 📊 **全数据类型** — 标量、文本、图表、表格、媒体、直方图、嵌入、PCA、模型图
- 🚀 **一行命令本地模式** — `trailer up` 启动完整看板，零配置、零 HTTP 开销，数据本地落盘
- 🔬 **跨项目 Explore** — 折线、散点、平行坐标图跨 run 分析，可保存分享
- 🗄️ **灵活存储** — SQLite（默认）、PostgreSQL、TensorBoard 风格文件模式
- 👥 **多用户与权限** — admin / experimenter 角色，匿名分享链接
- 🔍 **强大的 Compare** — 渐进式加载的跨 run 对比

## 截图

<img src="docs/public/ScreenShot_1.png" width="32%"/> <img src="docs/public/ScreenShot_2.png" width="32%"/> <img src="docs/public/ScreenShot_3.png" width="32%"/>

<img src="docs/public/ScreenShot_4.png" width="32%"/> <img src="docs/public/ScreenShot_5.png" width="32%"/> <img src="docs/public/ScreenShot_6.png" width="32%"/>

<img src="docs/public/ScreenShot_7.png" width="32%"/> <img src="docs/public/ScreenShot_8.png" width="32%"/> <img src="docs/public/ScreenShot_9.png" width="32%"/>

## 快速开始

```bash
pip install trailer-sdk
```

```python
from trailer import Tracker

t = Tracker(project="my_experiment")
t.log({"train/loss": 0.5, "val/loss": 0.6})
t.finish()
```

启动看板：

```bash
trailer up          # http://127.0.0.1:5120
```

## 文档

完整文档（中英）：**https://limoncc.github.io/trailer/**

## 许可证

[Elastic License 2.0](LICENSE) — 公司内部使用免费；商业托管 / SaaS 需单独授权。见 [LICENSING.md](LICENSING.md)。
