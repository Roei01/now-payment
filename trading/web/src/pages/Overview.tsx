import { useState } from "react";
import { api } from "../api";
import type { Me } from "../App";
import { Badge, Loading, Stat, useApi } from "../components/ui";
import { ago, dt, he, ils, pct, signClass, usd } from "../format";

export function KillSwitchButton({ active, me, onDone }: { active: boolean; me: Me; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  if (me.role !== "owner" || active) return null;
  return (
    <button
      className="btn danger"
      disabled={busy}
      onClick={async () => {
        const reason = prompt("סיבת עצירת החירום (תיעצר שליחת פקודות חדשות; פוזיציות לא יימכרו):");
        if (!reason) return;
        setBusy(true);
        try {
          await api("/api/control/kill-switch", { method: "POST", body: { active: true, reason } });
          onDone();
        } catch (e) {
          alert((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      ⛔ עצירת חירום
    </button>
  );
}

export function Overview({ me }: { me: Me }) {
  const { data, error, reload } = useApi<any>("/api/overview");
  if (!data) return <Loading error={error} />;
  const { portfolios, system, budget } = data;
  const bench = portfolios.find((p: any) => p.kind === "BENCHMARK");
  const benchRet = bench?.perf?.net_return_pct;
  const simulated = String(system.integrations.marketData).startsWith("SIMULATED");
  const heartbeatAge = system.workerHeartbeat ? (Date.now() - new Date(system.workerHeartbeat).getTime()) / 60000 : Infinity;

  return (
    <>
      {system.killSwitch.active && (
        <div className="banner bad">
          <strong>עצירת חירום פעילה</strong> — {system.killSwitch.reason} ({system.killSwitch.by}, {dt(system.killSwitch.at)}). אין פקודות חדשות; שחרור במסך תפעול עם 2FA.
        </div>
      )}
      {simulated && (
        <div className="banner warn">
          <strong>נתוני שוק מדומים.</strong> המחירים אינם אמיתיים והתוצאות לא ייחשבו בשער הקידום. חבר מפתחות Alpaca כדי לעבור לנתונים אמיתיים.
        </div>
      )}
      {heartbeatAge > 10 && <div className="banner warn">ה־worker לא דיווח {Number.isFinite(heartbeatAge) ? ago(system.workerHeartbeat) : "מעולם"} — מחזורי מסחר לא רצים.</div>}
      {system.openIncidents.length > 0 && (
        <div className="banner warn">
          {system.openIncidents.length} תקלות פתוחות — <a href="#/ops">למסך תפעול</a>
        </div>
      )}

      <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <span className="muted" style={{ fontSize: 12 }}>
          מחזור אחרון: {system.lastCycle ? `${dt(system.lastCycle.started_at)} · ${system.lastCycle.status} · שוק ${system.lastCycle.market_open ? "פתוח" : "סגור"}` : "טרם רץ"}
        </span>
        <KillSwitchButton active={system.killSwitch.active} me={me} onDone={reload} />
      </div>

      <div className="grid two">
        {portfolios.map((p: any) => {
          const perf = p.perf;
          const excess = perf && benchRet !== undefined && p.kind !== "BENCHMARK" ? Number(perf.net_return_pct) - Number(benchRet) : null;
          return (
            <a key={p.id} href={`#/portfolio/${p.id}`} className="card" style={{ color: "inherit" }}>
              <h2>
                <span>{p.name}</span>
                <span className="row">
                  {p.kind === "LIVE" && <span className="badge">לייב</span>}
                  <Badge value={p.status} />
                </span>
              </h2>
              {p.kind === "LIVE" && !perf ? (
                <p className="muted" style={{ margin: 0 }}>
                  התיק החי רדום. לא נשלחות ממנו פקודות עד מעבר שער הקידום, מדיניות חתומה והפעלה מפורשת. <br />
                  <span style={{ fontSize: 12 }}>אסטרטגיה: {p.strategy_code ?? "טרם שויכה"}</span>
                </p>
              ) : (
                <>
                  <div className="stats">
                    <Stat label="שווי" value={usd(perf?.value_usd)} sub={<span className="num">{ils(perf?.value_ils)}</span>} />
                    <Stat label="תשואה נטו ($)" value={pct(perf?.net_return_pct)} className={signClass(perf?.net_return_pct)} sub={<span className="num">₪ {pct(perf?.return_ils_pct)}</span>} />
                    <Stat label={p.kind === "BENCHMARK" ? "מזומן" : "מול מדד ייחוס"} value={p.kind === "BENCHMARK" ? usd(perf?.cash_usd) : pct(excess)} className={p.kind === "BENCHMARK" ? "" : signClass(excess)} />
                    <Stat label="הפסד מההון / מהשיא" value={`${pct(perf?.loss_from_initial_pct, 1)} / ${pct(perf?.drawdown_pct, 1)}`} sub={`יעד סיכון ${pct(p.risk_budget_pct, 0)}`} />
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
                    {p.strategy_name ?? "—"} v{p.strategy_version ?? "—"} · מזומן {usd(perf?.cash_usd)} · מושקע {pct(perf?.invested_pct, 0)} · {p.execution_venue === "INTERNAL_SIM" ? "סימולטור פנימי" : p.execution_venue}
                    {perf?.simulated_data ? " · נתונים מדומים" : ""}
                  </div>
                  {p.last_decision && (
                    <div style={{ fontSize: 13, marginTop: 8 }}>
                      <Badge value={p.last_decision.status} /> {he(p.last_decision.action)} — <span className="muted">{p.last_decision.rationale.slice(0, 110)}</span>
                    </div>
                  )}
                </>
              )}
            </a>
          );
        })}
      </div>

      <div className="section-title">בריאות מערכת ועלויות</div>
      <div className="grid two">
        <div className="card">
          <h2>חיבורים</h2>
          <table>
            <tbody>
              {Object.entries(system.integrations).map(([k, v]) => (
                <tr key={k}>
                  <th>{k}</th>
                  <td className="ltr" style={{ textAlign: "left" }}>
                    {String(v)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2>עלויות תפעול החודש</h2>
          <div className="stats">
            <Stat label="AI" value={ils(budget.monthAiIls)} sub={`מתוך ${ils(budget.aiBudgetIls, 0)}`} />
            <Stat label="סה״כ (כולל הערכת תשתית)" value={ils(budget.monthTotalIls)} sub={`תקרה ${ils(budget.opsCapIls, 0)}`} className={budget.remainingOpsIls < budget.opsCapIls * 0.2 ? "warn" : ""} />
          </div>
          <p className="muted" style={{ fontSize: 12 }}>
            עלויות אמיתיות, נפרדות מהון הדמה. בחריגה צפויה נדחות החלטות AI חדשות; בקרות סיכון ופיוס ממשיכים.
          </p>
        </div>
      </div>
    </>
  );
}
