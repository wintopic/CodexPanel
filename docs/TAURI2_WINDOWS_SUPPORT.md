# CodexPanel Tauri 2 Windows 支持说明

## 目标

CodexPanel Windows 桌面版打包为 Tauri 2 应用。桌面端显示本地控制面板，手机远控入口仍通过浏览器访问本机服务提供的 LAN/Relay URL。

## 组件

- `src-tauri/tauri.conf.json`：Tauri 2 配置、图标、NSIS 打包、Node sidecar 声明。
- `src-tauri/src/main.rs`：Rust 主进程，负责启动 sidecar 和创建控制面板窗口。
- `windows/node-sidecar.js`：Node sidecar 入口，只启动本地服务，不打开浏览器。
- `scripts/build-tauri-sidecar.ps1`：把 `server.js`、`public`、`bin` 和 Node runtime 打成 Tauri sidecar。
- `scripts/run-tauri-windows.ps1`：加载 VS C++ 编译环境后运行 `tauri build` 或 `tauri dev`。
- `public/control.html`：桌面控制面板。
- `public/index.html`：手机浏览器远控页面。

## 启动流程

1. Tauri 应用启动。
2. Rust 主进程生成本地访问 token。
3. Rust 主进程从 `8787` 开始寻找可用端口。
4. Rust 主进程启动 `bin/codexpanel-node-sidecar`。
5. Node sidecar 运行 `server.js`，提供本地 API 和 Web 页面。
6. Rust 主进程等待 `/codex/health` 返回 200。
7. Tauri 创建桌面窗口并打开 `http://127.0.0.1:<port>/control.html?token=<token>`。
8. 手机端通过控制面板显示的 LAN/Relay URL 在手机浏览器访问。

## 构建命令

```powershell
npm run tauri:build
```

该命令会自动执行：

- `scripts/run-tauri-windows.ps1 -Mode build`
- Tauri `beforeBuildCommand`
- `npm run tauri:sidecar`
- `scripts/build-tauri-sidecar.ps1`
- `tauri build`

## 开发命令

```powershell
npm run tauri:dev
```

## 验证变量

正式运行时 Tauri 会自动选择端口并生成 token。自动化验证时可以固定它们：

```powershell
$env:PORT = "8799"
$env:MOBILE_TYPER_TOKEN = "tauri-test-token"
.\src-tauri\target\release\codexpanel-desktop.exe
```

然后检查：

```powershell
Invoke-WebRequest http://127.0.0.1:8799/codex/health?token=tauri-test-token
Invoke-WebRequest http://127.0.0.1:8799/control.html?token=tauri-test-token
```

## 产物位置

Tauri Windows 安装包输出到：

```text
src-tauri/target/release/bundle/nsis/
```

Node sidecar 输出到：

```text
src-tauri/bin/codexpanel-node-sidecar-x86_64-pc-windows-msvc.exe
```

## 环境要求

- Node.js 18+
- Rust stable toolchain
- Visual Studio Build Tools 2022 C++ workload
- Windows SDK
- WebView2 Runtime

`scripts/run-tauri-windows.ps1` 会自动加载 VS C++ 环境，并确认第一个 `link.exe` 来自 Visual Studio。
