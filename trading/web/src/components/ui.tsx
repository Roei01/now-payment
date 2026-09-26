import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../api";
import { t, tone } from "../i18n";
import { Icon, type IconName } from "./icons";

/** Fetches JSON, keeps the previous data while refreshing, and auto-refreshes while the tab is visible. */
export function useApi<T = any>(path: string | null, opts: { refreshMs?: number } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    setData(null);
    load();
  }, [load]);
  useEffect(() => {
    if (!opts.refreshMs) return;
    const id = setInterval(() => document.visibilityState === "visible" && load(), opts.refreshMs);
    return () => clearInterval(id);
  }, [load, opts.refreshMs]);
  return { data, error, loading, reload: load };
}

export function Badge({ value, text, plain, live }: { value: string; text?: string; plain?: boolean; live?: boolean }) {
  return <span className={`badge ${tone(value)} ${plain ? "plain" : ""} ${live ? "live" : ""}`}>{text ?? t(value)}</span>;
}

export function Kpi({ label, value, sub, className, i }: { label: ReactNode; value: ReactNode; sub?: ReactNode; className?: string; i?: number }) {
  return (
    <div className="kpi" style={{ ["--i" as string]: i ?? 0 }}>
      <div className="label">{label}</div>
      <div className={`value num ${className ?? ""}`}>{value}</div>
      {sub !== undefined && sub !== null && <div className="sub">{sub}</div>}
    </div>
  );
}

export function Card({ title, desc, action, children, i, className }: { title?: ReactNode; desc?: ReactNode; action?: ReactNode; children: ReactNode; i?: number; className?: string }) {
  return (
    <section className={`card ${className ?? ""}`} style={{ ["--i" as string]: i ?? 0 }}>
      {(title || action) && (
        <div className="card-head">
          <div className="grow">
            {title && <h3>{title}</h3>}
            {desc && <div className="desc">{desc}</div>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function SectionHead({ title, hint }: { title: ReactNode; hint?: ReactNode }) {
  return (
    <div className="section-head">
      <h2>{title}</h2>
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function Alert({ tone: tn = "info", title, children, icon }: { tone?: "info" | "warn" | "bad"; title?: ReactNode; children?: ReactNode; icon?: IconName }) {
  return (
    <div className={`alert ${tn}`} role={tn === "bad" ? "alert" : undefined}>
      <Icon name={icon ?? (tn === "info" ? "info" : "alert")} />
      <div className="body">
        {title && <strong>{title}</strong>}
        {children}
      </div>
    </div>
  );
}

export function Empty({ text, icon = "inbox" }: { text: ReactNode; icon?: IconName }) {
  return (
    <div className="empty">
      <Icon name={icon} />
      <div>{text}</div>
    </div>
  );
}

export function KV({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="kv">
      {rows.map(([k, v], i) => (
        <div key={i}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface Column<R> {
  key: string;
  label: string;
  render: (row: R) => ReactNode;
  primary?: boolean;
  align?: "end";
}

/** Table on wide screens; each row becomes a labelled card on phones. */
export function RTable<R>({ columns, rows, rowKey, empty }: { columns: Column<R>[]; rows: R[]; rowKey: (r: R, i: number) => string; empty?: ReactNode }) {
  if (rows.length === 0) return <Empty text={empty ?? "אין נתונים"} />;
  return (
    <div className="table-scroll">
      <table className="rtable cards">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={c.align === "end" ? { textAlign: "end" } : undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={rowKey(r, i)}>
              {columns.map((c) => (
                <td key={c.key} data-label={c.primary ? "" : c.label} className={c.primary ? "primary-cell" : undefined} style={c.align === "end" ? { textAlign: "end" } : undefined}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Segmented<V extends string>({ value, options, onChange, label }: { value: V; options: { value: V; label: string }[]; onChange: (v: V) => void; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? "on" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Progress({ value, max, danger = 0.9, warn = 0.75 }: { value: number; max: number; danger?: number; warn?: number }) {
  const r = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <div className={`progress ${r >= danger ? "bad" : r >= warn ? "warn" : ""}`} role="progressbar" aria-valuenow={Math.round(r * 100)} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${r * 100}%` }} />
    </div>
  );
}

export function Skeleton({ h = 16, w = "100%", r }: { h?: number; w?: number | string; r?: number }) {
  return <div className="skeleton" style={{ height: h, width: w, borderRadius: r }} />;
}

export function PageSkeleton() {
  return (
    <div className="stack" aria-busy="true" aria-label="טוען">
      <div className="card">
        <Skeleton h={18} w="40%" />
        <div className="kpis four mt-16">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} h={64} r={12} />
          ))}
        </div>
      </div>
      <div className="grid cols-2">
        <div className="card">
          <Skeleton h={180} r={12} />
        </div>
        <div className="card">
          <Skeleton h={180} r={12} />
        </div>
      </div>
    </div>
  );
}

export function LoadError({ error, retry }: { error: string; retry: () => void }) {
  return (
    <Card>
      <Empty text={<span className="bad">{error}</span>} icon="alert" />
      <div className="row" style={{ justifyContent: "center" }}>
        <button className="btn" onClick={retry}>
          <Icon name="refresh" /> ניסיון חוזר
        </button>
      </div>
    </Card>
  );
}

export function Code({ value }: { value: unknown }) {
  return <pre className="code">{typeof value === "string" ? value : JSON.stringify(value, null, 2)}</pre>;
}

export function Acc({ summary, children, open }: { summary: ReactNode; children: ReactNode; open?: boolean }) {
  return (
    <details className="acc" open={open}>
      <summary>
        <div className="grow">{summary}</div>
        <Icon name="chevron" className="chev" />
      </summary>
      <div className="acc-body">{children}</div>
    </details>
  );
}

// ------------------------------------------------------------------- chart

export interface Series {
  label: string;
  color: string;
  points: { x: string; y: number }[];
}

function niceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const start = Math.floor(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 0.5; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

/** Line chart with crosshair + tooltip (mouse, touch, keyboard) and a draw-in animation. */
export function LineChart({ series, height = 200, format, area = true }: { series: Series[]; height?: number; format: (v: number) => string; area?: boolean }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [series.length, series[0]?.points.length]);
  const H = height;
  const pad = { l: 4, r: 50, t: 10, b: 24 };
  const xs = useMemo(() => [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort(), [series]);
  const allY = series.flatMap((s) => s.points.map((p) => p.y));
  if (xs.length < 2)
    return (
      <div ref={wrapRef}>
        <Empty text="אין עדיין מספיק ימים לגרף — הגרף יתמלא עם הזמן." icon="spark" />
      </div>
    );
  let min = Math.min(0, ...allY);
  let max = Math.max(0, ...allY);
  if (max - min < 1e-4) {
    max += 0.005;
    min -= 0.005;
  }
  const ticks = niceTicks(min, max);
  min = Math.min(min, ticks[0]!);
  max = Math.max(max, ticks.at(-1)!);
  const xPos = (i: number) => pad.l + (i / (xs.length - 1)) * (W - pad.l - pad.r);
  const yPos = (v: number) => pad.t + (1 - (v - min) / (max - min)) * (H - pad.t - pad.b);
  const idx = new Map(xs.map((x, i) => [x, i]));
  const paths = series.map((s) => {
    const pts = s.points.map((p) => [xPos(idx.get(p.x)!), yPos(p.y)] as const);
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
    const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
    const a = pts.length ? `${d}L${pts.at(-1)![0].toFixed(1)},${yPos(Math.max(min, Math.min(0, max))).toFixed(1)}L${pts[0]![0].toFixed(1)},${yPos(Math.max(min, Math.min(0, max))).toFixed(1)}Z` : "";
    return { s, d, a, len: Math.ceil(len) + 2 };
  });

  const locate = (clientX: number) => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vx = ((clientX - rect.left) / rect.width) * W;
    const i = Math.round(((vx - pad.l) / (W - pad.l - pad.r)) * (xs.length - 1));
    setHover(Math.max(0, Math.min(xs.length - 1, i)));
  };
  const hx = hover === null ? null : xs[hover]!;
  const leftPct = hover === null ? 0 : (xPos(hover) / W) * 100;
  const gid = `g${series[0]?.label.length ?? 0}${xs.length}`;

  return (
    <div>
      <div
        ref={wrapRef}
        className="chart-wrap"
        tabIndex={0}
        role="img"
        aria-label={`${series.map((s) => s.label).join(" מול ")}. השתמשו בחצים לקריאת ערכים.`}
        onPointerMove={(e) => locate(e.clientX)}
        onPointerDown={(e) => locate(e.clientX)}
        onPointerLeave={(e) => e.pointerType === "mouse" && setHover(null)}
        onBlur={() => setHover(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? xs.length) - 1));
          if (e.key === "ArrowRight") setHover((h) => Math.min(xs.length - 1, (h ?? -1) + 1));
          if (e.key === "Escape") setHover(null);
        }}
      >
        <svg className="chart" viewBox={`0 0 ${W} ${H}`} style={{ direction: "ltr" }}>
          <defs>
            <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={series[0]?.color} stopOpacity="0.18" />
              <stop offset="100%" stopColor={series[0]?.color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((tv) => (
            <g key={tv}>
              <line x1={pad.l} x2={W - pad.r} y1={yPos(tv)} y2={yPos(tv)} stroke="var(--grid)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
              <text x={W - pad.r + 8} y={yPos(tv) + 4} fontSize={11} fill="var(--muted)">
                {format(tv)}
              </text>
            </g>
          ))}
          {min < 0 && max > 0 && <line x1={pad.l} x2={W - pad.r} y1={yPos(0)} y2={yPos(0)} stroke="var(--border-strong)" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
          {area && paths[0] && <path className="area" d={paths[0].a} fill={`url(#${gid})`} />}
          {paths.map(({ s, d, len }) => (
            <path key={s.label} className="line" d={d} stroke={s.color} style={{ ["--len" as string]: len }} />
          ))}
          <text x={pad.l} y={H - 6} fontSize={11} fill="var(--muted)">
            {xs[0]}
          </text>
          <text x={W - pad.r} y={H - 6} fontSize={11} fill="var(--muted)" textAnchor="end">
            {xs.at(-1)}
          </text>
          {hover !== null && (
            <g>
              <line x1={xPos(hover)} x2={xPos(hover)} y1={pad.t} y2={H - pad.b} stroke="var(--muted)" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
              {series.map((s) => {
                const p = s.points.find((q) => q.x === hx);
                return p ? <circle key={s.label} cx={xPos(hover)} cy={yPos(p.y)} r={4.5} fill={s.color} stroke="var(--surface)" strokeWidth={2} /> : null;
              })}
            </g>
          )}
        </svg>
        {hover !== null && (
          <div className="chart-tip" style={leftPct > 55 ? { right: `${100 - leftPct + 2}%` } : { left: `${leftPct + 2}%` }}>
            <div className="date ltr">{hx}</div>
            {series.map((s) => {
              const p = s.points.find((q) => q.x === hx);
              return (
                <div className="r" key={s.label}>
                  <span className="key">
                    <i style={{ background: s.color }} />
                    {s.label}
                  </span>
                  <b className="ltr">{p ? format(p.y) : "—"}</b>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {series.length > 1 && (
        <div className="legend">
          {series.map((s) => (
            <span key={s.label}>
              <i style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
