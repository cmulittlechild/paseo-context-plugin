/**
 * Pure agent-list helpers for the host-level "Context" surface.
 *
 * The surface has no agentId of its own (PluginSurfaceProps only carries
 * theme/host/layout), so it lists agents from the client SDK and lets the user
 * pick one. Kept import-free so it stays trivially unit-testable.
 */

/** Structural view of one `paseo.agents.list()` entry. */
export interface AgentListEntryLike {
  readonly agent?: {
    readonly id?: string | null;
    readonly provider?: string | null;
    readonly title?: string | null;
    readonly status?: string | null;
    readonly model?: string | null;
    readonly cwd?: string | null;
    readonly createdAt?: string | null;
    readonly updatedAt?: string | null;
    readonly lastUserMessageAt?: string | null;
    readonly archivedAt?: string | null;
  } | null;
  readonly project?: {
    readonly projectName?: string | null;
    readonly workspaceName?: string | null;
  } | null;
}

export interface AgentCandidate {
  id: string;
  title: string;
  provider: string | null;
  status: string | null;
  model: string | null;
  workspaceLabel: string | null;
  /** Epoch ms of the most recent known activity; 0 when unknown. */
  lastActivityAt: number;
}

function parseTime(value: string | null | undefined): number {
  if (typeof value !== "string" || value.length === 0) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nonEmpty(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** Maps one list entry to a candidate; returns null for archived / id-less rows. */
export function toAgentCandidate(entry: AgentListEntryLike | null | undefined): AgentCandidate | null {
  const agent = entry?.agent;
  const id = nonEmpty(agent?.id);
  if (!id) return null;
  if (nonEmpty(agent?.archivedAt)) return null;

  const workspaceLabel =
    nonEmpty(entry?.project?.workspaceName) ?? nonEmpty(entry?.project?.projectName);

  return {
    id,
    title: nonEmpty(agent?.title) ?? id,
    provider: nonEmpty(agent?.provider),
    status: nonEmpty(agent?.status),
    model: nonEmpty(agent?.model),
    workspaceLabel,
    lastActivityAt: Math.max(
      parseTime(agent?.updatedAt),
      parseTime(agent?.lastUserMessageAt),
      parseTime(agent?.createdAt),
    ),
  };
}

/**
 * Candidates for the picker: OpenCode agents first, most recently active first.
 * When no entry advertises an OpenCode provider (or provider info is missing
 * entirely) every agent is returned and the panel's `not_opencode` state does
 * the explaining.
 */
export function buildAgentCandidates(
  entries: readonly (AgentListEntryLike | null | undefined)[] | null | undefined,
): AgentCandidate[] {
  const candidates: AgentCandidate[] = [];
  for (const entry of entries ?? []) {
    const candidate = toAgentCandidate(entry);
    if (candidate) candidates.push(candidate);
  }

  const opencode = candidates.filter((candidate) =>
    (candidate.provider ?? "").toLowerCase().startsWith("opencode"),
  );
  const selected = opencode.length > 0 ? opencode : candidates;

  return selected.sort((a, b) => {
    if (b.lastActivityAt !== a.lastActivityAt) return b.lastActivityAt - a.lastActivityAt;
    return a.title.localeCompare(b.title);
  });
}

/** One-line subtitle for a candidate row: workspace · model · status. */
export function describeCandidate(candidate: AgentCandidate): string {
  return [candidate.workspaceLabel, candidate.model, candidate.status]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join(" · ");
}
