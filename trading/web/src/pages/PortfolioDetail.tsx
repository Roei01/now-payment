import { useState } from "react";
import { api } from "../api";
import type { Me } from "../App";
import { Badge, LineChart, Loading, Stat, TotpField, useApi } from "../components/ui";
import { dt, he, num, pct, signClass, usd, ils } from "../format";

export function PortfolioDetail({ id, me }: { id: string; me: Me }) {
  const { data, error, reload } = useApi<any>(`/api/portfolios/${id}`, [id]);
  const [busy, setBusy] = useState(false);
  const [totp, setTotp] = useState("");
  if (!data) return <Loading error={error} />;
  const { runs, dataSourceIncident, portfolio: p, performance, benchmark, snapshot, trades, openOrders, decisions, assignments, pnlBySymbol, gate } = data;
  const last = performance.at(-1);
  const retSeries = { label: "תיק (תשואה $)", color: "var(--series-1)", points: performance.map((r: any) => ({ x: r.date, y: Number(r.net_return_pct) })) };
  const benchSeries = { label: "מדד ייחוס SPY", color: "var(--series-2)", points: benchmark.map((r: any) => ({ x: r.date, y: Number(r.net_return_pct) })) };
  const ddSeries = { label: "ירידה מהשיא", color: "var(--bad)", points: performance.map((r: any) => ({ x: r.date, y: -Number(r.drawdown_pct) })) };
  const lossSeries = { label: "הפסד מההון ההתחלתי", color: "var(--warn)", points: performance.map((r: any) => ({ x: r.date, y: -Number(r.loss_from_initial_pct) })) };

  const act = async (path: string, body: object) => {
    setBusy(true);
    try {
      await api(path, { method: "POST", body });
      await reload();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const newRun = async () => {
    const capital = prompt("הון התחלתי לריצה החדשה (₪):", String(Number(p.initial_capital_ils ?? 200)));
    if (!capital) return;
    const reason = prompt("סיבה (הריצה הנוכחית תישמר בארכיון, כולל כל ההיסטוריה):");
    if (!reason) return;
    setBusy(true);
    try {
      const r = await api<{ id: string }>(`/api/portfolios/${p.id}/new-run`, { method: "POST", body: { reason, totp, capitalIls: Number(capital) } });
      location.hash = `#/portfolio/${r.id}`;
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {dataSourceIncident && (
        <div className="banner bad">
          <strong>מקור הנתונים השתנה.</strong> הריצה הזו התחילה על נתוני <span className="ltr">{p.data_source}</span> והמסחר בה מושעה. ההון לא אופס. כדי להמשיך על הנתונים הנוכחיים פתחו ריצה חדשה (למטה) — רק לפי החלטתכם.
        </div>
      )}
      {p.status === "ARCHIVED" && <div className="banner warn">ריצה בארכיון (צפייה בלבד).</div>}
      <div className="card">
        <h2>
          <span>{p.name}</span>
          <Badge value={p.status} />
        </h2>
        <div className="stats">
          <Stat label="שווי" value={usd(last?.value_usd)} sub={<span className="num">{ils(last?.value_ils)}</span>} />
          <Stat label="תשואה נטו $ / ₪" value={pct(last?.net_return_pct)} className={signClass(last?.net_return_pct)} sub={<span className="num">₪ {pct(last?.return_ils_pct)} (כולל השפעת מטבע)</span>} />
          <Stat label="הפסד מצטבר מההון" value={pct(last?.loss_from_initial_pct, 1)} sub={`ירידה מהשיא ${pct(last?.drawdown_pct, 1)}`} />
          <Stat label="עמלות / עסקאות" value={usd(last?.fees_cum_usd, 3)} sub={`${last?.trades_cum ?? 0} עסקאות`} />
          <Stat label="רווח ממומש" value={usd(last?.realized_pnl_usd)} className={signClass(last?.realized_pnl_usd)} />
          <Stat label="רווח לא ממומש" value={usd(last?.unrealized_pnl_usd)} className={signClass(last?.unrealized_pnl_usd)} />
          <Stat label="הון התחלתי" value={p.initial_capital_ils ? `₪${Number(p.initial_capital_ils).toFixed(0)}` : "טרם נקבע"} sub={p.initial_fx_rate ? <span className="num">{usd(p.initial_capital_usd)} @ {Number(p.initial_fx_rate).toFixed(4)}</span> : undefined} />
          <Stat label="ביצוע" value={p.execution_venue === "INTERNAL_SIM" ? "סימולטור" : p.execution_venue} sub={p.fx_rate_source ?? undefined} />
          <Stat label="מקור נתונים / ריצה" value={<span className="ltr">{p.data_source ?? "—"}</span>} className={p.data_source === "simulated" ? "warn" : ""} sub={`ריצה ${p.run_number} · מאז ${p.started_at ? dt(p.started_at) : "—"}`} />
        </div>
        {me.role === "owner" && p.kind !== "LIVE" && (
          <div className="row" style={{ marginTop: 12 }}>
            {p.status === "PAUSED" ? (
              <button className="btn" disabled={busy} onClick={() => act(`/api/portfolios/${p.id}/resume`, { reason: prompt("סיבה לחידוש:") || "manual resume" })}>
                חידוש
              </button>
            ) : (
              <button className="btn" disabled={busy} onClick={() => { const r = prompt("סיבת השהיה:"); if (r) act(`/api/portfolios/${p.id}/pause`, { reason: r }); }}>
                השהיית תיק
              </button>
            )}
          </div>
        )}
      </div>

      <div className="grid two" style={{ marginTop: 12 }}>
        <div className="card">
          <h2>תשואה מול מדד ייחוס</h2>
          <LineChart series={p.kind === "BENCHMARK" ? [retSeries] : [retSeries, benchSeries]} />
        </div>
        <div className="card">
          <h2>ירידות</h2>
          <LineChart series={[ddSeries, lossSeries]} />
        </div>
      </div>

      <div className="section-title">פוזיציות {snapshot ? `(${dt(snapshot.as_of)})` : ""}</div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>נייר</th>
              <th>כמות</th>
              <th>עלות</th>
              <th>משקל</th>
            </tr>
          </thead>
          <tbody>
            {(snapshot?.positions ?? []).map((x: any) => (
              <tr key={x.symbol}>
                <td className="ltr">{x.symbol}</td>
                <td className="num">{num(x.qty, 6)}</td>
                <td className="num">{usd(x.costBasis)}</td>
                <td className="num">{pct(x.weight, 1)}</td>
              </tr>
            ))}
            <tr>
              <td>מזומן</td>
              <td />
              <td className="num">{usd(snapshot?.cash_usd)}</td>
              <td />
            </tr>
          </tbody>
        </table>
        {openOrders.length > 0 && (
          <>
            <h3>פקודות פתוחות</h3>
            <table>
              <tbody>
                {openOrders.map((o: any) => (
                  <tr key={o.id}>
                    <td className="ltr">{o.symbol}</td>
                    <td>{he(o.side)}</td>
                    <td className="num">
                      {num(o.filled_qty, 6)}/{num(o.qty, 6)}
                    </td>
                    <td>{o.order_type === "LIMIT" ? `לימיט ${usd(o.limit_price)}` : "שוק"}</td>
                    <td>
                      <Badge value={o.status} text={o.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      <div className="section-title">מקור רווח/הפסד לפי נייר</div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>נייר</th>
              <th>תזרים עסקאות</th>
              <th>עמלות</th>
              <th>כמות נוכחית</th>
            </tr>
          </thead>
          <tbody>
            {pnlBySymbol.map((r: any) => (
              <tr key={r.symbol}>
                <td className="ltr">{r.symbol}</td>
                <td className={`num ${signClass(r.trade_cash)}`}>{usd(r.trade_cash)}</td>
                <td className="num">{usd(r.fees, 4)}</td>
                <td className="num">{num(r.qty, 6)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="section-title">ציר החלטות</div>
      <div className="card">
        {decisions.map((d: any) => (
          <a key={d.id} href={`#/decision/${d.id}`} className="list-item">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span>
                <Badge value={d.status} /> {he(d.action)}
              </span>
              <span className="muted" style={{ fontSize: 12 }}>
                {dt(d.created_at)}
              </span>
            </div>
            <div className="muted" style={{ fontSize: 13 }}>
              {d.rationale.slice(0, 160)}
            </div>
          </a>
        ))}
        {decisions.length === 0 && <span className="muted">אין עדיין החלטות.</span>}
      </div>

      <div className="section-title">עסקאות</div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>זמן</th>
              <th>נייר</th>
              <th>צד</th>
              <th>כמות</th>
              <th>מחיר</th>
              <th>עמלה</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((t: any, i: number) => (
              <tr key={i}>
                <td>{dt(t.occurred_at)}</td>
                <td className="ltr">{t.symbol}</td>
                <td>{he(t.side)}</td>
                <td className="num">{num(t.qty, 6)}</td>
                <td className="num">{usd(t.price)}</td>
                <td className="num">{usd(t.fee, 4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="section-title">ריצות (ההון לא מתאפס אלא בהחלטתכם)</div>
      <div className="card">
        {runs.map((r: any) => (
          <a key={r.id} href={`#/portfolio/${r.id}`} className="list-item" style={{ fontSize: 13 }}>
            ריצה {r.run_number} · <Badge value={r.status} text={r.status === "ARCHIVED" ? "ארכיון" : he(r.status)} /> · <span className="ltr">{r.data_source ?? "—"}</span> · ₪{Number(r.initial_capital_ils ?? 0).toFixed(0)} · {dt(r.started_at)}
            {r.archived_at ? ` → ${dt(r.archived_at)}` : ""}
          </a>
        ))}
        {me.role === "owner" && p.kind !== "LIVE" && p.status !== "ARCHIVED" && (
          <div style={{ marginTop: 12 }}>
            <p className="muted" style={{ fontSize: 12 }}>
              פתיחת ריצה חדשה מעבירה את הריצה הנוכחית לארכיון ומתחילה מחדש עם הון התחלתי ושער מטבע עדכניים על מקור הנתונים הנוכחי. דורש 2FA.
            </p>
            <TotpField value={totp} onChange={setTotp} />
            <button className="btn" disabled={busy} onClick={newRun}>
              פתיחת ריצה חדשה
            </button>
          </div>
        )}
      </div>

      <div className="section-title">היסטוריית אסטרטגיות ושער קידום</div>
      <div className="card">
        {assignments.map((a: any, i: number) => (
          <div key={i} className="list-item">
            {a.name} v{a.version} — <span className="muted">{dt(a.assigned_at)} → {a.unassigned_at ? dt(a.unassigned_at) : "פעילה"} · {a.reason}</span>
          </div>
        ))}
        {gate && (
          <>
            <h3>
              הערכת שער אחרונה: <Badge value={gate.decision} /> <span className="muted">({dt(gate.evaluated_at)})</span>
            </h3>
            <table>
              <tbody>
                {gate.checks.map((c: any) => (
                  <tr key={c.code}>
                    <td>{c.pass ? "✓" : "✗"}</td>
                    <td className="ltr">{c.code}</td>
                    <td className="muted">{c.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </>
  );
}
