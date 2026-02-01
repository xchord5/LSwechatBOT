import {
  getChatChannelMeta,
  DEFAULT_ACCOUNT_ID,
  buildChannelConfigSchema,
  type ChannelPlugin,
  type ResolvedAccount,
} from "clawdbot/plugin-sdk";

import { getWechatRuntime } from "./runtime.js";
import {
  createWechatBot,
  getWechatContext,
  stopWechatBot,
} from "./runtime.js";
import { WechatConfigSchema } from "./config-schema.js";
import type { WechatAccount } from "./types.js";

const meta = getChatChannelMeta("wechat");

export const wechatPlugin: ChannelPlugin<WechatAccount> = {
  id: "wechat",
  meta: {
    ...meta,
  },
  capabilities: {
    chatTypes: ["direct"],
    media: true,
  },
  configSchema: buildChannelConfigSchema(WechatConfigSchema),
  config: {
    listAccountIds: (cfg) => {
      const wechatConfig = cfg.channels?.wechat;
      if (!wechatConfig) return [];
      
      const accounts = wechatConfig.accounts;
      if (accounts && typeof accounts === "object") {
        return Object.keys(accounts);
      }
      
      return ["default"];
    },
    resolveAccount: (cfg, accountId) => {
      const resolvedAccountId = accountId ?? DEFAULT_ACCOUNT_ID;
      const account = resolvedAccountId === DEFAULT_ACCOUNT_ID
        ? cfg.channels?.wechat
        : cfg.channels?.wechat?.accounts?.[resolvedAccountId];
      
      return {
        accountId: resolvedAccountId,
        enabled: account?.enabled ?? true,
        config: {
          enabled: account?.enabled ?? true,
          puppet: account?.puppet,
          token: account?.token,
          name: account?.name,
        },
      };
    },
    defaultAccountId: (cfg) => DEFAULT_ACCOUNT_ID,
    isConfigured: (account) => Boolean(account.config.puppet || account.config.token),
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.config.name || "WeChat Bot",
      enabled: account.enabled,
      configured: Boolean(account.config.puppet || account.config.token),
    }),
    resolveAllowFrom: ({ cfg, accountId }) =>
      (cfg.channels?.wechat?.dm?.allowFrom ?? []).map((entry) =>
        String(entry),
      ),
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => entry.replace(/^@/, ""))
        .map((entry) => entry.replace(/^wechat:user:/i, "")),
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      ctx.log?.info(`[wechat] starting provider for account: ${account.accountId}`);
      
      const wechatContext = await createWechatBot(
        account.accountId,
        {
          puppet: account.config.puppet,
          token: account.config.token,
          name: account.config.name,
        }
      );

      const handlerId = `${account.accountId}-handler`;
      const core = getWechatRuntime();
      
      wechatContext.messageHandlers.set(handlerId, async (wechatMessage) => {
        try {
          const route = core.channel.routing.resolveAgentRoute({
            cfg: ctx.cfg,
            channel: "wechat",
            accountId: account.accountId,
            peer: {
              kind: "direct",
              id: wechatMessage.fromId,
            },
          });

          let messageText = wechatMessage.text;
          let commandBody = messageText;

          if (messageText.includes("管家宁贵人")) {
            const parts = messageText.split("管家宁贵人");
            commandBody = parts[parts.length - 1].trim();
            if (!commandBody) {
              commandBody = messageText;
            }
          }

          const body = core.channel.reply.formatAgentEnvelope({
            channel: "WeChat",
            from: wechatMessage.from,
            timestamp: wechatMessage.timestamp?.getTime(),
            envelope: core.channel.reply.resolveEnvelopeFormatOptions(ctx.cfg),
            body: messageText,
          });

          const ctxPayload = core.channel.reply.finalizeInboundContext({
            Body: body,
            RawBody: messageText,
            CommandBody: commandBody,
            From: `wechat:user:${wechatMessage.fromId}`,
            To: `wechat:user:${wechatMessage.toId}`,
            SessionKey: route.sessionKey,
            AccountId: route.accountId,
            ChatType: "direct",
            ConversationLabel: wechatMessage.fromId,
            SenderName: wechatMessage.from,
            SenderId: wechatMessage.fromId.replace(/^@/, ""),
            Provider: "wechat",
            Surface: "wechat",
            MessageSid: wechatMessage.timestamp?.getTime().toString(),
            OriginatingChannel: "wechat",
            OriginatingTo: `wechat:user:${wechatMessage.toId}`,
            CommandAuthorized: true,
          });

          const storePath = core.channel.session.resolveStorePath(ctx.cfg.session?.store, {
            agentId: route.agentId,
          });
          await core.channel.session.recordInboundSession({
            storePath,
            sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
            ctx: ctxPayload,
            onRecordError: (err) => {
              ctx.log?.error(`[wechat] Failed updating session meta: ${String(err)}`);
            },
          });

          const tableMode = core.channel.text.resolveMarkdownTableMode({
            cfg: ctx.cfg,
            channel: "wechat",
            accountId: account.accountId,
          });

          await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
            ctx: ctxPayload,
            cfg: ctx.cfg,
            dispatcherOptions: {
              deliver: async (payload) => {
                const contact = await wechatContext.bot.Contact.find({ id: wechatMessage.fromId });
                if (!contact) {
                  ctx.log?.error(`[wechat] Contact not found: ${wechatMessage.fromId}`);
                  return;
                }
                await contact.say(payload.text);
                const contactName = contact.name() || wechatMessage.fromId;
                ctx.log?.info(`[wechat] Sent reply to ${contactName} (${wechatMessage.fromId})`);
              },
            },
          });
        } catch (err) {
          ctx.log?.error(`[wechat] Failed to route message: ${err}`);
        }
      });

      return {
        async stop() {
          wechatContext.messageHandlers.delete(handlerId);
          await stopWechatBot(account.accountId);
        },
      };
    },
  },
  outbound: {
    deliveryMode: "direct",
    chunker: null,
    textChunkLimit: 2000,
    sendText: async ({ to, text, accountId }) => {
      const context = getWechatContext(accountId ?? DEFAULT_ACCOUNT_ID);
      if (!context) {
        throw new Error(`WeChat bot not found for account: ${accountId}`);
      }

      const targetId = to.replace(/^(wechat:)?user:/, "");
      const contact = await context.bot.Contact.find({ id: targetId });
      
      if (!contact) {
        throw new Error(`WeChat contact not found: ${targetId}`);
      }

      await contact.say(text);
      
      return {
        channel: "wechat",
        target: to,
        success: true,
      };
    },
    sendMedia: async ({ to, text, mediaUrl, accountId }) => {
      const context = getWechatContext(accountId ?? DEFAULT_ACCOUNT_ID);
      if (!context) {
        throw new Error(`WeChat bot not found for account: ${accountId}`);
      }

      const targetId = to.replace(/^(wechat:)?user:/, "");
      const contact = await context.bot.Contact.find({ id: targetId });
      
      if (!contact) {
        throw new Error(`WeChat contact not found: ${targetId}`);
      }

      if (mediaUrl) {
        const fileBox = await context.bot.FileBox.fromUrl(mediaUrl);
        await contact.say(fileBox);
      }
      
      if (text) {
        await contact.say(text);
      }
      
      return {
        channel: "wechat",
        target: to,
        success: true,
      };
    },
  },
  messaging: {
    normalizeTarget: (target) => {
      if (target.match(/^user:/)) {
        return target;
      }
      if (target.match(/^\d+$/)) {
        return `user:${target}`;
      }
      return target;
    },
    targetResolver: {
      looksLikeId: (target) => target.match(/^user:\d+$/) !== null,
      hint: "user:WeChatId",
    },
  },
};
