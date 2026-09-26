import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * Failure codes surfaced to the panel. The panel maps these to friendly copy;
 * `message` is always safe to render (never contains tokens, ports or paths).
 */
export const MagicSidebarErrorCodeSchema = z.enum([
  "not_opencode",
  "agent_unavailable",
  "magic_context_inactive",
  "rpc_failed",
]);

export type MagicSidebarErrorCode = z.output<typeof MagicSidebarErrorCodeSchema>;

/**
 * Optional numeric field. The upstream Magic Context snapshot evolves quickly,
 * so every metric except the session id is treated as best-effort.
 */
const optionalNumber = z.number().nullable().optional();
const optionalBoolean = z.boolean().nullable().optional();
const optionalString = z.string().nullable().optional();

export const TailHygieneSchema = z.object({
  u: optionalNumber,
  t: optionalNumber,
  severity: optionalNumber,
  evaluable: optionalBoolean,
});

export const DreamerProgressSchema = z.object({
  task: optionalString,
  processed: optionalNumber,
  total: optionalNumber,
  startedAt: optionalNumber,
});

export const DreamerBacklogEntrySchema = z.object({
  pending: optionalNumber,
  total: optionalNumber,
});

export const RecompProgressSchema = z.object({
  kind: optionalString,
  phase: optionalString,
  processedMessages: optionalNumber,
  totalMessages: optionalNumber,
  passCount: optionalNumber,
  compartmentsCreated: optionalNumber,
  message: optionalString,
  note: optionalString,
});

export const MagicSidebarSnapshotSchema = z.object({
  sessionId: z.string(),
  // Header / pressure.
  usagePercentage: optionalNumber,
  inputTokens: optionalNumber,
  contextLimit: optionalNumber,
  nativeContextUsagePercentage: optionalNumber,
  compactionEnabled: optionalBoolean,
  executeThreshold: optionalNumber,
  executeThresholdClamped: optionalBoolean,
  // Token breakdown.
  systemPromptTokens: optionalNumber,
  compartmentTokens: optionalNumber,
  factTokens: optionalNumber,
  memoryTokens: optionalNumber,
  docsTokens: optionalNumber,
  profileTokens: optionalNumber,
  conversationTokens: optionalNumber,
  toolCallTokens: optionalNumber,
  toolDefinitionTokens: optionalNumber,
  tailHygiene: TailHygieneSchema.nullable().optional(),
  // Historian / memory / status.
  compartmentCount: optionalNumber,
  archivedCompartmentCount: optionalNumber,
  compartmentInProgress: optionalBoolean,
  historianRunning: optionalBoolean,
  memoryCount: optionalNumber,
  memoryBlockCount: optionalNumber,
  pendingOpsCount: optionalNumber,
  sessionNoteCount: optionalNumber,
  readySmartNoteCount: optionalNumber,
  cacheTtl: optionalString,
  lastTransformError: optionalString,
  projectIdentity: optionalString,
  boundaryPresent: optionalBoolean,
  coverageOrdinal: optionalNumber,
  newWorkTokens: optionalNumber,
  totalInputTokens: optionalNumber,
  // Dreamer.
  lastDreamerRunAt: optionalNumber,
  dreamerProgress: DreamerProgressSchema.nullable().optional(),
  dreamerBacklog: z.record(z.string(), DreamerBacklogEntrySchema).nullable().optional(),
  recompProgress: RecompProgressSchema.nullable().optional(),
  /** Best-effort Magic Context package version, resolved by the backend. */
  pluginVersion: optionalString,
});

export type MagicSidebarSnapshot = z.output<typeof MagicSidebarSnapshotSchema>;

export const MagicSidebarSnapshotResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    snapshot: MagicSidebarSnapshotSchema,
  }),
  z.object({
    ok: z.literal(false),
    code: MagicSidebarErrorCodeSchema,
    message: z.string(),
  }),
]);

export type MagicSidebarSnapshotResult = z.output<typeof MagicSidebarSnapshotResultSchema>;

export const magicSidebarSnapshotContract = defineRpc({
  name: "magic.sidebar-snapshot",
  input: z.object({ agentId: z.string() }),
  output: MagicSidebarSnapshotResultSchema,
});

/* ------------------------------------------------------------------ */
/* Subscription quota (Anthropic + OpenAI)                             */
/* ------------------------------------------------------------------ */

export const QuotaErrorCodeSchema = z.enum([
  "no_credentials",
  "needs_reauth",
  "rpc_failed",
]);

export type QuotaErrorCode = z.output<typeof QuotaErrorCodeSchema>;

export const QuotaProviderIdSchema = z.enum(["anthropic", "openai"]);

export type QuotaProviderId = z.output<typeof QuotaProviderIdSchema>;

/** One rate-limit window, provider-agnostic. */
export const QuotaWindowSchema = z.object({
  id: z.string(),
  label: z.string(),
  /** Percentage of the window consumed, 0-100. */
  utilization: optionalNumber,
  /** ISO timestamp of the next reset. */
  resetsAt: optionalString,
});

export type QuotaWindow = z.output<typeof QuotaWindowSchema>;

/** Money / credit style counter shown next to the windows. */
export const QuotaSpendSchema = z.object({
  label: z.string(),
  amount: optionalNumber,
  unit: z.enum(["usd", "percent", "credits"]).nullable().optional(),
});

export type QuotaSpend = z.output<typeof QuotaSpendSchema>;

export const QuotaProviderResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    id: QuotaProviderIdSchema,
    displayName: z.string(),
    windows: z.array(QuotaWindowSchema),
    plan: optionalString,
    spend: QuotaSpendSchema.nullable().optional(),
    /** Epoch ms the backend last talked to the provider (cache-aware). */
    checkedAt: z.number(),
  }),
  z.object({
    ok: z.literal(false),
    id: QuotaProviderIdSchema,
    displayName: z.string(),
    code: QuotaErrorCodeSchema,
    message: z.string(),
  }),
]);

export type QuotaProviderResult = z.output<typeof QuotaProviderResultSchema>;

export const QuotaResultSchema = z.object({
  providers: z.array(QuotaProviderResultSchema),
});

export type QuotaResult = z.output<typeof QuotaResultSchema>;

export const quotaContract = defineRpc({
  name: "magic.quota",
  input: z.object({}),
  output: QuotaResultSchema,
});
