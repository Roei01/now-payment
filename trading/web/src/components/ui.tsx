import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api } from "../api";
import { he } from "../format";

export function useApi<T = any>(path: string | null, deps: unknown[] = []) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => {
    load();
  }, [load]);
  return { data, error, loading, reload: load };
}

export function Stat({ label, value, sub, className }: { label: string; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className={`value num ${className ?? ""}`}>{value}</div>
      {sub !== undefined && <div className="sub">{sub}</div>}
    </div>
  );
}

const TONE: Record<string, string> = {
  ACTIVE: "good",
  EXECUTED: "good",
  PASS: "good",
  OK: "good",
  SENT: "good",
  PAUSED: "bad",
  REJECTED: "bad",
  FAIL: "bad",
  FAILED: "bad",
  CRITICAL: "bad",
  WARNING: "warn",
  DEFERRED: "warn",
  PARTIAL: "warn",
  ARMED: "warn",
  PILOT: "warn",
  SUPPRESSED: "warn",
  INSUFFICIENT_DATA: "warn",
};

export function Badge({ value, text }: { value: string; text?: string }) {
  return <span className={`badge ${TONE[value] ?? ""}`}>{text ?? he(value)}</span>;
}

export function Loading({ error }: { error?: string | null }) {
  return <div className="card muted">{error ? <span className="error">{error}</span> : "טוען…"}</div>;
}

export function Json({ value }: { value: unknown }) {
  return <pre className="json">{JSON.stringify(value, null, 2)}</pre>;
}

export function TotpField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="field">
      <label htmlFor="totp">קוד אימות דו־שלבי (6 ספרות)</label>
      <input id="totp" className="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))} />
    </div>
  );
}

export interface Series {
  label: string;
  color: string;
  points: { x: string; y: number }[];
}

/** Minimal responsive SVG line chart (percent values). */
export function LineChart({ series, height = 180, percent = true }: { series: Series[]; height?: number; percent?: boolean }) {
  const all = series.flatMap((s) => s.points);
  if (all.length < 2) return <div className="muted" style={{ fontSize: 13 }}>אין עדיין מספיק נקודות לגרף.</div>;
  const xs = [...new Set(all.map((p) => p.x))].sort();
  const ys = all.map((p) => p.y);
  let min = Math.min(...ys, 0);
  let max = Math.max(...ys, 0);
  if (max - min < 1e-6) {
    max += 0.01;
    min -= 0.01;
  }
  const W = 600;
  const H = height;
  const padL = 44;
  const padR = 8;
  const padT = 8;
  const padB = 20;
  const x = (v: string) => padL + (xs.indexOf(v) / Math.max(1, xs.length - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);
  const ticks = [min, (min + max) / 2, max];
  const fmt = (v: number) => (percent ? `${(v * 100).toFixed(1)}%` : v.toFixed(2));
  return (
    <div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={series.map((s) => s.label).join(" / ")} style={{ direction: "ltr" }}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
            <text x={padL - 6} y={y(t) + 4} fontSize={11} textAnchor="end" fill="var(--muted)">
              {fmt(t)}
            </text>
          </g>
        ))}
        <line x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} stroke="var(--muted)" strokeWidth={1} strokeDasharray="3 3" />
        {series.map((s) => (
          <polyline
            key={s.label}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeLinejoin="round"
            points={s.points.map((p) => `${x(p.x)},${y(p.y)}`).join(" ")}
          />
        ))}
        <text x={padL} y={H - 4} fontSize={11} fill="var(--muted)">
          {xs[0]}
        </text>
        <text x={W - padR} y={H - 4} fontSize={11} fill="var(--muted)" textAnchor="end">
          {xs.at(-1)}
        </text>
      </svg>
      <div className="legend">
        {series.map((s) => (
          <span key={s.label}>
            <i style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
