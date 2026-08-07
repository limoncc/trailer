# 在 macOS 上构建 Linux(manylinux x86_64) 版 trailer SDK wheel
# 注: 不用 # syntax= 指令(避免从 docker.io 拉解析器镜像, 国内访问慢)
# 用法:
#   cd <项目根>
#   docker build --platform linux/amd64 -f deploy/sdk.Dockerfile -o dist .
# 产物: dist/trailer-<ver>-cp312-cp312-manylinux_2_28_x86_64.whl
#
# 说明: SDK wheel 除 Rust 扩展外还打包了 trailer-server 二进制与前端 build
# (见 build.py + pyproject.toml [tool.maturin].include), 故需在 Linux 容器内
# 完成: 前端构建 → server 编译 → maturin 打包。

# ── 阶段 1: 构建前端 trailer-ui/build ──
FROM node:22-alpine AS frontend
ENV COREPACK_NPM_REGISTRY=https://registry.npmmirror.com
RUN corepack enable
WORKDIR /app/trailer-ui
COPY trailer-ui/package.json trailer-ui/pnpm-lock.yaml trailer-ui/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --registry=https://registry.npmmirror.com
COPY trailer-ui/ ./
RUN pnpm build

# ── 阶段 2: manylinux 环境, 编译 server + Rust 扩展, 打包 wheel ──
FROM quay.io/pypa/manylinux_2_28_x86_64 AS sdk
#  FROM quay.io/pypa/ manylinux_2_28_aarch64 AS sdk
# 1) Rust 工具链(国内 rustup 镜像 rsproxy, 加速安装)
ENV RUSTUP_DIST_SERVER=https://rsproxy.cn \
    RUSTUP_UPDATE_ROOT=https://rsproxy.cn/rustup
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable
ENV PATH="/root/.cargo/bin:$PATH"

# 2) cargo 国内镜像(rsproxy sparse, 加速 crates.io 下载; 加大网络重试应对偶发失败)
RUN printf '[source.crates-io]\nreplace-with = "rsproxy-sparse"\n[source.rsproxy-sparse]\nregistry = "sparse+https://rsproxy.cn/index/"\n[net]\ngit-fetch-with-cli = true\nretry = 10\n' > /root/.cargo/config.toml

# 3) sqlite 开发库(sqlx 编译期链接) + 构建工具
RUN yum install -y sqlite-devel && yum clean all

# 4) Python 3.10 + maturin (manylinux 镜像自带 /opt/python/cp310-cp310; pip 走清华镜像)
ENV PATH="/opt/python/cp310-cp310/bin:$PATH"
RUN pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple "maturin>=1.5,<2.0"

# 4) 复制项目(避免把根 target/ 带入 context, .dockerignore 已排除)
WORKDIR /app
COPY Cargo.toml Cargo.lock pyproject.toml build.py ./
COPY crates/ ./crates/
COPY trailer-sdk/ ./trailer-sdk/
COPY --from=frontend /app/trailer-ui/build ./trailer-ui/build

# 5) 编译 trailer-server 并复制进包(含前端 build)
RUN python build.py

# 6) maturin 打包 manylinux wheel(server 二进制 + 前端已含在包内)
RUN maturin build --release --manylinux 2_28 --out /wheels

# ── 阶段 3: 导出 wheel ──
FROM scratch AS export
COPY --from=sdk /wheels /wheels
