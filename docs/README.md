# AYLink (安易连)

[![License](https://img.shields.io/badge/License-Apache2.0-blue.svg)](../LICENSE)
![Go](https://img.shields.io/badge/Go-1.25+-00ADD8.svg?logo=go&logoColor=white)
![Vue](https://img.shields.io/badge/Vue-3.5-42B883.svg?logo=vue.js&logoColor=white)

**简体中文**

**安易连（AYLink）** 是一套基于 [scrcpy](https://github.com/Genymobile/scrcpy) 与 WebRTC 的安卓设备管理与投屏方案，当前仓库包含：

- `AYLink.Agent`：Go 编写的服务端，负责 ADB、scrcpy、鉴权、设备管理与 WebRTC 信令
- `AYLink.Web`：Vue 3 编写的 Web 管理界面
- 如果你在找本机客户端 [AYLink](https://github.com/5656565566/AYLink) 该仓库包含了一个跨平台的桌面客户端，性能更佳

> [!TIP]
> 项目仍在持续迭代中。功能已经可用，但在不同设备、网络与编码器环境下仍可能遇到兼容性问题，欢迎通过 Issue 或 PR 一起完善。

## ✨ 核心特性

- **低延迟投屏与控制**：基于 scrcpy + WebRTC，支持触摸、键盘、鼠标与 HID 输入链路
- **设备管理**：查看在线设备、连接状态、无线 ADB 配对与常用操作
- **文件管理**：浏览、下载、删除、重命名设备文件
- **应用管理**：查看应用列表、启动应用、按应用发起投屏
- **终端能力**：通过 WebSocket 访问设备 Shell 终端
- **账号与权限**：内置本地账号、角色与权限模型，支持服务端 RBAC
- **WebRTC 网络配置**：支持 STUN/TURN、Host Candidate 覆写、单端口映射等部署方式

## 📸 界面展示

| **主界面** | **投屏窗口** |
| :---: | :---: |
| ![主界面](screenshot/1.png) | ![投屏窗口](screenshot/2.png) |
| **主要设置** | **权限设置** |
| ![主要设置](screenshot/3.png) | ![权限设置](screenshot/4.png) |

## 🚀 快速开始

### 前置准备

1. 安卓设备开启“开发者选项”
2. 打开“USB 调试”
3. 如需无线调试，按设备系统版本开启“无线调试”或先通过 USB 建立 ADB
4. 准备好 `adb`

### 方式一：本地开发运行

1. 安装依赖：
   - Go 1.25+
   - Node.js 20+
   - Android ADB
2. 复制配置文件
3. 根据本机环境调整 [config.example.json](F:/project/csharp_app/AYLink.Extra/AYLink.Agent/config.example.json) 中的 ADB 与 `scrcpy-server` 路径
4. 启动服务端：

```powershell
cd AYLink.Agent
go run ./cmd/agent
```

5. 首次启动时，服务端会自动创建一个初始管理员账号：
   - 用户名固定为 `admin`
   - 密码为随机生成，并打印在服务端控制台
6. 浏览器打开 `http://127.0.0.1:5501`

### 方式二：一键构建前端并本地运行

仓库根目录提供了 `Makefile`：

```bash
make run
```

常用命令：

- `make web`：构建前端资源
- `make agent`：构建多平台 Agent 二进制
- `make clean`：清理构建产物

### 方式三：Docker 运行

直接使用仓库内的 [docker-compose.yml](F:/project/csharp_app/AYLink.Extra/docker-compose.yml)：

```bash
docker compose up -d
```

默认会暴露：

- HTTP 管理端口：`5501`

容器镜像内已包含：

- `android-tools`，可直接提供 `adb`
- 运行所需的 `scrcpy-server`

如果你的部署环境对 ADB 或 WebRTC 网络路径有特殊要求，可以结合：

- 环境变量
- 挂载 `config.json`
- `network_mode: host`

一起使用。

## ⚙️ 配置说明

服务端默认配置示例见 [config.example.json](F:/project/csharp_app/AYLink.Extra/AYLink.Agent/config.example.json)：

环境变量优先级高于 `config.json`，常用项包括：

- `AYLINK_HTTP_LISTENADDR`
- `AYLINK_DB_PATH`
- `AYLINK_ADB_PATH`
- `AYLINK_ADB_SERVERHOST`
- `AYLINK_ADB_SERVERPORT`
- `AYLINK_ADB_BUNDLEDDIR`

## 📡 WebRTC 部署说明

如果你只在局域网内使用，默认配置通常就够用。  
如果你需要跨公网投屏，建议根据网络形态选择以下方式之一：

### 方案一：STUN / TURN

适合标准 WebRTC 部署场景：

- 在设置页填写 STUN 或 TURN 服务器
- 可选 `all` 或 `relay` 传输策略
- `relay` 模式会强制通过 TURN

### 方案二：Host Candidate 覆写

适合你明确知道服务端对外地址，不想依赖 STUN/TURN 的场景：

- 启用“直连 Host Candidate 覆写”
- 填写公网 IPv4 或确定可达的对外地址

### 方案三：单端口映射模式

适合 FRP、端口转发或受限网络环境：

- 启用“单端口映射模式”
- 指定服务端固定本地 UDP 监听端口
- 如外部访问端口不同，再填写“对外发布端口”

建议：

- 如果 ICE 候选来源复杂，先清空不需要的 STUN/TURN，再逐项排查
- 遇到短暂网络波动，当前投屏页已支持自动重连自愈

## 🔐 认证与权限

当前版本内置本地账号系统：

- 首次启动自动创建管理员账号
- 请妥善的保存，因为仅会显示一次
- 你可以首次登陆后立即改密


## 🛠️ 开发与构建

### 前端

```bash
cd AYLink.Web
npm install
npm run build
```

开发模式下，Vite 默认会把 API 代理到 `http://127.0.0.1:5501`。

### 服务端

```bash
cd AYLink.Agent
go build ./...
```

### 全量构建

```bash
make agent
```

会生成：

- Windows `amd64 / arm64`
- Linux `amd64 / arm64`
- macOS `amd64 / arm64`

的 Agent 可执行文件。

- 注: 如果其他平台可以自行编译 未使用 CGO

## 📦 依赖与致谢

本项目的实现离不开以下开源项目：

| 项目 | 描述 |
|------|------|
| [scrcpy](https://github.com/Genymobile/scrcpy) | 提供核心的屏幕镜像与控制能力 |
| [go-adbkit](https://github.com/codeskyblue/go-adbkit) | 使用的经过部分修改的代码方便管理 ADB |
| [pion](https://github.com/pion/webrtc) | 使用了一系列 pion webrtc 相关库 |
| [opus](https://github.com/jj11hh/opus) | 使用 WASM 编码器来避免使用 CGO |
| [websocket](https://github.com/gorilla/websocket) | WebSocket 协议的 Go 实现 |
| [sqlite](modernc.org/sqlite) | 提供了数据库功能 |

## 📄 开源协议

本项目基于 [Apache-2.0](../LICENSE) 协议开源。
