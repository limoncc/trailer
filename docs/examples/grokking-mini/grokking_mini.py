"""Grokking 迷你版 —— trailer 全能力跟踪教学示例。

任务: 模加法 a + b (mod p)。输入 3 个 token [a, b, "="], 模型在 "=" 位置
预测 (a + b) % p。训练集只覆盖全部 (a,b) 组合的一部分, 模型若只是死记
训练样本, 测试集永远答不对; 只有学到 mod 的真实规律才能泛化。

这正是 grokking 现象: train/acc 先爬到接近 100%(记忆), test/acc 长期
停在低位, 之后某刻突然跳到 100%(顿悟)。用 trailer 观察这条"突变"曲线。

本示例演示 trailer 的完整跟踪能力(与 `trailer-sdk/examples` 和文档
"进阶实战"章节对应):

  config            —— 超参快照, Compare 页可 diff
  metric_directions —— 声明 test/acc 越大越好, best 按语义计算
  log()             —— train/loss、train/acc、test/acc 曲线(分组命名)
  log_model         —— 模型结构图
  log_histogram     —— 注意力权重分布随训练演化
  log_pca           —— 词嵌入的 3D 投影, grokking 后数字 token 会排成 mod p 的环
  log_loss_landscape —— 权重附近损失曲面, 回放"景观随训练变平坦"
  resume_from/from_step —— 断点续训(结尾演示)

运行(几分钟, CPU/MPS 均可):

    python grokking_mini.py                  # 完整训练 + 景观
    python grokking_mini.py --epochs 300    # 更快跑完
    python grokking_mini.py --resume-demo   # 训练完后演示从 checkpoint 截断续训

训练完成后 `trailer up` 打开看板, 进入 `grokking-mini` 项目查看。
"""

from __future__ import annotations

import argparse
import copy

import torch
from torch import nn
from torch.utils.data import DataLoader, Dataset

from trailer import Tracker


# --------------------------------------------------------------------------- #
# 数据集: 模加法
# --------------------------------------------------------------------------- #
class ModAddDataset(Dataset):
    """模加法数据集。

    枚举全部 (a, b) 二元组(a, b ∈ [0, p)), 打乱后按 train_frac 切成
    train / test 两份。每行样本 = 3 个 token [a, b, "="], 标签 = (a+b)%p。
    """

    def __init__(self, p: int, train_frac: float, split: str, seed: int = 0):
        self.p = p
        rng = torch.Generator().manual_seed(seed)
        flat_ids = torch.randperm(p * p, generator=rng)  # 打乱, 让 train/test 均匀交错
        n_train = int(p * p * train_frac)
        selected = flat_ids[:n_train] if split == "train" else flat_ids[n_train:]
        self.rows = [(int(f) // p, int(f) % p, (int(f) // p + int(f) % p) % p)
                     for f in selected]

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, idx: int):
        a, b, c = self.rows[idx]
        # 第三位 token 用 p 表示 "=", 不参与分类; 数字 a/b 直接当 token id。
        return (torch.tensor([a, b, self.p], dtype=torch.long),
                torch.tensor(c, dtype=torch.long))


# --------------------------------------------------------------------------- #
# 模型: 单层 Transformer
# --------------------------------------------------------------------------- #
class MultiHeadAttention(nn.Module):
    """双向多头 self-attention, 让 "=" 位置同时汇聚 a 和 b 的信息。"""

    def __init__(self, d_model: int, n_heads: int):
        super().__init__()
        assert d_model % n_heads == 0
        self.n_heads = n_heads
        self.head_dim = d_model // n_heads
        self.scale = self.head_dim ** -0.5
        self.w_q = nn.Linear(d_model, d_model)
        self.w_k = nn.Linear(d_model, d_model)
        self.w_v = nn.Linear(d_model, d_model)
        self.w_o = nn.Linear(d_model, d_model)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        b, s, _ = x.shape
        q = self.w_q(x).view(b, s, self.n_heads, self.head_dim).transpose(1, 2)
        k = self.w_k(x).view(b, s, self.n_heads, self.head_dim).transpose(1, 2)
        v = self.w_v(x).view(b, s, self.n_heads, self.head_dim).transpose(1, 2)
        attn = torch.softmax((q @ k.transpose(-2, -1)) * self.scale, dim=-1)
        x = (attn @ v).transpose(1, 2).reshape(b, s, -1)
        return self.w_o(x)


class GrokkingMini(nn.Module):
    """极简单层 Transformer: 词嵌入 + 位置嵌入 → attention → MLP → 输出。"""

    def __init__(self, p: int, d_model: int = 64, n_heads: int = 4, d_mlp: int = 128):
        super().__init__()
        self.p = p
        self.tok_emb = nn.Embedding(p + 1, d_model)
        self.pos_emb = nn.Parameter(torch.zeros(3, d_model))
        self.attn = MultiHeadAttention(d_model, n_heads)
        self.mlp = nn.Sequential(nn.Linear(d_model, d_mlp), nn.ReLU(), nn.Linear(d_mlp, d_model))
        self.unembed = nn.Linear(d_model, p)

    def forward(self, tokens: torch.Tensor) -> torch.Tensor:
        x = self.tok_emb(tokens) + self.pos_emb[: tokens.shape[1]].unsqueeze(0)
        x = self.mlp(self.attn(x))
        return self.unembed(x[:, -1])  # 只取 "=" 位置预测


@torch.no_grad()
def evaluate(model: nn.Module, loader: DataLoader, device: torch.device) -> float:
    """在给定数据加载器上计算分类准确率(返回 0~1)。"""
    model.eval()
    correct = total = 0
    for tokens, labels in loader:
        tokens, labels = tokens.to(device), labels.to(device)
        correct += (model(tokens).argmax(-1) == labels).sum().item()
        total += labels.numel()
    return correct / total if total else 0.0


def _fixed_batches(ds: Dataset, batch_size: int, nbatches: int) -> list:
    """取固定的前 nbatches 个 batch 作景观评估子集 —— 帧间可比的前提。"""
    out = []
    for tokens, labels in DataLoader(ds, batch_size=batch_size, shuffle=False):
        out.append((tokens, labels))
        if len(out) >= nbatches:
            break
    return out


# --------------------------------------------------------------------------- #
# 训练 + trailer 跟踪
# --------------------------------------------------------------------------- #
def train(args: argparse.Namespace) -> dict:
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    torch.manual_seed(args.seed)

    model = GrokkingMini(args.p, d_model=args.d_model, n_heads=args.n_heads,
                         d_mlp=args.d_mlp).to(device)
    train_ds = ModAddDataset(args.p, args.train_frac, "train", args.seed)
    test_ds = ModAddDataset(args.p, args.train_frac, "test", args.seed)
    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True)
    test_loader = DataLoader(test_ds, batch_size=args.batch_size)

    # 景观评估子集: 每帧复用同一批数据, 保证跨 epoch 可比
    ls_train = _fixed_batches(train_ds, args.batch_size, args.landscape_nbatches)

    tracker = Tracker(
        project="grokking-mini",
        name=f"p{args.p}-wd{args.weight_decay}",
        config={
            "task": "a + b mod p",
            "p": args.p,
            "train_frac": args.train_frac,
            "epochs": args.epochs,
            "batch_size": args.batch_size,
            "lr": args.lr,
            "d_model": args.d_model,
            "d_mlp": args.d_mlp,
            "weight_decay": args.weight_decay,
            "seed": args.seed,
            "device": str(device),
            "landscape_n": args.landscape_n,
        },
        # test/acc 越大越好; train/loss 由命名约定自动推断为 minimize
        metric_directions={"test/acc": "max", "train/acc": "max"},
        resume_from=args.resume_from,
        from_step=args.from_step,
    )

    tracker.log_model(model, name="GrokkingMini")  # 模型结构图

    criterion = nn.CrossEntropyLoss()
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr,
                                  weight_decay=args.weight_decay)

    memorized: nn.Module | None = None  # 记忆期快照, 用于插值景观
    history = {}
    for epoch in range(1, args.epochs + 1):
        model.train()
        total_loss = correct = n = 0
        for tokens, labels in train_loader:
            tokens, labels = tokens.to(device), labels.to(device)
            loss = criterion(model(tokens), labels)
            optimizer.zero_grad(); loss.backward(); optimizer.step()
            total_loss += loss.item() * labels.numel()
            correct += (model(tokens).argmax(-1) == labels).sum().item()
            n += labels.numel()

        train_loss, train_acc = total_loss / n, correct / n
        test_acc = evaluate(model, test_loader, device)

        # 抓记忆期快照: 训练集背熟、测试集还没泛化的那一刻(只出现一次)
        just_memorized = False
        if memorized is None and train_acc >= 0.999 and test_acc < 0.5:
            memorized = copy.deepcopy(model)
            just_memorized = True

        if epoch % args.log_every == 0 or test_acc >= 1.0:
            history[epoch] = {"train/loss": train_loss, "train/acc": train_acc, "test/acc": test_acc}
            print(f"epoch {epoch:5d} | train_loss {train_loss:.4f} | "
                  f"train_acc {train_acc:.3f} | test_acc {test_acc:.3f}")
            tracker.log({"train/loss": train_loss, "train/acc": train_acc, "test/acc": test_acc},
                        step=epoch)
            # 权重分布演化: detach→cpu→numpy, log_histogram 需一维数组
            tracker.log_histogram(model.attn.w_q.weight.detach().cpu().numpy().tolist(),
                                  name="attn/w_q", step=epoch)
            tracker.log_histogram(model.unembed.weight.detach().cpu().numpy().tolist(),
                                  name="unembed/weight", step=epoch)
            # 词嵌入 3D 投影: grokking 后数字 token 会排成 mod p 的环形结构
            tracker.log_pca(model.tok_emb.weight.detach().cpu().numpy(),
                            name="tok_emb", step=epoch)

        # 损失景观: 第 1 轮 / 周期 / 刚记忆 / grokking 完成那刻
        if args.landscape_every > 0 and (
            epoch == 1 or epoch % args.landscape_every == 0
            or just_memorized or test_acc >= 1.0
        ):
            t0 = __import__("time").time()
            tracker.log_loss_landscape(model, ls_train, n=args.landscape_n,
                                       step=epoch, seed=0, name="landscape/train")
            if memorized is not None:
                tracker.log_loss_landscape(model, ls_train, model_b=memorized,
                                           n=args.landscape_n, step=epoch, seed=0,
                                           name="landscape/interp",
                                           meta={"between": f"记忆期 {epoch} ↔ 当前"})
            print(f"         [landscape] @{epoch} ({__import__('time').time() - t0:.1f}s)")

        if test_acc >= 1.0:
            print(f"grokking 完成: epoch {epoch}")
            break

    tracker.finish()
    return {"run_id": tracker.run_id, "history": history}


def resume_demo(args: argparse.Namespace) -> None:
    """断点续训演示: 从已有 run 的第 from_step 步截断并重训。

    对应"训练到 N 步、从 checkpoint 的 K 步重来"的场景 —— from_step 会删除
    step > K 的旧区间再继续, 避免新旧数据在同一步重叠导致出图错乱。
    """
    if args.resume_from is None:
        raise SystemExit("需要 --resume-from <run_id>(可从 `trailer list` 或看板复制)")
    print(f"截断续训: run={args.resume_from}, 删除 step > {args.from_step} 的旧数据")
    args.epochs = min(args.epochs, (args.from_step or 0) + 50)  # 续训不必跑满
    train(args)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Grokking 迷你版 + trailer 全能力跟踪")
    parser.add_argument("--p", type=int, default=31, help="模数(样本数 = p*p, 默认 31 → 961 样本)")
    parser.add_argument("--train-frac", type=float, default=0.5)
    parser.add_argument("--epochs", type=int, default=1000)
    parser.add_argument("--batch-size", type=int, default=128)
    # 容量 + 学习率是触发 grokking 的关键: 迷你默认值经实测可在 ~800 epoch 内
    # 观察到完整跳变(train_acc 一直 100%, test_acc 低位横盘后冲到 100%)。
    # 容量太小(如 d_model=64)或 lr 太小(1e-3)只会停在记忆态。
    parser.add_argument("--d-model", type=int, default=128)
    parser.add_argument("--n-heads", type=int, default=4)
    parser.add_argument("--d-mlp", type=int, default=512)
    parser.add_argument("--lr", type=float, default=3e-3, help="太小只停在记忆态, 太大震荡")
    parser.add_argument("--weight-decay", type=float, default=1.0, help="大权重衰减是诱导 grokking 的关键")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--log-every", type=int, default=5)
    parser.add_argument("--landscape-every", type=int, default=50)
    parser.add_argument("--landscape-n", type=int, default=15, help="景观网格分辨率, 迷你版用小网格省时")
    parser.add_argument("--landscape-nbatches", type=int, default=1)
    parser.add_argument("--resume-from", type=str, default=None, help="断点续训的目标 run_id")
    parser.add_argument("--from-step", type=int, default=None, help="截断续训: 删除 step > N 的旧数据")
    parser.add_argument("--resume-demo", action="store_true", help="训练完后演示截断续训")
    args = parser.parse_args()

    result = train(args)
    print(f"\n完成: run_id={result['run_id']}")
    if args.resume_demo:
        resume_demo(argparse.Namespace(**{**vars(args), "resume_from": result["run_id"],
                                          "from_step": args.epochs // 2}))
