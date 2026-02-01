export interface WechatAccount {
  accountId: string;
  enabled: boolean;
  config: WechatAccountConfig;
}

export interface WechatAccountConfig {
  enabled?: boolean;
  puppet?: string;
  token?: string;
  name?: string;
}

export interface WechatMessage {
  text: string;
  from: string;
  fromId: string;
  to: string;
  toId: string;
  room?: string;
  isGroup: boolean;
  timestamp: Date;
}

export interface WechatContext {
  accountId: string;
  bot: any;
  messageHandlers: Map<string, (msg: any) => void>;
}
