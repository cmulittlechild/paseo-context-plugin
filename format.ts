/**
 * Pure display formatters. Mirrors the OpenCode TUI sidebar helpers
 * (`src/tui/slots/sidebar-content.tsx`, `src/shared/format-threshold.ts`,
 * `src/shared/tail-hygiene-status.ts`) so the panel reads the same way.
 *
 * This module intentionally has no imports so it stays trivially unit-testable.
 */

/** `1234` → `1K`, `1_500_000` → `1.5M`. Matches the TUI's compactTokens. */
export function compactTokens(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return String(Math.round(value));
}

/** Past timestamp (ms) → "just now" / "5m ago" / "2h ago" / "3d ago". */
export function relativeTime(ms: number | null | undefined, now: number = Date.now()): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "never";
  const diff = now - ms;
  if (diff < 0) return "just now";
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

/** Future ISO timestamp → "in 42m" / "in 3h" / "in 2d"; past or unusable → null. */
export function relativeFromIso(iso: string | null | undefined, now: number = Date.now()): string | null {
  if (typeof iso !== "string" || iso.length === 0) return null;
  const target = Date.parse(iso);
  if (!Number.isFinite(target)) return null;
  const diff = target - now;
  if (diff <= 0) return "now";
  if (diff < 60_000) return "in <1m";
  if (diff < 3_600_000) return `in ${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `in ${Math.floor(diff / 3_600_000)}h`;
  return `in ${Math.floor(diff / 86_400_000)}d`;
}

/** Threshold percent display: integers stay bare, otherwise one decimal. */
export function formatThresholdPercent(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const rounded = Math.round(value);
  if (Math.abs(value - rounded) < 0.05) return String(rounded);
  return value.toFixed(1);
}

/** `12.3%` style percentage, or an em dash when unknown. */
export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

/** Share of `total`, rounded to whole percent, as used by the legend rows. */
export function sharePercent(tokens: number, total: number | null | undefined): string {
  const denominator = typeof total === "number" && total > 0 ? total : 1;
  return `${((tokens / denominator) * 100).toFixed(0)}%`;
}

export interface TailHygieneLike {
  u?: number | null;
  t?: number | null;
  severity?: number | null;
  evaluable?: boolean | null;
}

/** "12.5% · 1,200 / 9,600 tok" (+ held marker when not yet evaluable). */
export function formatTailHygiene(status: TailHygieneLike): string {
  const percentage = ((status.severity ?? 0) * 100).toFixed(1);
  const state = status.evaluable === false ? " · held until baseline refresh" : "";
  return `${percentage}% · ${(status.u ?? 0).toLocaleString("en-US")} / ${(status.t ?? 0).toLocaleString("en-US")} tok${state}`;
}

/** Native-compaction header label used when Magic Context compaction is off. */
export function nativeCompactionLabel(
  inputTokens: number | null | undefined,
  contextLimit: number | null | undefined,
): string {
  if (typeof contextLimit !== "number" || contextLimit <= 0 || typeof inputTokens !== "number") {
    return "Context: unknown · native compaction";
  }
  return `Context: ${((inputTokens / contextLimit) * 100).toFixed(1)}% · native compaction`;
}
