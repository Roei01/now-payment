import { useState } from "react";
import { Badge, Json, Loading, useApi } from "../components/ui";
import { dt, he, num, pct, usd } from "../format";

export function DecisionList() {
  const [status, setStatus] = useState("");
  const { data, error } = useApi<any[]>(`/api/decisions?limit=100${status ? `&status=${status}` : ""}`, [status]);
  return (
    <>
      <div className="row" style={{ marginBottom: 10 }}>
        <select className="btn" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="סינון לפי סטטוס">
          <option value="">כל הסטטוסים</option>
          {["EXECUTED", "PARTIAL", "REJECTED", "DEFERRED", "NO_ACTION", "APPROVED"].map((s) => (
            <option key={s} value={s}>
              {he(s)}
            </option>
          ))}
        </select>
      </div>
      {!data ? (
        <Loading error={error} />
      ) : (
        <div className="card">
          {data.map((d) => (
            <a key={d.id} href={`#/decision/${d.id}`} className="list-item">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span>
                  <Badge value={d.status} /> {he(d.action)} · <span className="muted">{d.portfolio_name}</span>
                </span>
                <span className="muted" style={{ fontSize: 12 }}>
                  {dt(d.created_at)}
                </span>
              </div>
              <div className="muted" style={{ fontSize: 13 }}>
                {d.rationale.slice(0, 180)}
              </div>
            </a>
          ))}
          {data.length === 0 && <span className="muted">אין החלטות.</span>}
        </div>
      )}
    </>
  );
}

export function DecisionTrace({ id }: { id: string }) {
  const { data, error } = useApi<any>(`/api/decisions/${id}`, [id]);
  if (!data) return <Loading error={error} />;
  const { decision: d, cycle, signals, riskChecks, orders, forecasts, prompt } = data;
  const ai = d.ai_output;
  return (
    <>
      <div className="card">
        <h2>
          <span>
            {he(d.action)} · {d.portfolio_name}
          </span>
          <Badge value={d.status} />
        </h2>
        <p style={{ marginTop: 0 }}>{d.rationale}</p>
        <div className="muted" style={{ fontSize: 12 }}>
          {dt(d.created_at)} · אסטרטגיה {d.strategy_code ?? "—"} v{d.strategy_version ?? "—"} · מדיניות {d.policy_version}
          {d.model_version ? ` · מודל ${d.model_version}` : ""}
          {d.valid_until ? ` · בתוקף עד ${dt(d.valid_until)}` : ""}
        </div>
      </div>

      <div className="section-title">1. הנתונים שהיו זמינים</div>
      <div className="card">
        {cycle ? (
          <table>
            <tbody>
              <tr><th>ספק</th><td className="ltr">{cycle.provider} ({cycle.feed}){cycle.simulated ? " — SIMULATED" : ""}</td></tr>
              <tr><th>נכון ל־</th><td>{dt(cycle.data_as_of)}</td></tr>
              <tr><th>נקלט</th><td>{dt(cycle.ingested_at)}</td></tr>
              <tr><th>סטטוס נתונים</th><td><Badge value={cycle.batch_status} text={cycle.batch_status} /></td></tr>
              <tr><th>שוק</th><td>{cycle.market_open ? "פתוח" : "סגור"}</td></tr>
              <tr><th>שער USD/ILS</th><td className="ltr">{cycle.stats?.fx?.rate} ({cycle.stats?.fx?.source})</td></tr>
            </tbody>
          </table>
        ) : (
          <span className="muted">אין מחזור משויך.</span>
        )}
        {d.evidence?.sources && (
          <>
            <h3>מקורות שסופקו למודל</h3>
            <table>
              <tbody>
                {d.evidence.sources.map((s: any) => (
                  <tr key={s.id}>
                    <td className="ltr" style={{ fontSize: 11 }}>{s.id}</td>
                    <td>{s.kind}</td>
                    <td className="muted">{s.title}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      <div className="section-title">2. אותות</div>
      <div className="card table-wrap">
        <table>
          <tbody>
            {signals.map((s: any, i: number) => (
              <tr key={i}>
                <td className="ltr">{s.symbol ?? "—"}</td>
                <td>{s.kind}</td>
                <td className="num">{s.value === null ? "" : num(s.value, 4)}</td>
                <td className="muted ltr" style={{ fontSize: 11 }}>{JSON.stringify(s.payload)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {signals.length === 0 && <span className="muted">אין אותות.</span>}
        <h3>ראיות</h3>
        <Json value={d.evidence} />
      </div>

      {ai && (
        <>
          <div className="section-title">3. פלט מנהל ההשקעות (AI)</div>
          <div className="card">
            {ai.valuation && (
              <table>
                <tbody>
                  <tr><th>המלצה</th><td>{he(ai.action)} ({ai.confidence_label} — תווית מילולית, לא הסתברות)</td></tr>
                  <tr><th>טווח שווי למניה</th><td className="num">{usd(ai.valuation.per_share_low)} – {usd(ai.valuation.per_share_base)} – {usd(ai.valuation.per_share_high)}</td></tr>
                  <tr><th>שיטה</th><td>{ai.valuation.method}</td></tr>
                  <tr><th>תרחישים</th><td className="num">דובי {usd(ai.scenarios.bear.price)} · בסיס {usd(ai.scenarios.base.price)} · שורי {usd(ai.scenarios.bull.price)}</td></tr>
                  <tr><th>מחיר קנייה מרבי</th><td className="num">{usd(ai.max_buy_price)}</td></tr>
                  <tr><th>חשיפת יעד</th><td className="num">{num(ai.target_exposure_pct, 1)}%</td></tr>
                  <tr><th>אופק</th><td>{ai.horizon_days} ימים</td></tr>
                  <tr><th>ביטול תזה</th><td>{(ai.thesis_invalidation ?? []).join(" · ")}</td></tr>
                  <tr><th>מידע חסר</th><td>{(ai.missing_material_information ?? []).join(" · ") || "—"}</td></tr>
                </tbody>
              </table>
            )}
            <h3>ראיות בעד / נגד</h3>
            <ul>
              {(ai.evidence_for ?? []).map((e: any, i: number) => <li key={`f${i}`} className="good">{e.claim} <span className="muted ltr">[{e.source_id}]</span></li>)}
              {(ai.evidence_against ?? []).map((e: any, i: number) => <li key={`a${i}`} className="bad">{e.claim} <span className="muted ltr">[{e.source_id}]</span></li>)}
            </ul>
            <details>
              <summary>פלט מלא</summary>
              <Json value={ai} />
            </details>
            {prompt && (
              <details>
                <summary>גרסת פרומפט {prompt.prompt_hash.slice(0, 10)} ({prompt.model})</summary>
                <pre className="json">{prompt.prompt_text}</pre>
              </details>
            )}
          </div>
        </>
      )}

      <div className="section-title">4. בדיקות סיכון</div>
      <div className="card">
        {riskChecks.map((r: any) => (
          <div key={r.id} className="list-item">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="ltr">
                {r.proposal.side} {num(r.proposal.qty, 6)} {r.proposal.symbol} ({r.proposal.orderType})
              </span>
              <Badge value={r.result === "ALLOW" ? "OK" : r.result === "RESIZE" ? "WARNING" : "FAILED"} text={r.result} />
            </div>
            {r.reasons.map((x: any, i: number) => (
              <div key={i} className="muted" style={{ fontSize: 13 }}>
                <span className="ltr">{x.code}</span>: {x.message}
              </div>
            ))}
            {r.metrics?.estimatedWorstLossFromInitialPct && (
              <div style={{ fontSize: 12 }}>
                הפסד מוערך בתרחיש הגרוע ({r.metrics.worstScenario}): {pct(r.metrics.estimatedWorstLossFromInitialPct, 1)} מההון ההתחלתי
              </div>
            )}
          </div>
        ))}
        {riskChecks.length === 0 && <span className="muted">לא נדרשה בדיקת סיכון (אין פקודה מוצעת).</span>}
      </div>

      <div className="section-title">5. פקודות וביצוע</div>
      <div className="card">
        {orders.map((o: any) => (
          <div key={o.id} className="list-item">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="ltr">
                {o.side} {num(o.qty, 6)} {o.symbol} @ {o.order_type === "LIMIT" ? usd(o.limit_price) : "MKT"}
              </span>
              <Badge value={o.status} text={o.status} />
            </div>
            <div className="muted ltr" style={{ fontSize: 11 }}>client_order_id: {o.client_order_id} · {o.venue}</div>
            <div style={{ fontSize: 12 }}>
              {(o.events ?? []).map((e: any) => (
                <div key={e.id} className="muted">
                  {dt(e.occurred_at)} · {e.event_type}
                </div>
              ))}
              {(o.fills ?? []).map((f: any) => (
                <div key={f.id}>
                  מילוי: {num(f.qty, 6)} @ {usd(f.price)} (עמלה {usd(f.fee, 4)})
                </div>
              ))}
            </div>
          </div>
        ))}
        {orders.length === 0 && <span className="muted">לא נשלחו פקודות.</span>}
      </div>

      {forecasts.length > 0 && (
        <>
          <div className="section-title">6. תחזית ותוצאה</div>
          <div className="card table-wrap">
            <table>
              <thead>
                <tr><th>נייר</th><th>מחיר בתחזית</th><th>אופק</th><th>יעד</th><th>תוצאה</th></tr>
              </thead>
              <tbody>
                {forecasts.map((f: any) => (
                  <tr key={f.id}>
                    <td className="ltr">{f.symbol}</td>
                    <td className="num">{usd(f.price_at_forecast)}</td>
                    <td>{f.horizon_days} ימים</td>
                    <td>{dt(f.due_at)}</td>
                    <td>{f.outcome ? `${f.outcome.classification} (${pct(f.outcome.excess_return_pct)} מול מדד)` : "טרם הבשילה"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
