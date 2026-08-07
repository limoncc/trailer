"""Trailer 示例：小型 CNN 图像分类器 — 展示增强版 log_model()"""

import os
import torch
import torch.nn as nn

# 设置远程模式（指向已启动的 trailer-server）
os.environ["TRAILER_HOST"] = "http://127.0.0.1:5120"

from trailer import Tracker


class CNNClassifier(nn.Module):
    """小型 CNN 分类器 — 用于 CIFAR-10（32×32 RGB 图像）"""

    def __init__(self, num_classes=10):
        super().__init__()
        self.features = nn.Sequential(
            # Conv Block 1
            nn.Conv2d(3, 32, kernel_size=3, padding=1),
            nn.BatchNorm2d(32),
            nn.ReLU(inplace=True),
            nn.Conv2d(32, 32, kernel_size=3, padding=1),
            nn.BatchNorm2d(32),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(kernel_size=2, stride=2),

            # Conv Block 2
            nn.Conv2d(32, 64, kernel_size=3, padding=1),
            nn.BatchNorm2d(64),
            nn.ReLU(inplace=True),
            nn.Conv2d(64, 64, kernel_size=3, padding=1),
            nn.BatchNorm2d(64),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(kernel_size=2, stride=2),

            # Conv Block 3
            nn.Conv2d(64, 128, kernel_size=3, padding=1),
            nn.BatchNorm2d(128),
            nn.ReLU(inplace=True),
            nn.Conv2d(128, 128, kernel_size=3, padding=1),
            nn.BatchNorm2d(128),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(kernel_size=2, stride=2),
        )

        self.classifier = nn.Sequential(
            nn.AdaptiveAvgPool2d((1, 1)),
            nn.Flatten(),
            nn.Dropout(0.2),
            nn.Linear(128, num_classes),
        )

    def forward(self, x):
        x = self.features(x)
        x = self.classifier(x)
        return x


def main():
    # 创建模型
    model = CNNClassifier(num_classes=10)
    model.eval()

    # 模拟一次前向推理（计算张量形状需要）
    dummy = torch.randn(1, 3, 32, 32)
    with torch.no_grad():
        _ = model(dummy)

    # 打印模型结构
    print("=" * 60)
    print("模型结构总览")
    print("=" * 60)
    total_params = sum(p.numel() for p in model.parameters())
    print(f"总参数量: {total_params:,} ({total_params/1e6:.2f}M)")
    print()

    for name, module in model.named_modules(prefix=""):
        if not name:
            continue
        p = sum(p.numel() for p in module.parameters())
        print(f"  {name:40s}  {type(module).__name__:20s}  {p:>8,} params")

    print()

    # === Trailer 记录 ===
    # 创建 Tracker（自动创建 run，并通过 HTTP 发送数据）
    tracker = Tracker(project="cnn_demo", name="cnn_classifier_cifar10")

    # 记录模型架构 — 使用增强版 log_model()
    # parse_model() 会自动:
    #   - 分类 Conv2d/BatchNorm/ReLU 等类型
    #   - 分配 section/group
    #   - 推断张量形状
    #   - 构建数据流 DAG 边
    print("正在记录模型架构到 Trailer...")
    tracker.log_model(model, name="CNNClassifier", input_shape=(1, 3, 32, 32))

    # 记录一些指标做参考
    tracker.log({"train/loss": 0.85, "val/loss": 0.92, "train/acc": 0.62}, step=0)
    tracker.log({"train/loss": 0.52, "val/loss": 0.58, "train/acc": 0.78}, step=1)

    tracker.finish()

    print(f"✓ 完成！Run ID: {tracker.run_id}")
    print(f"  打开前端 http://localhost:5173 查看效果")
    print(f"  或 http://localhost:5173/run/{tracker.run_id} 直接跳转")


if __name__ == "__main__":
    main()
