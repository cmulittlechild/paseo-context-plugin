import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type {
  MagicSidebarErrorCode,
  MagicSidebarSnapshot,
  MagicSidebarSnapshotResult,
  QuotaErrorCode,
  QuotaProviderId,
  QuotaProviderResult,
  QuotaResult,
  QuotaWindow,
} from "./magic.shared";

/**
 * Root of the Magic Context RPC discovery tree. Each OpenCode instance writes a
 * small JSON descriptor into `<root>/<directoryHash>/port-<pid>-<instance>.json`.
 */
const DISCOVERY_ROOT = join(
  homedir(),
  ".local",
  "share",
  "cortexkit",
  "magic-context",
  "rpc",
);

/** Best-effort source for the `v<version>` footer, mirroring the TUI header. */
const MAGIC_CONTEXT_PACKAGE_JSON = join(
  homedir(),
  ".cache",
  "opencode",
  "packages",
  "@cortexkit",
  "opencode-magic-context@latest",
  "node_modules",
  "@cortexkit",
  "opencode-magic-context",
  "package.json",
);

const OPENCODE_AUTH_PATH = join(homedir(), ".local", "share", "opencode", "auth.json");

const ANTHROPIC_QUOTA_URL = "https://api.anthropic.com/api/oauth/usage";
const OPENAI_QUOTA_URL = "https://chatgpt.com/backend-api/wham/usage";

const RPC_TIMEOUT_MS = 4000;
const QUOTA_TIMEOUT_MS = 5000;
/** Successful quota reads are reused for a minute so client polling can't hammer Anthropic. */
const QUOTA_CACHE_TTL_MS = 60_000;

/** Runtime imports are limited to node builtins + zod so the pure helpers stay unit-testable. */
const InstanceDescriptorSchema = z.object({
  port: z.number(),
  pid: z.number(),
  started_at: z.number().nullable().optional(),
  kind: z.string().nullable().optional(),
  token: z.string(),
  instance_id: z.string().nullable().optional(),
});

export type MagicInstanceDescriptor = z.output<typeof InstanceDescriptorSchema>;

/** Lenient parse of the upstream sidebar-snapshot wire payload. */
const wireNumber = z.number().nullable().optional().catch(null);
const wireBoolean = z.boolean().nullable().optional().catch(null);
const wireString = z.string().nullable().optional().catch(null);

const WireTailHygieneSchema = z
  .object({
    u: wireNumber,
    t: wireNumber,
    severity: wireNumber,
    evaluable: wireBoolean,
  })
  .loose()
  .nullable()
  .optional()
  .catch(null);

const WireDreamerProgressSchema = z
  .object({
    task: wireString,
    processed: wireNumber,
    total: wireNumber,
    startedAt: wireNumber,
  })
  .loose()
  .nullable()
  .optional()
  .catch(null);

const WireDreamerBacklogSchema = z
  .record(
    z.string(),
    z.object({ pending: wireNumber, total: wireNumber }).loose(),
  )
  .nullable()
  .optional()
  .catch(null);

const WireRecompProgressSchema = z
  .object({
    kind: wireString,
    phase: wireString,
    processedMessages: wireNumber,
    totalMessages: wireNumber,
    passCount: wireNumber,
    compartmentsCreated: wireNumber,
    message: wireString,
    note: wireString,
  })
  .loose()
  .nullable()
  .optional()
  .catch(null);

const WireSnapshotSchema = z
  .object({
    sessionId: wireString,
    usagePercentage: wireNumber,
    inputTokens: wireNumber,
    contextLimit: wireNumber,
    native_context_usage_percentage: wireNumber,
    compaction_enabled: wireBoolean,
    executeThreshold: wireNumber,
    executeThresholdClamped: wireBoolean,
    systemPromptTokens: wireNumber,
    compartmentTokens: wireNumber,
    factTokens: wireNumber,
    memoryTokens: wireNumber,
    docsTokens: wireNumber,
    profileTokens: wireNumber,
    conversationTokens: wireNumber,
    toolCallTokens: wireNumber,
    toolDefinitionTokens: wireNumber,
    tailHygiene: WireTailHygieneSchema,
    compartmentCount: wireNumber,
    archivedCompartmentCount: wireNumber,
    compartmentInProgress: wireBoolean,
    historianRunning: wireBoolean,
    memoryCount: wireNumber,
    memoryBlockCount: wireNumber,
    pendingOpsCount: wireNumber,
    sessionNoteCount: wireNumber,
    readySmartNoteCount: wireNumber,
    cacheTtl: wireString,
    lastTransformError: wireString,
    projectIdentity: wireString,
    boundaryPresent: wireBoolean,
    coverageOrdinal: wireNumber,
    newWorkTokens: wireNumber,
    totalInputTokens: wireNumber,
    lastDreamerRunAt: wireNumber,
    dreamerProgress: WireDreamerProgressSchema,
    dreamerBacklog: WireDreamerBacklogSchema,
    recompProgress: WireRecompProgressSchema,
  })
  .loose();

/** Minimal structural view of a Paseo agent snapshot, so helpers stay dependency-free. */
export interface AgentSessionSource {
  readonly persistence?: {
    readonly sessionId?: string | null;
    readonly nativeHandle?: string | null;
  } | null;
  readonly runtimeInfo?: {
    readonly sessionId?: string | null;
  } | null;
}

function failure(code: MagicSidebarErrorCode, message: string): MagicSidebarSnapshotResult {
  return { ok: false, code, message };
}

/** True when the provider is OpenCode (`opencode`, `opencode-foo`, …). */
export function isOpencodeProvider(provider: string | null | undefined): boolean {
  return typeof provider === "string" && provider.toLowerCase().startsWith("opencode");
}

/**
 * Session id resolution order: persisted session id, then the provider-native
 * handle, then the live runtime info.
 */
export function pickSessionId(agent: AgentSessionSource | null | undefined): string | null {
  if (!agent) return null;
  const candidates = [
    agent.persistence?.sessionId,
    agent.persistence?.nativeHandle,
    agent.runtimeInfo?.sessionId,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) return candidate;
  }
  return null;
}

/** Directory-scoped discovery folder for a workspace path. */
export function discoveryDirectoryFor(directory: string): string {
  const hash = createHash("sha256").update(directory).digest("hex").slice(0, 16);
  return join(DISCOVERY_ROOT, hash);
}

/** Parses one descriptor file body; returns null for anything unusable. */
export function parseInstanceDescriptor(raw: string): MagicInstanceDescriptor | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = InstanceDescriptorSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/** A pid is considered live when signal 0 succeeds, or fails with EPERM. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException | null)?.code === "EPERM";
  }
}

/**
 * Picks the most recently started live instance. Pure: liveness is injected so
 * the selection rule can be unit-tested.
 */
export function selectLiveInstance(
  entries: readonly MagicInstanceDescriptor[],
  isAlive: (pid: number) => boolean,
): MagicInstanceDescriptor | null {
  let best: MagicInstanceDescriptor | null = null;
  for (const entry of entries) {
    if (!isAlive(entry.pid)) continue;
    if (best === null || (entry.started_at ?? 0) > (best.started_at ?? 0)) {
      best = entry;
    }
  }
  return best;
}

/**
 * Coerces an upstream sidebar-snapshot payload into the contract shape.
 * Returns null when the payload is not an object we can use at all.
 */
export function normalizeSnapshot(
  raw: unknown,
  fallbackSessionId: string,
  pluginVersion: string | null = null,
): MagicSidebarSnapshot | null {
  const parsed = WireSnapshotSchema.safeParse(raw);
  if (!parsed.success) return null;
  const wire = parsed.data;

  const backlogEntries = wire.dreamerBacklog
    ? Object.fromEntries(
        Object.entries(wire.dreamerBacklog).map(([task, entry]) => [
          task,
          { pending: entry.pending ?? null, total: entry.total ?? null },
        ]),
      )
    : null;

  return {
    sessionId: wire.sessionId ?? fallbackSessionId,
    usagePercentage: wire.usagePercentage ?? null,
    inputTokens: wire.inputTokens ?? null,
    contextLimit: wire.contextLimit ?? null,
    nativeContextUsagePercentage: wire.native_context_usage_percentage ?? null,
    compactionEnabled: wire.compaction_enabled ?? null,
    executeThreshold: wire.executeThreshold ?? null,
    executeThresholdClamped: wire.executeThresholdClamped ?? null,
    systemPromptTokens: wire.systemPromptTokens ?? null,
    compartmentTokens: wire.compartmentTokens ?? null,
    factTokens: wire.factTokens ?? null,
    memoryTokens: wire.memoryTokens ?? null,
    docsTokens: wire.docsTokens ?? null,
    profileTokens: wire.profileTokens ?? null,
    conversationTokens: wire.conversationTokens ?? null,
    toolCallTokens: wire.toolCallTokens ?? null,
    toolDefinitionTokens: wire.toolDefinitionTokens ?? null,
    tailHygiene: wire.tailHygiene
      ? {
          u: wire.tailHygiene.u ?? null,
          t: wire.tailHygiene.t ?? null,
          severity: wire.tailHygiene.severity ?? null,
          evaluable: wire.tailHygiene.evaluable ?? null,
        }
      : null,
    compartmentCount: wire.compartmentCount ?? null,
    archivedCompartmentCount: wire.archivedCompartmentCount ?? null,
    compartmentInProgress: wire.compartmentInProgress ?? null,
    historianRunning: wire.historianRunning ?? null,
    memoryCount: wire.memoryCount ?? null,
    memoryBlockCount: wire.memoryBlockCount ?? null,
    pendingOpsCount: wire.pendingOpsCount ?? null,
    sessionNoteCount: wire.sessionNoteCount ?? null,
    readySmartNoteCount: wire.readySmartNoteCount ?? null,
    cacheTtl: wire.cacheTtl ?? null,
    lastTransformError: wire.lastTransformError ?? null,
    projectIdentity: wire.projectIdentity ?? null,
    boundaryPresent: wire.boundaryPresent ?? null,
    coverageOrdinal: wire.coverageOrdinal ?? null,
    newWorkTokens: wire.newWorkTokens ?? null,
    totalInputTokens: wire.totalInputTokens ?? null,
    lastDreamerRunAt: wire.lastDreamerRunAt ?? null,
    dreamerProgress: wire.dreamerProgress
      ? {
          task: wire.dreamerProgress.task ?? null,
          processed: wire.dreamerProgress.processed ?? null,
          total: wire.dreamerProgress.total ?? null,
          startedAt: wire.dreamerProgress.startedAt ?? null,
        }
      : null,
    dreamerBacklog: backlogEntries,
    recompProgress: wire.recompProgress
      ? {
          kind: wire.recompProgress.kind ?? null,
          phase: wire.recompProgress.phase ?? null,
          processedMessages: wire.recompProgress.processedMessages ?? null,
          totalMessages: wire.recompProgress.totalMessages ?? null,
          passCount: wire.recompProgress.passCount ?? null,
          compartmentsCreated: wire.recompProgress.compartmentsCreated ?? null,
          message: wire.recompProgress.message ?? null,
          note: wire.recompProgress.note ?? null,
        }
      : null,
    pluginVersion,
  };
}

/** Reads every descriptor in the directory-scoped discovery folder. */
async function readInstanceDescriptors(directory: string): Promise<MagicInstanceDescriptor[]> {
  const folder = discoveryDirectoryFor(directory);
  let names: string[];
  try {
    names = await readdir(folder);
  } catch {
    return [];
  }
  const descriptors: MagicInstanceDescriptor[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const body = await readFile(join(folder, name), "utf8");
      const descriptor = parseInstanceDescriptor(body);
      if (descriptor) descriptors.push(descriptor);
    } catch {
      // Ignore unreadable / racing descriptor files.
    }
  }
  return descriptors;
}

let cachedPluginVersion: string | null | undefined;

/** Best-effort Magic Context version for the footer. Never throws. */
async function readPluginVersion(): Promise<string | null> {
  if (cachedPluginVersion !== undefined) return cachedPluginVersion;
  try {
    const body = await readFile(MAGIC_CONTEXT_PACKAGE_JSON, "utf8");
    const parsed: unknown = JSON.parse(body);
    const version = (parsed as { version?: unknown } | null)?.version;
    cachedPluginVersion = typeof version === "string" ? version : null;
  } catch {
    cachedPluginVersion = null;
  }
  return cachedPluginVersion;
}

/** Minimal structural view of the Paseo API surface this handler needs. */
export interface AgentRefreshApi {
  agents: {
    ref(agentId: string): {
      refresh(): Promise<{ agent?: unknown } | null>;
    };
  };
}

interface RefreshedAgent extends AgentSessionSource {
  readonly provider?: string | null;
  readonly cwd?: string | null;
}

/**
 * Resolves the agent, locates its live Magic Context instance and fetches the
 * sidebar snapshot. Every failure path returns a safe, code-tagged result.
 */
export async function fetchSidebarSnapshot(
  input: { agentId: string },
  paseo: AgentRefreshApi,
): Promise<MagicSidebarSnapshotResult> {
  let agent: RefreshedAgent | null = null;
  try {
    const result = await paseo.agents.ref(input.agentId).refresh();
    agent = (result?.agent as RefreshedAgent | undefined) ?? null;
  } catch {
    agent = null;
  }
  if (!agent) {
    return failure("agent_unavailable", "This agent is not available right now.");
  }

  if (!isOpencodeProvider(agent.provider)) {
    return failure("not_opencode", "Context metrics are only available for OpenCode agents.");
  }

  const sessionId = pickSessionId(agent);
  if (!sessionId) {
    return failure("agent_unavailable", "This agent has no session yet.");
  }

  const directory = typeof agent.cwd === "string" ? agent.cwd : "";
  if (directory.length === 0) {
    return failure("agent_unavailable", "This agent has no working directory.");
  }

  const descriptors = await readInstanceDescriptors(directory);
  const instance = selectLiveInstance(descriptors, isProcessAlive);
  if (!instance) {
    return failure(
      "magic_context_inactive",
      "No running Magic Context instance was found for this workspace.",
    );
  }

  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${instance.port}/rpc/sidebar-snapshot`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${instance.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ sessionId, directory }),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });
  } catch {
    return failure("rpc_failed", "Could not reach the Magic Context instance.");
  }

  if (!response.ok) {
    return failure("rpc_failed", `Magic Context returned an error (HTTP ${response.status}).`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return failure("rpc_failed", "Magic Context returned an unreadable response.");
  }

  const envelope = payload as { snapshot?: unknown; data?: unknown } | null;
  const candidate =
    envelope && typeof envelope === "object" && envelope.snapshot !== undefined
      ? envelope.snapshot
      : envelope && typeof envelope === "object" && envelope.data !== undefined
        ? envelope.data
        : payload;

  const snapshot = normalizeSnapshot(candidate, sessionId, await readPluginVersion());
  if (!snapshot) {
    return failure("rpc_failed", "Magic Context returned an unexpected snapshot shape.");
  }

  return { ok: true, snapshot };
}

/* ------------------------------------------------------------------ */
/* Subscription quota (Anthropic + OpenAI)                             */
/* ------------------------------------------------------------------ */

export type OAuthCredentialSelection =
  | { status: "ok"; accessToken: string; accountId: string | null }
  | { status: "no_credentials" }
  | { status: "needs_reauth" };

/**
 * Reads one OAuth record out of OpenCode's auth.json.
 *
 * Deliberately does NOT refresh: rotating OpenCode's refresh token from here
 * could invalidate the running session's credentials. An expired token is
 * reported as `needs_reauth` instead. Token values never leave this module.
 */
export function selectOAuthCredential(
  raw: unknown,
  provider: "anthropic" | "openai",
  now: number = Date.now(),
): OAuthCredentialSelection {
  if (!raw || typeof raw !== "object") return { status: "no_credentials" };
  const record = (raw as Record<string, unknown>)[provider];
  if (!record || typeof record !== "object") return { status: "no_credentials" };
  const entry = record as { access?: unknown; expires?: unknown; accountId?: unknown };
  const access = typeof entry.access === "string" ? entry.access.trim() : "";
  if (access.length === 0) return { status: "no_credentials" };
  const expires = typeof entry.expires === "number" ? entry.expires : null;
  if (expires !== null && expires <= now) return { status: "needs_reauth" };
  const accountId = typeof entry.accountId === "string" && entry.accountId.length > 0
    ? entry.accountId
    : null;
  return { status: "ok", accessToken: access, accountId };
}

/** Back-compat alias used by the Anthropic path. */
export function selectAnthropicCredential(
  raw: unknown,
  now: number = Date.now(),
): OAuthCredentialSelection {
  return selectOAuthCredential(raw, "anthropic", now);
}

function readOptionalNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  // The Codex usage API is documented (paseo's own fetcher uses z.coerce.number)
  // to sometimes send numeric strings.
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function clampPercent(value: number | null): number | null {
  return value === null ? null : Math.max(0, Math.min(100, value));
}

function readIsoString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function providerFailure(
  id: QuotaProviderId,
  displayName: string,
  code: QuotaErrorCode,
  message: string,
): QuotaProviderResult {
  return { ok: false, id, displayName, code, message };
}

/* --------------------------- Anthropic ---------------------------- */

function anthropicWindow(raw: unknown, id: string, label: string): QuotaWindow | null {
  if (!raw || typeof raw !== "object") return null;
  const window = raw as { utilization?: unknown; resets_at?: unknown; resetsAt?: unknown };
  const utilization = clampPercent(readOptionalNumber(window.utilization));
  const resetsAt = readIsoString(window.resets_at) ?? readIsoString(window.resetsAt);
  if (utilization === null && resetsAt === null) return null;
  return { id, label, utilization, resetsAt };
}

/** Maps the Anthropic `/api/oauth/usage` payload onto the shared window shape. */
export function normalizeAnthropicQuota(raw: unknown, checkedAt: number): QuotaProviderResult {
  const usage = (raw && typeof raw === "object" ? raw : {}) as {
    five_hour?: unknown;
    seven_day?: unknown;
    extra_usage?: unknown;
  };

  const windows: QuotaWindow[] = [];
  const fiveHour = anthropicWindow(usage.five_hour, "five_hour", "5h");
  if (fiveHour) windows.push(fiveHour);
  const sevenDay = anthropicWindow(usage.seven_day, "seven_day", "Weekly");
  if (sevenDay) windows.push(sevenDay);

  const extra = (usage.extra_usage && typeof usage.extra_usage === "object"
    ? usage.extra_usage
    : null) as { is_enabled?: unknown; utilization?: unknown } | null;
  const extraUtilization = extra ? clampPercent(readOptionalNumber(extra.utilization)) : null;

  return {
    ok: true,
    id: "anthropic",
    displayName: "Claude",
    windows,
    plan: null,
    spend:
      extraUtilization === null
        ? null
        : { label: "Extra usage", amount: extraUtilization, unit: "percent" },
    checkedAt,
  };
}

async function fetchAnthropicQuota(authRaw: unknown, now: number): Promise<QuotaProviderResult> {
  const credential = selectOAuthCredential(authRaw, "anthropic", now);
  if (credential.status === "no_credentials") {
    return providerFailure("anthropic", "Claude", "no_credentials", "No Claude credentials found.");
  }
  if (credential.status === "needs_reauth") {
    return providerFailure(
      "anthropic",
      "Claude",
      "needs_reauth",
      "Claude login expired — re-authenticate in OpenCode.",
    );
  }

  let response: Response;
  try {
    response = await fetch(ANTHROPIC_QUOTA_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${credential.accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "anthropic-beta": "oauth-2025-04-20",
        "User-Agent": "claude-code/1.0",
      },
      signal: AbortSignal.timeout(QUOTA_TIMEOUT_MS),
    });
  } catch {
    return providerFailure("anthropic", "Claude", "rpc_failed", "Could not reach the Claude usage API.");
  }

  if (response.status === 401 || response.status === 403) {
    return providerFailure(
      "anthropic",
      "Claude",
      "needs_reauth",
      "Claude login expired — re-authenticate in OpenCode.",
    );
  }
  if (!response.ok) {
    return providerFailure(
      "anthropic",
      "Claude",
      "rpc_failed",
      `Claude usage API returned HTTP ${response.status}.`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return providerFailure(
      "anthropic",
      "Claude",
      "rpc_failed",
      "Claude usage API returned an unreadable response.",
    );
  }

  return normalizeAnthropicQuota(payload, now);
}

/* ----------------------------- OpenAI ----------------------------- */

function codexWindow(raw: unknown, id: string, label: string): QuotaWindow | null {
  if (!raw || typeof raw !== "object") return null;
  const window = raw as { used_percent?: unknown; reset_at?: unknown };
  const utilization = clampPercent(readOptionalNumber(window.used_percent));
  const resetAtSeconds = readOptionalNumber(window.reset_at);
  const resetsAt =
    resetAtSeconds === null ? null : new Date(resetAtSeconds * 1000).toISOString();
  if (utilization === null && resetsAt === null) return null;
  return { id, label, utilization: utilization ?? 0, resetsAt };
}

/**
 * Maps the ChatGPT `backend-api/wham/usage` payload. Mirrors paseo's own
 * CodexQuotaProvider: `rate_limit.primary_window` is the rolling session window,
 * `secondary_window` the weekly one, plus an optional code-review window and a
 * credit balance. `reset_at` is epoch seconds.
 */
export function normalizeOpenAIQuota(raw: unknown, checkedAt: number): QuotaProviderResult {
  const usage = (raw && typeof raw === "object" ? raw : {}) as {
    plan_type?: unknown;
    rate_limit?: { primary_window?: unknown; secondary_window?: unknown } | null;
    code_review_rate_limit?: { primary_window?: unknown } | null;
    credits?: { balance?: unknown; unlimited?: unknown } | null;
  };

  const windows: QuotaWindow[] = [];
  const session = codexWindow(usage.rate_limit?.primary_window, "session", "5h");
  if (session) windows.push(session);
  const weekly = codexWindow(usage.rate_limit?.secondary_window, "weekly", "Weekly");
  if (weekly) windows.push(weekly);
  const codeReview = codexWindow(
    usage.code_review_rate_limit?.primary_window,
    "code_review",
    "Code review",
  );
  if (codeReview) windows.push(codeReview);

  const balance = readOptionalNumber(usage.credits?.balance);

  return {
    ok: true,
    id: "openai",
    displayName: "OpenAI",
    windows,
    plan: typeof usage.plan_type === "string" ? usage.plan_type : null,
    spend: balance === null ? null : { label: "Credits", amount: balance, unit: "usd" },
    checkedAt,
  };
}

async function fetchOpenAIQuota(authRaw: unknown, now: number): Promise<QuotaProviderResult> {
  const credential = selectOAuthCredential(authRaw, "openai", now);
  if (credential.status === "no_credentials") {
    return providerFailure("openai", "OpenAI", "no_credentials", "No OpenAI credentials found.");
  }
  if (credential.status === "needs_reauth") {
    return providerFailure(
      "openai",
      "OpenAI",
      "needs_reauth",
      "OpenAI login expired — re-authenticate in OpenCode.",
    );
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${credential.accessToken}`,
    Accept: "application/json",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
  };
  if (credential.accountId) headers["ChatGPT-Account-Id"] = credential.accountId;

  let response: Response;
  try {
    response = await fetch(OPENAI_QUOTA_URL, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(QUOTA_TIMEOUT_MS),
    });
  } catch {
    return providerFailure("openai", "OpenAI", "rpc_failed", "Could not reach the OpenAI usage API.");
  }

  if (response.status === 401 || response.status === 403) {
    return providerFailure(
      "openai",
      "OpenAI",
      "needs_reauth",
      "OpenAI login expired — re-authenticate in OpenCode.",
    );
  }
  if (!response.ok) {
    return providerFailure(
      "openai",
      "OpenAI",
      "rpc_failed",
      `OpenAI usage API returned HTTP ${response.status}.`,
    );
  }

  let text: string;
  try {
    text = await response.text();
  } catch {
    return providerFailure(
      "openai",
      "OpenAI",
      "rpc_failed",
      "OpenAI usage API returned an unreadable response.",
    );
  }
  // An HTML body means the session cookie/token was rejected and we were sent
  // to a login page — same signal paseo's Codex fetcher uses.
  if (text.trim().startsWith("<")) {
    return providerFailure(
      "openai",
      "OpenAI",
      "needs_reauth",
      "OpenAI login expired — re-authenticate in OpenCode.",
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return providerFailure(
      "openai",
      "OpenAI",
      "rpc_failed",
      "OpenAI usage API returned an unreadable response.",
    );
  }

  return normalizeOpenAIQuota(payload, now);
}

/* ---------------------------- Combined ---------------------------- */

const quotaCache = new Map<QuotaProviderId, { at: number; result: QuotaProviderResult }>();

/** Test seam: clears the module-level 60s per-provider quota cache. */
export function resetQuotaCache(): void {
  quotaCache.clear();
}

/**
 * Merges freshly fetched provider results with the per-provider cache. Only
 * successful reads are cached (60s); failures always reflect the live attempt.
 */
export function mergeProviderResults(
  results: readonly PromiseSettledResult<QuotaProviderResult>[],
  order: readonly QuotaProviderId[],
  displayNames: Readonly<Record<QuotaProviderId, string>>,
): QuotaProviderResult[] {
  return results.map((settled, index) => {
    const id = order[index] ?? "anthropic";
    if (settled.status === "fulfilled") return settled.value;
    return providerFailure(id, displayNames[id], "rpc_failed", "Usage lookup failed.");
  });
}

/**
 * Reads subscription usage for every supported provider concurrently.
 * Successful responses are cached for 60s per provider so a polling panel
 * cannot hammer the upstream APIs.
 */
export async function fetchQuota(now: number = Date.now()): Promise<QuotaResult> {
  let authRaw: unknown = null;
  try {
    authRaw = JSON.parse(await readFile(OPENCODE_AUTH_PATH, "utf8"));
  } catch {
    authRaw = null;
  }

  const order: QuotaProviderId[] = ["anthropic", "openai"];
  const displayNames: Record<QuotaProviderId, string> = {
    anthropic: "Claude",
    openai: "OpenAI",
  };

  const settled = await Promise.allSettled(
    order.map(async (id) => {
      const cached = quotaCache.get(id);
      if (cached && now - cached.at < QUOTA_CACHE_TTL_MS) return cached.result;
      const result =
        id === "anthropic"
          ? await fetchAnthropicQuota(authRaw, now)
          : await fetchOpenAIQuota(authRaw, now);
      if (result.ok) quotaCache.set(id, { at: now, result });
      return result;
    }),
  );

  return { providers: mergeProviderResults(settled, order, displayNames) };
}
