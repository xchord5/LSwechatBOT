import { z } from "zod";

const WechatAccountSchemaBase = z
  .object({
    enabled: z.boolean().optional(),
    puppet: z.string().optional(),
    token: z.string().optional(),
    name: z.string().optional(),
  })
  .strict();

export const WechatConfigSchema = WechatAccountSchemaBase.extend({
  accounts: z.record(z.string(), WechatAccountSchemaBase.optional()).optional(),
});
