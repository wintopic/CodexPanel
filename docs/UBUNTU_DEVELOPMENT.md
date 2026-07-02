# CodexPanel Ubuntu 开发说明

## 目标

Ubuntu 用于开发、调试和打包 CodexPanel 的 Tauri 2 桌面壳、Node sidecar、本地 Web 前端和 Cloudflare relay 代码。

## 环境准备

推荐 Ubuntu 22.04 或 24.04。

```bash
bash scripts/setup-ubuntu-dev.sh --yes
```

该脚本会安装 Tauri Linux 构建依赖、Rust 工具链、项目依赖并运行 `npm run check`。Node.js 需要 18 或更新版本；如果系统没有合适的 Node，请先用 nvm、fnm 或发行版软件源安装。

## 开发运行

```bash
npm run tauri:dev:linux
```

Linux 入口会自动构建当前平台的 sidecar：

```text
src-tauri/bin/codexpanel-node-sidecar-<linux-target>
```

## 打包

```bash
npm run tauri:build:linux
```

Linux 构建默认输出 `deb` 和 `AppImage`。产物位于：

```text
src-tauri/target/release/bundle/
```

## Relay 开发

Cloudflare relay 已不再要求电脑端 Agent 提供额外验证密钥。电脑端作为被控 Agent，只需要：

- Cloudflare 服务地址
- 设备 ID
- 手机/远端 URL 中的远控密钥 token

部署入口：

```bash
cd cloudflare
npx wrangler deploy
cd pages
npx wrangler pages deploy . --project-name codexpanel --branch main
```

## 当前平台说明

Windows 本机 Codex Desktop GUI 自动化已经通过 `focusWindowsCodexWindow` 验证。Ubuntu 开发环境可以完整开发和打包 CodexPanel；若要在 Ubuntu 上直接操控 Codex Desktop GUI，需要目标系统存在可被自动化控制的 Codex Desktop 图形客户端。
