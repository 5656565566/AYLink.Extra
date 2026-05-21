# =============================================================================
# Build Web
# =============================================================================
FROM node:20-alpine AS web-builder

WORKDIR /src/AYLink.Web

# 安装依赖
COPY AYLink.Web/package*.json ./
RUN npm install

# 拷贝源码并构建
COPY AYLink.Web ./
RUN npm run build


# =============================================================================
# Build Agent
# =============================================================================
FROM golang:1.25.1-alpine AS agent-builder

ARG SCRCPY_SERVER_VERSION=4.0

WORKDIR /src

RUN apk add --no-cache curl

# 拷贝并下载 Go 依赖
COPY AYLink.Agent/go.mod AYLink.Agent/go.sum ./AYLink.Agent/
RUN cd AYLink.Agent && go mod download

# 拷贝 Agent 源码
COPY AYLink.Agent ./AYLink.Agent/
COPY scripts/download-scrcpy-server.sh ./scripts/download-scrcpy-server.sh

# 下载并准备 scrcpy-server 供运行时直接使用
RUN SCRCPY_SERVER_VERSION=${SCRCPY_SERVER_VERSION} sh ./scripts/download-scrcpy-server.sh ./AYLink.Agent/Scrcpy

# 将 Web 构建产物拷贝到 Agent 的 www 目录下 以便 go:embed 打包
COPY --from=web-builder /src/AYLink.Agent/www ./AYLink.Agent/www/

RUN cd AYLink.Agent && \
    CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /app/aylink-agent ./cmd/agent


# =============================================================================
# Runtime Environment
# =============================================================================
FROM alpine:latest

# 设置时区和安装基础依赖 包括 adb (android-tools)
RUN apk add --no-cache tzdata ca-certificates android-tools

WORKDIR /app

# 从 builder 阶段拷贝编译好的二进制文件
COPY --from=agent-builder /app/aylink-agent .
COPY --from=agent-builder /src/AYLink.Agent/Scrcpy ./Scrcpy

# 创建数据挂载目录
RUN mkdir -p /app/data /app/Scrcpy

# 暴露 HTTP 端口 (默认 5501)
EXPOSE 5501

# 持久化数据目录
VOLUME ["/app/data"]

# 启动命令
ENTRYPOINT ["./aylink-agent"]
