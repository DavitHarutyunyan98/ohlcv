"use client";

interface Props {
  startDate: string;
  endDate: string;
  onStartChange: (v: string) => void;
  onEndChange: (v: string) => void;
  onClear: () => void;
}

export default function DateRangePicker({
  startDate,
  endDate,
  onStartChange,
  onEndChange,
  onClear,
}: Props) {
  const today = new Date().toISOString().split("T")[0];
  const hasRange = startDate || endDate;

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-binance-muted font-medium uppercase tracking-wider">
        Date Range
      </label>
      <div className="flex items-center gap-2">
        <input
          type="date"
          max={endDate || today}
          value={startDate}
          onChange={(e) => onStartChange(e.target.value)}
          className="bg-binance-dark border border-binance-border rounded px-2 py-1.5 text-sm text-binance-text focus:border-binance-yellow outline-none transition [color-scheme:dark]"
        />
        <span className="text-binance-muted text-sm">→</span>
        <input
          type="date"
          min={startDate}
          max={today}
          value={endDate}
          onChange={(e) => onEndChange(e.target.value)}
          className="bg-binance-dark border border-binance-border rounded px-2 py-1.5 text-sm text-binance-text focus:border-binance-yellow outline-none transition [color-scheme:dark]"
        />
        {hasRange && (
          <button
            onClick={onClear}
            title="Clear date range"
            className="text-binance-muted hover:text-binance-red transition text-lg leading-none"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
