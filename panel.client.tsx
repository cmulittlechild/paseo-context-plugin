import type { PluginAgentPanelProps } from "@getpaseo/plugin";
import React from "react";
import { ContextView } from "./context-view.client";

/**
 * Agent-scoped workspace panel. The host already knows which agent is focused,
 * so this is a thin wrapper around the shared context view.
 */
export function MagicContextPanel({ theme, layout, agentId }: PluginAgentPanelProps) {
  return <ContextView theme={theme} layout={layout} agentId={agentId} />;
}
