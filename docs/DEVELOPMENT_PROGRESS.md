# CodexPanel 开发进展

更新时间：2026-07-02

## 已完成

- 已将默认桌面壳迁移到 Wails + Go。
- 已全局安装 Go 与 Wails CLI，当前本机 `wails doctor` 通过。
- 已新增 Wails 主程序：`main.go`。
- 已新增 Go 侧服务生命周期管理：`app.go`、`sidecar.go`、`process_windows.go`、`process_unix.go`。
- 已新增 Wails asset server 入口与 `/codex/*` 反代：`assets.go`。
- 已复用现有 `public/control.html` 控制面板和 `public/index.html` 远控页面。
- 已让控制面板通过 Wails `window.go.main.App` 调用桌面服务控制。
- 已新增 Wails sidecar 打包脚本：`scripts/build-wails-sidecar.js`。
- 已修复 Wails 根路径 trailing slash 报错。
- 已修复 Windows 下 caxa 参数带空格导致 sidecar 递归启动的问题。
- 已将 GitHub Actions 改为 Windows、Linux、macOS 三端 Wails 便携包构建。
- 已移除旧桌面壳的 active npm 依赖，`npm ci` 更轻。

## 当前架构

- Wails 负责桌面窗口、系统 WebView、跨平台构建和前后端绑定。
- Go 负责生成本地 token、选择端口、启动/停止 Node sidecar、等待健康检查。
- Wails asset server 直接承载桌面控制面板，并把 `/codex/*` 请求反代给本地 sidecar。
- Node sidecar 继续运行现有 `server.js`，负责 Codex Desktop 自动化、LAN 远控、Cloudflare WAN relay。
- 手机远控仍然在浏览器中打开，不需要桌面控制面板跳转浏览器。

## 本地验证

已通过：

```text
npm run check
node --check windows/node-sidecar.js
go test ./...
wails build -clean
npm run wails:sidecar
```

本机验证结果：

- `build/bin/CodexPanel.exe` 构建成功，用时约 13 秒。
- `build/bin/codexpanel-node-sidecar.exe` 构建成功，约 42 MB。
- 单独启动 sidecar 后，临时端口健康检查返回 200。
- 通过 Wails 主程序启动 sidecar 后，临时端口健康检查返回 200。

## 当前产物

```text
build/bin/CodexPanel.exe
build/bin/codexpanel-node-sidecar.exe
```

当前阶段采用便携包发布：主程序和 sidecar 放在同一目录。后续如需进一步压缩分发形态，可以把 sidecar 嵌入 Go 程序并在运行时释放，或逐步把 Node sidecar 迁移为 Go 实现。

## 后续建议

- 在 GitHub Actions 上验证三端 artifact。
- 增加一次 Windows 可视化 smoke test，确认首次启动 UI 不再出现 trailing slash 报错。
- Linux/macOS 构建通过后，补充对应平台的依赖安装说明。
- 如需真正单文件 exe，进入第二阶段：Go 内嵌 sidecar 或 Go 重写 sidecar 核心能力。
