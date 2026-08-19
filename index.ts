import type { PluginAgentCommandContext, PluginContext } from "@getpaseo/plugin";
import { fetchQuota, fetchSidebarSnapshot } from "./magic.server";
import { magicSidebarSnapshotContract, quotaContract } from "./magic.shared";
import { MagicContextPanel } from "./panel.client";
import { SidebarSurface } from "./sidebar.client";

/** Panel id kept stable across the "Magic Context" → "Context" rename. */
const PANEL_ID = "magic-context";
const SURFACE_ID = "context";

export default function contribute(plugin: PluginContext) {
  plugin.handle(magicSidebarSnapshotContract, (input, { paseo }) =>
    fetchSidebarSnapshot(input, paseo),
  );

  plugin.handle(quotaContract, () => fetchQuota());

  plugin.addWorkspacePanel({
    id: PANEL_ID,
    title: "Context",
    icon: "Sparkles",
    context: "agent",
    Component: MagicContextPanel,
  });

  plugin.addSurface(SURFACE_ID, SidebarSurface);

  plugin.addSidebarItem({
    id: SURFACE_ID,
    title: "Context",
    icon: "Sparkles",
    surface: SURFACE_ID,
  });

  plugin.addCommandCenterItem({
    id: "open-magic-context",
    title: "Open Context panel",
    icon: "Sparkles",
    keywords: ["context", "magic", "tokens", "usage", "quota"],
    context: "agent",
    onSelect: (context: PluginAgentCommandContext) => {
      context.openPanel(PANEL_ID);
    },
  });

  return () => {};
}
