import type { PluginServerContext } from "@getpaseo/plugin/server";
import { fetchQuota, fetchSidebarSnapshot } from "./magic.server";
import { magicSidebarSnapshotContract, quotaContract } from "./magic.shared";

export default function contribute(server: PluginServerContext) {
  server.handle(magicSidebarSnapshotContract, (input, { paseo }) => fetchSidebarSnapshot(input, paseo));
  server.handle(quotaContract, () => fetchQuota());
  return () => {};
}
