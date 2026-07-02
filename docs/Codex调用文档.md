# Codex 调用文档

更新时间：2026-06-30

来源：

- OpenAI 官方 Codex manual（`https://developers.openai.com/codex/codex-manual.md`）。本文只把官方手册可确认的 `codex://` deep link 和 slash command 纳入“官方已记录”范围；CLI-only 或当前 GUI 未验证的命令会单独标注。
- 本机解包观察：`<local Codex.app path>`，版本 `26.623.70822`，build `4559`。这部分只能作为当前版本兼容线索，不视为公开稳定 API。

## 支持等级

| 标记 | 含义 |
| --- | --- |
| 官方已记录 | OpenAI Codex manual 明确列出的入口。 |
| 本项目已封装 | Codex 已提供安全 API 或前端识别。 |
| 本机观察 | 从本机 Codex.app 解包资源中观察到，需随 Codex 升级复核。 |
| 仅文档记录 | 已在官方手册出现，但不适合直接做成远控快捷入口，或属于 CLI-only。 |

## `codex://` Deep Link

Codex Desktop 注册了 `codex://` URL scheme。拼接 URL 时必须对 query value 做 URL encode；本项目的 `/codex/open-link` 会重新生成白名单 URL，避免任意 `codex://` 透传。

| Deep link | 作用 | 支持 |
| --- | --- | --- |
| `codex://threads/new` | 打开一个新的本地线程。 | 官方已记录，本项目已封装 |
| `codex://threads/new?prompt=&path=&originUrl=` | 打开新本地线程，并预填 prompt、工作目录或按 Git remote 匹配工作区。 | 官方已记录，本项目已封装 |
| `codex://new?prompt=&path=&originUrl=` | 打开新本地线程；至少需要一个 query 参数，否则不生效。 | 官方已记录，本项目已封装 |
| `codex://threads/<threadId>` | 打开指定本地线程，`threadId` 必须是 session UUID。 | 官方已记录，本项目已封装 |
| `codex://settings` | 打开设置。 | 官方已记录，本项目已封装 |
| `codex://settings/browser-use` | 打开 Browser Use 设置。 | 官方已记录，本项目已封装 |
| `codex://settings/computer-use/google-chrome` | 打开 Google Chrome computer-use 设置。 | 官方已记录，本项目已封装 |
| `codex://settings/connections` | 打开远程连接设置。 | 官方已记录，本项目已封装 |
| `codex://settings/connections/computer` | 打开“控制这台电脑”设置。 | 官方已记录，本项目已封装 |
| `codex://settings/connections/devices` | 打开设备连接设置。 | 官方已记录，本项目已封装 |
| `codex://settings/connections/ssh` | 打开 SSH 连接设置。 | 官方已记录，本项目已封装 |
| `codex://settings/connections/ssh/add?name=<ssh-alias>` | 从 `~/.ssh/config` 添加指定 host alias。 | 官方已记录，本项目已封装 |
| `codex://skills` | 打开 Skills。 | 官方已记录，本项目已封装 |
| `codex://automations` | 打开 Automations 创建流程。 | 官方已记录，本项目已封装 |
| `codex://plugins/install/?marketplace=<marketplace>` | 从已知 marketplace 打开插件安装流程。 | 官方已记录，本项目已封装 |
| `codex://plugins/<plugin-id>` | 打开插件详情页。OpenAI curated 插件通常形如 `<plugin>@openai-curated`。 | 官方已记录，本项目已封装 |
| `codex://plugins/?marketplacePath=<absolute-path>&mode=share` | 从本地 marketplace 打开插件详情或分享流程。 | 官方已记录，本项目已封装 |
| `codex://pets/install?name=&imageUrl=&description=` | 打开 pet install 流程，`imageUrl` 必须是 HTTPS。 | 官方已记录，本项目已封装 |

### 新线程参数

| 参数 | 作用 |
| --- | --- |
| `prompt` | 设置初始 composer 文本。 |
| `path` | 使用本机绝对目录作为工作区；本项目要求目录存在。 |
| `originUrl` | 按 Git remote URL 匹配已有 workspace root。若同时有 `path`，Codex 优先解析 `path`。 |

### 本项目 Deep Link API

接口：`POST /codex/open-link`

认证：query、cookie 或 header 中携带当前服务 token；前端通常使用 `x-mobile-typer-token`。

示例：打开线程。

```json
{
  "kind": "thread",
  "threadId": "00000000-0000-0000-0000-000000000000"
}
```

示例：新建项目线程并预填 prompt。

```json
{
  "kind": "new-thread",
  "path": "C:\\Users\\<user>\\Desktop\\DEV\\CodexPanel",
  "prompt": "检查这个项目的测试入口"
}
```

示例：打开设置页。

```json
{
  "kind": "settings",
  "page": "connections/ssh"
}
```

示例：打开官方插件详情。

```json
{
  "kind": "plugin",
  "pluginId": "openai-developers@openai-curated"
}
```

也可以传入 `url`，但服务端仍会解析并重建白名单链接：

```json
{
  "url": "codex://skills"
}
```

调试时可加 `"dryRun": true`，只返回规范化后的 `link`，不实际打开 Codex。

## Codex App Slash Commands

这些命令是官方手册在 Codex App commands 中列出的命令。网页端直接发送文本时已经可以把 slash command 粘贴到 Codex composer；本项目现在也会在前端识别这些命令并显示对应运行态。

| Command | 作用 | 支持 |
| --- | --- | --- |
| `/feedback` | 打开反馈对话框，可提交反馈并附带日志。 | 官方已记录，本项目已封装 |
| `/goal` | 设置或管理持续目标；建议先用 `/plan` 打磨目标。 | 官方已记录，本项目已封装 |
| `/init` | 为当前项目生成 `AGENTS.md` scaffold。 | 官方已记录，本项目已封装 |
| `/mcp` | 打开 MCP status，查看已连接 servers。 | 官方已记录，本项目已封装 |
| `/plan` | 切换到 Plan mode，适合多步骤规划。 | 官方已记录，本项目已封装 |
| `/review` | 进入代码审查模式，可审查未提交改动或与 base branch 比较。 | 官方已记录，本项目已封装 |
| `/status` | 显示 thread ID、上下文用量、rate limits 等状态。 | 官方已记录，本项目已封装 |

### `/goal` 用法

| 用法 | 作用 |
| --- | --- |
| `/goal` | 查看当前 goal 或进入 goal 管理。 |
| `/goal <text>` | 设置目标；官方手册说明 goal objective 最多 4000 字符。 |
| `/goal pause` | 暂停当前 goal。 |
| `/goal resume` | 恢复当前 goal。 |
| `/goal clear` | 清除当前 goal。 |

### `/plan` 用法

| 用法 | 作用 |
| --- | --- |
| `/plan` | 切换到 Plan mode。 |
| `/plan <prompt>` | 切换到 Plan mode，并把后续文本作为第一条规划请求。 |

## CLI Slash Commands

下面是官方手册在 Codex CLI slash commands 中列出的命令。部分命令也可能在 App/IDE 可用，但官方 CLI 表格本身不等同于 App 远控入口。

| Command | 作用 | 本项目策略 |
| --- | --- | --- |
| `/permissions` | 调整 approval/sandbox 权限。 | 仅文档记录 |
| `/ide` | 引入 IDE 上下文。 | 仅文档记录 |
| `/keymap` | 调整 TUI 快捷键。 | 仅文档记录 |
| `/vim` | 切换 Vim composer 模式。 | 仅文档记录 |
| `/sandbox-add-read-dir` | Windows 下给 sandbox 增加只读目录。 | 仅文档记录 |
| `/agent` | 切换 subagent thread。 | 仅文档记录 |
| `/apps` | 浏览 apps/connectors 并插入到 prompt。 | 本项目已封装 |
| `/plugins` | 浏览或管理插件。 | 本项目已封装 |
| `/hooks` | 查看和管理 lifecycle hooks。 | 本项目已封装 |
| `/clear` | 清屏并开始新聊天。 | 仅文档记录 |
| `/archive` | 归档当前 session 并退出 CLI。 | 仅文档记录；本项目另有线程归档按钮 |
| `/delete` | 永久删除当前 session。 | 仅文档记录 |
| `/compact` | 压缩/总结上下文。 | 本项目前端支持；中文快捷为 `/压缩` |
| `/copy` | 复制最新回复。 | 仅文档记录 |
| `/diff` | 展示 Git diff。 | 仅文档记录 |
| `/exit` | 退出 CLI。 | 仅文档记录 |
| `/experimental` | 切换实验功能。 | 仅文档记录 |
| `/approve` | 批准一次自动审查拒绝后的重试。 | 仅文档记录 |
| `/memories` | 配置 memory 使用和生成。 | 本项目已封装 |
| `/skills` | 浏览和使用 skills。 | 本项目已封装 |
| `/import` | 导入 Claude Code 配置、项目文件和最近聊天。 | 仅文档记录 |
| `/feedback` | 发送反馈。 | 本项目已封装 |
| `/init` | 生成 `AGENTS.md`。 | 本项目已封装 |
| `/logout` | 退出 Codex 登录。 | 仅文档记录 |
| `/mcp` | 列出 MCP tools。 | 本项目已封装 |
| `/mention` | 附加文件或目录到对话。 | 仅文档记录 |
| `/model` | 切换模型。 | 仅文档记录；本项目另有模型切换控件 |
| `/fast on` | 打开 Fast mode。 | 本项目已封装 |
| `/fast off` | 关闭 Fast mode。 | 本项目已封装 |
| `/fast status` | 查看 Fast mode 状态。 | 本项目已封装 |
| `/plan` | 切换 Plan mode，可带 prompt。 | 本项目已封装 |
| `/goal` | 设置、暂停、恢复、查看或清除 goal。 | 本项目已封装 |
| `/personality` | 设置交流风格。 | 仅文档记录 |
| `/ps` | 查看实验性后台终端。 | 仅文档记录 |
| `/stop` | 停止后台终端。 | 仅文档记录；本项目另有停止生成按钮 |
| `/fork` | fork 当前会话。 | 仅文档记录 |
| `/side` / `/btw` | 开始临时 side conversation。 | 仅文档记录 |
| `/raw` | 切换 raw scrollback。 | 仅文档记录 |
| `/resume` | 恢复保存的 CLI conversation。 | 仅文档记录 |
| `/new` | 在同一个 CLI session 中开始新 conversation。 | 仅文档记录；本项目另有新建线程按钮 |
| `/quit` | 退出 CLI。 | 仅文档记录 |
| `/review` | 请求审查 working tree。 | 本项目已封装 |
| `/status` | 显示 session 配置、token、上下文等状态。 | 本项目已封装 |
| `/usage` | 查看账号 token usage 或 rate-limit reset。 | 仅文档记录 |
| `/debug-config` | 打印 config layer 和 requirements 诊断。 | 仅文档记录 |
| `/statusline` | 配置 TUI footer items。 | 仅文档记录 |
| `/title` | 配置 terminal title items。 | 仅文档记录 |
| `/theme` | 选择 terminal syntax theme。 | 仅文档记录 |

## 本项目 Slash Command API

接口：`POST /codex/slash-command`

该接口会先定位指定 Codex thread，再把白名单命令粘贴到 Codex composer 并回车。为了远控安全，不开放 `/delete`、`/logout`、`/quit`、`/exit`、`/permissions` 等高风险或 CLI-only 操作。

示例：进入 plan mode。

```json
{
  "threadId": "00000000-0000-0000-0000-000000000000",
  "command": "/plan",
  "argument": "先审查实现方案，不要直接改代码"
}
```

示例：设置 goal。

```json
{
  "threadId": "00000000-0000-0000-0000-000000000000",
  "command": "/goal",
  "argument": "完成 Codex 的远控调用支持，并通过本地验证"
}
```

示例：查看状态。

```json
{
  "threadId": "00000000-0000-0000-0000-000000000000",
  "command": "/status"
}
```

调试时可加 `"dryRun": true`，只返回规范化后的 `command`，不实际发送到 Codex。

## Codex App 快捷命令

以下命令来自本机 `Codex.app 26.623.70822` 前端资源中观察到的命令注册和默认快捷键。本项目只封装非破坏性、可由用户手动快捷键完成的动作；删除、退出登录、放宽权限等高风险动作不开放远控入口。

接口：`POST /codex/app-command`

| Command | 默认快捷键 | 作用 | 支持 |
| --- | --- | --- | --- |
| `copyDeeplink` | `CmdOrCtrl+Alt+L` | 复制当前对话 Codex 链接。 | 本机观察，本项目已封装 |
| `copyConversationPath` | `CmdOrCtrl+Alt+Shift+C` | 复制当前会话路径。 | 本机观察，本项目已封装 |
| `copySessionId` | `CmdOrCtrl+Alt+C` | 复制当前 Session ID。 | 本机观察，本项目已封装 |
| `copyWorkingDirectory` | `CmdOrCtrl+Shift+C` | 复制当前工作目录。 | 本机观察，本项目已封装 |
| `openCommandMenu` | `CmdOrCtrl+K` | 打开命令面板。 | 本机观察，本项目已封装 |
| `searchChats` | `CmdOrCtrl+G` | 搜索对话。 | 本机观察，本项目已封装 |
| `searchFiles` | `CmdOrCtrl+P` | 搜索文件。 | 本机观察，本项目已封装 |
| `findInThread` | `CmdOrCtrl+F` | 在当前对话中查找。 | 本机观察，本项目已封装 |
| `showKeyboardShortcuts` | `CmdOrCtrl+Shift+/` | 显示快捷键。 | 本机观察，本项目已封装 |
| `settings` | `CmdOrCtrl+,` | 打开设置。 | 本机观察，本项目已封装 |
| `openFolder` | `CmdOrCtrl+O` | 打开文件夹选择。 | 本机观察，本项目已封装 |
| `newWindow` | `CmdOrCtrl+Shift+N` | 新建窗口。 | 本机观察，本项目已封装 |
| `toggleSidebar` | `CmdOrCtrl+B` | 切换侧边栏。 | 本机观察，本项目已封装 |
| `toggleBottomPanel` | `CmdOrCtrl+J` | 切换底部面板。 | 本机观察，本项目已封装 |
| `toggleTerminal` | `Ctrl+Backtick` | 切换终端。 | 本机观察，本项目已封装 |
| `toggleSidePanel` | `CmdOrCtrl+Alt+B` | 切换右侧面板。 | 本机观察，本项目已封装 |
| `toggleBrowserPanel` | `CmdOrCtrl+Shift+B` | 切换浏览器面板。 | 本机观察，本项目已封装 |
| `openBrowserTab` | `CmdOrCtrl+T` | 打开浏览器标签。 | 本机观察，本项目已封装 |
| `openReviewTab` | `Ctrl+Shift+G` | 打开审查标签。 | 本机观察，本项目已封装 |
| `openSideChat` | `CmdOrCtrl+Alt+S` | 打开 side chat。 | 本机观察，本项目已封装 |
| `composer.openModelPicker` | `Ctrl+Shift+M` | 打开模型选择器。 | 本机观察，本项目已封装 |

示例：打开命令面板。

```json
{
  "command": "openCommandMenu"
}
```

示例：切到指定线程后打开当前线程查找。

```json
{
  "threadId": "00000000-0000-0000-0000-000000000000",
  "command": "findInThread"
}
```

也可以使用短横线别名，例如 `toggle-sidebar`、`copy-link`、`open-model-picker`。调试时可加 `"dryRun": true`，只返回规范化命令，不实际按快捷键。

## 已有 Codex 功能映射

| Codex 能力 | Codex 当前实现 |
| --- | --- |
| 打开已有线程 | 侧边栏选择线程；服务端使用 `codex://threads/<threadId>` 激活 Codex Desktop。 |
| 新建项目线程 | 新建线程按钮；服务端使用 `codex://threads/new?path=<cwd>`。 |
| 新建纯对话线程 | 新建对话逻辑先定位纯对话 anchor，再触发 Codex 自身 New Chat。 |
| 发送消息/图片 | `/send` 通过剪贴板和键盘自动化发送到 Codex composer。 |
| 停止生成 | `/codex/stop` 发送 Esc / Ctrl+. 等停止快捷键。 |
| 切换模型 | `/codex/model-switch` 通过 Codex GUI 的 `/模型` 流程切换。 |
| 切换推理模式 | `/codex/reasoning-mode` 通过 Codex GUI 的 `/推理模式` 流程切换。 |
| 归档、置顶、重命名 | `/codex/thread-action` 通过 Codex Desktop 快捷键执行，并同步本项目本地状态。 |
| 上下文压缩 | 前端快捷 `/压缩`，同时识别 CLI `/compact`。 |
| 官方 deep links | `/codex/open-link` 白名单封装。 |
| 安全 slash commands | `/codex/slash-command` 白名单封装；前端直接输入时也有专属运行态。 |
| 安全 App 快捷命令 | `/codex/app-command` 白名单封装；用于触发当前 Codex App 的非破坏性客户端命令。 |

## Codex.app 26.623.70822 解包观察

本节记录当前本机安装包中可确认的结构，用于后续 UI 和远控能力对齐。不要直接复制私有前端源码；可以参考资源类型、交互入口和命令命名自行实现。

| 项目 | 观察结果 |
| --- | --- |
| App 标识 | `CFBundleIdentifier=com.openai.codex` |
| 版本 | `CFBundleShortVersionString=26.623.70822`，`CFBundleVersion=4559` |
| URL Scheme | `CFBundleURLSchemes` 注册 `codex` |
| 主资源 | `Resources/app.asar`，`Resources/app.asar.unpacked` |
| 本地 agent | `Resources/codex` |
| 图标资源 | `icon.icns`、`icon.png`、`icon-codex-dark-color.png`、`icon-codex-light.png` |
| Web 字体 | `OpenAISans-Regular`、`OpenAISans-Medium` |
| 前端入口 | `webview/index.html`、`webview/assets/*.js`、`webview/assets/*.css` |
| 典型页面 chunk | `remote-conversation-page`、`local-conversation-thread`、`thread-app-shell-chrome`、`new-thread-panel-page`、`settings-page`、`automations-page`、`plugins-page`、`skills-page` |
| 内置插件 | `browser`、`chrome`、`computer-use`、`latex`、`record-and-replay`、`sites` |

观察到的内部路由校验包含 `codex://threads/<uuid>`，并出现过 review 相关参数名，例如 `view=review`、`diffFilter=branch|last-turn`、`reviewPath`。这类参数未纳入本项目默认白名单，除非之后能从官方文档或实际稳定行为中确认。

## 后续扩展原则

1. 官方手册没有记录的入口，只能标注为“实验/本地验证”，不要写成稳定 API。
2. 能用结构化参数生成链接时，不接受原始 URL 透传。
3. 涉及删除、退出登录、权限放宽、永久配置修改的命令，不做远控快捷按钮。
4. CLI-only 命令可以记录用法，但不要默认当成 Codex App GUI 能力。
