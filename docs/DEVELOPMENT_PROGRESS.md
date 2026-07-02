# CodexPanel 开发进展

更新时间：2026-07-01

## 已完成

- 已确认项目转为 Tauri 2 桌面打包路线，新增 `src-tauri`。
- 已全局安装 Rust toolchain：`rustc 1.96.1`、`cargo 1.96.1`。
- 已安装 Visual Studio Build Tools 2022 C++ workload 与 Windows SDK，用于 Windows 原生编译。
- 已加入项目级 Cargo 镜像配置：`.cargo/config.toml`。
- 已加入 Tauri CLI：`@tauri-apps/cli@2.11.4`。
- 已新增 Rust/Tauri 主进程：`src-tauri/src/main.rs`。
- 已新增 Node sidecar 启动器：`windows/node-sidecar.js`。
- 已新增 sidecar 构建脚本：`scripts/build-tauri-sidecar.ps1`。
- 已新增 Tauri Windows 构建包装脚本：`scripts/run-tauri-windows.ps1`。
- 已新增 Ubuntu 开发支持脚本：`scripts/setup-ubuntu-dev.sh`、`scripts/run-tauri-linux.sh`、`scripts/build-tauri-sidecar-linux.sh`。
- 已新增跨平台 Tauri 包装入口：`scripts/run-tauri.js`、`scripts/build-tauri-sidecar.js`。
- 已新增 Ubuntu 开发说明：`docs/UBUNTU_DEVELOPMENT.md`。
- 桌面窗口默认打开本地控制面板：`/control.html?token=...`。
- 手机远控继续通过本地服务提供的 LAN/Relay URL 在手机浏览器打开。
- `cargo check` 已通过。
- `npm run tauri:build` 已通过。
- Tauri release exe 已验证：
  - `/codex/health?token=...` 返回 200。
  - `/control.html?token=...` 返回 200。
  - 启动进程为 Tauri 主程序、Node sidecar、WebView2 Runtime。
  - 未启动新的 `msedge.exe` 浏览器进程。
- 旧品牌字符串和旧文件名扫描已清理完成。
- 项目/产品级命名已恢复为 `CodexPanel`。

## 当前架构

- Tauri 2 负责 Windows 桌面壳、安装包、应用图标和生命周期。
- Rust 主进程负责生成本地 token、选择端口、启动 Node sidecar、等待健康检查、创建控制面板窗口。
- Node sidecar 负责运行现有 `server.js`，继续复用 `public` Web 前端与本地 API。
- Web 前端不重写；桌面控制面板复用 `public/control.html`，手机端复用 `public/index.html`。

## 产物

```text
src-tauri/target/release/bundle/nsis/CodexPanel_3.0.5_x64-setup.exe
```

## 后续建议

- 在干净 Windows 用户环境中安装一次 NSIS 包，确认开始菜单、卸载项和 WebView2 bootstrapper 体验。
- 如需企业分发，补代码签名证书和固定版本发布流程。
