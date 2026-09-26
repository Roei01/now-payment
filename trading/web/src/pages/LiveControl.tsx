import { useState } from "react";
import { api } from "../api";
import type { Me } from "../App";
import { Badge, Loading, TotpField, useApi } from "../components/ui";
import { dt, he, pct, usd } from "../format";

const STEPS = ["DORMANT", "ELIGIBLE", "ARMED", "PILOT", "ACTIVE"];

export function LiveControl({ me }: { me: Me }) {
  const { data, error, reload } = useApi<any>("/api/live");
  const [totp, setTotp] = useState("");
  const [readiness, setReadiness] = useState<any>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState({
    maxCapitalUsd: 500,
    pilotFraction: 0.1,
    allowedSymbols: "SPY,VTI,BND,GLD,SHY",
    maxPositionPct: 0.4,
    maxOrderUsd: 100,
    riskBudgetPct: 0.3,
    strategySwitchPolicy: "MANUAL",
    autoPromote: false,
    notes: "",
  });
  if (!data) return <Loading error={error} />;
  const { portfolio: p, transitions, policies, gates, broker, assignment, allowedTransitions, liveTradingEnabled } = data;
  const owner = me.role === "owner";

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg(ok);
      setTotp("");
      reload();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <>
      <div className="card">
        <h2>
          <span>תיק חי</span>
          <Badge value={p.status} />
        </h2>
        <div className="row" style={{ gap: 4, fontSize: 12 }}>
          {STEPS.map((s, i) => (
            <span key={s} className={`badge ${p.status === s ? "good" : ""}`}>
              {i + 1}. {he(s)}
            </span>
          ))}
        </div>
        <p style={{ fontSize: 13 }}>
          לא ייצאו פקודות מהתיק החי עד ש: (1) אסטרטגיית דמה עברה את שער הקידום, (2) נחתמה מדיניות לייב עם 2FA, (3) LIVE_TRADING_ENABLED=true בשרת, (4) בדיקת מוכנות ברוקר עברה, ו־(5) הפעלתם במפורש פיילוט. מפתחות בלבד אינם מהווים אישור.
        </p>
        <table>
          <tbody>
            <tr><th>LIVE_TRADING_ENABLED</th><td className={liveTradingEnabled ? "warn" : "good"}>{String(liveTradingEnabled)}</td></tr>
            <tr><th>אסטרטגיה משויכת</th><td>{assignment ? `${assignment.name} v${assignment.version}` : "אין (תשויך בעת ARMED מהמועמדת שעברה)"}</td></tr>
            <tr><th>ברוקר</th><td className="ltr">{broker ? `${broker.provider}/${broker.environment} · ${broker.status} · keys from ${broker.key_env_var}` : "—"}</td></tr>
            <tr><th>AUTO_PROMOTE</th><td>{p.auto_promote ? "פעיל (במסגרת המדיניות החתומה)" : "כבוי"}</td></tr>
          </tbody>
        </table>
      </div>

      <div className="section-title">שער קידום — תוצאות אחרונות</div>
      <div className="card">
        {gates.map((g: any) => (
          <details key={g.id} className="list-item">
            <summary>
              <Badge value={g.decision} /> {g.portfolio_code} · {g.strategy_code} v{g.version} · {dt(g.evaluated_at)}
            </summary>
            <table>
              <tbody>
                {g.checks.map((c: any) => (
                  <tr key={c.code}>
                    <td>{c.pass ? "✓" : "✗"}</td>
                    <td className="ltr">{c.code}</td>
                    <td className="muted">{c.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        ))}
        {gates.length === 0 && <span className="muted">השער טרם הוערך (רץ פעם ביום אחרי סגירת המסחר).</span>}
      </div>

      {owner && (
        <>
          <div className="section-title">פעולות</div>
          <div className="card">
            <TotpField value={totp} onChange={setTotp} />
            <div className="row">
              <button className="btn" onClick={() => run(async () => setReadiness(await api("/api/live/readiness", { method: "POST", body: {} })), "בדיקת מוכנות הושלמה")}>
                בדיקת מוכנות
              </button>
              {allowedTransitions.map((to: string) => (
                <button
                  key={to}
                  className={`btn ${to === "PAUSED" ? "danger" : to === "PILOT" || to === "ACTIVE" || to === "ARMED" ? "primary" : ""}`}
                  onClick={() => {
                    const reason = prompt(`סיבה למעבר ל־${he(to)}:`);
                    if (reason) run(() => api("/api/live/transition", { method: "POST", body: { to, reason, totp } }), `עבר ל־${he(to)}`);
                  }}
                >
                  → {he(to)}
                </button>
              ))}
              {p.status === "PAUSED" && (
                <button className="btn" onClick={() => run(() => api(`/api/portfolios/${p.id}/resume`, { method: "POST", body: { reason: prompt("סיבה:") || "resume", totp } }), "חודש (למצב בטוח)")}>
                  חידוש מהשהיה
                </button>
              )}
            </div>
            {msg && <p className="muted">{msg}</p>}
            {readiness && (
              <table style={{ marginTop: 10 }}>
                <tbody>
                  {readiness.checks.map((c: any) => (
                    <tr key={c.code}>
                      <td>{c.pass ? "✓" : "✗"}</td>
                      <td className="ltr">{c.code}</td>
                      <td className="muted">{c.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="section-title">חתימת מדיניות לייב (גרסה חדשה, בלתי ניתנת לשינוי)</div>
          <div className="card">
            <div className="grid two">
              {(
                [
                  ["maxCapitalUsd", "הון מרבי ($)"],
                  ["pilotFraction", "חלק הפיילוט (0–0.5)"],
                  ["maxPositionPct", "משקל מרבי לנייר (0–0.6)"],
                  ["maxOrderUsd", "פקודה מרבית ($)"],
                  ["riskBudgetPct", "יעד סיכון מוערך (≤0.30)"],
                ] as const
              ).map(([k, label]) => (
                <div className="field" key={k}>
                  <label>{label}</label>
                  <input className="ltr" type="number" step="any" value={form[k]} onChange={(e) => setForm({ ...form, [k]: Number(e.target.value) })} />
                </div>
              ))}
              <div className="field">
                <label>ניירות מותרים</label>
                <input className="ltr" value={form.allowedSymbols} onChange={(e) => setForm({ ...form, allowedSymbols: e.target.value })} />
              </div>
              <div className="field">
                <label>מדיניות החלפת אסטרטגיה</label>
                <select value={form.strategySwitchPolicy} onChange={(e) => setForm({ ...form, strategySwitchPolicy: e.target.value })}>
                  <option value="MANUAL">ידנית בלבד</option>
                  <option value="AUTO_WITHIN_GATE">אוטומטית במסגרת השער</option>
                </select>
              </div>
              <div className="field">
                <label>AUTO_PROMOTE (פיילוט→פעיל אוטומטית במסגרת התקרות)</label>
                <select value={String(form.autoPromote)} onChange={(e) => setForm({ ...form, autoPromote: e.target.value === "true" })}>
                  <option value="false">כבוי</option>
                  <option value="true">פעיל</option>
                </select>
              </div>
            </div>
            <div className="field">
              <label>הערות</label>
              <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <button
              className="btn primary"
              onClick={() =>
                run(
                  () =>
                    api("/api/live/policy", {
                      method: "POST",
                      body: { ...form, allowedSymbols: form.allowedSymbols.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean), totp },
                    }),
                  "המדיניות נחתמה",
                )
              }
            >
              חתימה (דורש 2FA)
            </button>
          </div>
        </>
      )}

      <div className="section-title">גרסאות מדיניות</div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>גרסה</th><th>הון</th><th>פיילוט</th><th>פקודה מרבית</th><th>סיכון</th><th>נחתם</th></tr>
          </thead>
          <tbody>
            {policies.map((x: any) => (
              <tr key={x.id}>
                <td>v{x.version}</td>
                <td className="num">{usd(x.max_capital_usd, 0)}</td>
                <td className="num">{pct(x.pilot_fraction, 0)}</td>
                <td className="num">{usd(x.max_order_usd, 0)}</td>
                <td className="num">{pct(x.risk_budget_pct, 0)}</td>
                <td>{x.signed_by} · {dt(x.signed_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {policies.length === 0 && <span className="muted">טרם נחתמה מדיניות.</span>}
      </div>

      <div className="section-title">יומן מעברים (audit)</div>
      <div className="card">
        {transitions.map((t: any) => (
          <div key={t.id} className="list-item" style={{ fontSize: 13 }}>
            {dt(t.at)} · {he(t.from_status)} → {he(t.to_status)} · {t.actor}
            {t.mfa_verified ? " (2FA)" : ""} — <span className="muted">{t.reason}</span>
          </div>
        ))}
        {transitions.length === 0 && <span className="muted">אין מעברים.</span>}
      </div>
    </>
  );
}
