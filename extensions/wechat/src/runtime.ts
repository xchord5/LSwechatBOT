import type { PluginRuntime } from "clawdbot/plugin-sdk";
import { WechatyBuilder } from "wechaty";
import { PuppetWechat4u } from "wechaty-puppet-wechat4u";
import type { WechatContext } from "./types.js";

let runtime: PluginRuntime | null = null;
const botInstances = new Map<string, WechatContext>();

export function setWechatRuntime(next: PluginRuntime) {
  runtime = next;
}

export function getWechatRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("WeChat runtime not initialized");
  }
  return runtime;
}

export async function createWechatBot(
  accountId: string,
  config: { puppet?: string; token?: string; name?: string }
): Promise<WechatContext> {
  const puppetName = config.puppet || "wechat-puppet-wechat4u";
  let puppet;
  
  if (puppetName === "wechat-puppet-wechat4u") {
    puppet = new PuppetWechat4u();
  } else {
    puppet = puppetName;
  }

  const bot = WechatyBuilder.build({
    name: config.name || `moltbot-wechat-${accountId}`,
    puppet,
  });

  const context: WechatContext = {
    accountId,
    bot,
    messageHandlers: new Map(),
  };

  bot.on("message", async (msg: any) => {
    try {
      const self = msg.talker();
      const room = msg.room();
      const text = msg.text();
      const date = msg.date();

      if (!text || text.trim() === "") {
        return;
      }

      const isGroup = !!room;

      if (isGroup) {
        return;
      }

      const fromName = self.name();
      const fromId = self.id;
      const to = msg.to()?.name() || "Unknown";
      const toId = msg.to()?.id || "Unknown";

      const wechatMessage = {
        text,
        from: fromName,
        fromId,
        to,
        toId,
        room: room?.id(),
        isGroup,
        timestamp: date || new Date(),
      };

      console.log(`[WeChat] 收到私聊消息 - From: ${fromName} (${fromId}), To: ${to} (${toId}), Text: ${text}`);

      if (!text.includes("管家宁贵人")) {
        console.log(`[WeChat] 消息未包含"管家宁贵人"，忽略处理`);
        return;
      }

      context.messageHandlers.forEach((handler) => {
        try {
          handler(wechatMessage);
        } catch (err) {
          console.error("[WeChat] 消息处理器错误:", err);
        }
      });
    } catch (err) {
      console.error("[WeChat] 处理消息错误:", err);
    }
  });

  bot.on("scan", (qrcode: string, status: number) => {
    console.log(`[WeChat] 扫码登录 - Status: ${status}`);
    console.log(`[WeChat] 二维码 URL: https://wechaty.js.org/qrcode/${encodeURIComponent(qrcode)}`);
    console.log(`[WeChat] 请在微信中扫描上方二维码登录`);
  });

  bot.on("login", (user: any) => {
    console.log(`[WeChat] Bot 登录成功: ${user.name()}`);
  });

  bot.on("logout", (user: any) => {
    console.log(`[WeChat] Bot 登出: ${user.name()}`);
  });

  bot.on("error", (err: Error) => {
    console.error("[WeChat] Bot 错误:", err);
  });

  await bot.start();
  botInstances.set(accountId, context);

  return context;
}

export function getWechatContext(accountId: string): WechatContext | undefined {
  return botInstances.get(accountId);
}

export async function stopWechatBot(accountId: string): Promise<void> {
  const context = botInstances.get(accountId);
  if (context) {
    await context.bot.stop();
    botInstances.delete(accountId);
  }
}

export async function stopAllWechatBots(): Promise<void> {
  const promises = Array.from(botInstances.keys()).map((accountId) =>
    stopWechatBot(accountId)
  );
  await Promise.all(promises);
}
