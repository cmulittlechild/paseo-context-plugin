# paseo-context-plugin

A [Paseo](https://getpaseo.com) plugin that shows a live **Context** panel for your OpenCode
agents. It mirrors the OpenCode Magic Context TUI sidebar inside Paseo: how much of the model
window a session is using, what is actually filling it, what the background workers are doing,
and how much of your Claude / ChatGPT subscription quota is left.

## Features

- **Usage vs. compaction threshold** — `usage% / threshold%` against the usable scheduler
  window, plus absolute `input / limit` tokens. Sessions running on native compaction instead of
  Magic Context show a `Context: x% · native compaction` header instead.
- **Token breakdown bar** — a segmented, proportional bar over System, Docs, Compartments,
  Facts, Memories, Profile, Conversation, Tool Calls and Tool Definitions, with a legend showing
  each category's token count and share, and the tail-hygiene reclaimable ratio.
- **Historian** — compaction state (`idle` / `comparting`), compartment and archived-compartment
  counts, and live recomp / session-upgrade progress.
- **Memory** — total memories and how many are currently injected into the prompt.
- **Status** — queued operations, session notes, and smart notes that are ready to surface.
- **Dreamer** — the currently running background task, when it last ran, and the per-task backlog.
- **Subscription quota** — Claude (Anthropic OAuth) and OpenAI (ChatGPT/Codex) usage windows as
  mini bars with `X% used · resets in …`, plus plan and credit balance when the provider reports
  them. A provider you are not logged into is hidden entirely.

Three ways in:

1. **Agent tab panel** — a "Context" panel on any agent, scoped to that agent automatically.
2. **Sidebar surface** — a host-level "Context" item that lists your OpenCode agents (title,
   workspace, model, status, most recently active first) and opens the same view for whichever
   one you pick. A single candidate is auto-selected.
3. **Command Center** — `⌘K` → **Open Context panel**.

## Requirements

Everything must run on the **same machine** as the Paseo daemon, since the plugin talks to
OpenCode's local RPC server and reads local credential files.

- Paseo `>= 0.5.0-beta.2` with plugins enabled.
- Agents using the **OpenCode** provider. Other providers render a friendly "not OpenCode" state.
- [`@cortexkit/opencode-magic-context`](https://www.npmjs.com/package/@cortexkit/opencode-magic-context)
  installed in OpenCode — it is the source of all context data. Without a running instance the
  panel shows "Magic Context is not running for this workspace".
- Optional: OpenCode's Anthropic and/or OpenAI OAuth logins, for the quota section. Each provider's
  block is hidden when there are no credentials for it.
- Node.js 20+ and npm, to install dependencies and run the checks.

## Install

```bash
git clone https://github.com/BrianAguilarWasco/paseo-context-plugin.git
cd paseo-context-plugin
npm install
npm run typecheck

# Install into your local Paseo daemon (absolute path required)
paseo plugin install "$(pwd)"
```

Then enable plugins in Paseo's settings if they are not already on, and open the panel with
`⌘K` → **Open Context panel** (or click **Context** in the sidebar).

## How it works

1. The panel asks the plugin backend for a snapshot of a given `agentId`.
2. The backend refreshes the agent through the Paseo API to resolve its **OpenCode session id**
   (persisted session id → provider-native handle → live runtime info) and its working directory.
3. It discovers the local Magic Context RPC server for that directory: instance descriptors live
   under `~/.local/share/cortexkit/magic-context/rpc/<sha256(directory)[:16]>/` and carry a port,
   pid and per-process token. The newest descriptor whose process is still alive wins.
4. It calls that instance's `POST /rpc/sidebar-snapshot` over loopback and normalizes the reply
   into a stable, fully optional schema, so a Magic Context upgrade cannot break the panel.
5. Quota is read separately: the backend reads OpenCode's `auth.json` OAuth records fresh on each
   call and queries the official Anthropic and OpenAI usage endpoints concurrently, caching
   successful responses for 60 seconds per provider.

The snapshot polls every 3 seconds; quota polls every 60 seconds.

## Security

- OAuth access tokens are read on the daemon, used only as `Authorization` headers against the
  official Anthropic and OpenAI usage endpoints, and never logged, cached to disk, or sent to the
  client.
- The plugin **never refreshes or rewrites** OpenCode's credentials — rotating a refresh token
  could invalidate your running OpenCode session. An expired token is reported as
  `reauth needed` and you re-authenticate in OpenCode.
- Magic Context RPC tokens and ports stay on the daemon; error messages are code-tagged and
  deliberately contain no tokens, ports, or filesystem paths.
- The client only ever receives normalized numbers, labels and a session id.

## Development

```bash
npm run typecheck   # tsc --noEmit
npm test            # node --test (pure helpers: parsing, normalization, formatting)
paseo plugin reload # pick up local changes in the running daemon
```

Source layout: `index.ts` registers contributions; `magic.shared.ts` holds the Zod RPC contracts;
`magic.server.ts` is the daemon-side implementation; `context-view.client.tsx` is the shared
panel body, wrapped by `panel.client.tsx` (agent panel) and `sidebar.client.tsx` (surface +
agent picker); `format.ts` and `agents.ts` hold pure helpers.

## License

MIT © 2026 Brian Aguilar
