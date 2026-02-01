import type { MoltbotPluginApi } from "clawdbot/plugin-sdk";
import { emptyPluginConfigSchema } from "clawdbot/plugin-sdk";

import { wechatPlugin } from "./src/channel.js";
import { setWechatRuntime } from "./src/runtime.js";

const plugin = {
  id: "wechat",
  name: "WeChat",
  description: "WeChat channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: MoltbotPluginApi) {
    setWechatRuntime(api.runtime);
    api.registerChannel({ plugin: wechatPlugin });
  },
};

export default plugin;
