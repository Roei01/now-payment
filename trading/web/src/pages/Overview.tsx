import { useEffect } from "react";
import { api } from "../api";
import { useTopbar, type Me } from "../App";
import { Icon } from "../components/icons";
import { useUI, REASON_FIELD } from "../components/overlay";
import { Alert, Badge, Card, Kpi, LoadError, PageSkeleton, Progress, SectionHead, useApi } from "../components/ui";
import { t } from "../i18n";
import { ago, dt, ils, pct, signClass, spct, usd } from "../format";

export function useKillSwitch(onDone: () => void) {
  const ui = useUI();
  return () =>
    ui.form({
      title: "עצירת חירום",
      description: "תיעצר שליחת כל פקודה חדשה בכל התיקים. פוזיציות קיימות לא יימכרו. שחרור דורש אימות דו־שלבי.",
      fields: [REASON_FIELD],
      submitLabel: "עצירה מיידית",
      tone: "danger",
      onSubmit: async (v) => {
        await api("/api/control/kill-switch", { method: "POST", body: { active: true, reason: v.reason } });
        ui.toast("עצירת החירום הופעלה", "bad");
        onDone();
      },
    });
}

export function Overview({ me }: { me: Me }) {
  const { data, error, reload } = useApi<any>("/api/overview", { refreshMs: 60_000 });
  const setTop = useTopbar();
  const kill = useKillSwitch(reload);

  useEffect(() => {
    if (!data) return;
    const c = data.system.lastCycle;
    setTop({
      sub: c ? `עודכן ${ago(c.started_at)} · השוק ${c.market_open ? "פתוח" : "סגור"}` : "טרם רץ מחזור",
      action:
        me.role === "owner" && !data.system.killSwitch.active ? (
          <button className="btn danger-soft sm" onClick={kill}>
            <Icon name="stop" />
            <span>עצירת חירום</span>
          </button>
        ) : undefined,
    });
  }, [data]);

  if (error && !data) return <LoadError error={error} retry={reload} />;
  if (!data) return <PageSkeleton />;
  const { portfolios, system, budget } = data;
  const paper = portfolios.filter((p: any) => p.kind === "PAPER");
  const bench = portfolios.find((p: any) => p.kind === "BENCHMARK");
  const live = portfolios.find((p: any) => p.kind === "LIVE");
  const benchRet = bench?.perf ? Number(bench.perf.net_return_pct) : null;
  const simulated = String(system.integrations.marketData).startsWith("SIMULATED");
  const hbAge = system.workerHeartbeat ? (Date.now() - new Date(system.workerHeartbeat).getTime()) / 60000 : Infinity;
  const totalUsd = paper.reduce((a: number, p: any) => a + Number(p.perf?.value_usd ?? 0), 0);
  const totalIls = paper.reduce((a: number, p: any) => a + Number(p.perf?.value_ils ?? 0), 0);
  const startIls = paper.reduce((a: number, p: any) => a + Number(p.initial_capital_ils ?? 0), 0);

  return (
    <div className="stack">
      {system.killSwitch.active && (
        <Alert tone="bad" title="עצירת חירום פעילה" icon="stop">
          {system.killSwitch.reason} · {dt(system.killSwitch.at)}. לא נשלחות פקודות חדשות. שחרור במסך תפעול.
        </Alert>
      )}
      {simulated && (
        <Alert tone="warn" title="נתוני שוק מדומים">
          המחירים אינם אמיתיים והתוצאות לא ייחשבו לקידום. חברו מפתחות Alpaca כדי לעבור לנתונים אמיתיים.
        </Alert>
      )}
      {hbAge > 10 && (
        <Alert tone="warn" title="מנוע הרקע לא פעיל">
          דיווח אחרון {Number.isFinite(hbAge) ? ago(system.workerHeartbeat) : "— מעולם לא"}. מחזורי המסחר לא רצים.
        </Alert>
      )}
      {system.openIncidents.length > 0 && (
        <a href="#/ops" style={{ color: "inherit" }}>
          <Alert tone="warn" title={`${system.openIncidents.length} תקלות פתוחות`}>
            {t(system.openIncidents[0].kind)}: {system.openIncidents[0].message}
          </Alert>
        </a>
      )}

      <Card i={0}>
        <div className="row between" style={{ alignItems: "flex-end" }}>
          <div className="grow">
            <div className="muted small">שווי כולל — שלושת תיקי הדמה</div>
            <div className="hero-value num mt-4">{ils(totalIls)}</div>
            <div className="small muted num mt-4">
              {usd(totalUsd)} · הון התחלתי {ils(startIls, 0)}
            </div>
          </div>
          <div style={{ textAlign: "end" }}>
            <div className={`num ${signClass(totalIls - startIls)}`} style={{ fontSize: 20, fontWeight: 750 }}>
              {startIls ? spct(totalIls / startIls - 1) : "—"}
            </div>
            <div className="xsmall muted">תשואה בשקלים</div>
          </div>
        </div>
      </Card>

      <SectionHead title="תיקי דמה" hint="לחצו על תיק לפרטים" />
      <div className="grid auto">
        {[...paper, bench].filter(Boolean).map((p: any, i: number) => {
          const perf = p.perf;
          const excess = perf && benchRet !== null && p.kind !== "BENCHMARK" ? Number(perf.net_return_pct) - benchRet : null;
          return (
            <a key={p.id} href={`#/portfolio/${p.id}`} className="card" style={{ ["--i" as string]: i + 1 }}>
              <div className="card-head">
                <div className="grow">
                  <h3>{p.name}</h3>
                  <div className="desc">
                    {p.strategy_name ?? "—"} · גרסה {p.strategy_version ?? "—"}
                  </div>
                </div>
                <Badge value={p.status} />
              </div>
              <div className="row between nowrap">
                <div className="grow">
                  <div className="num" style={{ fontSize: 24, fontWeight: 800 }}>
                    {ils(perf?.value_ils)}
                  </div>
                  <div className="xsmall muted num">{usd(perf?.value_usd)}</div>
                </div>
                <div style={{ textAlign: "end" }}>
                  <div className={`num ${signClass(perf?.net_return_pct)}`} style={{ fontWeight: 750 }}>
                    {spct(perf?.net_return_pct)}
                  </div>
                  <div className="xsmall muted">{p.kind === "BENCHMARK" ? "תשואה" : <>מול מדד <span className={`num ${signClass(excess)}`}>{spct(excess)}</span></>}</div>
                </div>
              </div>
              <div className="divider" />
              <div className="kpis">
                <Kpi label="הפסד מההון" value={pct(perf?.loss_from_initial_pct, 1)} sub={`יעד סיכון ${pct(p.risk_budget_pct, 0)}`} />
                <Kpi label="ירידה מהשיא" value={pct(perf?.drawdown_pct, 1)} sub={`מושקע ${pct(perf?.invested_pct, 0)}`} />
              </div>
              {p.last_decision && (
                <div className="row nowrap mt-12 small" style={{ alignItems: "flex-start" }}>
                  <Badge value={p.last_decision.status} />
                  <span className="muted grow" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {t(p.last_decision.action)} · {p.last_decision.rationale}
                  </span>
                </div>
              )}
            </a>
          );
        })}
      </div>

      {live && (
        <a href="#/live" className="card" style={{ ["--i" as string]: 5 }}>
          <div className="card-head">
            <div className="grow">
              <h3>{live.name}</h3>
              <div className="desc">{live.strategy_name ? `${live.strategy_name} · גרסה ${live.strategy_version}` : "טרם שויכה אסטרטגיה"}</div>
            </div>
            <Badge value={live.status} live={live.status === "PILOT" || live.status === "ACTIVE"} />
          </div>
          <p className="small muted">
            {live.perf
              ? `שווי ${usd(live.perf.value_usd)} · תשואה ${spct(live.perf.net_return_pct)}`
              : "לא נשלחות פקודות עד מעבר שער הקידום, מדיניות חתומה והפעלה מפורשת שלכם."}
          </p>
        </a>
      )}

      <SectionHead title="עלויות ומערכת" />
      <div className="grid cols-2">
        <Card title="עלויות תפעול החודש" desc="כסף אמיתי, נפרד מהון הדמה" i={6}>
          <div className="stack" style={{ gap: 12 }}>
            <div>
              <div className="row between small">
                <span>סה״כ (כולל שרת)</span>
                <span className="num">
                  {ils(budget.monthTotalIls)} / {ils(budget.opsCapIls, 0)}
                </span>
              </div>
              <div className="mt-8">
                <Progress value={budget.monthTotalIls} max={budget.opsCapIls} />
              </div>
            </div>
            <div>
              <div className="row between small">
                <span>מודלי AI</span>
                <span className="num">
                  {ils(budget.monthAiIls)} / {ils(budget.aiBudgetIls, 0)}
                </span>
              </div>
              <div className="mt-8">
                <Progress value={budget.monthAiIls} max={budget.aiBudgetIls} />
              </div>
            </div>
          </div>
        </Card>
        <Card title="חיבורים" desc="מצב השירותים החיצוניים" i={7} action={<a className="btn sm" href="#/ops">פרטים</a>}>
          <div className="list">
            {(["marketData", "ai", "email"] as const).map((k) => {
              const v = String(system.integrations[k]);
              const ok = !/SIMULATED|not configured|off \(/.test(v);
              return (
                <div className="list-row" key={k}>
                  <div className="list-main">
                    <div className="list-title">{t(k)}</div>
                    <div className="list-sub ltr" style={{ textAlign: "right" }}>
                      {v}
                    </div>
                  </div>
                  <Badge value={ok ? "OK" : "WARNING"} text={ok ? "מחובר" : "חסר"} />
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}
