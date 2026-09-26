import type { PluginClientContext } from "@getpaseo/plugin/client";
import { MagicContextPanel } from "./panel.client";
import { SidebarSurface } from "./sidebar.client";

const PANEL_ID = "magic-context";
const SURFACE_ID = "context";

export default function contribute(client: PluginClientContext) {
  client.addSidebarItem({
    id: SURFACE_ID,
    title: "Context",
    icon: "Sparkles",
    surface: SURFACE_ID,
  });
  client.addSurface(SURFACE_ID, SidebarSurface);
  client.addWorkspacePanel({
    id: PANEL_ID,
    title: "Context",
    icon: "Sparkles",
    context: "agent",
    Component: MagicContextPanel,
  });
  client.addCommandCenterItem({
    id: "open-magic-context",
    title: "Open Context panel",
    icon: "Sparkles",
    keywords: ["context", "magic", "tokens", "usage", "quota"],
    context: "agent",
    onSelect: (context) => { context.openPanel(PANEL_ID); },
  });
  return () => {};
}
