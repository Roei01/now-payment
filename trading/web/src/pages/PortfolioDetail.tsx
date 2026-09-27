import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useTopbar, type Me } from "../App";
import { Icon } from "../components/icons";
import { OTP_FIELD, REASON_FIELD, useUI } from "../components/overlay";
import { Acc, Alert, Badge, Card, Empty, Kpi, KV, LineChart, LoadError, PageSkeleton, RTable, Segmented, useApi } from "../components/ui";
import { t } from "../i18n";
import { day, dt, ils, num, pct, signClass, spct, usd } from "../format";

type Tab = "overview" | "positions" | "decisions" | "trades" | "runs";
type Range = "1m" | "3m" | "all";

export function PortfolioDetail({ id, me }: { id: string; me: Me }) {
  const { data, error, reload } = useApi<any>(`/api/portfolios/${id}`, { refreshMs: 60_000 });
  const [tab, setTab] = useState<Tab>("overview");
  const [range, setRange] = useState<Range>("all");
  const ui = useUI();
  const setTop = useTopbar();

  useEffect(() => {
    if (data) setTop({ sub: `${data.portfolio.name} · ריצה ${data.portfolio.run_number}` });
  }, [data]);

  const cut = useMemo(() => {
    if (range === "all") return "";
    const d = new Date();
    d.setMonth(d.getMonth() - (range === "1m" ? 1 : 3));
    return d.toISOString().slice(0, 10);
  }, [range]);

  if (error && !data) return <LoadError error={error} retry={reload} />;
  if (!data) return <PageSkeleton />;
  const { portfolio: p, runs, dataSourceIncident, performance, benchmark, snapshot, trades, openOrders, decisions, assignments, pnlBySymbol, gate } = data;
  const last = performance.at(-1);
  const owner = me.role === "owner";
  const perf = performance.filter((r: any) => r.date >= cut);
  const bench = benchmark.filter((r: any) => r.date >= cut);
  const excess = last && benchmark.at(-1) && p.kind !== "BENCHMARK" ? Number(last.net_return_pct) - Number(benchmark.at(-1).net_return_pct) : null;

  const pause = () =>
    ui.form({
      title: "השהיית התיק",
      description: "לא יישלחו פקודות חדשות מהתיק. ההחזקות נשמרות ולא נמכרות.",
      fields: [REASON_FIELD],
      submitLabel: "השהיה",
      tone: "danger",
      onSubmit: async (v) => {
        await api(`/api/portfolios/${p.id}/pause`, { method: "POST", body: { reason: v.reason } });
        ui.toast("התיק הושהה");
        reload();
      },
    });
  const resume = () =>
    ui.form({
      title: "חידוש התיק",
      fields: [REASON_FIELD],
      submitLabel: "חידוש",
      onSubmit: async (v) => {
        await api(`/api/portfolios/${p.id}/resume`, { method: "POST", body: { reason: v.reason } });
        ui.toast("התיק חודש");
        reload();
      },
    });
  const newRun = () =>
    ui.form({
      title: "פתיחת ריצה חדשה",
      description: "הריצה הנוכחית עוברת לארכיון עם כל ההיסטוריה. הריצה החדשה מתחילה עם הון התחלתי ושער מטבע עדכני, על מקור הנתונים הנוכחי.",
      fields: [
        { name: "capital", label: "הון התחלתי (₪)", type: "number", required: true, defaultValue: String(Number(p.initial_capital_ils ?? 200)) },
        REASON_FIELD,
        OTP_FIELD,
      ],
      submitLabel: "פתיחת ריצה",
      tone: "danger",
      onSubmit: async (v) => {
        const r = await api<{ id: string }>(`/api/portfolios/${p.id}/new-run`, { method: "POST", body: { reason: v.reason, totp: v.totp, capitalIls: Number(v.capital) } });
        ui.toast("נפתחה ריצה חדשה");
        location.hash = `#/portfolio/${r.id}`;
      },
    });

  return (
    <div className="stack">
      {dataSourceIncident && (
        <Alert tone="bad" title="מקור הנתונים השתנה — המסחר בריצה מושעה">
          הריצה התחילה על נתוני <span className="ltr">{p.data_source}</span>. ההון לא אופס. כדי להמשיך על הנתונים הנוכחיים פתחו ריצה חדשה בלשונית "ריצות".
        </Alert>
      )}
      {p.status === "ARCHIVED" && <Alert tone="info" title="ריצה בארכיון">צפייה בלבד.</Alert>}

      <Card i={0}>
        <div className="card-head">
          <div className="grow">
            <h2>{p.name}</h2>
            <div className="desc">
              {t(p.execution_venue)} · נתונים <span className="ltr">{p.data_source ?? "—"}</span> · מאז {day(p.started_at)}
            </div>
          </div>
          <Badge value={p.status} />
        </div>
        <div className="row between" style={{ alignItems: "flex-end" }}>
          <div>
            <div className="hero-value num">{ils(last?.value_ils)}</div>
            <div className="small muted num mt-4">
              {usd(last?.value_usd)} · הון התחלתי {p.initial_capital_ils ? ils(p.initial_capital_ils, 0) : "—"}
            </div>
          </div>
          <div style={{ textAlign: "end" }}>
            <div className={`num ${signClass(last?.net_return_pct)}`} style={{ fontSize: 20, fontWeight: 750 }}>
              {spct(last?.net_return_pct)}
            </div>
            <div className="xsmall muted">תשואה נטו בדולר</div>
          </div>
        </div>
        {owner && p.kind !== "LIVE" && p.status !== "ARCHIVED" && (
          <div className="actions stretch mt-16">
            {p.status === "PAUSED" ? (
              <button className="btn" onClick={resume}>
                <Icon name="play" /> חידוש
              </button>
            ) : (
              <button className="btn" onClick={pause}>
                <Icon name="stop" /> השהיה
              </button>
            )}
            <button className="btn ghost" onClick={newRun}>
              <Icon name="refresh" /> ריצה חדשה
            </button>
          </div>
        )}
      </Card>

      <Segmented<Tab>
        label="אזורי התיק"
        value={tab}
        onChange={setTab}
        options={[
          { value: "overview", label: "ביצועים" },
          { value: "positions", label: "החזקות" },
          { value: "decisions", label: "החלטות" },
          { value: "trades", label: "עסקאות" },
          { value: "runs", label: "ריצות" },
        ]}
      />

      {tab === "overview" && (
        <>
          <div className="kpis four">
            <Kpi i={0} label="מול מדד הייחוס" value={spct(excess)} className={signClass(excess)} sub="פער תשואה" />
            <Kpi i={1} label="תשואה בשקלים" value={spct(last?.return_ils_pct)} className={signClass(last?.return_ils_pct)} sub="כולל השפעת מטבע" />
            <Kpi i={2} label="הפסד מההון / מהשיא" value={`${pct(last?.loss_from_initial_pct, 1)} / ${pct(last?.drawdown_pct, 1)}`} sub={`יעד סיכון ${pct(p.risk_budget_pct, 0)}`} />
            <Kpi i={3} label="רווח ממומש / לא ממומש" value={`${usd(last?.realized_pnl_usd)} / ${usd(last?.unrealized_pnl_usd)}`} sub={`${last?.trades_cum ?? 0} עסקאות · עמלות ${usd(last?.fees_cum_usd, 3)}`} />
          </div>
          <Card
            title="תשואה מול מדד ייחוס"
            i={1}
            action={
              <Segmented<Range>
                label="טווח"
                value={range}
                onChange={setRange}
                options={[
                  { value: "1m", label: "חודש" },
                  { value: "3m", label: "3 חודשים" },
                  { value: "all", label: "הכול" },
                ]}
              />
            }
          >
            <LineChart
              format={(v) => `${(v * 100).toFixed(1)}%`}
              series={[
                { label: "התיק", color: "var(--series-1)", points: perf.map((r: any) => ({ x: r.date, y: Number(r.net_return_pct) })) },
                ...(p.kind === "BENCHMARK" ? [] : [{ label: "SPY", color: "var(--series-2)", points: bench.map((r: any) => ({ x: r.date, y: Number(r.net_return_pct) })) }]),
              ]}
            />
          </Card>
          <Card title="ירידות" desc="מהשיא ומההון ההתחלתי — שתי המדידות מוצגות כדי לא להסתיר הפסד" i={2}>
            <LineChart
              area={false}
              format={(v) => `${(v * 100).toFixed(1)}%`}
              series={[
                { label: "ירידה מהשיא", color: "var(--series-1)", points: perf.map((r: any) => ({ x: r.date, y: -Number(r.drawdown_pct) })) },
                { label: "הפסד מההון", color: "var(--series-2)", points: perf.map((r: any) => ({ x: r.date, y: -Number(r.loss_from_initial_pct) })) },
              ]}
            />
          </Card>
          <Card title="שער הקידום ללייב" i={3} desc={gate ? `הערכה אחרונה ${dt(gate.evaluated_at)}` : "מוערך פעם ביום אחרי סגירת המסחר"} action={gate ? <Badge value={gate.decision} /> : undefined}>
            {gate ? (
              <div className="list">
                {gate.checks.map((c: any) => (
                  <div className="list-row" key={c.code}>
                    <Icon name={c.pass ? "check" : "x"} className={c.pass ? "good" : "bad"} style={{ width: 18, height: 18, flex: "none", marginTop: 2 }} />
                    <div className="list-main">
                      <div className="list-title">{t(c.code)}</div>
                      <div className="list-sub">{c.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty text="השער טרם הוערך לתיק זה." />
            )}
          </Card>
        </>
      )}

      {tab === "positions" && (
        <>
          <Card title="החזקות" desc={snapshot ? `נכון ל־${dt(snapshot.as_of)}` : undefined} i={0}>
            <RTable
              rowKey={(r: any) => r.symbol}
              rows={[...(snapshot?.positions ?? []), { symbol: "מזומן", qty: null, costBasis: snapshot?.cash_usd, weight: null, cash: true }]}
              columns={[
                { key: "s", label: "נייר", primary: true, render: (r: any) => <span className={r.cash ? "" : "ltr"}>{r.symbol}</span> },
                { key: "q", label: "כמות", render: (r: any) => <span className="num">{r.cash ? "—" : num(r.qty, 6)}</span> },
                { key: "c", label: "עלות / סכום", render: (r: any) => <span className="num">{usd(r.costBasis)}</span> },
                { key: "w", label: "משקל", render: (r: any) => <span className="num">{r.cash ? "—" : pct(r.weight, 1)}</span> },
              ]}
            />
          </Card>
          {openOrders.length > 0 && (
            <Card title="פקודות פתוחות" i={1}>
              <RTable
                rowKey={(r: any) => r.id}
                rows={openOrders}
                columns={[
                  { key: "s", label: "נייר", primary: true, render: (r: any) => <span className="ltr">{r.symbol}</span> },
                  { key: "side", label: "צד", render: (r: any) => t(r.side) },
                  { key: "q", label: "בוצע / כמות", render: (r: any) => <span className="num">{num(r.filled_qty, 6)} / {num(r.qty, 6)}</span> },
                  { key: "t", label: "סוג", render: (r: any) => (r.order_type === "LIMIT" ? `לימיט ${usd(r.limit_price)}` : "שוק") },
                  { key: "st", label: "סטטוס", render: (r: any) => <Badge value={r.status} /> },
                ]}
              />
            </Card>
          )}
          <Card title="מקור רווח/הפסד לפי נייר" desc="תזרים עסקאות מצטבר (שלילי = השקעה שעדיין מוחזקת)" i={2}>
            <RTable
              rowKey={(r: any) => r.symbol}
              rows={pnlBySymbol}
              empty="אין עדיין עסקאות"
              columns={[
                { key: "s", label: "נייר", primary: true, render: (r: any) => <span className="ltr">{r.symbol}</span> },
                { key: "c", label: "תזרים", render: (r: any) => <span className={`num ${signClass(r.trade_cash)}`}>{usd(r.trade_cash)}</span> },
                { key: "f", label: "עמלות", render: (r: any) => <span className="num">{usd(r.fees ?? 0, 4)}</span> },
                { key: "q", label: "כמות נוכחית", render: (r: any) => <span className="num">{num(r.qty, 6)}</span> },
              ]}
            />
          </Card>
        </>
      )}

      {tab === "decisions" && (
        <Card i={0}>
          {decisions.length === 0 ? (
            <Empty text="אין עדיין החלטות." />
          ) : (
            <div className="list">
              {decisions.map((d: any) => (
                <a key={d.id} href={`#/decision/${d.id}`} className="list-row">
                  <div className="list-main">
                    <div className="row nowrap">
                      <Badge value={d.status} />
                      <span className="list-title">{t(d.action)}</span>
                    </div>
                    <div className="list-sub mt-4">{d.rationale}</div>
                  </div>
                  <div className="list-meta">{dt(d.created_at)}</div>
                  <Icon name="chevron" className="chev" />
                </a>
              ))}
            </div>
          )}
        </Card>
      )}

      {tab === "trades" && (
        <Card i={0}>
          <RTable
            rowKey={(_r: any, i) => String(i)}
            rows={trades}
            empty="אין עדיין עסקאות"
            columns={[
              { key: "s", label: "נייר", primary: true, render: (r: any) => <span><span className="ltr">{r.symbol}</span> · {t(r.side)}</span> },
              { key: "d", label: "זמן", render: (r: any) => dt(r.occurred_at) },
              { key: "q", label: "כמות", render: (r: any) => <span className="num">{num(r.qty, 6)}</span> },
              { key: "p", label: "מחיר", render: (r: any) => <span className="num">{usd(r.price)}</span> },
              { key: "f", label: "עמלה", render: (r: any) => <span className="num">{usd(r.fee, 4)}</span> },
            ]}
          />
        </Card>
      )}

      {tab === "runs" && (
        <>
          <Card title="ריצות" desc="ההון לא מתאפס לעולם באופן אוטומטי — רק לפי החלטתכם" i={0}>
            <div className="list">
              {runs.map((r: any) => (
                <a key={r.id} href={`#/portfolio/${r.id}`} className="list-row">
                  <div className="list-main">
                    <div className="row nowrap">
                      <Badge value={r.status} />
                      <span className="list-title">ריצה {r.run_number}</span>
                    </div>
                    <div className="list-sub mt-4">
                      {ils(r.initial_capital_ils, 0)} · נתונים <span className="ltr">{r.data_source ?? "—"}</span> · {day(r.started_at)}
                      {r.archived_at ? ` עד ${day(r.archived_at)}` : ""}
                    </div>
                  </div>
                  <Icon name="chevron" className="chev" />
                </a>
              ))}
            </div>
          </Card>
          <Card title="היסטוריית אסטרטגיות" i={1}>
            <div className="list">
              {assignments.map((a: any, i: number) => (
                <div key={i} className="list-row">
                  <div className="list-main">
                    <div className="list-title">
                      {a.name} · גרסה {a.version}
                    </div>
                    <div className="list-sub">
                      {day(a.assigned_at)} — {a.unassigned_at ? day(a.unassigned_at) : "פעילה"} · {a.reason}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <Card title="פרטי הריצה" i={2}>
            <KV
              rows={[
                ["הון התחלתי", p.initial_capital_ils ? `${ils(p.initial_capital_ils, 0)} (${usd(p.initial_capital_usd)})` : "—"],
                ["שער המרה", p.initial_fx_rate ? <span className="num">{Number(p.initial_fx_rate).toFixed(4)}</span> : "—"],
                ["מקור השער", <span className="ltr">{p.fx_rate_source ?? "—"}</span>],
                ["עלות המרה משוערת", `${Number(p.fx_conversion_cost_bps)} נקודות בסיס`],
                ["ביצוע", t(p.execution_venue)],
              ]}
            />
          </Card>
          <Acc summary={<span className="small muted">מה זה סימולטור פנימי?</span>}>
            <p className="small muted">
              תיקי הדמה מבצעים עסקאות מדומות על מחירי שוק אמיתיים (הצעת הקנייה/המכירה בזמן אמת), כולל החלקה ועמלות משוערות. ביצוע אמיתי עשוי להיות שונה.
            </p>
          </Acc>
        </>
      )}
    </div>
  );
}

