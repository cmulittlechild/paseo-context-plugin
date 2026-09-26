import type { PluginSurfaceProps, PluginTheme } from "@getpaseo/plugin/client";
import { usePaseo } from "@getpaseo/plugin/client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { AgentCandidate } from "../shared/agents";
import { buildAgentCandidates, describeCandidate } from "../shared/agents";
import { ContextView } from "./context-view.client";

const LIST_POLL_MS = 3000;

type ListState =
  | { phase: "loading" }
  | { phase: "ready"; candidates: AgentCandidate[] }
  | { phase: "failed"; message: string };

function createListStyles(theme: PluginTheme, compact: boolean) {
  const pad = compact ? 12 : 16;
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.surface0 },
    content: { padding: pad, paddingBottom: pad * 2 },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: compact ? 8 : 12,
    },
    title: { color: theme.colors.foreground, fontSize: compact ? 14 : 16, fontWeight: "700" },
    button: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 6,
      backgroundColor: theme.colors.accent,
    },
    buttonLabel: { color: theme.colors.accentForeground, fontSize: 12, fontWeight: "600" },
    row: {
      paddingVertical: compact ? 6 : 8,
      paddingHorizontal: compact ? 8 : 10,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: theme.colors.foregroundMuted,
      marginBottom: 6,
    },
    rowTitle: { color: theme.colors.foreground, fontSize: 13, fontWeight: "600" },
    rowSubtitle: { color: theme.colors.foregroundMuted, fontSize: 11, marginTop: 2 },
    empty: { color: theme.colors.foregroundMuted, fontSize: 13 },
    danger: { color: theme.colors.statusDanger, fontSize: 13, fontWeight: "600" },
    hint: { color: theme.colors.foregroundMuted, fontSize: 11, marginTop: 6 },
  });
}

/**
 * Host-level "Context" surface. `PluginSurfaceProps` carries no agentId, so the
 * surface lists agents through the client SDK (`usePaseo().agents.list()`) and
 * renders the shared ContextView for whichever agent the user picks.
 */
export function SidebarSurface({ theme, layout }: PluginSurfaceProps) {
  const paseo = usePaseo();
  const paseoRef = useRef(paseo);
  paseoRef.current = paseo;

  const mountedRef = useRef(true);
  const [state, setState] = useState<ListState>({ phase: "loading" });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const styles = useMemo(() => createListStyles(theme, layout.compact), [theme, layout.compact]);

  const loadAgents = useCallback(async () => {
    try {
      const result = await paseoRef.current.agents.list();
      if (!mountedRef.current) return;
      setState({ phase: "ready", candidates: buildAgentCandidates(result.entries) });
    } catch {
      if (!mountedRef.current) return;
      setState({ phase: "failed", message: "Could not list agents." });
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void loadAgents();
    const timer = setInterval(() => {
      void loadAgents();
    }, LIST_POLL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
    };
  }, [loadAgents]);

  const candidates = state.phase === "ready" ? state.candidates : [];

  // Auto-select the only candidate so a single-agent machine skips the picker.
  useEffect(() => {
    if (selectedId === null && candidates.length === 1) {
      setSelectedId(candidates[0]!.id);
    }
  }, [candidates, selectedId]);

  const onBack = useCallback(() => setSelectedId(null), []);

  const selected = candidates.find((candidate) => candidate.id === selectedId) ?? null;

  if (selectedId !== null) {
    return (
      <ContextView
        theme={theme}
        layout={layout}
        agentId={selectedId}
        title={selected?.title ?? "Context"}
        onBack={candidates.length > 1 ? onBack : undefined}
      />
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Context</Text>
          <Pressable
            style={styles.button}
            onPress={() => {
              void loadAgents();
            }}
            accessibilityRole="button"
          >
            <Text style={styles.buttonLabel}>Refresh</Text>
          </Pressable>
        </View>

        {state.phase === "loading" ? (
          <Text style={styles.empty}>Loading agents…</Text>
        ) : state.phase === "failed" ? (
          <Text style={styles.danger}>{state.message}</Text>
        ) : candidates.length === 0 ? (
          <Text style={styles.empty}>No agents</Text>
        ) : (
          <View>
            {candidates.map((candidate) => (
              <Pressable
                key={candidate.id}
                style={styles.row}
                accessibilityRole="button"
                onPress={() => setSelectedId(candidate.id)}
              >
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {candidate.title}
                </Text>
                <Text style={styles.rowSubtitle} numberOfLines={1}>
                  {describeCandidate(candidate) || candidate.id}
                </Text>
              </Pressable>
            ))}
            <Text style={styles.hint}>Pick an agent to inspect its context.</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
