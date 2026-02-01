# 微信 Channel 接入计划

## 概述

本文档详细说明了在 Moltbot 代码库中接入微信通道的技术实现方案。

### 方案选择

基于代码库现有架构，我们考虑两种方案：

**方案 1（推荐）：微信企业号 Webhook**
- ✅ 官方 API，稳定可靠
- ✅ 跨平台支持（macOS、Windows、Linux）
- ✅ 与 Discord/Slack/GoogleChat 架构类似
- ✅ 完整的功能支持（消息 ID、事件、媒体等）
- ✅ 维护成本低

**方案 2（备选）：微信个人号（本地客户端自动化）**
- ⚠️ 类似 iMessage 的实现方式
- ⚠️ 仅支持 macOS 和 Windows
- ⚠️ 严重依赖 WeChat UI 结构，更新可能失效
- ⚠️ 需要用户授权辅助功能
- ⚠️ 消息 ID 获取不稳定
- ⚠️ 反检测风险高

**建议：** 优先实现方案 1（微信企业号），方案 2 仅作为备选用于个人测试。

---

## 方案 1：微信企业号 Webhook（推荐）

### 技术架构

- **API 类型**: 企业微信 Webhook / 企业微信 API
- **协议**: HTTP Webhook + REST API
- **验证**: Token 签名验证
- **消息类型**: 文本、图片、视频、文件、语音、图文消息

### 实施阶段

#### 第一阶段：核心架构和类型定义（2-3 天）

**1. 配置系统扩展**

创建 `src/config/types.wechat.ts`:

```typescript
export type WeChatConfig = {
  enabled: boolean;
  webhookUrl?: string;
  webhookToken?: string;
  corpId?: string;        // 企业 ID
  agentId?: string;      // 应用 Secret
  dmPolicy?: "pairing" | "auto" | "deny";
  groups?: Record<string, { requireMention?: boolean }>;
  allowFrom?: Array<string | number>;
  network?: "public" | "corp";
  timeoutSeconds?: number;
  proxy?: string;
};
```

更新 `src/config/types.channels.ts` 添加 `wechat?: WeChatConfig`

更新 `src/config/zod-schema.channels.ts` 添加微信配置验证

**2. Channel 注册**

在 `src/channels/registry.ts` 添加：

```typescript
export const CHAT_CHANNEL_ORDER = [
  "telegram",
  "whatsapp",
  "wechat",  // 新增
  "discord",
  // ...
] as const;

const CHAT_CHANNEL_META: Record<ChatChannelId, ChannelMeta> = {
  // ... 其他通道
  wechat: {
    id: "wechat",
    label: "WeChat",
    selectionLabel: "WeChat (企业号 Webhook)",
    detailLabel: "WeChat Bot",
    docsPath: "/channels/wechat",
    docsLabel: "wechat",
    blurb: "企业号 Webhook 支持，需要企业微信后台配置",
    systemImage: "message.circle.fill",
  },
};
```

添加别名映射：`wx: "wechat"`

**3. 类型定义**

创建 `src/wechat/bot/types.ts`:

```typescript
// 微信消息类型
export type WeChatMessage = {
  msgId: string;
  chatId: string;  // 企业微信：user 或 group
  from?: {
    id: string;
    displayName?: string;
  };
  to?: {
    id: string;
    displayName?: string;
  };
  text?: string;
  timestamp?: number;
  isFromSelf?: boolean;

  // 媒体附件
  attachments?: Array<{
    mimeType: string;
    url?: string;
    filename?: string;
    size?: number;
  }>;

  // 图文消息
  article?: {
    title: string;
    description: string;
    url: string;
    picUrl?: string;
  };

  // 位置
  location?: {
    latitude?: number;
    longitude?: number;
  };
};

export type WeChatContext = {
  chat?: {
    id: string;
    type: "dm" | "group";
    title?: string;
  };
  message?: WeChatMessage;
};

// WeChat 更新事件
export type WeChatUpdate = {
  type: "message" | "edited_message" | "deleted_message" | "reaction";
  message?: WeChatMessage;
  edited_message?: WeChatMessage;
  deleted_message?: { chatId: string; msgId: string };
  reaction?: {
    chatId: string;
    msgId: string;
    emoji: string;
    from: string;
  };
};
```

#### 第二阶段：Bot 实现（5-7 天）

**1. Bot 创建和配置**

创建 `src/wechat/bot.ts`:

```typescript
import type { RuntimeEnv } from "../runtime.js";
import type { MoltbotConfig } from "../config/config.js";

export type WeChatBotOptions = {
  webhookUrl?: string;
  webhookToken?: string;
  corpId?: string;
  agentId?: string;
  runtime?: RuntimeEnv;
  config?: MoltbotConfig;
  allowFrom?: Array<string>;
  dmPolicy?: "pairing" | "auto" | "deny";
};

export async function createWeChatBot(opts: WeChatBotOptions) {
  const runtime: RuntimeEnv = opts.runtime ?? {
    log: console.log,
    error: console.error,
    exit: (code: number): never => {
      throw new Error(`exit ${code}`);
    },
  };

  const cfg = opts.config ?? loadConfig();
  const wechatCfg = cfg.channels.wechat;

  // 验证配置
  if (!wechatCfg?.enabled) {
    runtime.log.info("WeChat channel not enabled");
    return { start: async () => {}, stop: async () => {} };
  }

  // Webhook 验证
  const webhookToken = opts.webhookToken || wechatCfg.webhookToken;
  if (!webhookToken) {
    throw new Error("WeChat webhook token is required");
  }

  return {
    start: async () => {
      runtime.log.info("Starting WeChat bot");
      // 启动 webhook 服务器
    },
    stop: async () => {
      runtime.log.info("Stopping WeChat bot");
      // 停止 webhook 服务器
    },
    sendMessage: async (chatId: string, text: string, sendOpts = {}) => {
      // 发送消息到微信企业 API
      return await sendMessageWeChat(chatId, text, sendOpts);
    },
    getBotInfo: async () => {
      return {
        id: opts.corpId || "",
        displayName: "Moltbot WeChat Bot",
      };
    },
  };
}
```

**2. Webhook 服务器**

创建 `src/wechat/webhook.ts`:

```typescript
import Hono from "hono";
import { createSubsystemLogger } from "../logging/subsystem.js";
import type { WeChatUpdate } from "./bot/types.js";

const log = createSubsystemLogger("wechat/webhook");

export type WeChatWebhookOptions = {
  token: string;
  port?: number;
  path?: string;
  onMessage: (update: WeChatUpdate) => void | Promise<void>;
};

export function createWeChatWebhookServer(opts: WeChatWebhookOptions) {
  const { token, port = 8080, path = "/wechat/webhook", onMessage } = opts;

  const app = new Hono();

  // GET 验证端点（微信服务器验证）
  app.get(path, async (c) => {
    const echostr = c.req.query("echostr");
    const signature = c.req.query("signature");
    const timestamp = c.req.query("timestamp");
    const nonce = c.req.query("nonce");

    // 验证签名
    // 实现企业微信签名验证逻辑

    log.info(`WeChat webhook verification request: ${echostr}`);
    return c.text(echostr);
  });

  // POST 消息接收端点
  app.post(path, async (c) => {
    try {
      const signature = c.req.header("wechat-signature") || "";
      const body = await c.req.text();
      const data = JSON.parse(body);

      // 验证签名
      if (!verifyWeChatSignature(signature, body, token)) {
        log.warn("Invalid WeChat webhook signature");
        return c.text("Invalid signature", 401);
      }

      log.verbose(`Received WeChat message: ${JSON.stringify(data)}`);

      // 处理消息
      const update = parseWeChatUpdate(data);
      await onMessage(update);

      return c.text("success");
    } catch (err) {
      log.error(`WeChat webhook error: ${err}`);
      return c.text("error", 500);
    }
  });

  return {
    start: async () => {
      log.info(`Starting WeChat webhook server on port ${port}`);
      // 启动 HTTP 服务器
    },
    stop: async () => {
      log.info("Stopping WeChat webhook server");
      // 停止服务器
    },
  };
}

// 签名验证
function verifyWeChatSignature(signature: string, body: string, token: string): boolean {
  // 实现企业微信签名验证算法
  // 参考：https://developer.work.weixin.qq.com/document/path/90665
  return true; // 占位
}
```

**3. 消息发送**

创建 `src/wechat/send.ts`:

```typescript
import type { WeChatSendOpts } from "./bot/types.js";
import { loadConfig } from "../config/config.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import axios from "axios"; // 或使用 undici

const log = createSubsystemLogger("wechat/send");

export type WeChatSendResult = {
  success: boolean;
  msgId: string;
  chatId: string;
};

export async function sendMessageWeChat(
  chatId: string,
  text: string,
  opts: WeChatSendOpts = {},
): Promise<WeChatSendResult> {
  const cfg = loadConfig();
  const wechatCfg = cfg.channels.wechat;

  try {
    // 发送到企业微信 API
    const apiUrl = "https://qyapi.weixin.qq.com/cgi-bin/message/send";
    const accessToken = await getWeChatAccessToken();

    const payload = {
      touser: chatId,
      msgtype: "text",
      text: {
        content: text,
      },
    };

    if (opts.mediaUrl) {
      payload.msgtype = "image";
      payload.image = {
        media_id: await uploadWeChatMedia(opts.mediaUrl),
      };
    }

    const response = await axios.post(
      `${apiUrl}?access_token=${accessToken}`,
      payload
    );

    if (response.data.errcode !== 0) {
      throw new Error(`WeChat API error: ${response.data.errmsg}`);
    }

    log.verbose(`Sent WeChat message to ${chatId}: ${response.data.msgid}`);

    return {
      success: true,
      msgId: response.data.msgid,
      chatId,
    };
  } catch (err) {
    log.error(`Failed to send WeChat message: ${err}`);
    return {
      success: false,
      chatId,
      msgId: "",
    };
  }
}

// 获取 Access Token
async function getWeChatAccessToken(): Promise<string> {
  // 实现企业微信 Access Token 获取和缓存
  return "cached_token";
}

// 上传媒体
async function uploadWeChatMedia(url: string): Promise<string> {
  // 实现企业微信媒体上传
  return "media_id";
}
```

**4. 消息处理器**

创建 `src/wechat/bot-message.ts` - 参考 Telegram 消息处理器实现

#### 第三阶段：CLI 和配置命令（3-4 天）

**1. CLI 命令**

创建 `src/cli/wechat-cli.ts`:

```typescript
import { Command } from "commander";

export function registerWeChatCommands(program: Command) {
  const wechatCmd = program
    .command("wechat")
    .description("WeChat enterprise account commands");

  wechatCmd
    .command("test")
    .description("Test WeChat webhook connection")
    .action(async () => {
      await testWeChatConnection();
    });

  wechatCmd
    .command("send <chatId> <message>")
    .description("Send a test message to WeChat")
    .action(async (chatId, message) => {
      await sendTestMessage(chatId, message);
    });
}
```

**2. Gateway 集成**

更新 `src/gateway/server-channels.ts` 添加微信通道管理

更新 `src/cli/deps.ts` 添加 `sendMessageWeChat`

#### 第四阶段：测试和文档（3-4 天）

**1. 单元测试**

创建 `src/wechat/*.test.ts` 测试文件

**2. 集成测试**

创建 `src/wechat/*.e2e.test.ts`

**3. 文档编写**

创建 `docs/channels/wechat.md`:

```markdown
---
summary: "WeChat enterprise account webhook support"
read_when:
  - You want to connect Moltbot to WeChat via enterprise webhook
---
# WeChat (企业号 Webhook)

Status: production-ready via enterprise WeChat API

## 快速设置

1. 在企业微信后台创建应用
2. 获取 CorpID、AgentID、Secret
3. 配置 Webhook URL
4. 在 Moltbot 中配置企业微信

## 配置示例

```json
{
  "channels": {
    "wechat": {
      "enabled": true,
      "corpId": "ww1234567890abcdef",
      "agentId": "1234567890abcdef",
      "webhookToken": "your-webhook-token",
      "dmPolicy": "pairing",
      "groups": {
        "*": { "requireMention": true }
      }
    }
  }
}
```
```

更新 `docs/channels/index.md` 添加微信入口

---

## 方案 2：微信个人号（本地客户端自动化）- 备选

### 技术架构

- **实现方式**: 通过本地 WeChat 客户端 API 桥接，类似 iMessage
- **技术路径**:
  - macOS: 通过 AppleScript + UI Automation
  - Windows: 通过 COM + UI Automation 或 Python 自动化
  - Linux: 不支持
- **参考实现**: `src/imessage/` 目录

### 实施阶段

#### 第一阶段：架构调研和可行性验证（2-3 天）

**1.1 微信本地 API 调研**

调研目标：
- macOS 下如何通过 AppleScript/JavaScript 访问 WeChat
- Windows 下如何通过 COM 接口调用 WeChat
- 消息发送、接收、读取历史记录的可行性
- WeChat 版本差异和兼容性

技术探索：

**macOS 方案:**
```typescript
// 可能的实现方式
// 方式 A: AppleScript + UI 自动化
// 方式 B: 使用 Apple EventBridge（如果支持）
// 方式 C: 使用第三方库如 wechat-electron-hook
```

**Windows 方案:**
```typescript
// 可能的实现方式
// 方式 A: UI Automation + COM
// 方式 B: 使用 WeChat UWP 应用桥接
// 方式 C: 使用第三方库如 wechat-com-automation
```

调研产出：
- 创建 `src/wechat/research-notes.md` 记录调研结果
- 列出各平台的支持矩阵
- 评估技术风险和稳定性

**1.2 创建核心类型定义**

创建 `src/wechat/personal/bot/types.ts`:

```typescript
// 微信消息类型（基于 iMessage 类型结构）
export type WeChatPersonalMessage = {
  msgId: string;
  chatId: string;
  from?: {
    id: string;        // 微信号
    displayName?: string;
  };
  to?: {
    id: string;
    displayName?: string;
  };
  text?: string;
  timestamp?: number;
  isFromSelf?: boolean;

  // 媒体附件
  attachments?: Array<{
    mimeType: string;
    url?: string;
    filename?: string;
    size?: number;
  }>;

  // 表情/贴纸
  sticker?: {
    id: string;
    url?: string;
  };
};

export type WeChatPersonalContext = {
  chat?: {
    id: string;
    type: "dm" | "group";
    title?: string;  // 群名称
  };
  message?: WeChatPersonalMessage;
};
```

#### 第二阶段：macOS 实现（7-10 天）

**2.1 创建核心 Bot 实现**

创建 `src/wechat/personal/bot.ts`:

```typescript
export type WeChatPersonalBotHandle = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  sendMessage: (chatId: string, text: string, opts?: WeChatSendOpts) => Promise<WeChatSendResult>;
  getBotInfo: () => Promise<{ id: string; displayName?: string }>;
};
```

**2.2 实现 AppleScript 桥接**

创建 `src/wechat/personal/applescript-bridge.ts`:

```typescript
export type WeChatAppleScriptBridge = {
  sendMessage: (toId: string, text: string) => Promise<{ success: boolean; msgId?: string }>;
  sendImage: (toId: string, imagePath: string) => Promise<{ success: boolean; msgId?: string }>;
  sendFile: (toId: string, filePath: string) => Promise<{ success: boolean; msgId?: string }>;
  getCurrentUser: () => Promise<{ id: string; displayName?: string }>;
  startMonitoring: (callback: (message: WeChatPersonalMessage) => void) => void;
  stopMonitoring: () => void;
};
```

核心 AppleScript 实现：

```applescript
-- sendMessage.applescript
on run argv
    set targetId to item 1 of argv
    set messageText to item 2 of argv

    tell application "WeChat"
        activate
        delay 0.5
        -- 通过 UI 自动化定位聊天窗口
        -- 这里需要具体实现，取决于 WeChat 的 UI 结构
        -- 可能需要使用 System Events 或 Accessibility API
    end tell
end run
```

**技术挑战：**
- ⚠️ WeChat 不像 iMessage 有完整的 AppleScript 支持
- ⚠️ 需要使用 UI Automation / Accessibility API
- ⚠️ 需要用户授权辅助功能访问
- ⚠️ 消息 ID 获取可能不稳定

**2.3 实现消息监控**

创建 `src/wechat/personal/monitor.ts`:

```typescript
export function createWeChatMonitor(opts: WeChatMonitorOptions) {
  const { bridge, onMessage, onError } = opts;

  return {
    start: async () => {
      try {
        log.info("Starting WeChat message monitoring");
        await bridge.startMonitoring(onMessage);
      } catch (err) {
        onError(err instanceof Error ? err : new Error(String(err)));
      }
    },
    stop: async () => {
      log.info("Stopping WeChat message monitoring");
      await bridge.stopMonitoring();
    },
  };
}
```

**2.4 实现消息发送**

创建 `src/wechat/personal/send.ts`:

```typescript
export async function sendMessageWeChat(
  chatId: string,
  text: string,
  opts: WeChatSendOpts = {},
): Promise<WeChatSendResult> {
  const { bridge, mediaUrl, imagePath, filePath } = opts;

  try {
    let result;

    if (mediaUrl) {
      const tempPath = await downloadMedia(mediaUrl);
      result = await bridge.sendImage(chatId, tempPath);
    } else if (filePath) {
      result = await bridge.sendFile(chatId, filePath);
    } else {
      result = await bridge.sendMessage(chatId, text);
    }

    if (!result.success) {
      throw new Error("Failed to send WeChat message");
    }

    return {
      success: true,
      msgId: result.msgId,
      chatId,
    };
  } catch (err) {
    return {
      success: false,
      chatId,
    };
  }
}
```

#### 第三阶段：Windows 实现（5-7 天）

**3.1 创建 Windows 桥接**

创建 `src/wechat/personal/windows-bridge.ts`:

```typescript
export type WeChatWindowsBridge = {
  sendMessage: (toId: string, text: string) => Promise<{ success: boolean; msgId?: string }>;
  sendImage: (toId: string, imagePath: string) => Promise<{ success: boolean; msgId?: string }>;
  getCurrentUser: () => Promise<{ id: string; displayName?: string }>;
  startMonitoring: (callback: (message: WeChatPersonalMessage) => void) => void;
  stopMonitoring: () => void;
};
```

技术方案选项：

**方案 A: Python + WeChat UWP 桥接**
```python
import pywinauto

class WeChatUWPBridge:
    def __init__(self):
        self.app = Application(backend="uwp", name="WeChat")

    def send_message(self, to_id: str, text: str):
        # 定位联系人并打开聊天
        # 输入文本并发送
        pass
```

**方案 B: COM + UI Automation**

```powershell
Add-Type -TypeDefinition @"
using System;
using System.Windows.Automation;

[ComImport, InterfaceType(ComInterfaceType.InterfaceIsDual)]
public interface IWeChatAutomation {
    void SendMessage(string chatId, string message);
    string GetCurrentUser();
}
"
```

**3.2 跨平台抽象**

创建 `src/wechat/personal/platform-bridge.ts`:

```typescript
export type WeChatPlatformBridge = WeChatAppleScriptBridge | WeChatWindowsBridge;

export async function createWeChatPersonalBridge(runtime: RuntimeEnv): Promise<WeChatPlatformBridge> {
  const platform = process.platform;

  if (platform === "darwin") {
    const { createAppleScriptBridge } = await import("./applescript-bridge.js");
    return await createAppleScriptBridge(runtime);
  }

  if (platform === "win32") {
    const { createWindowsBridge } = await import("./windows-bridge.js");
    return await createWindowsBridge(runtime);
  }

  throw new Error(`WeChat personal bridge not supported on platform: ${platform}`);
}
```

#### 第四阶段：配置和集成（3-4 天）

**4.1 配置类型定义**

创建 `src/config/types.wechat.personal.ts`:

```typescript
export type WeChatPersonalConfig = {
  enabled: boolean;
  dmPolicy?: "pairing" | "auto" | "deny";
  allowFrom?: Array<string>;  // 微信号白名单
  groups?: Record<string, {
    requireMention?: boolean;
    allowFrom?: Array<string>;
  }>;
  heartbeat?: {
    showOk?: boolean;
    showAlerts?: boolean;
    useIndicator?: boolean;
  };
  // macOS 特定配置
  macOS?: {
    requireAccessibility?: boolean;  // 是否需要辅助功能授权
    pollingInterval?: number;  // 轮询间隔（秒）
  };
  // Windows 特定配置
  windows?: {
    automationMode?: "uwp" | "com" | "python";
  };
};
```

**4.2 Channel 注册（个人号）**

在 `src/channels/registry.ts` 中添加个人号选项：

```typescript
wechat: {
  id: "wechat",
  label: "WeChat",
  selectionLabel: "WeChat (个人号)",
  detailLabel: "WeChat Personal",
  docsPath: "/channels/wechat-personal",
  docsLabel: "wechat-personal",
  blurb: "本地 WeChat 客户端集成，需要 macOS/Windows + 辅助功能授权",
  systemImage: "message.circle.fill",
},
```

#### 第五阶段：Gateway 集成（4-5 天）

**5.1 创建个人号 Bot 工厂**

创建 `src/wechat/personal/bot.ts` 完整实现：

```typescript
import { createWeChatPersonalBridge } from "./platform-bridge.js";
import { createWeChatMonitor } from "./monitor.js";

export async function createWeChatPersonalBot(opts: WeChatBotOptions) {
  const bridge = await createWeChatPersonalBridge(runtime);
  const botInfo = await bridge.getCurrentUser();

  const monitor = createWeChatMonitor({
    bridge,
    onMessage: async (message) => {
      await messageProcessor.process(message);
    },
  });

  return {
    start: async () => {
      await monitor.start();
    },
    stop: async () => {
      await monitor.stop();
    },
    sendMessage: async (chatId: string, text: string, sendOpts = {}) => {
      return await sendMessageWeChat(chatId, text, {
        ...sendOpts,
        bridge,
      });
    },
    getBotInfo: async () => botInfo,
  };
}
```

#### 第六阶段：CLI 命令（3-4 天）

**6.1 创建个人号 CLI 命令**

创建 `src/cli/wechat-personal-cli.ts`:

```typescript
export function registerWeChatPersonalCommands(program: Command) {
  const wechatCmd = program
    .command("wechat-personal")
    .description("WeChat personal account commands");

  wechatCmd
    .command("pair")
    .description("Enable WeChat personal account pairing")
    .action(async () => {
      await handleWeChatPairing();
    });

  wechatCmd
    .command("test")
    .description("Test WeChat connection")
    .action(async () => {
      await testWeChatConnection();
    });
}
```

#### 第七阶段：测试（5-7 天）

**7.1 单元测试**

创建 `src/wechat/personal/*.test.ts` 测试文件

**7.2 集成测试（macOS 专用）**

创建 `src/wechat/personal/*.e2e.test.ts`:

```typescript
describe("WeChat Personal Channel E2E", () => {
  beforeAll(() => {
    if (process.platform !== "darwin") {
      console.warn("WeChat Personal E2E tests require macOS");
      return;
    }
  });
}, {
  platform: "darwin",
});
```

#### 第八阶段：文档和用户指南（2-3 天）

**8.1 创建个人号用户文档**

创建 `docs/channels/wechat-personal.md`:

```markdown
---
summary: "WeChat personal account support via local client automation"
read_when:
  - You want to use WeChat with Moltbot on macOS or Windows
---
# WeChat (个人号)

Status: macOS 和 Windows 支持；需要本地 WeChat 客户端 + 辅助功能授权

## 平台支持

### macOS
- ✅ 支持：macOS 10.14+
- ✅ 方式：AppleScript + UI Automation
- ✅ 要求：WeChat 客户端运行 + 辅助功能权限

### Windows
- ✅ 支持：Windows 10/11
- ✅ 方式：COM + UI Automation 或 Python 自动化
- ✅ 要求：WeChat UWP 或桌面版运行

### Linux
- ❌ 不支持（微信没有 Linux 客户端）

## 快速设置

### 1) 启动 WeChat
- 确保已安装并登录 WeChat
- macOS: 打开 WeChat 应用
- Windows: 打开 WeChat UWP 或桌面版

### 2) 配置 Moltbot
```json
{
  "channels": {
    "wechat-personal": {
      "enabled": true,
      "dmPolicy": "pairing"
    }
  }
}
```

### 3) 启动 Gateway
```bash
moltbot gateway run
```

### 4) 配对（首次使用）
- Gateway 会显示配对代码
- 在 WeChat 中发送配对代码给任意联系人或文件传输助手
- 首次配对后，DM 将自动允许

## 辅助功能授权

### macOS
1. 打开 **系统设置 → 隐私与安全性 → 辅助功能**
2. 找到并勾选 **Moltbot**（或你的终端应用）
3. 重启 WeChat

### Windows
1. 打开 **设置 → 辅助功能**
2. 确保 UI Automation 已启用
3. 重启 WeChat

## 功能支持

### ✅ 已支持
- 接收和发送文本消息
- 接收和发送图片
- DM 配对和 Allowlist
- 群消息提及控制
- 消息历史记录

### ⚠️ 限制
- 消息 ID 获取不稳定
- 无法可靠获取消息编辑/删除事件
- 需要用户授权辅助功能
- 依赖 WeChat UI 结构（更新可能失效）
- 仅支持 macOS 和 Windows

### ❌ 不支持
- 视频通话
- 语音通话
- 文件传输（通过 Gateway）
- 消息编辑/删除检测
- 表情包（贴纸）
- 朋友圈操作

## 故障排除

### WeChat 未响应消息
1. 检查 WeChat 是否正在运行
2. 检查辅助功能权限是否已授予
3. 重启 Gateway

### 消息发送失败
1. 确认配对状态（DM 是否已配对）
2. 检查 Allowlist 配置
3. 查看日志：`moltbot logs wechat`

### 辅助功能问题（macOS）
1. 重启 WeChat
2. 在系统设置中重新授权辅助功能
3. 如果问题持续，尝试重启系统
```

更新 `docs/channels/index.md` 添加个人号入口

#### 第九阶段：UI 支持（6-8 天）

**9.1 macOS 应用集成**

更新 `apps/macos/` 相关文件：
- 添加个人号连接设置界面
- 实现辅助功能授权引导
- 显示微信连接状态

**9.2 Web UI 更新**

更新 Gateway Web UI：
- 添加个人号通道配置表单
- 显示实时连接状态
- 显示最近消息日志

**9.3 配置向导**

更新 `src/wizard/onboarding.ts` 添加个人号引导：

```typescript
if (platform === "darwin" || platform === "win32") {
  const wechatChoice = await prompt.select({
    message: "选择 WeChat 集成方式",
    choices: [
      { name: "wechat-personal", message: "个人号（本地客户端）" },
      { name: "wechat", message: "企业号（推荐）" },
    ],
  });
}
```

---

### 技术风险和缓解措施

#### 风险 1：UI 自动化不稳定

风险描述：
- WeChat UI 结构可能随时更新导致自动化失效
- 依赖元素定位，布局变化会破坏功能

缓解措施：
```typescript
// 实现多层定位策略
const定位策略 = {
  primary: "通过窗口标题定位",
  fallback: "通过 Accessibility 树遍历",
  lastResort: "通过坐标点击（不推荐）",
};

// 添加自检测和回退机制
async function locateChatWindow(chatId: string) {
  for (const strategy of Object.values(定位策略)) {
    try {
      const result = await executeStrategy(strategy, chatId);
      if (result) return result;
    } catch (err) {
      log.warn(`Strategy ${strategy} failed, trying next`);
      continue;
    }
  }
  throw new Error("所有定位策略都失败");
}
```

#### 风险 2：消息 ID 获取不可靠

缓解措施：
```typescript
// 使用时间戳 + 发送者 ID 作为唯一键
export function getWeChatSequentialKey(ctx: WeChatPersonalContext): string {
  const msg = ctx.message;
  if (!msg) return "wechat:unknown";

  const timestamp = msg.timestamp || Date.now();
  const chatId = msg.chatId;

  return `wechat:${chatId}:${timestamp}`;
}
```

#### 风险 3：反检测风险

缓解措施：
```typescript
// 实现人类化行为
const humanBehavior = {
  randomDelay: () => Math.random() * 1000 + 500,
  typingSimulation: () => Math.random() * 2000 + 1000,
  rateLimiting: {
    minInterval: 3000,
    maxMessagesPerMinute: 10,
  },
};

// 添加配置选项
export type WeChatPersonalConfig = {
  humanBehavior?: {
    enabled: boolean;
    randomDelay: boolean;
    typingSimulation: boolean;
  };
};
```

---

### 工作量对比

#### 方案 1（企业号 Webhook）

| 阶段 | 任务 | 预计时间 |
|------|------|----------|
| 第一阶段 | 架构和类型定义 | 2-3 天 |
| 第二阶段 | Bot 实现 | 5-7 天 |
| 第三阶段 | CLI 和配置 | 3-4 天 |
| 第四阶段 | 测试和文档 | 3-4 天 |
| **总计** | **13-18 天** |

#### 方案 2（个人号）

| 阶段 | 任务 | 预计时间 |
|------|------|----------|
| 第一阶段 | 架构调研和类型定义 | 2-3 天 |
| 第二阶段 | macOS Bot 实现 | 7-10 天 |
| 第三阶段 | Windows 桥接实现 | 5-7 天 |
| 第四阶段 | 配置和集成 | 3-4 天 |
| 第五阶段 | Gateway 集成 | 4-5 天 |
| 第六阶段 | CLI 命令 | 3-4 天 |
| 第七阶段 | 测试 | 5-7 天 |
| 第八阶段 | 文档和用户指南 | 2-3 天 |
| 第九阶段 | UI 支持 | 6-8 天 |
| **总计** | **37-51 天** |

---

### 关键成功指标

#### 方案 1（企业号 Webhook）

1. ✅ 微信企业号可以通过 Webhook 接收和发送消息
2. ✅ Gateway 可以正确路由微信消息
3. ✅ 支持 DM 和群消息
4. ✅ 支持媒体附件（图片、视频、文件）
5. ✅ 支持企业微信签名验证
6. ✅ 有完整的单元测试和集成测试
7. ✅ 有完整的用户文档
8. ✅ 集成到所有 UI（macOS 应用、Web UI）
9. ✅ 跨平台支持（macOS、Windows、Linux）

#### 方案 2（个人号）

1. ✅ macOS 上可以通过 AppleScript 发送和接收消息
2. ✅ Windows 上可以通过 UI Automation 发送和接收消息
3. ✅ Gateway 可以正确路由微信消息
4. ✅ 支持 DM 配对和 Allowlist
5. ✅ 有完整的单元测试覆盖
6. ✅ 有 macOS 集成测试（需要真实环境）
7. ✅ 有完整的用户文档
8. ✅ macOS 应用支持配置和状态显示
9. ✅ 有人类化行为缓解反检测风险

---

### 重大警告

#### 方案 2（个人号）重大限制

**⚠️ 此方案有以下重大限制：**

1. **平台限制：** 仅支持 macOS 和 Windows，Linux 不支持
2. **依赖性强：** 严重依赖 WeChat UI 结构，微信更新可能导致功能失效
3. **维护负担：** 需要持续跟进 WeChat 更新并调整自动化逻辑
4. **功能有限：** 无法可靠获取消息 ID、编辑、删除等事件
5. **反检测风险：** 即使有缓解措施，仍有被微信检测和限制的风险
6. **用户体验：** 需要 WeChat 在前台运行，可能影响正常使用
7. **稳定性：** UI 自动化相比 API 方案稳定性差很多

---

### 建议

基于以上分析，强烈建议**优先实现方案 1（微信企业号 Webhook）**：

**企业号方案优势：**
- ✅ 官方 API，稳定可靠
- ✅ 跨平台支持（macOS、Windows、Linux）
- ✅ 完整的功能支持（消息 ID、事件、媒体等）
- ✅ 无需用户授权辅助功能
- ✅ 维护成本低
- ✅ 与现有 Discord/Slack 架构一致

**个人号方案适用场景：**
- 仅用于个人测试和学习
- 企业号方案不可行时的备选
- 需要非常了解其局限性

---

## 附录

### 参考资源

#### 企业微信 API 文档
- 企业微信 API 文档：https://developer.work.weixin.qq.com/document/
- 应用管理后台：https://work.weixin.qq.com/

#### 技术参考
- Telegram 实现：`src/telegram/`
- Discord 实现：`src/discord/`
- iMessage 实现：`src/imessage/`

#### 相关文档
- Channel 架构：`src/channels/registry.ts`
- 配置系统：`src/config/`
- Gateway 集成：`src/gateway/server-channels.ts`

---

**文档版本：** 1.0
**最后更新：** 2026-01-31
**状态：** 规划阶段