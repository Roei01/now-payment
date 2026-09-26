import { useState } from "react";
import { api } from "../api";
import type { Me } from "../App";
import { Badge, Json, Loading, TotpField, useApi } from "../components/ui";
import { ago, dt, ils } from "../format";

export function Operations({ me }: { me: Me }) {
  const { data, error, reload } = useApi<any>("/api/operations");
  const overview = useApi<any>("/api/overview");
  const [totp, setTotp] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  if (!data) return <Loading error={error} />;
  const ks = overview.data?.system.killSwitch;
  const owner = me.role === "owner";
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      const r = await fn();
      setMsg(`${ok}${r && typeof r === "object" && "status" in (r as any) ? ` (${(r as any).status})` : ""}`);
      reload();
      overview.reload();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <>
      {owner && (
        <div className="card">
          <h2>בקרה</h2>
          {ks?.active && (
            <>
              <p className="bad">עצירת חירום פעילה: {ks.reason}</p>
              <TotpField value={totp} onChange={setTotp} />
            </>
          )}
          <div className="row">
            {ks?.active ? (
              <button className="btn" onClick={() => { const r = prompt("סיבת השחרור:"); if (r) run(() => api("/api/control/kill-switch", { method: "POST", body: { active: false, reason: r, totp } }), "עצירת החירום שוחררה"); }}>
                שחרור עצירת חירום (2FA)
              </button>
            ) : (
              <button className="btn danger" onClick={() => { const r = prompt("סיבה:"); if (r) run(() => api("/api/control/kill-switch", { method: "POST", body: { active: true, reason: r } }), "עצירת חירום הופעלה"); }}>
                ⛔ עצירת חירום
              </button>
            )}
            <button className="btn" onClick={() => run(() => api("/api/operations/run-cycle", { method: "POST", body: {} }), "מחזור הורץ")}>
              הרצת מחזור עכשיו
            </button>
          </div>
          {msg && <p className="muted">{msg}</p>}
        </div>
      )}

      <div className="section-title">חיבורים</div>
      <div className="card">
        <Json value={data.integrations} />
      </div>

      <div className="section-title">Heartbeat וג׳ובים</div>
      <div className="card table-wrap">
        <table>
          <tbody>
            {data.heartbeats.map((h: any) => (
              <tr key={h.component}>
                <th>{h.component}</th>
                <td>{ago(h.last_beat_at)}</td>
              </tr>
            ))}
            {data.jobs.map((j: any) => (
              <tr key={j.id}>
                <td>{j.job}</td>
                <td>{dt(j.started_at)}</td>
                <td>
                  <Badge value={j.status} text={j.status} />
                </td>
                <td className="muted ltr" style={{ fontSize: 11 }}>{JSON.stringify(j.details).slice(0, 120)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="section-title">תקלות</div>
      <div className="card">
        {data.incidents.map((i: any) => (
          <div key={i.id} className="list-item">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span>
                <Badge value={i.severity} text={i.severity} /> {i.kind} {i.resolved_at ? <span className="muted">(נסגרה)</span> : ""}
              </span>
              {owner && !i.resolved_at && (
                <button className="btn" onClick={() => run(() => api(`/api/incidents/${i.id}/resolve`, { method: "POST", body: {} }), "נסגרה")}>
                  סגירה
                </button>
              )}
            </div>
            <div style={{ fontSize: 13 }}>{i.message}</div>
            <div className="muted" style={{ fontSize: 12 }}>{dt(i.opened_at)}</div>
          </div>
        ))}
        {data.incidents.length === 0 && <span className="muted">אין תקלות.</span>}
      </div>

      <div className="section-title">נתוני שוק (גיל נתונים)</div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>ספק</th><th>נכון ל־</th><th>נקלט</th><th>סטטוס</th><th>חסרים/ישנים</th></tr>
          </thead>
          <tbody>
            {data.batches.map((b: any) => (
              <tr key={b.id}>
                <td className="ltr">{b.provider}/{b.feed}{b.simulated ? " (sim)" : ""}</td>
                <td>{dt(b.as_of)}</td>
                <td>{ago(b.ingested_at)}</td>
                <td><Badge value={b.status} text={b.status} /></td>
                <td className="ltr" style={{ fontSize: 11 }}>{[...(b.missing ?? []), ...(b.stale ?? [])].join(",")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="section-title">מחזורי החלטה</div>
      <div className="card table-wrap">
        <table>
          <tbody>
            {data.cycles.map((c: any) => (
              <tr key={c.id}>
                <td>{dt(c.started_at)}</td>
                <td><Badge value={c.status} text={c.status} /></td>
                <td>{c.market_open ? "שוק פתוח" : "שוק סגור"}</td>
                <td className="muted" style={{ fontSize: 11 }}>{(c.notes?.notes ?? []).join(" · ")}{c.notes?.error ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="section-title">סנכרון ברוקר</div>
      <div className="card table-wrap">
        <table>
          <tbody>
            {data.brokers.map((b: any) => (
              <tr key={b.id}>
                <td>{b.code}</td>
                <td className="ltr">{b.provider}/{b.environment}</td>
                <td><Badge value={b.status} text={b.status} /></td>
                <td>{ago(b.last_sync_at)}</td>
                <td className="muted" style={{ fontSize: 11 }}>{b.last_error}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: 12 }}>תיקי הדמה מבוצעים בסימולטור פנימי; ספר החשבונות שלו הוא המשמורת ולכן אין מול מה לפייס חיצונית.</p>
      </div>

      <div className="section-title">התראות דוא״ל (תור)</div>
      <div className="card table-wrap">
        <div className="row" style={{ marginBottom: 8 }}>
          {data.notificationQueue.map((q: any) => (
            <Badge key={q.status} value={q.status} text={`${q.status}: ${q.n}`} />
          ))}
        </div>
        <table>
          <tbody>
            {data.notifications.map((n: any) => (
              <tr key={n.id}>
                <td>{dt(n.created_at)}</td>
                <td>{n.subject}</td>
                <td><Badge value={n.status} text={n.status} /></td>
                <td className="muted" style={{ fontSize: 11 }}>{n.last_error}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="section-title">עלויות החודש</div>
      <div className="card table-wrap">
        <table>
          <tbody>
            {data.costs.map((c: any, i: number) => (
              <tr key={i}>
                <td>{c.category}</td>
                <td className="ltr">{c.provider} {c.model ?? ""}</td>
                <td className="num">{ils(c.ils)}</td>
                <td className="num">{c.n} קריאות</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: 12 }}>
          תקרה חודשית {ils(data.budget.opsCapIls, 0)} · AI {ils(data.budget.aiBudgetIls, 0)} · הערכת תשתית {ils(data.budget.infraEstimateIls, 0)}
        </p>
      </div>

      <div className="section-title">מודל הסיכון</div>
      <div className="card">
        <Json value={data.riskModel} />
      </div>
    </>
  );
}
