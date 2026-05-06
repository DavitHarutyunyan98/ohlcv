"use client";

/**
 * Strategies tab — manage user-saved strategies.
 *
 * Lists every strategy stored locally (and synced from Supabase if available).
 * From here the user can:
 *   • Run a quick backtest preview on the currently loaded bars
 *   • Edit name / description
 *   • Delete a strategy (with confirm)
 *   • Send a strategy back to the Strategy Builder for further tuning
 *   • Export the strategy params as JSON
 */

import { useEffect, useState, useCallback } from "react";
import * as Strategies from "@/lib/strategies";
import type { SavedStrategy } from "@/lib/strategies";
import type { EnrichedBar } from "@/lib/types";
import type { BacktestParams, BacktestResult } from "@/lib/backtest";
import { runBacktest } from "@/lib/backtest";
import { downloadXlsx } from "@/lib/downloadXlsx";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SOURCE_BADGE: Record<SavedStrategy["source"], { label: string; cls: string }> = {
  builder:   { label: "Builder",   cls: "bg-purple-900/40 text-purple-300" },
  optimizer: { label: "Optimizer", cls: "bg-orange-900/40 text-orange-300" },
  preset:    { label: "Preset",    cls: "bg-blue-900/40 text-blue-300" },
  imported:  { label: "Imported",  cls: "bg-binance-border text-binance-text" },
};

function fmt(n: number | undefined | null, d = 2) {
  if (n === undefined || n === null) return "—";
  if (!isFinite(n)) return "∞";
  return n.toFixed(d);
}

function fmtDate(ts: number) {
  return new Date(ts).toLocaleString(undefined, {
    month: "short", day: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ─── Edit modal ───────────────────────────────────────────────────────────────

function EditModal({ strategy, onClose, onSaved }: {
  strategy: SavedStrategy;
  onClose:  () => void;
  onSaved:  (s: SavedStrategy) => void;
}) {
  const [name, setName] = useState(strategy.name);
  const [desc, setDesc] = useState(strategy.description);

  const handleSave = () => {
    const next = Strategies.update(strategy.id, { name: name.trim(), description: desc.trim() });
    if (next) onSaved(next);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-binance-card border border-binance-border rounded-xl p-5 w-[440px] max-w-[95vw]" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-bold text-white mb-3">✏️ Edit Strategy</h3>

        <label className="text-[11px] text-binance-muted uppercase tracking-wider">Name</label>
        <input
          value={name} onChange={(e) => setName(e.target.value)} autoFocus
          className="w-full mt-1 mb-3 bg-binance-dark border border-binance-border rounded px-2 py-1.5 text-sm text-white outline-none focus:border-binance-yellow"
        />

        <label className="text-[11px] text-binance-muted uppercase tracking-wider">Description</label>
        <textarea
          value={desc} onChange={(e) => setDesc(e.target.value)} rows={4}
          className="w-full mt-1 mb-4 bg-binance-dark border border-binance-border rounded px-2 py-1.5 text-sm text-white outline-none focus:border-binance-yellow resize-y"
        />

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-1.5 text-xs rounded bg-binance-border text-binance-text hover:bg-[#414d5c] transition">Cancel</button>
          <button onClick={handleSave} disabled={!name.trim()}
            className="px-4 py-1.5 text-xs font-bold rounded bg-binance-yellow text-binance-dark hover:brightness-110 disabled:opacity-40 transition">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Strategy details panel ───────────────────────────────────────────────────

function StrategyDetails({ s, bars, onEdit, onSend, onDelete, onClose }: {
  s:        SavedStrategy;
  bars:     EnrichedBar[];
  onEdit:   () => void;
  onSend:   (params: BacktestParams) => void;
  onDelete: () => void;
  onClose:  () => void;
}) {
  const [running, setRunning] = useState(false);
  const [preview, setPreview] = useState<BacktestResult | null>(null);

  const handleQuickTest = () => {
    if (bars.length === 0) return;
    setRunning(true);
    setPreview(null);
    setTimeout(() => {
      try {
        setPreview(runBacktest(bars, s.params));
      } finally {
        setRunning(false);
      }
    }, 16);
  };

  const handleExportJson = () => {
    try {
      const json  = JSON.stringify(s, null, 2);
      const blob  = new Blob([json], { type: "application/json" });
      const url   = URL.createObjectURL(blob);
      const a     = document.createElement("a");
      a.href      = url;
      a.download  = `${s.name.replace(/[^a-zA-Z0-9]+/g, "_")}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      /* noop */
    }
  };

  const handleExportTrades = () => {
    if (!preview) return;
    const rows = preview.trades.map((t, i) => ({
      "#":            i + 1,
      Symbol:         t.symbol,
      Side:           t.side,
      "Entry Time":   new Date(t.entryTime).toLocaleString(),
      "Entry Price":  t.entryPrice.toFixed(6),
      "Exit Time":    new Date(t.exitTime).toLocaleString(),
      "Exit Price":   t.exitPrice.toFixed(6),
      "P&L %":        t.pnlPct.toFixed(4),
      "Exit Reason":  t.exitReason,
      "Hold (bars)":  t.durationBars,
    }));
    downloadXlsx(rows, `strategy_${s.name.replace(/[^a-zA-Z0-9]+/g, "_")}_trades`);
  };

  const stats = preview?.stats ?? null;
  const hint  = s.lastStats;

  return (
    <div className="bg-binance-dark border border-binance-border rounded-xl p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-white">{s.name}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${SOURCE_BADGE[s.source].cls}`}>
              {SOURCE_BADGE[s.source].label}
            </span>
            {s.tunedOn && <span className="text-[10px] text-binance-muted">tuned on {s.tunedOn}{s.interval ? ` · ${s.interval}` : ""}</span>}
          </div>
          {s.description && (
            <p className="text-xs text-binance-muted mt-1 leading-snug">{s.description}</p>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-binance-muted hover:text-binance-red transition text-sm"
          title="Close details"
        >✕</button>
      </div>

      {/* Conditions */}
      <div>
        <div className="text-[10px] text-binance-muted uppercase tracking-wider mb-1">Entry Conditions</div>
        <div className="flex flex-wrap gap-1.5">
          {s.params.conditions.map((c, ci) => (
            <span key={ci} className="px-2 py-0.5 bg-binance-border text-white text-[10px] rounded font-mono">
              {c.feature} [{c.buckets.map((b) => `Q${b}`).join("/")}]
            </span>
          ))}
        </div>
      </div>

      {/* Params row */}
      <div className="flex flex-wrap gap-3 text-[11px] text-binance-muted">
        <span>TP: <span className="text-white font-mono">{s.params.tpAtr}×ATR</span></span>
        <span>SL: <span className="text-white font-mono">{s.params.slAtr}×ATR</span></span>
        <span>Hold: <span className="text-white font-mono">{s.params.maxHold}b</span></span>
        <span>Cooldown: <span className="text-white font-mono">{s.params.cooldown}b</span></span>
        <span>Side: <span className="text-white font-mono capitalize">{s.params.side}</span></span>
      </div>

      {/* Saved-time stats hint */}
      {hint && Object.keys(hint).length > 0 && !preview && (
        <div className="bg-binance-card border border-binance-border/50 rounded p-2 text-[10px] text-binance-muted">
          Snapshot at save:&nbsp;
          {hint.totalTrades !== undefined && <span>Trades <span className="text-white">{hint.totalTrades}</span> · </span>}
          {hint.winRate !== undefined && <span>WR <span className="text-white">{fmt((hint.winRate ?? 0) * 100, 1)}%</span> · </span>}
          {hint.profitFactor !== undefined && <span>PF <span className="text-white">{fmt(hint.profitFactor)}</span> · </span>}
          {hint.expectancy !== undefined && <span>E <span className="text-white">{fmt(hint.expectancy, 4)}%</span> · </span>}
          {hint.totalReturnPct !== undefined && <span>Total <span className={hint.totalReturnPct >= 0 ? "text-binance-green" : "text-binance-red"}>{fmt(hint.totalReturnPct)}%</span></span>}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={handleQuickTest}
          disabled={bars.length === 0 || running}
          className="px-3 py-1.5 text-xs font-bold rounded bg-purple-700 text-white hover:bg-purple-600 disabled:opacity-40 transition"
        >
          {running ? "Running…" : "▶ Quick Backtest"}
        </button>
        <button
          onClick={() => onSend(s.params)}
          className="px-3 py-1.5 text-xs font-medium rounded bg-binance-border text-binance-text hover:bg-[#414d5c] transition"
        >
          🎯 Open in Builder
        </button>
        <button
          onClick={onEdit}
          className="px-3 py-1.5 text-xs font-medium rounded bg-binance-border text-binance-text hover:bg-[#414d5c] transition"
        >
          ✏️ Edit
        </button>
        <button
          onClick={handleExportJson}
          className="px-3 py-1.5 text-xs font-medium rounded bg-binance-border text-binance-text hover:bg-[#414d5c] transition"
        >
          📤 Export JSON
        </button>
        <button
          onClick={onDelete}
          className="ml-auto px-3 py-1.5 text-xs font-medium rounded bg-binance-red/20 text-binance-red border border-binance-red/40 hover:bg-binance-red/30 transition"
        >
          🗑 Delete
        </button>
      </div>

      {/* Quick backtest preview */}
      {stats && preview && (
        <div className="bg-binance-card border border-binance-border rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-white">📊 Quick-test Result · {bars.length.toLocaleString()} bars</span>
            <button
              onClick={handleExportTrades}
              disabled={preview.trades.length === 0}
              className="text-[10px] px-2 py-0.5 rounded bg-binance-border text-binance-text hover:bg-binance-yellow hover:text-binance-dark disabled:opacity-40 transition"
            >
              📥 Export trades
            </button>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {[
              { label: "Trades", value: String(stats.totalTrades) },
              { label: "Win Rate", value: `${fmt(stats.winRate * 100, 1)}%`, color: stats.winRate >= 0.5 ? "text-binance-green" : "text-binance-red" },
              { label: "PF", value: isFinite(stats.profitFactor) ? fmt(stats.profitFactor) : "∞", color: stats.profitFactor >= 1 ? "text-binance-green" : "text-binance-red" },
              { label: "Expectancy", value: `${stats.expectancy >= 0 ? "+" : ""}${fmt(stats.expectancy, 4)}%`, color: stats.expectancy >= 0 ? "text-binance-green" : "text-binance-red" },
              { label: "Sharpe", value: fmt(stats.sharpe), color: stats.sharpe >= 1 ? "text-binance-green" : "text-white" },
              { label: "Total", value: `${stats.totalReturnPct >= 0 ? "+" : ""}${fmt(stats.totalReturnPct)}%`, color: stats.totalReturnPct >= 0 ? "text-binance-green" : "text-binance-red" },
            ].map(({ label, value, color = "text-white" }) => (
              <div key={label} className="bg-binance-dark border border-binance-border/50 rounded p-2">
                <div className="text-[10px] text-binance-muted uppercase tracking-wide">{label}</div>
                <div className={`text-sm font-bold font-mono mt-0.5 ${color}`}>{value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="text-[10px] text-binance-muted">
        Created {fmtDate(s.createdAt)} · Last updated {fmtDate(s.updatedAt)}
      </div>
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  bars:        EnrichedBar[];
  onOpenInBuilder: (params: BacktestParams) => void;
  /** External tick to force-refresh the list (e.g. after a Save in another tab) */
  refreshKey?: number;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function StrategiesPanel({ bars, onOpenInBuilder, refreshKey }: Props) {
  const [list,     setList]     = useState<SavedStrategy[]>([]);
  const [selected, setSelected] = useState<SavedStrategy | null>(null);
  const [editing,  setEditing]  = useState<SavedStrategy | null>(null);
  const [confirm,  setConfirm]  = useState<SavedStrategy | null>(null);
  const [filter,   setFilter]   = useState<"all" | SavedStrategy["source"]>("all");
  const [search,   setSearch]   = useState("");

  const refresh = useCallback(() => {
    const merged = Strategies.loadAll((remoteList) => setList(remoteList));
    setList(merged);
  }, []);

  useEffect(() => { refresh(); }, [refresh, refreshKey]);

  const filtered = list
    .filter((s) => filter === "all" || s.source === filter)
    .filter((s) => {
      if (!search.trim()) return true;
      const q = search.trim().toLowerCase();
      return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q);
    });

  const handleDelete = (s: SavedStrategy) => {
    Strategies.remove(s.id);
    setConfirm(null);
    if (selected?.id === s.id) setSelected(null);
    refresh();
  };

  const handleImport = async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text) as Partial<SavedStrategy>;
      if (!data.params || !data.name) throw new Error("Invalid strategy file");
      Strategies.saveNew({
        name:        `${data.name} (imported)`,
        description: data.description ?? "",
        params:      data.params,
        source:      "imported",
        tunedOn:     data.tunedOn,
        interval:    data.interval,
      });
      refresh();
    } catch {
      alert("Could not import — file is not a valid strategy JSON.");
    }
  };

  return (
    <div className="p-4 space-y-3">

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          {(["all", "builder", "optimizer", "imported"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2.5 py-1 text-xs rounded font-medium transition capitalize ${
                filter === f
                  ? "bg-binance-yellow text-binance-dark"
                  : "bg-binance-border text-binance-text hover:bg-[#414d5c]"
              }`}
            >
              {f === "all" ? "All" : f}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5 bg-binance-dark border border-binance-border rounded px-2.5 py-1">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or description…"
            className="bg-transparent text-xs text-white outline-none w-48 placeholder:text-binance-muted"
          />
          {search && (
            <button onClick={() => setSearch("")} className="text-binance-muted hover:text-binance-red text-sm">✕</button>
          )}
        </div>

        <span className="text-[11px] text-binance-muted ml-2">
          {filtered.length} of {list.length} strategy{list.length === 1 ? "" : "ies"}
        </span>

        <label className="ml-auto px-3 py-1.5 text-xs rounded bg-binance-border text-binance-text hover:bg-[#414d5c] transition cursor-pointer">
          📥 Import JSON
          <input
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImport(f);
              e.target.value = "";
            }}
          />
        </label>

        <button
          onClick={refresh}
          className="px-3 py-1.5 text-xs rounded bg-binance-border text-binance-text hover:bg-[#414d5c] transition"
          title="Refresh from Supabase"
        >
          ↻ Refresh
        </button>
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="text-center py-12 text-binance-muted text-sm">
          {list.length === 0
            ? <>No saved strategies yet. Build one in <strong className="text-white">🎯 Strategy Builder</strong> or
                run <strong className="text-white">⚡ Optimize</strong> and click <strong className="text-binance-yellow">💾 Save</strong>.</>
            : <>No strategies match the current filter.</>
          }
        </div>
      )}

      {/* List */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {filtered.map((s) => {
            const isActive = selected?.id === s.id;
            return (
              <div
                key={s.id}
                onClick={() => setSelected(isActive ? null : s)}
                className={`cursor-pointer p-3 rounded-lg border transition ${
                  isActive
                    ? "border-binance-yellow bg-[#1a1f10] shadow-[0_0_12px_rgba(240,185,11,0.12)]"
                    : "border-binance-border bg-binance-dark hover:border-binance-text/40"
                }`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-white truncate flex-1 min-w-0">{s.name}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${SOURCE_BADGE[s.source].cls}`}>
                    {SOURCE_BADGE[s.source].label}
                  </span>
                </div>
                {s.description && (
                  <p className="text-[11px] text-binance-muted line-clamp-2 mt-1">{s.description}</p>
                )}
                <div className="mt-2 flex flex-wrap gap-1">
                  {s.params.conditions.slice(0, 3).map((c, ci) => (
                    <span key={ci} className="px-1.5 py-0.5 bg-binance-border text-white text-[9px] rounded font-mono">
                      {c.feature} {c.buckets.map((b) => `Q${b}`).join("/")}
                    </span>
                  ))}
                  {s.params.conditions.length > 3 && (
                    <span className="text-[9px] text-binance-muted self-center">+{s.params.conditions.length - 3}</span>
                  )}
                </div>
                <div className="mt-2 flex items-center justify-between text-[10px] text-binance-muted">
                  <span>{fmtDate(s.updatedAt)}</span>
                  {s.lastStats?.profitFactor !== undefined && (
                    <span className={s.lastStats.profitFactor && s.lastStats.profitFactor >= 1 ? "text-binance-green" : "text-binance-red"}>
                      PF {fmt(s.lastStats.profitFactor)}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Details */}
      {selected && (
        <StrategyDetails
          s={selected}
          bars={bars}
          onEdit={() => setEditing(selected)}
          onSend={(params) => onOpenInBuilder(params)}
          onDelete={() => setConfirm(selected)}
          onClose={() => setSelected(null)}
        />
      )}

      {/* Edit */}
      {editing && (
        <EditModal
          strategy={editing}
          onClose={() => setEditing(null)}
          onSaved={(s) => { setEditing(null); setSelected(s); refresh(); }}
        />
      )}

      {/* Delete confirm */}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setConfirm(null)}>
          <div className="bg-binance-card border border-binance-border rounded-xl p-5 w-[400px] max-w-[95vw]" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-white mb-2">Delete strategy?</h3>
            <p className="text-xs text-binance-muted mb-4">
              <span className="text-white">{confirm.name}</span> will be removed locally and from Supabase. This can&apos;t be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirm(null)} className="px-3 py-1.5 text-xs rounded bg-binance-border text-binance-text hover:bg-[#414d5c] transition">Cancel</button>
              <button
                onClick={() => handleDelete(confirm)}
                className="px-4 py-1.5 text-xs font-bold rounded bg-binance-red text-white hover:brightness-110 transition"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
