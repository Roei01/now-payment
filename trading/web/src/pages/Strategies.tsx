import { useState } from "react";
import { api } from "../api";
import type { Me } from "../App";
import { Badge, Json, Loading, useApi } from "../components/ui";
import { dt, pct, usd } from "../format";

function BacktestForm({ versions, onDone }: { versions: { id: string; label: string }[]; onDone: () => void }) {
  const [versionId, setVersionId] = useState(versions[0]?.id ?? "");
  const [start, setStart] = useState("2025-01-01");
  const [end, setEnd] = useState(new Date().toISOString().slice(0, 10));
  const [split, setSplit] = useState("DEV");
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="card">
      <h2>הרצת Backtest</h2>
      <div className="field">
        <label>גרסה</label>
        <select value={versionId} onChange={(e) => setVersionId(e.target.value)}>
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
      </div>
      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label>מתאריך</label>
          <input className="ltr" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>עד תאריך</label>
          <input className="ltr" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>חלוקה</label>
        <select value={split} onChange={(e) => setSplit(e.target.value)}>
          <option value="DEV">פיתוח (70% הראשונים)</option>
          <option value="TEST">בדיקה (30% האחרונים — לא לכיול)</option>
          <option value="FULL">מלא</option>
        </select>
      </div>
      <button
        className="btn primary"
        disabled={busy || !versionId}
        onClick={async () => {
          setBusy(true);
          try {
            setResult(await api("/api/backtests", { method: "POST", body: { strategyVersionId: versionId, start, end, split } }));
            onDone();
          } catch (e) {
            setResult({ error: (e as Error).message });
          } finally {
            setBusy(false);
          }
        }}
      >
        הרצה
      </button>
      {result && <Json value={result} />}
    </div>
  );
}

export function Strategies({ me }: { me: Me }) {
  const { data, error, reload } = useApi<any>("/api/strategies");
  const [lesson, setLesson] = useState("");
  if (!data) return <Loading error={error} />;
  const { strategies, assignments, gates, backtests, experiments, versionWindows, lessons, forecastStats, gatePolicy } = data;
  const allVersions = strategies.flatMap((s: any) => (s.versions ?? []).map((v: any) => ({ ...v, code: s.code, name: s.name })));
  const vLabel = (id: string) => {
    const v = allVersions.find((x: any) => x.id === id);
    return v ? `${v.code} v${v.version}` : id.slice(0, 8);
  };

  return (
    <>
      <div className="banner">
        השוואה הוגנת: שלושת תיקי הדמה מתחילים באותו הון, באותו חלון ובאותן הנחות עלות. כשמחליפים שיטה בתיק, ההון וההפסדים נשמרים וחלונות גרסה שונים אינם ניסוי מקביל.
      </div>
      {strategies.map((s: any) => {
        const active = assignments.filter((a: any) => !a.unassigned_at && (s.versions ?? []).some((v: any) => v.id === a.strategy_version_id));
        return (
          <div key={s.id} className="card" style={{ marginBottom: 12 }}>
            <h2>
              <span>{s.name}</span>
              <span className="badge ltr">{s.code}</span>
            </h2>
            <p className="muted" style={{ marginTop: 0 }}>{s.description}</p>
            <div style={{ fontSize: 13 }}>פעילה ב: {active.map((a: any) => a.portfolio_code).join(", ") || "—"}</div>
            {(s.versions ?? []).map((v: any) => {
              const windows = versionWindows.filter((w: any) => w.strategy_version_id === v.id);
              const g = gates.filter((x: any) => x.strategy_version_id === v.id);
              const fs = forecastStats.find((f: any) => f.strategy_version_id === v.id);
              return (
                <details key={v.id} style={{ marginTop: 10 }} open={v.version === s.versions.length}>
                  <summary>
                    גרסה {v.version} · {dt(v.created_at)} · {v.change_reason} {v.requires_ai ? "· דורש AI" : ""}
                  </summary>
                  <h3>חוקים</h3>
                  <table>
                    <tbody>
                      {Object.entries(v.rules).map(([k, val]) => (
                        <tr key={k}>
                          <th className="ltr">{k}</th>
                          <td>{String(val)}</td>
                        </tr>
                      ))}
                      <tr>
                        <th>יקום</th>
                        <td className="ltr">{v.universe.join(", ")}</td>
                      </tr>
                      <tr>
                        <th>אופק</th>
                        <td>{v.horizon_days} ימים</td>
                      </tr>
                    </tbody>
                  </table>
                  <details>
                    <summary>פרמטרים</summary>
                    <Json value={v.params} />
                  </details>
                  <h3>חלונות ביצועים לפי גרסה (forward paper)</h3>
                  {windows.map((w: any) => (
                    <div key={w.portfolio_id} style={{ fontSize: 13 }}>
                      {w.start} → {w.end} · {w.days} ימים · {usd(w.start_value)} → {usd(w.end_value)} ({pct(Number(w.end_value) / Number(w.start_value) - 1)})
                    </div>
                  ))}
                  {windows.length === 0 && <div className="muted" style={{ fontSize: 13 }}>טרם רצה בדמה.</div>}
                  {fs && (
                    <div style={{ fontSize: 13 }}>
                      תחזיות: {fs.forecasts} · הבשילו {fs.matured} · נתמכו {fs.supported} · נסתרו {fs.contradicted}
                    </div>
                  )}
                  {g.map((x: any) => (
                    <div key={x.id} style={{ fontSize: 13 }}>
                      שער קידום ({x.portfolio_code}): <Badge value={x.decision} /> {dt(x.evaluated_at)}
                    </div>
                  ))}
                </details>
              );
            })}
          </div>
        );
      })}

      <div className="section-title">תנאי שער הקידום (ערכי דיון — לא סופיים)</div>
      <div className="card">
        <Json value={gatePolicy} />
      </div>

      {me.role === "owner" && <BacktestForm versions={allVersions.filter((v: any) => !v.requires_ai).map((v: any) => ({ id: v.id, label: `${v.code} v${v.version}` }))} onDone={reload} />}

      <div className="section-title">Backtests</div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>גרסה</th>
              <th>חלוקה</th>
              <th>טווח</th>
              <th>תשואה</th>
              <th>מדד</th>
              <th>DD</th>
              <th>עסקאות</th>
            </tr>
          </thead>
          <tbody>
            {backtests.map((b: any) => (
              <tr key={b.id}>
                <td className="ltr">{vLabel(b.strategy_version_id)}</td>
                <td>{b.split}{b.simulated_data ? " (מדומה)" : ""}</td>
                <td className="ltr">{b.start_date} → {b.end_date}</td>
                <td className="num">{pct(b.summary.totalReturn)}</td>
                <td className="num">{pct(b.summary.benchmarkReturn)}</td>
                <td className="num">{pct(b.summary.maxDrawdown)}</td>
                <td className="num">{b.summary.trades}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {backtests.length === 0 && <span className="muted">אין הרצות.</span>}
      </div>

      <div className="section-title">ניסויים (כולל כושלים)</div>
      <div className="card">
        {experiments.map((e: any) => (
          <div key={e.id} className="list-item">
            <Badge value={e.status} text={e.status} /> {vLabel(e.strategy_version_id)} — {e.hypothesis}
          </div>
        ))}
        {experiments.length === 0 && <span className="muted">אין ניסויים רשומים.</span>}
      </div>

      <div className="section-title">לקחי מחקר</div>
      <div className="card">
        {lessons.map((l: any) => (
          <div key={l.id} className="list-item">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span>
                <Badge value={l.status === "APPROVED" ? "OK" : "WARNING"} text={l.status} /> {l.text}
              </span>
              {me.role === "owner" && l.status !== "APPROVED" && (
                <button className="btn" onClick={() => api(`/api/lessons/${l.id}`, { method: "PATCH", body: { status: "APPROVED" } }).then(reload)}>
                  אישור
                </button>
              )}
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              מדגם {l.sample_size} · תגיות {l.tags.join(", ")} {l.validity_conditions ? `· תקף כאשר: ${l.validity_conditions}` : ""}
            </div>
          </div>
        ))}
        {me.role === "owner" && (
          <div style={{ marginTop: 10 }}>
            <div className="field">
              <label>לקח חדש (מועמד — לא הופך לחוק עד אישור)</label>
              <textarea rows={2} value={lesson} onChange={(e) => setLesson(e.target.value)} />
            </div>
            <button
              className="btn"
              disabled={lesson.length < 10}
              onClick={async () => {
                const tags = prompt("תגיות (סימול/ענף/קוד אסטרטגיה, מופרדות בפסיק):") ?? "";
                await api("/api/lessons", { method: "POST", body: { text: lesson, tags: tags.split(",").map((t) => t.trim()).filter(Boolean) } });
                setLesson("");
                reload();
              }}
            >
              הוספה
            </button>
          </div>
        )}
      </div>
    </>
  );
}
