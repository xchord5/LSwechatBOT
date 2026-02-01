# CODEBUDDY.md

本文件为 CodeBuddy Code 在此代码库中工作提供指导。

## 常用开发命令

### 核心开发
- 安装依赖：`pnpm install`（或 `bun install` 以保持 `pnpm-lock.yaml` 和 Bun 补丁同步）
- 类型检查/构建：`pnpm build`（tsc）
- 代码检查：`pnpm lint`（oxlint）
- 代码格式化：`pnpm format`（oxfmt --check）或 `pnpm format:fix`（oxfmt --write）
- 推送前的完整检查：`pnpm lint && pnpm build && pnpm test`

### 运行测试
- 单元/集成测试：`pnpm test`
- 端到端测试：`pnpm test:e2e`
- 实时测试（需要真实凭证）：`pnpm test:live` 或 `CLAWDBOT_LIVE_TEST=1 pnpm test:live`
- 代码覆盖率：`pnpm test:coverage`
- 监视模式：`pnpm test:watch`

### 单个测试命令
- 运行特定测试文件：`vitest run path/to/file.test.ts`
- 运行特定测试：`vitest run path/to/file.test.ts -t "测试名称"`
- 监视特定文件：`vitest watch path/to/file.test.ts`
- 特定文件覆盖率：`vitest run path/to/file.test.ts --coverage`

注意：以 `.e2e.test.ts` 结尾的测试文件使用 `vitest.e2e.config.ts`，以 `.live.test.ts` 结尾的测试文件使用 `vitest.live.config.ts`。

### CLI 命令
- 开发模式运行 CLI：`pnpm moltbot ...`（使用 bun）或 `pnpm dev`
- Gateway 开发模式：`pnpm gateway:dev`（跳过通道初始化）
- Gateway 监视模式：`pnpm gateway:watch`
- Gateway 重置：`pnpm gateway:dev:reset`
- TUI：`pnpm tui` 或 `pnpm tui:dev`

### 平台特定命令
- iOS：`pnpm ios:open`（生成并打开 Xcode 项目），`pnpm ios:run`（构建并运行）
- Android：`pnpm android:run`（构建、安装并启动）
- macOS：`pnpm mac:package`（打包菜单栏应用），`pnpm mac:restart`（重启 gateway）
- macOS 日志查询：`./scripts/clawlog.sh`（支持 follow/tail/类别过滤器）

### UI 开发
- Web UI 开发：`pnpm ui:dev`
- Web UI 构建：`pnpm ui:build`
- 安装 UI 依赖：`pnpm ui:install`

### 预提交钩子
- 安装钩子：`prek install`（运行与 CI 相同的检查）

## 核心架构概览

### 入口点和程序流程
- **CLI 入口**：`src/entry.ts` 是主入口点。它处理进程生成、环境规范化（包括 `NODE_OPTIONS` 抑制实验性警告）、Windows argv 清理和配置文件参数解析。它导入并运行 `src/cli/run-main.js`。
- **CLI 构建器**：`src/cli/program/build-program.ts` 使用 `createProgramContext()` 构造 Commander 程序，并通过 `registerProgramCommands()` 注册命令。
- **Gateway 服务器**：`src/gateway/server.impl.ts` 导出 `startGatewayServer()`，它初始化 WebSocket/HTTP gateway、通道管理器、节点注册表、代理事件处理器和所有附属服务。

### 关键架构层

1. **CLI 层**（`src/cli/`）：基于 Commander 的 CLI，包含子命令
   - `program/`：程序构建、上下文和命令注册
   - `cli-*.ts`：各种功能的 CLI 命令实现（channels、gateway、models 等）
   - 通过 `src/cli/deps.ts` 中的 `createDefaultDeps()` 实现依赖注入模式

2. **Gateway 层**（`src/gateway/`）：用于代理通信的 WebSocket/HTTP 服务器
   - `server.impl.ts`：主 gateway 服务器实现，包含启动和生命周期管理
   - `server-methods/`：Gateway RPC 方法处理器（agent、chat、config、nodes、cron、plugins 等）
   - `client.ts`：用于连接到运行中 gateway 实例的 gateway 客户端
   - `server-channels.ts`：通道管理器和生命周期
   - `server-node-events.ts`：节点事件广播和订阅
   - 集成通道、插件、节点注册表和控制 UI

3. **Agent 层**（`src/agents/`）：AI 代理执行和工具管理
   - 工具实现：bash 工具（exec、process、send-keys）、文件工具、通道工具、clawdbot 工具
   - 认证配置文件管理：`src/agents/auth-profiles/` 处理多个提供商认证配置文件、OAuth 流和配置文件解析
   - 会话管理和上下文处理
   - 子代理生成和生命周期管理
   - 外部 AI 后端的 CLI 运行器（Claude Code CLI 等）

4. **Channel 层**（`src/channels/`、`src/telegram/`、`src/discord/`、`src/slack/`、`src/signal/`、`src/imessage/`、`src/web/`）：消息平台集成
   - `src/channels/` 中的核心通道抽象（registry、config、routing、allowlists、command/mention gating）
   - 子目录中的平台特定实现（每个处理自己的 SDK 和协议）
   - 消息路由、传递和入站/出站转换

5. **Routing 层**（`src/routing/`）：消息路由和会话密钥解析
   - `resolve-route.ts`：根据绑定确定出站消息的目标通道
   - `bindings.ts`：通道绑定配置和解析
   - `session-key.ts`：会话密钥派生和解析（agent:session、agent:session:thread 等）

6. **Plugin 系统**（`src/plugins/`、`src/plugin-sdk/`）：扩展架构
   - 作为 `extensions/*` 中工作区包的通道插件（例如 `extensions/msteams`、`extensions/matrix`）
   - 插件 SDK 从 `dist/plugin-sdk/` 导出为 `./plugin-sdk` 包入口点
   - 插件发现、自动启用和生命周期管理
   - 将仅限插件的依赖保留在扩展 `package.json` 中；除非核心使用，否则不要添加到根 `package.json`

### 依赖注入模式

代码库广泛使用依赖注入来实现可测试性和模块化：
- `src/cli/deps.ts` 中的 `createDefaultDeps()` 提供出站发送函数的默认实现（sendMessageWhatsApp、sendMessageTelegram 等）
- `createOutboundSendDeps()` 将 `CliDeps` 转换为内部使用的 `OutboundSendDeps`
- 许多模块接受 `deps` 对象以覆盖行为（例如 `CliDeps`、`OutboundSendDeps`、代理特定的依赖）
- `src/runtime.ts` 中的运行时环境（`RuntimeEnv`）抽象 log/error/exit 以实现可测试性

### 配置系统

- **Config**：`src/config/config.ts` 从 `~/.clawdbot/moltbot.json`（或 `CLAWDBOT_CONFIG_PATH`）加载和验证配置
- **Auth Profiles**：`src/agents/auth-profiles/` 管理多个提供商认证配置文件，包含 OAuth 流、冷却和修复
- **Session Store**：`src/config/sessions.ts` 使用 SQLite 后端处理会话持久性
- 凭证存储在 `~/.clawdbot/credentials/`（基于配置文件的认证；如果已登出，重新运行 `moltbot login`）
- 会话默认位于 `~/.clawdbot/sessions/`（基本目录不可配置）
- Gateway 配置重载：`src/gateway/config-reload.ts` 处理运行时配置更改

### 测试架构和并行化

测试运行器（`scripts/test-parallel.mjs`）以并行组运行测试：
- **unit**：核心单元测试（`vitest.unit.config.ts`）
- **extensions**：扩展/插件测试（`vitest.extensions.config.ts`）
- **gateway**：Gateway 特定测试（`vitest.gateway.config.ts`）
- Windows CI 串行运行测试以避免干扰
- 工作线程数可通过 `CLAWDBOT_TEST_WORKERS` 环境变量配置（默认：localWorkers = max(4, min(16, cpuCount))，CI：2-3 个工作线程）
- macOS CI 将工作线程减少到 1 以避免崩溃/OOM
- 以 `.e2e.test.ts` 结尾的测试文件通过 `vitest.e2e.config.ts` 运行（配置：vitest.e2e.config.ts）
- 以 `.live.test.ts` 结尾的测试文件通过 `vitest.live.config.ts` 运行（配置：vitest.live.config.ts；需要 `CLAWDBOT_LIVE_TEST=1`）

### 代码覆盖率

覆盖率阈值在 `package.json` 中配置（70% 的行/分支/函数/语句，55% 的分支）。某些目录在 `vitest.config.ts` 中被故意排除在覆盖率之外：
- CLI 入口点和连线（`src/entry.ts`、`src/index.ts`、`src/runtime.ts`、`src/cli/`、`src/commands/`、`src/daemon/`、`src/hooks/`、`src/macos/`）
- 与外部工具的代理集成（`src/agents/model-scan.ts`、`src/agents/pi-embedded-runner.ts`、`src/agents/sandbox-paths.ts`、`src/agents/sandbox.ts`、`src/agents/skills-install.ts`）
- Gateway 服务器集成表面（`src/gateway/control-ui.ts`、`src/gateway/server-bridge.ts`、`src/gateway/server-channels.ts`、`src/gateway/server-methods/`）
- 进程桥接（`src/gateway/call.ts`、`src/process/tau-rpc.ts`、`src/process/exec.ts`）
- 交互式 UI/流程（`src/tui/`、`src/wizard/`）
- 通道表面（`src/discord/`、`src/imessage/`、`src/signal/`、`src/slack/`、`src/browser/`、`src/channels/web/`、`src/telegram/`）
- 协议和 Tailscale（`src/gateway/protocol/`、`src/infra/tailscale.ts`）

这些区域通过手动/e2e 运行进行验证，或者难以在隔离环境中进行单元测试。

## 消息通道架构

重构共享逻辑（路由、allowlists、配对、命令门控、入门、文档）时，始终考虑所有内置 + 扩展通道：

**核心通道**：`src/telegram`、`src/discord`、`src/slack`、`src/signal`、`src/imessage`、`src/web`（WhatsApp web）
**扩展通道**：`extensions/*`（例如 `extensions/msteams`、`src/matrix`、`extensions/zalo`、`extensions/zalouser`、`extensions/voice-call`）

与通道无关的抽象位于 `src/channels/`：
- Registry：`src/channels/registry.ts`
- Config：`src/channels/channel-config.ts`
- Routing：`src/channels/targets.ts`、`src/routing/resolve-route.ts`
- Gating：`src/channels/command-gating.ts`、`src/channels/mention-gating.ts`
- Allowlists：`src/channels/allowlist-match.ts`

## 提供商和模型架构

- 提供商实现：`src/providers/`（例如 `github-copilot-auth.ts`、`google-shared.*.ts`、`qwen-portal-oauth.ts`）
- 模型发现和认证配置文件：`src/agents/models.profiles.ts`、`src/agents/auth-profiles/`
- 支持多个认证配置文件：配置文件存储在 `~/.clawdbot/credentials/`，通过 `src/agents/auth-profiles/resolve-auth-profile-order.ts` 解析
- 通过 `models.providers` 配置支持自定义提供商端点（OpenAI/Anthropic 兼容代理，如 LM Studio、vLLM、LiteLLM）

## Gateway 方法架构

Gateway RPC 方法组织在 `src/gateway/server-methods/` 中：
- 核心：`agent.ts`（代理执行、流式传输）、`chat.ts`（消息发送）、`config.ts`（配置 get/set/patch）、`nodes.ts`（节点注册表和管理）
- Sidecar：`wizard.ts`（入门向导）、`skills.ts`（技能管理）、`cron.ts`（计划任务）
- Channels：`send.ts`（出站消息传递）、`web.ts`（web 控制UI）
- Runtime：`exec-approval.ts`（执行批准流程）

Gateway 事件（`GATEWAY_EVENTS`）广播到连接的客户端，用于生命周期更改、健康更新和代理事件。

## 多代理安全指南

代码库支持多个 CodeBuddy Code 代理并发工作。遵循以下安全规则：

**Git 操作：**
- 当用户说"push"时：`git pull --rebase` 是可接受的，用于集成最新更改（绝不丢弃其他代理的工作）
- 当用户说"commit"时：仅限于你的更改
- 当用户说"commit all"时：将所有更改分组提交
- **绝不创建/应用/删除 `git stash`**条目，除非明确请求（这包括 `git pull --rebase --autostash`）
- **绝不创建/删除/修改 `git worktree`**检出（或编辑 `.worktrees/*`），除非明确请求
- **绝不切换分支**，除非明确请求

**文件处理：**
- 当你看到无法识别的文件时，继续进行；专注于你的更改并仅提交这些更改
- 多个代理触摸同一文件：如果安全则继续；仅在相关时以简短的"存在其他文件"说明结束

**Lint/Format 变更：**
- 如果已暂存+未暂存的差异仅为格式化，则自动解决而不询问
- 如果已请求 commit/push，则自动暂存并在同一提交中包含仅格式化的后续（或根据需要进行微小后续提交），无需额外确认
- 仅当更改是语义性的（逻辑/数据/行为）时才询问

**常规：**
- 专注于你的编辑报告；除非真正受阻，否则避免护栏免责声明
- 运行多个代理是可以的，只要每个代理都有自己的会话
- 不要通过 SSH 重建 macOS 应用；重建必须在 Mac 上直接运行

## 重要架构模式

### 通道提供者对接
添加新的消息通道时，更新每个 UI 表面和文档：
- macOS 应用连接表单
- Web UI 提供者列表和设置
- 移动应用（如适用）
- 入门/概述文档
- 添加匹配的状态 + 配置表单，使提供者列表保持同步

### 依赖管理
- 将 `pnpm.patchedDependencies` 中的依赖保持在精确版本（无 `^`/`~`）
- 永不更新 Carbon 依赖（`@buape/carbon`）
- 修补依赖（pnpm 补丁、覆盖或供应商更改）需要明确批准；默认情况下不要这样做
- 避免在插件 `dependencies` 中使用 `workspace:*`（npm install 会中断）；将 `moltbot` 放在 `devDependencies` 或 `peerDependencies` 中

### CLI 进度和输出
- 使用 `src/cli/progress.ts`（`osc-progress` + `@clack/prompts` spinner）作为进度指示器；不要手动滚动进度条/条
- 状态输出：通过 `src/terminal/table.ts` 保持表格 + ANSI 安全换行
- `status --all` = 只读/可粘贴，`status --deep` = 探测
- CLI 调色板颜色：使用 `src/terminal/palette.ts` 中的共享调色板（无硬编码颜色）；应用于入门/配置提示和其他 TTY UI 输出

### 工具模式护栏
- 避免在工具输入模式中使用 `Type.Union`；不使用 `anyOf`/`oneOf`/`allOf`
- 对字符串列表使用 `stringEnum`/`optionalStringEnum`（Type.Unsafe 枚举）
- 使用 `Type.Optional(...)` 代替 `... | null`
- 保持顶级工具模式为 `type: "object"` 和 `properties`
- 避免在工具模式中使用原始 `format` 属性名称（某些验证器将其视为保留关键字）

### 会话日志位置
- 当被要求打开"session"文件时，打开 `~/.clawdbot/agents/<agentId>/sessions/*.jsonl` 下的 Pi 会话日志（使用系统提示的 Runtime 行中的 `agent=<id>` 值；除非给出特定 ID，否则使用最新的），而不是默认的 `sessions.json`
- 如果需要另一台机器上的日志，通过 Tailscale SSH 并在那里读取相同的路径

### 流式传输和传递
- 永不将流式/部分回复发送到外部消息表面（WhatsApp、Telegram）；只有最终回复应该在那里传递
- 流式传输/工具事件可能仍然进入内部 UI/控制通道

## 平台特定说明

### macOS
- Gateway 仅作为菜单栏应用运行；没有安装单独的 LaunchAgent/helper 标签
- 通过 Moltbot Mac 应用或 `scripts/restart-mac.sh` 重启
- 要验证/终止：使用 `launchctl print gui/$UID | grep moltbot` 而不是假设固定标签
- 在 macOS 上调试时，通过应用启动/停止 gateway，而不是临时 tmux 会话；在移交之前终止任何临时隧道
- 使用 `./scripts/clawlog.sh` 查询 Moltbot 子系统的统一日志（支持 follow/tail/类别过滤器）
- SwiftUI 状态管理：首选 `Observation` 框架（`@Observable`、`@Bindable`）而不是 `ObservableObject`/`@StateObject`；除非为了兼容性需要，否则不引入新的 `ObservableObject`，并在触摸相关代码时迁移现有用法

### iOS/Android
- "重启 iOS/Android 应用"意味着重建（重新编译/安装）并重新启动，而不仅仅是终止/启动
- 在测试之前，在接触模拟器/模拟器之前验证连接的真实设备（iOS + Android）
- iOS Team ID 查找：`security find-identity -p codesigning -v` → 使用 Apple Development (…) TEAMID；回退：`defaults read com.apple.dt.Xcode IDEProvisioningTeamIdentifiers`

### exe.dev 虚拟机
- 访问：稳定路径是 `ssh exe.dev` 然后 `ssh vm-name`（假设已设置 SSH 密钥）
- SSH 不稳定：使用 exe.dev Web 终端或 Shelley（Web 代理）；为长时间操作保持 tmux 会话
- 更新：`sudo npm i -g moltbot@latest`（全局安装需要在 `/usr/lib/node_modules` 上有 root 权限）
- 配置：使用 `moltbot config set ...`；确保设置了 `gateway.mode=local`
- Discord：仅存储原始令牌（无 `DISCORD_BOT_TOKEN=` 前缀）
- 重启：停止旧 gateway 并运行：`pkill -9 -f moltbot-gateway || true; nohup moltbot gateway run --bind loopback --port 18789 --force > /tmp/moltbot-gateway.log 2>&1 &`
- 验证：`moltbot channels status --probe`、`ss -ltnp | rg 18789`、`tail -n 120 /tmp/moltbot-gateway.log`

## 发布和版本控制

### 版本位置
- CLI：`package.json`
- Android：`apps/android/app/build.gradle.kts`（versionName/versionCode）
- iOS：`apps/ios/Sources/Info.plist` + `apps/ios/Tests/Info.plist`（CFBundleShortVersionString/CFBundleVersion）
- macOS：`apps/macos/Sources/Moltbot/Resources/Info.plist`（CFBundleShortVersionString/CFBundleVersion）
- 文档：`docs/install/updating.md`（固定的 npm 版本）、`docs/platforms/mac/release.md`（APP_VERSION/APP_BUILD 示例）
- Peekaboo：Xcode 项目/Info.plists（MARKETING_VERSION/CURRENT_PROJECT_VERSION）

### 发布护栏
- 未经操作员明确同意，不得更改版本号
- 在运行任何 npm publish/release 步骤之前始终请求许可
- 在进行任何发布工作之前阅读 `docs/reference/RELEASING.md` 和 `docs/platforms/mac/release.md`
- 发布签名/公证密钥在代码库外部管理；遵循内部发布文档
- Notary 认证环境变量（`APP_STORE_CONNECT_ISSUER_ID`、`APP_STORE_CONNECT_KEY_ID`、`APP_STORE_CONNECT_API_KEY_P8`）预期在你的环境中

## 特殊文件和自动生成的内容

- **A2UI bundle hash**：`src/canvas-host/a2ui/.bundle.hash` 是自动生成的；忽略意外更改，并仅在需要时通过 `pnpm canvas:a2ui:bundle`（或 `scripts/bundle-a2ui.sh`）重新生成。将 hash 作为单独提交提交。
- **Protocol 生成**：运行 `pnpm protocol:gen` 重新生成协议模式；`pnpm protocol:check` 验证是否不需要更改（比较生成的 Swift 类型和 JSON 模式）。

## 文档链接和样式

- 文档托管在 Mintlify 上（docs.molt.bot）
- `docs/**/*.md` 中的内部文档链接：根目录相对，无 `.md`/`.mdx`（例如：`[Config](/configuration)`）
- 章节交叉引用：在根目录相对路径上使用锚点（例如：`[Hooks](/configuration#hooks)`）
- 文档标题和锚点：避免在标题中使用破折号和撇号，因为它们会破坏 Mintlify 锚点链接
- 当 Peter 要求提供链接时，回复完整的 `https://docs.molt.bot/...` URL（而不是根目录相对）
- README（GitHub）：保持绝对文档 URL（`https://docs.molt.bot/...`）以便链接在 GitHub 上工作
- 文档内容必须是通用的：没有个人设备名称/主机名/路径；使用 `user@gateway-host` 和"gateway host"等占位符
- 文档编辑后运行文档健全性检查：`pnpm docs:list`

## 提交和 PR 工作流程

### 提交
- 使用 `scripts/committer "<msg>" <file...>`创建提交；避免手动 `git add`/`git commit` 以保持暂存范围
- 遵循简洁、面向操作的提交消息（例如，"CLI: add verbose flag to send"）
- 分组相关更改；避免捆绑不相关的重构

### 变更日志
- 在顶部保留最新发布的版本（无"Unreleased"）
- 发布后，提升版本并开始新的顶部章节
- 处理 PR 时添加带有 PR # 的变更日志条目
- 处理问题时在变更日志条目中引用问题

### PR 审查
- 当给出 PR 链接时，通过 `gh pr view`/`gh pr diff` 审查，并且**不**切换分支
- 首选单个 `gh pr view --json ...` 批处理元数据/注释；仅在需要时运行 `gh pr diff`
- 在开始审查粘贴的 GH Issue/PR 之前：运行 `git pull`；如果有本地更改或未推送的提交，请在审查前停止并提醒用户
- 目标：合并 PR。当提交干净时首选**rebase**；当历史记录混乱时首选**squash**

### PR 落地
- 从 `main` 创建临时分支，将 PR 分支合并到其中（首选 squash，除非提交历史很重要；在这种情况下使用 rebase/merge）
- 应用修复，添加变更日志（+ 感谢 + PR #），在提交**本地之前运行完整检查**（`pnpm lint && pnpm build && pnpm test`），提交，合并回 `main`，删除临时分支，在 `main` 上结束
- 重要：此后贡献者必须在 git 图中！如果我们 squash，将 PR 作者添加为共同贡献者
- 当从新贡献者合并 PR 时：将其头像添加到 README"感谢所有 clawtributors"缩略图列表中，然后运行 `bun scripts/update-clawtributors.ts` 并提交重新生成的 README
- 留下一条 PR 评论，准确说明我们做了什么并包含 SHA 哈希
- 处理 Issue/PR 时，在任务结束时打印完整的 GitHub URL

## NPM + 1Password（发布）

- 使用 1password 技能；所有 `op` 命令必须在新的 tmux 会话中运行
- 登录：`eval "$(op signin --account my.1password.com)"`（应用已解锁 + 集成已开启）
- OTP：`op read 'op://Private/Npmjs/one-time password?attribute=otp'`
- 发布：`npm publish --access public --otp="<otp>"`（从包目录运行）
- 在没有本地 npmrc 副作用的情况下验证：`npm view <pkg> version --userconfig "$(mktemp)"`
- 发布后终止 tmux 会话

## 词汇和术语

- "makeup" = "mac 应用"
- 对产品/应用/文档标题使用 **Moltbot**
- 对 CLI 命令、包/二进制文件、路径和配置键使用 `moltbot`

## 故障排除

- 重新品牌/迁移问题或旧配置/服务警告：运行 `moltbot doctor`（参见 `docs/gateway/doctor.md`）
- 回答问题时，仅响应高置信度的答案：在代码中验证；不要猜测
- Bug 调查：在得出结论之前阅读相关 npm 依赖项的源代码和所有相关本地代码；以高置信度的根本原因为目标
- 为棘手或非显而易见的逻辑添加简短的代码注释
- 保持文件简洁；提取辅助函数而不是"V2"副本
- 目标是将文件保持在 ~700 LOC 以下（仅作指导，不是硬性护栏）；在提高清晰度或可测试性时拆分/重构
