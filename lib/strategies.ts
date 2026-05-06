/**
 * User-defined strategies storage layer.
 *
 * Primary storage: browser localStorage (instant, offline).
 * Optional sync:    Supabase (cross-device) — best-effort; failures are silent.
 *
 * Design notes:
 *   - Local store is the source of truth during a session.
 *   - On `loadAll`, we read localStorage first, then merge any Supabase rows
 *     (newest `updatedAt` wins per id) so users see strategies from other devices.
 *   - All mutations write through to localStorage synchronously and fire
 *     a fire-and-forget Supabase sync.
 */

import type { BacktestParams } from "./backtest";
import { migrateLegacyParams } from "./backtest";
import type { BacktestStats } from "./backtest";

// ─── Types ────────────────────────────────────────────────────────────────────

export type StrategySource = "builder" | "optimizer" | "preset" | "imported";

export interface SavedStrategy {
  id:          string;
  name:        string;
  description: string;
  params:      BacktestParams;
  source:      StrategySource;
  createdAt:   number;
  updatedAt:   number;
  /** Optional: snapshot of last backtest stats at save time (for quick UI). */
  lastStats?:  Partial<BacktestStats> | null;
  /** Optional: which symbol(s) the strategy was tuned on, for context. */
  tunedOn?:    string;
  /** Optional: which interval (e.g. "1h"). */
  interval?:   string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LS_KEY = "binance-ohlcv:strategies:v1";

// ─── ID + time helpers ────────────────────────────────────────────────────────

function uid(): string {
  // Crypto.randomUUID() is widely supported in modern browsers; fall back if not.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

const now = () => Date.now();

// ─── localStorage layer ───────────────────────────────────────────────────────

function readLocal(): SavedStrategy[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Migrate any legacy-shaped params on the fly.
    return parsed
      .filter((s) => s && typeof s.id === "string" && s.params)
      .map((s) => ({ ...s, params: migrateLegacyParams(s.params) })) as SavedStrategy[];
  } catch {
    return [];
  }
}

function writeLocal(list: SavedStrategy[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(list));
  } catch {
    /* quota or privacy mode — ignore */
  }
}

// ─── Supabase remote layer (best-effort) ──────────────────────────────────────

interface RemoteEnvelope {
  ok:         boolean;
  enabled:    boolean;
  strategies: SavedStrategy[];
}

/** Fire-and-forget sync to remote. Returns true if the request succeeded. */
async function pushRemote(s: SavedStrategy): Promise<boolean> {
  try {
    const r = await fetch("/api/supabase/strategies", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(s),
    });
    return r.ok;
  } catch {
    return false;
  }
}

async function deleteRemote(id: string): Promise<boolean> {
  try {
    const r = await fetch(`/api/supabase/strategies?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    return r.ok;
  } catch {
    return false;
  }
}

async function fetchRemote(): Promise<RemoteEnvelope> {
  try {
    const r = await fetch("/api/supabase/strategies");
    if (!r.ok) return { ok: false, enabled: r.status !== 503, strategies: [] };
    const data = (await r.json()) as { strategies?: SavedStrategy[] };
    return { ok: true, enabled: true, strategies: data.strategies ?? [] };
  } catch {
    return { ok: false, enabled: false, strategies: [] };
  }
}

// ─── Public CRUD ──────────────────────────────────────────────────────────────

/**
 * Load all saved strategies.
 * - Reads from localStorage immediately.
 * - In the background, fetches from Supabase and merges (newer updatedAt wins).
 *   The optional `onRemoteUpdate` callback fires when remote data is merged in,
 *   so the UI can refresh.
 */
export function loadAll(
  onRemoteUpdate?: (merged: SavedStrategy[]) => void,
): SavedStrategy[] {
  const local = readLocal();

  // Background remote merge
  if (onRemoteUpdate) {
    void fetchRemote().then((env) => {
      if (!env.ok || env.strategies.length === 0) return;
      const merged = mergeById(local, env.strategies);
      // Only update if something actually changed
      if (JSON.stringify(merged) !== JSON.stringify(local)) {
        writeLocal(merged);
        onRemoteUpdate(sortByUpdated(merged));
      }
    });
  }

  return sortByUpdated(local);
}

/** Synchronous read — for use after `loadAll` has already been called once. */
export function getAll(): SavedStrategy[] {
  return sortByUpdated(readLocal());
}

export function getById(id: string): SavedStrategy | undefined {
  return readLocal().find((s) => s.id === id);
}

/** Create a new strategy. Returns the saved record. */
export function saveNew(input: {
  name:        string;
  description?: string;
  params:      BacktestParams;
  source:      StrategySource;
  lastStats?:  Partial<BacktestStats> | null;
  tunedOn?:    string;
  interval?:   string;
}): SavedStrategy {
  const t = now();
  const s: SavedStrategy = {
    id:          uid(),
    name:        input.name.trim() || "Untitled Strategy",
    description: (input.description ?? "").trim(),
    params:      cloneParams(input.params),
    source:      input.source,
    createdAt:   t,
    updatedAt:   t,
    lastStats:   input.lastStats ?? null,
    tunedOn:     input.tunedOn,
    interval:    input.interval,
  };

  const list = readLocal();
  list.unshift(s);
  writeLocal(list);
  void pushRemote(s);
  return s;
}

/** Update an existing strategy. Bumps updatedAt. */
export function update(id: string, patch: Partial<Omit<SavedStrategy, "id" | "createdAt">>): SavedStrategy | null {
  const list = readLocal();
  const idx  = list.findIndex((s) => s.id === id);
  if (idx === -1) return null;

  const prev = list[idx];
  const next: SavedStrategy = {
    ...prev,
    ...patch,
    params:    patch.params ? cloneParams(patch.params) : prev.params,
    id:        prev.id,
    createdAt: prev.createdAt,
    updatedAt: now(),
  };
  list[idx] = next;
  writeLocal(list);
  void pushRemote(next);
  return next;
}

export function remove(id: string): boolean {
  const list = readLocal();
  const next = list.filter((s) => s.id !== id);
  if (next.length === list.length) return false;
  writeLocal(next);
  void deleteRemote(id);
  return true;
}

/** Replace the entire local store (e.g. after an import). */
export function replaceAll(strategies: SavedStrategy[]): void {
  writeLocal(strategies);
  // Push everything to remote, best-effort
  for (const s of strategies) void pushRemote(s);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sortByUpdated(list: SavedStrategy[]): SavedStrategy[] {
  return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
}

function cloneParams(p: BacktestParams): BacktestParams {
  return {
    bullConditions: p.bullConditions.map((c) => ({ feature: c.feature, buckets: [...c.buckets] })),
    bearConditions: p.bearConditions.map((c) => ({ feature: c.feature, buckets: [...c.buckets] })),
    exitMode:       p.exitMode,
    exitConditions: p.exitConditions.map((c) => ({ feature: c.feature, buckets: [...c.buckets] })),
    side:           p.side,
    flipOnSignal:   p.flipOnSignal,
    cooldown:       p.cooldown,
  };
}

function mergeById(a: SavedStrategy[], b: SavedStrategy[]): SavedStrategy[] {
  const map = new Map<string, SavedStrategy>();
  for (const s of a) map.set(s.id, s);
  for (const s of b) {
    const existing = map.get(s.id);
    if (!existing || s.updatedAt > existing.updatedAt) map.set(s.id, s);
  }
  return [...map.values()];
}
