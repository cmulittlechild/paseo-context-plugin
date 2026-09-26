import type { PluginHostProps, PluginTheme } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DimensionValue } from "react-native";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  compactTokens,
  formatPercent,
  formatTailHygiene,
  formatThresholdPercent,
  nativeCompactionLabel,
  relativeFromIso,
  relativeTime,
  sharePercent,
} from "../shared/format";
import type {
  QuotaProviderResult,
  QuotaResult,
  QuotaWindow,
  MagicSidebarErrorCode,
  MagicSidebarSnapshot,
  MagicSidebarSnapshotResult,
} from "../shared/magic.shared";
import { magicSidebarSnapshotContract, quotaContract } from "../shared/magic.shared";

/** Successful branch of a provider result — used for spend formatting. */
type QuotaProviderSuccess = Extract<QuotaProviderResult, { ok: true }>;

const SNAPSHOT_POLL_MS = 3000;
const QUOTA_POLL_MS = 60_000;

/**
 * Token-breakdown segment palette. These are the exact hex values the OpenCode
 * Magic Context TUI uses (`sidebar-content.tsx` COLORS) — the PluginTheme
 * exposes a single `accent`, which cannot encode nine distinct categories.
 * They are mid-tone tailwind 300/400 hues chosen to stay legible on both dark
 * and light surfaces; everything else in this panel comes from `theme.colors`.
 */
const SEGMENT_COLORS = {
  system: "#c084fc",
  docs: "#22d3ee",
  compartments: "#60a5fa",
  facts: "#fbbf24",
  memories: "#34d399",
  profile: "#a3e635",
  conversation: "#f87171",
  toolCalls: "#fb923c",
  toolDefs: "#f472b6",
} as const;

interface TokenSegment {
  key: string;
  label: string;
  tokens: number;
  color: string;
}

type PanelState =
  | { phase: "loading" }
  | { phase: "ready"; result: MagicSidebarSnapshotResult };

type QuotaState = { phase: "loading" } | { phase: "ready"; result: QuotaResult };

export function createStyles(theme: PluginTheme, compact: boolean) {
  const gap = compact ? 8 : 12;
  const pad = compact ? 12 : 16;
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.surface0 },
    content: { padding: pad, paddingBottom: pad * 2 },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: gap,
    },
    title: { color: theme.colors.foreground, fontSize: compact ? 14 : 16, fontWeight: "700", flexShrink: 1 },
    headerLeft: { flexDirection: "row", alignItems: "center", flexShrink: 1, gap: 6 },
    backButton: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
    backLabel: { color: theme.colors.accent, fontSize: 18, fontWeight: "700" },
    button: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 6,
      backgroundColor: theme.colors.accent,
    },
    buttonLabel: { color: theme.colors.accentForeground, fontSize: 12, fontWeight: "600" },
    sectionHeader: { marginTop: gap, marginBottom: 2 },
    sectionHeaderRow: {
      marginTop: gap,
      marginBottom: 2,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    sectionTitle: { color: theme.colors.foreground, fontSize: 13, fontWeight: "700" },
    summaryRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 4,
    },
    summaryText: { color: theme.colors.foreground, fontSize: 13, fontWeight: "700" },
    bar: {
      flexDirection: "row",
      height: 8,
      borderRadius: 4,
      overflow: "hidden",
      backgroundColor: theme.colors.foregroundMuted,
    },
    barSegment: { height: 8 },
    miniTrack: {
      height: 6,
      borderRadius: 3,
      overflow: "hidden",
      backgroundColor: theme.colors.foregroundMuted,
      marginTop: 3,
      marginBottom: 2,
    },
    miniFill: { height: 6, backgroundColor: theme.colors.accent },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 1,
    },
    label: { color: theme.colors.foregroundMuted, fontSize: 12 },
    value: { color: theme.colors.foreground, fontSize: 12, fontWeight: "600" },
    valueAccent: { color: theme.colors.accent, fontSize: 12, fontWeight: "600" },
    valueMuted: { color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "600" },
    valueDanger: { color: theme.colors.statusDanger, fontSize: 12, fontWeight: "600" },
    legendLabel: { fontSize: 12, fontWeight: "600" },
    footnote: { color: theme.colors.foregroundMuted, fontSize: 10, marginTop: 4 },
    banner: {
      marginBottom: 6,
      paddingVertical: 4,
      paddingHorizontal: 6,
      borderRadius: 4,
      borderWidth: 1,
      borderColor: theme.colors.statusDanger,
    },
    bannerText: { color: theme.colors.statusDanger, fontSize: 12 },
    body: { color: theme.colors.foreground, fontSize: 13 },
    danger: { color: theme.colors.statusDanger, fontSize: 13, fontWeight: "700" },
    muted: { color: theme.colors.foregroundMuted, fontSize: 11, marginTop: 4 },
    footer: { color: theme.colors.foregroundMuted, fontSize: 10, marginTop: 12 },
    providerName: { color: theme.colors.foreground, fontSize: 12, fontWeight: "700", marginTop: 4 },
  });
}

export type Styles = ReturnType<typeof createStyles>;

type RowTone = "default" | "accent" | "muted" | "danger";

function StatRow({
  styles,
  label,
  value,
  tone = "default",
}: {
  styles: Styles;
  label: string;
  value: string;
  tone?: RowTone;
}) {
  const valueStyle =
    tone === "accent"
      ? styles.valueAccent
      : tone === "muted"
        ? styles.valueMuted
        : tone === "danger"
          ? styles.valueDanger
          : styles.value;
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={valueStyle}>{value}</Text>
    </View>
  );
}

function SectionHeader({ styles, title }: { styles: Styles; title: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

function toNumber(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Ordered token categories, mirroring the TUI breakdown bar. */
export function buildSegments(snapshot: MagicSidebarSnapshot): TokenSegment[] {
  const candidates: TokenSegment[] = [
    { key: "sys", label: "System", tokens: toNumber(snapshot.systemPromptTokens), color: SEGMENT_COLORS.system },
    { key: "docs", label: "Docs", tokens: toNumber(snapshot.docsTokens), color: SEGMENT_COLORS.docs },
    {
      key: "compartments",
      label: "Compartments",
      tokens: toNumber(snapshot.compartmentTokens),
      color: SEGMENT_COLORS.compartments,
    },
    { key: "facts", label: "Facts", tokens: toNumber(snapshot.factTokens), color: SEGMENT_COLORS.facts },
    { key: "memories", label: "Memories", tokens: toNumber(snapshot.memoryTokens), color: SEGMENT_COLORS.memories },
    { key: "profile", label: "Profile", tokens: toNumber(snapshot.profileTokens), color: SEGMENT_COLORS.profile },
    {
      key: "conversation",
      label: "Conversation*",
      tokens: toNumber(snapshot.conversationTokens),
      color: SEGMENT_COLORS.conversation,
    },
    {
      key: "toolCalls",
      label: "Tool Calls",
      tokens: toNumber(snapshot.toolCallTokens),
      color: SEGMENT_COLORS.toolCalls,
    },
    {
      key: "toolDefs",
      label: "Tool Defs",
      tokens: toNumber(snapshot.toolDefinitionTokens),
      color: SEGMENT_COLORS.toolDefs,
    },
  ];
  return candidates.filter((segment) => segment.tokens > 0);
}

function TokenBreakdown({ styles, snapshot }: { styles: Styles; snapshot: MagicSidebarSnapshot }) {
  const segments = buildSegments(snapshot);
  if (segments.length === 0) return null;
  const total = toNumber(snapshot.inputTokens);
  return (
    <View>
      <View style={styles.bar}>
        {segments.map((segment) => (
          <View
            key={segment.key}
            style={[styles.barSegment, { flexGrow: Math.max(1, segment.tokens), flexBasis: 0, backgroundColor: segment.color }]}
          />
        ))}
      </View>
      <View style={{ marginTop: 4 }}>
        {segments.map((segment) => (
          <View key={segment.key} style={styles.row}>
            <Text style={[styles.legendLabel, { color: segment.color }]}>{segment.label}</Text>
            <Text style={styles.valueMuted}>
              {compactTokens(segment.tokens)} ({sharePercent(segment.tokens, total)})
            </Text>
          </View>
        ))}
      </View>
      <Text style={styles.footnote}>
        * includes Reasoning; hygiene excludes it. Conversation includes reasoning estimates;
        hygiene excludes reasoning.
      </Text>
    </View>
  );
}

function QuotaWindowRow({
  styles,
  title,
  window,
}: {
  styles: Styles;
  title: string;
  window: QuotaWindow | null | undefined;
}) {
  if (!window) return null;
  const used = Math.max(0, Math.min(100, toNumber(window.utilization)));
  const resets = relativeFromIso(window.resetsAt);
  const fillWidth = `${used}%` as DimensionValue;
  return (
    <View style={{ marginTop: 4 }}>
      <View style={styles.row}>
        <Text style={styles.label}>{title}</Text>
        <Text style={styles.value}>
          {formatPercent(window.utilization, 0)} used{resets ? ` · resets ${resets}` : ""}
        </Text>
      </View>
      <View style={styles.miniTrack}>
        <View style={[styles.miniFill, { width: fillWidth }]} />
      </View>
    </View>
  );
}

function formatSpend(spend: NonNullable<QuotaProviderSuccess["spend"]>): string {
  if (spend.amount === null || spend.amount === undefined) return "—";
  if (spend.unit === "percent") return formatPercent(spend.amount, 0);
  if (spend.unit === "usd") return `$${spend.amount.toFixed(2)}`;
  return String(spend.amount);
}

/** True when a provider result contributes nothing renderable. */
export function isProviderHidden(provider: QuotaProviderResult): boolean {
  // No credentials for a provider → that provider is simply not in play.
  if (!provider.ok) return provider.code === "no_credentials";
  return provider.windows.length === 0 && !provider.spend;
}

function QuotaProviderBlock({
  styles,
  provider,
}: {
  styles: Styles;
  provider: QuotaProviderResult;
}) {
  if (isProviderHidden(provider)) return null;

  if (!provider.ok) {
    return (
      <Text style={styles.muted}>
        {provider.displayName}:{" "}
        {provider.code === "needs_reauth" ? "reauth needed" : "usage unavailable"}
      </Text>
    );
  }

  return (
    <View style={{ marginTop: 4 }}>
      <Text style={styles.providerName}>
        {provider.displayName}
        {provider.plan ? ` · ${provider.plan}` : ""}
      </Text>
      {provider.windows.map((window) => (
        <QuotaWindowRow key={window.id} styles={styles} title={window.label} window={window} />
      ))}
      {provider.spend ? (
        <StatRow
          styles={styles}
          label={provider.spend.label}
          value={formatSpend(provider.spend)}
          tone="muted"
        />
      ) : null}
    </View>
  );
}

function QuotaSection({ styles, state }: { styles: Styles; state: QuotaState }) {
  if (state.phase === "loading") return null;
  const visible = state.result.providers.filter((provider) => !isProviderHidden(provider));
  if (visible.length === 0) return null;

  return (
    <View>
      <SectionHeader styles={styles} title="Quota" />
      {visible.map((provider) => (
        <QuotaProviderBlock key={provider.id} styles={styles} provider={provider} />
      ))}
    </View>
  );
}

function errorHeadline(code: MagicSidebarErrorCode): string {
  switch (code) {
    case "magic_context_inactive":
      return "Magic Context is not running for this workspace.";
    case "not_opencode":
      return "This agent does not use OpenCode.";
    case "agent_unavailable":
      return "This agent is not available right now.";
    default:
      return "Could not read the context snapshot.";
  }
}

function errorHint(code: MagicSidebarErrorCode): string {
  switch (code) {
    case "magic_context_inactive":
      return "Start an OpenCode session with the Magic Context plugin in this workspace, then refresh.";
    case "not_opencode":
      return "Context metrics are only available for OpenCode agents.";
    case "agent_unavailable":
      return "The agent may still be starting up, or it has no session yet.";
    default:
      return "The Magic Context instance did not answer. It may be busy or shutting down.";
  }
}

function SnapshotView({ styles, snapshot }: { styles: Styles; snapshot: MagicSidebarSnapshot }) {
  const compactionOff = snapshot.compactionEnabled === false;
  const inputTokens = toNumber(snapshot.inputTokens);
  const contextLimit = toNumber(snapshot.contextLimit);

  const pendingOps = toNumber(snapshot.pendingOpsCount);
  const notes = toNumber(snapshot.sessionNoteCount);
  const smartNotes = toNumber(snapshot.readySmartNoteCount);
  const showStatus = pendingOps > 0 || notes > 0 || smartNotes > 0;

  const backlog = Object.entries(snapshot.dreamerBacklog ?? {});
  const showDreamer =
    snapshot.lastDreamerRunAt !== null ||
    snapshot.dreamerProgress !== null ||
    backlog.length > 0;

  return (
    <View>
      {snapshot.lastTransformError ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>⚠ {snapshot.lastTransformError}</Text>
        </View>
      ) : null}

      {contextLimit > 0 ? (
        <View style={styles.summaryRow}>
          <Text style={styles.summaryText}>
            {compactionOff
              ? nativeCompactionLabel(inputTokens, contextLimit)
              : `${formatPercent(snapshot.usagePercentage)} / ${formatThresholdPercent(
                  snapshot.executeThreshold,
                )}%${snapshot.executeThresholdClamped ? "*" : ""}`}
          </Text>
          <Text style={styles.summaryText}>
            {compactTokens(inputTokens)} / {compactTokens(contextLimit)}
          </Text>
        </View>
      ) : null}

      <TokenBreakdown styles={styles} snapshot={snapshot} />

      {snapshot.tailHygiene ? (
        <StatRow
          styles={styles}
          label="Hygiene"
          value={formatTailHygiene(snapshot.tailHygiene)}
          tone={snapshot.tailHygiene.evaluable === false ? "accent" : "default"}
        />
      ) : null}

      {!compactionOff ? (
        <View>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Historian</Text>
            <Text style={snapshot.historianRunning ? styles.valueAccent : styles.valueMuted}>
              {snapshot.historianRunning ? "comparting ⟳" : "idle"}
            </Text>
          </View>
          <StatRow
            styles={styles}
            label="Compartments"
            value={String(toNumber(snapshot.compartmentCount))}
          />
          {toNumber(snapshot.archivedCompartmentCount) > 0 ? (
            <StatRow
              styles={styles}
              label="Archived"
              value={String(toNumber(snapshot.archivedCompartmentCount))}
              tone="muted"
            />
          ) : null}
          {snapshot.recompProgress?.phase ? (
            <StatRow
              styles={styles}
              label={snapshot.recompProgress.kind === "upgrade" ? "Upgrade" : "Recomp"}
              value={`${snapshot.recompProgress.phase} ${toNumber(
                snapshot.recompProgress.processedMessages,
              )}/${toNumber(snapshot.recompProgress.totalMessages)}`}
              tone="accent"
            />
          ) : null}
        </View>
      ) : null}

      <SectionHeader styles={styles} title="Memory" />
      <StatRow
        styles={styles}
        label="Memories"
        value={String(toNumber(snapshot.memoryCount))}
        tone="accent"
      />
      {toNumber(snapshot.memoryBlockCount) > 0 ? (
        <StatRow
          styles={styles}
          label="Injected"
          value={String(toNumber(snapshot.memoryBlockCount))}
          tone="muted"
        />
      ) : null}

      {showStatus ? (
        <View>
          <SectionHeader styles={styles} title="Status" />
          {pendingOps > 0 ? (
            <StatRow styles={styles} label="Queue" value={`${pendingOps} pending`} tone="accent" />
          ) : null}
          {notes > 0 ? <StatRow styles={styles} label="Notes" value={String(notes)} /> : null}
          {smartNotes > 0 ? (
            <StatRow
              styles={styles}
              label="Smart notes ready"
              value={String(smartNotes)}
              tone="accent"
            />
          ) : null}
        </View>
      ) : null}

      {showDreamer ? (
        <View>
          <SectionHeader styles={styles} title="Dreamer" />
          {snapshot.dreamerProgress ? (
            <StatRow
              styles={styles}
              label="Current"
              value={`${snapshot.dreamerProgress.task ?? "task"} ${toNumber(
                snapshot.dreamerProgress.processed,
              )}/${toNumber(snapshot.dreamerProgress.total)}`}
              tone="accent"
            />
          ) : null}
          {snapshot.lastDreamerRunAt !== null && snapshot.lastDreamerRunAt !== undefined ? (
            <StatRow
              styles={styles}
              label="Last run"
              value={relativeTime(snapshot.lastDreamerRunAt)}
              tone="muted"
            />
          ) : null}
          {backlog.map(([task, entry]) => (
            <StatRow
              key={task}
              styles={styles}
              label={task}
              value={`${toNumber(entry.pending)}/${toNumber(entry.total)}`}
              tone="muted"
            />
          ))}
        </View>
      ) : null}

      {snapshot.totalInputTokens !== null && snapshot.totalInputTokens !== undefined ? (
        <View>
          <SectionHeader styles={styles} title="Stats" />
          <StatRow
            styles={styles}
            label="Total tokens"
            value={compactTokens(snapshot.totalInputTokens)}
            tone="muted"
          />
        </View>
      ) : null}
    </View>
  );
}

export interface ContextViewProps {
  /** Agent whose context is rendered. Supplied by the panel host or the surface picker. */
  agentId: string;
  theme: PluginTheme;
  layout: PluginHostProps["layout"];
  /** Optional header title override (the surface shows the picked agent's name). */
  title?: string;
  /** When set, the header renders a back control (surface mode). */
  onBack?: () => void;
}

/**
 * The shared context body: snapshot polling, TUI-style sidebar sections and the
 * Claude quota block. Used by both the agent panel and the host-level surface.
 */
export function ContextView({ theme, layout, agentId, title, onBack }: ContextViewProps) {
  const callSnapshot = useRpc(magicSidebarSnapshotContract);
  const callQuota = useRpc(quotaContract);
  const snapshotRef = useRef(callSnapshot);
  const quotaRef = useRef(callQuota);
  snapshotRef.current = callSnapshot;
  quotaRef.current = callQuota;

  const mountedRef = useRef(true);
  const [state, setState] = useState<PanelState>({ phase: "loading" });
  const [quotaState, setQuotaState] = useState<QuotaState>({ phase: "loading" });

  const styles = useMemo(() => createStyles(theme, layout.compact), [theme, layout.compact]);

  const loadSnapshot = useCallback(async () => {
    try {
      const result = await snapshotRef.current({ agentId });
      if (!mountedRef.current) return;
      setState({ phase: "ready", result });
    } catch {
      if (!mountedRef.current) return;
      setState({
        phase: "ready",
        result: {
          ok: false,
          code: "rpc_failed",
          message: "Could not reach the plugin backend.",
        },
      });
    }
  }, [agentId]);

  const loadQuota = useCallback(async () => {
    try {
      const result = await quotaRef.current({});
      if (!mountedRef.current) return;
      setQuotaState({ phase: "ready", result });
    } catch {
      if (!mountedRef.current) return;
      setQuotaState({ phase: "ready", result: { providers: [] } });
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    setState({ phase: "loading" });
    void loadSnapshot();
    const timer = setInterval(() => {
      void loadSnapshot();
    }, SNAPSHOT_POLL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
    };
  }, [loadSnapshot]);

  useEffect(() => {
    void loadQuota();
    const timer = setInterval(() => {
      void loadQuota();
    }, QUOTA_POLL_MS);
    return () => clearInterval(timer);
  }, [loadQuota]);

  const onRefresh = useCallback(() => {
    void loadSnapshot();
    void loadQuota();
  }, [loadQuota, loadSnapshot]);

  const snapshot = state.phase === "ready" && state.result.ok ? state.result.snapshot : null;

  return (
    <View style={styles.screen}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {onBack ? (
              <Pressable
                style={styles.backButton}
                onPress={onBack}
                accessibilityRole="button"
                accessibilityLabel="Back to agent list"
              >
                <Text style={styles.backLabel}>‹</Text>
              </Pressable>
            ) : null}
            <Text style={styles.title} numberOfLines={1}>
              {title ?? "Context"}
            </Text>
          </View>
          <Pressable style={styles.button} onPress={onRefresh} accessibilityRole="button">
            <Text style={styles.buttonLabel}>Refresh</Text>
          </Pressable>
        </View>

        {/* Quota sits at the very top: it is the number users check first and
            it must stay visible even when the snapshot itself is failing. */}
        <QuotaSection styles={styles} state={quotaState} />

        {state.phase === "loading" ? (
          <Text style={styles.body}>Loading context snapshot…</Text>
        ) : state.result.ok ? (
          <SnapshotView styles={styles} snapshot={state.result.snapshot} />
        ) : (
          <View>
            <Text style={styles.danger}>{errorHeadline(state.result.code)}</Text>
            <Text style={styles.muted}>{state.result.message}</Text>
            <Text style={styles.muted}>{errorHint(state.result.code)}</Text>
          </View>
        )}

        {snapshot ? (
          <Text style={styles.footer}>
            {snapshot.sessionId}
            {snapshot.pluginVersion ? ` · v${snapshot.pluginVersion}` : ""}
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}
