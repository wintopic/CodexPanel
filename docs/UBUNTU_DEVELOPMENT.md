# CodexPanel Ubuntu 开发说明

## 目标

Ubuntu 用于开发、调试和打包 CodexPanel 的 Wails 桌面壳、Node sidecar、本地 Web 前端和 Cloudflare relay 代码。

## 环境准备

推荐 Ubuntu 22.04 或 24.04。

```bash
bash scripts/setup-ubuntu-dev.sh --yes
```

该脚本会安装 Wails Linux 构建依赖、检查 Node.js、检查 Go、安装 Wails CLI，并运行基础检查。

手动准备时需要：

- Node.js 18+
- Go 1.23+
- Wails CLI v2.12+
- `libgtk-3-dev`
- `libwebkit2gtk-4.1-dev` 或 `libwebkit2gtk-4.0-dev`

## 开发运行

```bash
npm run wails:dev
```

## 打包

```bash
npm run wails:build
npm run wails:sidecar
```

`npm run wails:build` 会在 Linux 上自动使用 Wails 的 `webkit2_41`
构建标记，匹配 Ubuntu 24.04 默认的 `libwebkit2gtk-4.1-dev`。

产物位于：

```text
build/bin/
```

Linux 当前采用便携目录发布：Wails 主程序和 `codexpanel-node-sidecar` 放在同一个目录。

## Relay 开发

广域网中转服务已经拆分到独立仓库：

```text
https://github.com/wintopic/CodexPanel-WAN
```

本仓库只保留本地控制面板和本机 sidecar。电脑端作为被控 Agent，只需要：

- Cloudflare 服务地址
- 设备 ID
- 手机/远端 URL 中的远控密钥 token

## 当前平台说明

Windows 本机 Codex Desktop GUI 自动化已经通过验证。Ubuntu 可以完整开发和打包 CodexPanel；若要在 Ubuntu 上直接操控 Codex Desktop GUI，需要目标系统存在可被自动化控制的 Codex Desktop 图形客户端。
