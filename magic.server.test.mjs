// Unit tests for the pure helpers in magic.server.ts.
// Written as .mjs so `tsc --noEmit` (which only includes **/*.ts and **/*.tsx)
// is unaffected; Node >= 23 strips the TypeScript types on import.
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAgentCandidates, describeCandidate, toAgentCandidate } from "./agents.ts";
import {
  compactTokens,
  formatPercent,
  formatTailHygiene,
  formatThresholdPercent,
  nativeCompactionLabel,
  relativeFromIso,
  relativeTime,
  sharePercent,
} from "./format.ts";
import {
  discoveryDirectoryFor,
  isOpencodeProvider,
  mergeProviderResults,
  normalizeAnthropicQuota,
  normalizeOpenAIQuota,
  normalizeSnapshot,
  parseInstanceDescriptor,
  pickSessionId,
  selectAnthropicCredential,
  selectLiveInstance,
  selectOAuthCredential,
} from "./magic.server.ts";

test("isOpencodeProvider matches opencode variants only", () => {
  assert.equal(isOpencodeProvider("opencode"), true);
  assert.equal(isOpencodeProvider("opencode-zen"), true);
  assert.equal(isOpencodeProvider("codex"), false);
  assert.equal(isOpencodeProvider(null), false);
  assert.equal(isOpencodeProvider(undefined), false);
});

test("pickSessionId prefers persistence.sessionId, then nativeHandle, then runtimeInfo", () => {
  assert.equal(
    pickSessionId({
      persistence: { sessionId: "ses_a", nativeHandle: "ses_b" },
      runtimeInfo: { sessionId: "ses_c" },
    }),
    "ses_a",
  );
  assert.equal(
    pickSessionId({ persistence: { nativeHandle: "ses_b" }, runtimeInfo: { sessionId: "ses_c" } }),
    "ses_b",
  );
  assert.equal(pickSessionId({ persistence: null, runtimeInfo: { sessionId: "ses_c" } }), "ses_c");
  assert.equal(pickSessionId({ persistence: { sessionId: "  " } }), null);
  assert.equal(pickSessionId(null), null);
});

test("discoveryDirectoryFor is a stable 16-hex-char folder", () => {
  const dir = discoveryDirectoryFor("/home/user/project");
  const hash = dir.split("/").pop();
  assert.match(hash ?? "", /^[0-9a-f]{16}$/);
  assert.equal(dir, discoveryDirectoryFor("/home/user/project"));
  assert.notEqual(dir, discoveryDirectoryFor("/home/user/other"));
});

test("parseInstanceDescriptor accepts real descriptors and rejects junk", () => {
  const ok = parseInstanceDescriptor(
    '{"port":35689,"pid":2782,"started_at":1787166669245,"kind":"OpenCode server","token":"abc","instance_id":"xyz"}',
  );
  assert.equal(ok?.port, 35689);
  assert.equal(ok?.token, "abc");
  assert.equal(parseInstanceDescriptor("not json"), null);
  assert.equal(parseInstanceDescriptor('{"pid":1}'), null);
});

test("selectLiveInstance picks the newest live instance", () => {
  const entries = [
    { port: 1, pid: 10, started_at: 100, token: "t1" },
    { port: 2, pid: 20, started_at: 300, token: "t2" },
    { port: 3, pid: 30, started_at: 200, token: "t3" },
  ];
  const alive = (pid) => pid !== 20;
  assert.equal(selectLiveInstance(entries, alive)?.port, 3);
  assert.equal(selectLiveInstance(entries, () => true)?.port, 2);
  assert.equal(selectLiveInstance(entries, () => false), null);
  assert.equal(selectLiveInstance([], () => true), null);
});

test("normalizeSnapshot fills missing metrics with null and keeps the session id", () => {
  const snapshot = normalizeSnapshot(
    { sessionId: "ses_1", usagePercentage: 42.5, inputTokens: 1000, extraField: "ignored" },
    "fallback",
  );
  assert.equal(snapshot?.sessionId, "ses_1");
  assert.equal(snapshot?.usagePercentage, 42.5);
  assert.equal(snapshot?.inputTokens, 1000);
  assert.equal(snapshot?.contextLimit, null);
  assert.equal(snapshot?.toolDefinitionTokens, null);

  assert.equal(normalizeSnapshot({}, "fallback")?.sessionId, "fallback");
  assert.equal(normalizeSnapshot(null, "fallback"), null);
  assert.equal(normalizeSnapshot("nope", "fallback"), null);
});

test("normalizeSnapshot maps the full v2 field set", () => {
  const snapshot = normalizeSnapshot(
    {
      sessionId: "ses_1",
      usagePercentage: 42.5,
      inputTokens: 85_000,
      contextLimit: 872_000,
      native_context_usage_percentage: 9.7,
      compaction_enabled: false,
      executeThreshold: 65,
      executeThresholdClamped: true,
      systemPromptTokens: 4000,
      compartmentTokens: 1000,
      factTokens: 200,
      memoryTokens: 300,
      docsTokens: 400,
      profileTokens: 500,
      conversationTokens: 600,
      toolCallTokens: 700,
      toolDefinitionTokens: 800,
      tailHygiene: { u: 120, t: 400, severity: 0.3, evaluable: false, extra: 1 },
      compartmentCount: 3,
      archivedCompartmentCount: 2,
      compartmentInProgress: true,
      historianRunning: true,
      memoryCount: 6,
      memoryBlockCount: 2,
      pendingOpsCount: 1,
      sessionNoteCount: 4,
      readySmartNoteCount: 2,
      cacheTtl: "5m",
      lastTransformError: "boom",
      lastDreamerRunAt: 1_700_000_000_000,
      projectIdentity: "proj",
      boundaryPresent: true,
      coverageOrdinal: 12,
      newWorkTokens: 900,
      totalInputTokens: 1_234_567,
      dreamerBacklog: { embed: { pending: 2, total: 9 } },
      dreamerProgress: { task: "embed", processed: 3, total: 10, startedAt: 5 },
      recompProgress: { kind: "upgrade", phase: "recomp", processedMessages: 5, totalMessages: 50 },
    },
    "fallback",
    "0.21.8",
  );

  assert.equal(snapshot?.nativeContextUsagePercentage, 9.7);
  assert.equal(snapshot?.compactionEnabled, false);
  assert.equal(snapshot?.executeThreshold, 65);
  assert.equal(snapshot?.executeThresholdClamped, true);
  assert.equal(snapshot?.tailHygiene?.severity, 0.3);
  assert.equal(snapshot?.tailHygiene?.evaluable, false);
  assert.equal(snapshot?.historianRunning, true);
  assert.equal(snapshot?.pendingOpsCount, 1);
  assert.equal(snapshot?.cacheTtl, "5m");
  assert.equal(snapshot?.lastTransformError, "boom");
  assert.equal(snapshot?.lastDreamerRunAt, 1_700_000_000_000);
  assert.equal(snapshot?.totalInputTokens, 1_234_567);
  assert.deepEqual(snapshot?.dreamerBacklog, { embed: { pending: 2, total: 9 } });
  assert.equal(snapshot?.dreamerProgress?.task, "embed");
  assert.equal(snapshot?.recompProgress?.phase, "recomp");
  assert.equal(snapshot?.pluginVersion, "0.21.8");
});

test("normalizeSnapshot nulls absent v2 structures instead of throwing", () => {
  const snapshot = normalizeSnapshot({ sessionId: "ses_2" }, "fallback");
  assert.equal(snapshot?.tailHygiene, null);
  assert.equal(snapshot?.dreamerProgress, null);
  assert.equal(snapshot?.dreamerBacklog, null);
  assert.equal(snapshot?.recompProgress, null);
  assert.equal(snapshot?.compactionEnabled, null);
  assert.equal(snapshot?.pluginVersion, null);
});

test("selectOAuthCredential classifies auth.json records per provider", () => {
  const now = 1_000_000;
  assert.deepEqual(selectOAuthCredential(null, "anthropic", now), { status: "no_credentials" });
  assert.deepEqual(selectOAuthCredential({ openai: {} }, "anthropic", now), {
    status: "no_credentials",
  });
  assert.deepEqual(selectOAuthCredential({ anthropic: { access: "  " } }, "anthropic", now), {
    status: "no_credentials",
  });
  assert.deepEqual(
    selectOAuthCredential({ anthropic: { access: "tok", expires: now - 1 } }, "anthropic", now),
    { status: "needs_reauth" },
  );
  assert.deepEqual(
    selectOAuthCredential({ anthropic: { access: "tok", expires: now + 60_000 } }, "anthropic", now),
    { status: "ok", accessToken: "tok", accountId: null },
  );
  // OpenAI records additionally carry the ChatGPT account id.
  assert.deepEqual(
    selectOAuthCredential(
      { openai: { access: "tok", expires: now + 1, accountId: "acct_1" } },
      "openai",
      now,
    ),
    { status: "ok", accessToken: "tok", accountId: "acct_1" },
  );
  // Missing `expires` is treated as usable; the API 401 path covers staleness.
  assert.deepEqual(selectAnthropicCredential({ anthropic: { access: "tok" } }, now), {
    status: "ok",
    accessToken: "tok",
    accountId: null,
  });
});

test("normalizeAnthropicQuota maps windows, clamps and folds extra usage into spend", () => {
  const result = normalizeAnthropicQuota(
    {
      five_hour: { utilization: 42, resets_at: "2026-08-19T20:00:00Z" },
      seven_day: { utilization: 137, resets_at: "2026-08-25T00:00:00Z" },
      extra_usage: { is_enabled: true, utilization: 12, used_credits: 500, monthly_limit: 2000 },
    },
    1234,
  );
  assert.equal(result.ok, true);
  assert.equal(result.id, "anthropic");
  assert.equal(result.displayName, "Claude");
  assert.deepEqual(result.windows, [
    { id: "five_hour", label: "5h", utilization: 42, resetsAt: "2026-08-19T20:00:00Z" },
    { id: "seven_day", label: "Weekly", utilization: 100, resetsAt: "2026-08-25T00:00:00Z" },
  ]);
  assert.deepEqual(result.spend, { label: "Extra usage", amount: 12, unit: "percent" });
  assert.equal(result.checkedAt, 1234);

  const empty = normalizeAnthropicQuota({}, 7);
  assert.deepEqual(empty.windows, []);
  assert.equal(empty.spend, null);

  const junk = normalizeAnthropicQuota({ five_hour: { utilization: "nope" } }, 7);
  assert.deepEqual(junk.windows, []);
});

test("normalizeOpenAIQuota maps the wham/usage rate_limit shape", () => {
  // Fixture mirrors paseo's CodexUsageResponseSchema: used_percent + epoch-second reset_at.
  const result = normalizeOpenAIQuota(
    {
      plan_type: "pro",
      rate_limit: {
        primary_window: { used_percent: 17.5, reset_at: 1_787_180_000 },
        secondary_window: { used_percent: "42", reset_at: "1787680000" },
      },
      code_review_rate_limit: { primary_window: { used_percent: 3 } },
      credits: { has_credits: true, balance: 12.5 },
    },
    99,
  );
  assert.equal(result.ok, true);
  assert.equal(result.id, "openai");
  assert.equal(result.displayName, "OpenAI");
  assert.equal(result.plan, "pro");
  assert.deepEqual(result.windows, [
    {
      id: "session",
      label: "5h",
      utilization: 17.5,
      resetsAt: new Date(1_787_180_000_000).toISOString(),
    },
    {
      id: "weekly",
      label: "Weekly",
      utilization: 42,
      resetsAt: new Date(1_787_680_000_000).toISOString(),
    },
    { id: "code_review", label: "Code review", utilization: 3, resetsAt: null },
  ]);
  assert.deepEqual(result.spend, { label: "Credits", amount: 12.5, unit: "usd" });
  assert.equal(result.checkedAt, 99);

  const empty = normalizeOpenAIQuota({}, 1);
  assert.deepEqual(empty.windows, []);
  assert.equal(empty.spend, null);
  assert.equal(empty.plan, null);

  // Over-100 percentages clamp; unusable windows are dropped entirely.
  const clamped = normalizeOpenAIQuota(
    { rate_limit: { primary_window: { used_percent: 150 }, secondary_window: {} } },
    1,
  );
  assert.deepEqual(clamped.windows, [
    { id: "session", label: "5h", utilization: 100, resetsAt: null },
  ]);
});

test("mergeProviderResults keeps fulfilled results and codes rejected ones", () => {
  const ok = { ok: true, id: "anthropic", displayName: "Claude", windows: [], plan: null, spend: null, checkedAt: 1 };
  const merged = mergeProviderResults(
    [
      { status: "fulfilled", value: ok },
      { status: "rejected", reason: new Error("boom") },
    ],
    ["anthropic", "openai"],
    { anthropic: "Claude", openai: "OpenAI" },
  );
  assert.deepEqual(merged[0], ok);
  assert.deepEqual(merged[1], {
    ok: false,
    id: "openai",
    displayName: "OpenAI",
    code: "rpc_failed",
    message: "Usage lookup failed.",
  });
  // Failure messages never carry provider internals.
  assert.equal(merged[1].message.includes("boom"), false);
});

test("compactTokens matches the TUI thresholds", () => {
  assert.equal(compactTokens(0), "0");
  assert.equal(compactTokens(999), "999");
  assert.equal(compactTokens(1000), "1K");
  assert.equal(compactTokens(85_400), "85K");
  assert.equal(compactTokens(872_000), "872K");
  assert.equal(compactTokens(1_500_000), "1.5M");
  assert.equal(compactTokens(null), "—");
  assert.equal(compactTokens(undefined), "—");
});

test("relativeTime formats past timestamps", () => {
  const now = 1_000_000_000;
  assert.equal(relativeTime(now - 5_000, now), "just now");
  assert.equal(relativeTime(now - 300_000, now), "5m ago");
  assert.equal(relativeTime(now - 3_600_000, now), "1h ago");
  assert.equal(relativeTime(now - 2 * 86_400_000, now), "2d ago");
  assert.equal(relativeTime(null, now), "never");
});

test("relativeFromIso formats future resets", () => {
  const now = Date.parse("2026-08-19T12:00:00Z");
  assert.equal(relativeFromIso("2026-08-19T12:42:00Z", now), "in 42m");
  assert.equal(relativeFromIso("2026-08-19T15:00:00Z", now), "in 3h");
  assert.equal(relativeFromIso("2026-08-21T12:00:00Z", now), "in 2d");
  assert.equal(relativeFromIso("2026-08-19T11:00:00Z", now), "now");
  assert.equal(relativeFromIso(null, now), null);
  assert.equal(relativeFromIso("not-a-date", now), null);
});

test("percentage helpers mirror the TUI", () => {
  assert.equal(formatThresholdPercent(65), "65");
  assert.equal(formatThresholdPercent(64.97), "65");
  assert.equal(formatThresholdPercent(64.5), "64.5");
  assert.equal(formatThresholdPercent(null), "—");
  assert.equal(formatPercent(42.567), "42.6%");
  assert.equal(formatPercent(42.567, 0), "43%");
  assert.equal(formatPercent(null), "—");
  assert.equal(sharePercent(250, 1000), "25%");
  assert.equal(sharePercent(250, 0), "25000%");
  assert.equal(sharePercent(0, null), "0%");
});

test("tail hygiene and native compaction labels", () => {
  assert.equal(
    formatTailHygiene({ u: 1200, t: 9600, severity: 0.125, evaluable: true }),
    "12.5% · 1,200 / 9,600 tok",
  );
  assert.match(
    formatTailHygiene({ u: 0, t: 0, severity: 0, evaluable: false }),
    /held until baseline refresh$/,
  );
  assert.equal(nativeCompactionLabel(50, 200), "Context: 25.0% · native compaction");
  assert.equal(nativeCompactionLabel(50, 0), "Context: unknown · native compaction");
});

test("toAgentCandidate maps entries and drops unusable rows", () => {
  const candidate = toAgentCandidate({
    agent: {
      id: "agt_1",
      provider: "opencode",
      title: "  Refactor tagger  ",
      status: "idle",
      model: "claude-opus-5",
      updatedAt: "2026-08-19T12:00:00Z",
      createdAt: "2026-08-18T12:00:00Z",
    },
    project: { projectName: "paseo", workspaceName: "feature/x" },
  });
  assert.equal(candidate?.id, "agt_1");
  assert.equal(candidate?.title, "Refactor tagger");
  assert.equal(candidate?.workspaceLabel, "feature/x");
  assert.equal(candidate?.lastActivityAt, Date.parse("2026-08-19T12:00:00Z"));

  // Falls back to project name, then to the id as the title.
  const fallback = toAgentCandidate({
    agent: { id: "agt_2", provider: "opencode" },
    project: { projectName: "paseo" },
  });
  assert.equal(fallback?.title, "agt_2");
  assert.equal(fallback?.workspaceLabel, "paseo");
  assert.equal(fallback?.lastActivityAt, 0);

  assert.equal(toAgentCandidate(null), null);
  assert.equal(toAgentCandidate({ agent: null }), null);
  assert.equal(toAgentCandidate({ agent: { id: "agt_3", archivedAt: "2026-01-01T00:00:00Z" } }), null);
});

test("buildAgentCandidates prefers opencode agents, newest first", () => {
  const entries = [
    { agent: { id: "a", provider: "opencode", updatedAt: "2026-08-19T10:00:00Z" } },
    { agent: { id: "b", provider: "codex", updatedAt: "2026-08-19T23:00:00Z" } },
    { agent: { id: "c", provider: "opencode-zen", updatedAt: "2026-08-19T22:00:00Z" } },
    { agent: { id: "d", provider: "opencode", archivedAt: "2026-08-19T09:00:00Z" } },
  ];
  assert.deepEqual(
    buildAgentCandidates(entries).map((candidate) => candidate.id),
    ["c", "a"],
  );

  // No opencode agents at all → show everything and let not_opencode explain.
  assert.deepEqual(
    buildAgentCandidates([
      { agent: { id: "x", provider: "codex", updatedAt: "2026-08-19T10:00:00Z" } },
      { agent: { id: "y", updatedAt: "2026-08-19T11:00:00Z" } },
    ]).map((candidate) => candidate.id),
    ["y", "x"],
  );

  assert.deepEqual(buildAgentCandidates(null), []);
  assert.deepEqual(buildAgentCandidates([null, undefined, {}]), []);
});

test("buildAgentCandidates breaks activity ties by title", () => {
  const entries = [
    { agent: { id: "2", provider: "opencode", title: "Zeta", updatedAt: "2026-08-19T10:00:00Z" } },
    { agent: { id: "1", provider: "opencode", title: "Alpha", updatedAt: "2026-08-19T10:00:00Z" } },
  ];
  assert.deepEqual(
    buildAgentCandidates(entries).map((candidate) => candidate.title),
    ["Alpha", "Zeta"],
  );
});

test("describeCandidate joins the present parts only", () => {
  assert.equal(
    describeCandidate({ id: "a", title: "t", provider: "opencode", status: "idle", model: "opus", workspaceLabel: "ws", lastActivityAt: 0 }),
    "ws · opus · idle",
  );
  assert.equal(
    describeCandidate({ id: "a", title: "t", provider: null, status: null, model: null, workspaceLabel: null, lastActivityAt: 0 }),
    "",
  );
});
