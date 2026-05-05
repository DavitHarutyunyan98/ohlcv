"use client";

interface Props {
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
  pageSize: number;
  totalRows: number;
  onPageSize?: (n: number) => void;
  pageSizeOptions?: number[];
}

export default function Pagination({
  page,
  totalPages,
  onPage,
  pageSize,
  totalRows,
  onPageSize,
  pageSizeOptions = [50, 100, 200, 500],
}: Props) {
  if (totalPages <= 1 && !onPageSize) return null;

  // Build visible page numbers with ellipsis
  const pages: (number | "…")[] = [];
  if (totalPages <= 9) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 4)            pages.push("…");
    for (let i = Math.max(2, page - 2); i <= Math.min(totalPages - 1, page + 2); i++) pages.push(i);
    if (page < totalPages - 3) pages.push("…");
    pages.push(totalPages);
  }

  const start = (page - 1) * pageSize + 1;
  const end   = Math.min(page * pageSize, totalRows);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-binance-border text-xs text-binance-muted">
      <span>
        {start}–{end} of <span className="text-white font-medium">{totalRows.toLocaleString()}</span> rows
      </span>

      <div className="flex items-center gap-1">
        <button
          disabled={page === 1}
          onClick={() => onPage(1)}
          className="px-2 py-1 rounded bg-binance-border hover:bg-[#414d5c] disabled:opacity-30 transition"
        >«</button>
        <button
          disabled={page === 1}
          onClick={() => onPage(page - 1)}
          className="px-2 py-1 rounded bg-binance-border hover:bg-[#414d5c] disabled:opacity-30 transition"
        >‹</button>

        {pages.map((p, i) =>
          p === "…" ? (
            <span key={`e${i}`} className="px-2 py-1 text-binance-muted">…</span>
          ) : (
            <button
              key={p}
              onClick={() => onPage(p as number)}
              className={`px-2.5 py-1 rounded font-medium transition ${
                p === page
                  ? "bg-binance-yellow text-binance-dark"
                  : "bg-binance-border hover:bg-[#414d5c] text-binance-text"
              }`}
            >{p}</button>
          )
        )}

        <button
          disabled={page === totalPages}
          onClick={() => onPage(page + 1)}
          className="px-2 py-1 rounded bg-binance-border hover:bg-[#414d5c] disabled:opacity-30 transition"
        >›</button>
        <button
          disabled={page === totalPages}
          onClick={() => onPage(totalPages)}
          className="px-2 py-1 rounded bg-binance-border hover:bg-[#414d5c] disabled:opacity-30 transition"
        >»</button>
      </div>

      {onPageSize && (
        <div className="flex items-center gap-2">
          <span>Rows per page</span>
          <select
            value={pageSize}
            onChange={(e) => { onPageSize(Number(e.target.value)); onPage(1); }}
            className="bg-binance-dark border border-binance-border rounded px-2 py-1 text-white outline-none focus:border-binance-yellow transition"
          >
            {pageSizeOptions.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      )}
    </div>
  );
}
