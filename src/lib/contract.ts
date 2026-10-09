import { z } from "zod";

const httpUrlSchema = z
  .string()
  .trim()
  .url()
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }, "url must be http or https");

export const buttonSchema = z
  .object({
    type: z.literal("url"),
    caption: z.string().trim().min(1).max(200),
    url: httpUrlSchema,
  })
  .strict();

export const textMessageSchema = z
  .object({
    type: z.literal("text"),
    text: z.string().trim().min(1).max(4000),
    buttons: z.array(buttonSchema).max(5).optional(),
  })
  .strict();

export const actionSchema = z
  .object({
    tag_name: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9_]+$/),
  })
  .strict();

export const quickReplyObjectSchema = z
  .object({
    caption: z.string().trim().min(1).max(200),
  })
  .strict();

export const quickReplyInputSchema = z.union([
  z.string().trim().min(1).max(200),
  quickReplyObjectSchema,
]);

export const publicChatResponseSchema = z
  .object({
    messages: z.array(textMessageSchema).max(10),
    quick_replies: z.array(quickReplyObjectSchema).max(11),
    actions: z.array(actionSchema).max(10),
  })
  .strict();

export const inboundReplyBodySchema = z
  .object({
    messages: z.array(textMessageSchema).max(10),
    quick_replies: z.array(quickReplyInputSchema).max(11),
    actions: z.array(actionSchema).max(10),
  })
  .strict();

export const chatRequestSchema = z
  .object({
    message: z.string().trim().min(1).max(4000),
    session_id: z.string().uuid(),
    channel: z.literal("website"),
    email: z.string().trim().email().max(320).optional(),
    name: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export const internalReplySchema = z
  .object({
    job_id: z.string().uuid(),
    session_id: z.string().uuid(),
    reply: inboundReplyBodySchema,
    email_captured: z.boolean().optional(),
  })
  .strict();

const timestampSchema = z.string().min(16).max(40);

export const storedJobSchema = z
  .object({
    job_id: z.string().uuid(),
    session_id: z.string().uuid(),
    status: z.enum(["pending", "done"]),
    message: z.string().min(1).max(4000),
    channel: z.literal("website"),
    email: z.string().email().max(320).optional(),
    name: z.string().min(1).max(200).optional(),
    created_at: timestampSchema,
    updated_at: timestampSchema,
    reply: publicChatResponseSchema.optional(),
    email_captured: z.boolean().optional(),
  })
  .strict();

export const historyEntrySchema = z
  .object({
    at: timestampSchema,
    job_id: z.string().uuid(),
    role: z.enum(["user", "assistant"]),
    message: z.string().min(1).max(4000).optional(),
    reply: publicChatResponseSchema.optional(),
  })
  .strict();

export const healthResponseSchema = z
  .object({
    ok: z.literal(true),
    service: z.literal("solon-support-api"),
    version: z.string().min(1),
    commit: z.string().min(1),
    time: z.string().min(16),
    kv: z.enum(["configured", "not_configured"]),
    webhook: z.enum(["configured", "not_configured"]),
  })
  .strict();

export type ChatRequest = z.infer<typeof chatRequestSchema>;
export type PublicChatResponse = z.infer<typeof publicChatResponseSchema>;
export type InboundReplyBody = z.infer<typeof inboundReplyBodySchema>;
export type InternalReply = z.infer<typeof internalReplySchema>;
export type StoredJob = z.infer<typeof storedJobSchema>;
export type HistoryEntry = z.infer<typeof historyEntrySchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const NOT_CONFIGURED_BODY = {
  error: "not_configured",
  message: "Support chat is not configured.",
} as const;

/**
 * Operational fallbacks for the sync bridge. These are not the support persona.
 * The website widget renders messages[].text and shows its own handoff note
 * when actions contain tag_name "needs_human".
 */
export const TIMEOUT_REPLY: PublicChatResponse = {
  messages: [
    {
      type: "text",
      text: "Nu am putut obține un răspuns la timp. Un coleg din echipă te va contacta.",
    },
  ],
  quick_replies: [],
  actions: [{ tag_name: "needs_human" }],
};

export const WAKE_FAILED_REPLY: PublicChatResponse = {
  messages: [
    {
      type: "text",
      text: "Serviciul de suport nu răspunde momentan. Un coleg din echipă te va contacta.",
    },
  ],
  quick_replies: [],
  actions: [{ tag_name: "needs_human" }],
};

export const normalizeReply = (reply: InboundReplyBody): PublicChatResponse => {
  const normalized = {
    messages: reply.messages,
    quick_replies: reply.quick_replies.map((item) =>
      typeof item === "string" ? { caption: item } : { caption: item.caption },
    ),
    actions: reply.actions,
  };
  return publicChatResponseSchema.parse(normalized);
};
