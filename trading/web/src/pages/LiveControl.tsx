import { useState } from "react";
import { api } from "../api";
import type { Me } from "../App";
import { Icon } from "../components/icons";
import { OTP_FIELD, REASON_FIELD, useUI } from "../components/overlay";
import { Acc, Alert, Badge, Card, Empty, KV, LoadError, PageSkeleton, RTable, SectionHead, useApi } from "../components/ui";
import { t } from "../i18n";
import { dt, pct, usd } from "../format";

const STEPS = ["DORMANT", "ELIGIBLE", "ARMED", "PILOT", "ACTIVE"];
const ACTION_LABEL: Record<string, string> = { DORMANT: "חזרה לרדום", ARMED: "דריכה", PILOT: "התחלת פיילוט", ACTIVE: "הפעלה מלאה", PAUSED: "השהיה" };

function PolicyForm({ onSigned }: { onSigned: () => void }) {
  const ui = useUI();
  const [f, setF] = useState({
    maxCapitalUsd: "500",
    pilotFraction: "0.1",
    allowedSymbols: "SPY, VTI, BND, GLD, SHY",
    maxPositionPct: "0.4",
    maxOrderUsd: "100",
    riskBudgetPct: "0.3",
    strategySwitchPolicy: "MANUAL",
    autoPromote: "false",
    notes: "",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const sign = () =>
    ui.form({
      title: "חתימה על מדיניות לייב",
      description: (
        <KV
          rows={[
            ["הון מרבי", usd(f.maxCapitalUsd, 0)],
            ["פיילוט", pct(f.pilotFraction, 0)],
            ["פקודה מרבית", usd(f.maxOrderUsd, 0)],
            ["יעד סיכון", pct(f.riskBudgetPct, 0)],
            ["ניירות", <span className="ltr">{f.allowedSymbols}</span>],
          ]}
        />
      ),
      fields: [OTP_FIELD],
      submitLabel: "חתימה",
      onSubmit: async (v) => {
        await api("/api/live/policy", {
          method: "POST",
          body: {
            maxCapitalUsd: Number(f.maxCapitalUsd),
            pilotFraction: Number(f.pilotFraction),
            allowedSymbols: f.allowedSymbols.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean),
            maxPositionPct: Number(f.maxPositionPct),
            maxOrderUsd: Number(f.maxOrderUsd),
            riskBudgetPct: Number(f.riskBudgetPct),
            strategySwitchPolicy: f.strategySwitchPolicy,
            autoPromote: f.autoPromote === "true",
            notes: f.notes || undefined,
            totp: v.totp,
          },
        });
        ui.toast("המדיניות נחתמה");
        onSigned();
      },
    });
  return (
    <Card title="מדיניות לייב חדשה" desc="כל חתימה יוצרת גרסה חדשה שאי אפשר לשנות. דורש אימות דו־שלבי.">
      <div className="form-grid two">
        <div className="field">
          <label htmlFor="p1">הון מרבי ($)</label>
          <input id="p1" className="input num" inputMode="decimal" value={f.maxCapitalUsd} onChange={set("maxCapitalUsd")} />
        </div>
        <div className="field">
          <label htmlFor="p2">חלק הפיילוט</label>
          <input id="p2" className="input num" inputMode="decimal" value={f.pilotFraction} onChange={set("pilotFraction")} />
          <div className="help">בין 0 ל־0.5 מההון המרבי</div>
        </div>
        <div className="field">
          <label htmlFor="p3">משקל מרבי לנייר</label>
          <input id="p3" className="input num" inputMode="decimal" value={f.maxPositionPct} onChange={set("maxPositionPct")} />
          <div className="help">עד 0.6</div>
        </div>
        <div className="field">
          <label htmlFor="p4">פקודה מרבית ($)</label>
          <input id="p4" className="input num" inputMode="decimal" value={f.maxOrderUsd} onChange={set("maxOrderUsd")} />
        </div>
        <div className="field">
          <label htmlFor="p5">יעד סיכון מוערך</label>
          <input id="p5" className="input num" inputMode="decimal" value={f.riskBudgetPct} onChange={set("riskBudgetPct")} />
          <div className="help">עד 0.30 מההון, לכל תקופת ההחזקה</div>
        </div>
        <div className="field">
          <label htmlFor="p6">ניירות מותרים</label>
          <input id="p6" className="input ltr" value={f.allowedSymbols} onChange={set("allowedSymbols")} />
        </div>
        <div className="field">
          <label htmlFor="p7">החלפת אסטרטגיה</label>
          <select id="p7" className="select" value={f.strategySwitchPolicy} onChange={set("strategySwitchPolicy")}>
            <option value="MANUAL">ידנית בלבד</option>
            <option value="AUTO_WITHIN_GATE">אוטומטית במסגרת השער</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="p8">קידום אוטומטי</label>
          <select id="p8" className="select" value={f.autoPromote} onChange={set("autoPromote")}>
            <option value="false">כבוי</option>
            <option value="true">פעיל (פיילוט → פעיל במסגרת התקרות)</option>
          </select>
        </div>
      </div>
      <div className="field mt-12">
        <label htmlFor="p9">הערות</label>
        <input id="p9" className="input" value={f.notes} onChange={set("notes")} />
      </div>
      <div className="actions mt-16">
        <button className="btn primary" onClick={sign}>
          <Icon name="lock" /> המשך לחתימה
        </button>
      </div>
    </Card>
  );
}

export function LiveControl({ me }: { me: Me }) {
  const { data, error, reload } = useApi<any>("/api/live", { refreshMs: 60_000 });
  const ui = useUI();
  const [readiness, setReadiness] = useState<any>(null);
  const [checking, setChecking] = useState(false);
  if (error && !data) return <LoadError error={error} retry={reload} />;
  if (!data) return <PageSkeleton />;
  const { portfolio: p, transitions, policies, gates, broker, assignment, allowedTransitions, liveTradingEnabled } = data;
  const owner = me.role === "owner";
  const cur = STEPS.indexOf(p.status);
  const passGate = gates.some((g: any) => g.decision === "PASS");

  const transition = (to: string) =>
    ui.form({
      title: ACTION_LABEL[to] ?? `מעבר ל${t(to)}`,
      description:
        to === "PILOT"
          ? "הפיילוט יתחיל לשלוח פקודות אמיתיות בהיקף קטן. ההון ההתחלתי נלקח מהמזומן בחשבון, עד התקרה במדיניות."
          : to === "ARMED"
            ? "האסטרטגיה שעברה את השער תשויך לתיק החי. עדיין לא יישלחו פקודות."
            : to === "DORMANT"
              ? "התיק יחזור למצב רדום ולא ישלח פקודות."
              : undefined,
      fields: to === "DORMANT" || to === "PAUSED" ? [REASON_FIELD] : [REASON_FIELD, OTP_FIELD],
      submitLabel: ACTION_LABEL[to] ?? `מעבר ל${t(to)}`,
      tone: to === "PAUSED" || to === "PILOT" || to === "ACTIVE" ? "danger" : "primary",
      onSubmit: async (v) => {
        await api("/api/live/transition", { method: "POST", body: { to, reason: v.reason, totp: v.totp } });
        ui.toast(`התיק החי עבר ל${t(to)}`);
        reload();
      },
    });

  const checkReady = async () => {
    setChecking(true);
    try {
      setReadiness(await api("/api/live/readiness", { method: "POST", body: {} }));
    } catch (e) {
      ui.toast((e as Error).message, "bad");
    } finally {
      setChecking(false);
    }
  };

  const reqs: [string, boolean, string][] = [
    ["אסטרטגיית דמה עברה את שער הקידום", passGate, "נבדק אוטומטית פעם ביום"],
    ["מדיניות לייב חתומה (2FA)", policies.length > 0, policies.length ? `גרסה ${policies[0].version}` : "חתמו למטה"],
    ["מסחר חי מאופשר בשרת", liveTradingEnabled, "LIVE_TRADING_ENABLED"],
    ["ברוקר חי מוגדר ותקין", broker?.status === "OK", broker ? t(broker.status) : "חסרים מפתחות לייב"],
  ];

  return (
    <div className="stack">
      <Card i={0}>
        <div className="card-head">
          <div className="grow">
            <h2>{p.name}</h2>
            <div className="desc">{assignment ? `${assignment.name} · גרסה ${assignment.version}` : "תשויך אסטרטגיה בעת מעבר לדרוך"}</div>
          </div>
          <Badge value={p.status} live={p.status === "PILOT" || p.status === "ACTIVE"} />
        </div>
        <div className="stepper" aria-label="שלבי התיק החי">
          {STEPS.map((s, i) => (
            <div key={s} className={`step ${i < cur ? "done" : i === cur ? "current" : ""}`}>
              <div className="dot">{i < cur ? <Icon name="check" style={{ width: 16, height: 16 }} /> : i + 1}</div>
              <span>{t(s)}</span>
            </div>
          ))}
        </div>
        {p.status === "PAUSED" && (
          <div className="mt-12">
            <Alert tone="bad" title="התיק החי מושהה">
              לא נשלחות פקודות. חידוש מחזיר למצב בטוח (דרוך לכל היותר).
            </Alert>
          </div>
        )}
      </Card>

      <Card title="תנאים לפני שליחת פקודה אמיתית" desc="כולם חייבים להתקיים — מפתחות לבדם אינם אישור" i={1}>
        <div className="list">
          {reqs.map(([label, ok, hint]) => (
            <div key={label} className="list-row">
              <Icon name={ok ? "check" : "x"} className={ok ? "good" : "bad"} style={{ width: 18, height: 18, flex: "none", marginTop: 2 }} />
              <div className="list-main">
                <div className="list-title">{label}</div>
                <div className="list-sub">{hint}</div>
              </div>
            </div>
          ))}
        </div>
        {owner && (
          <div className="actions stretch mt-16">
            <button className="btn" onClick={checkReady} disabled={checking}>
              {checking ? <span className="spinner" /> : <Icon name="shield" />} בדיקת מוכנות
            </button>
            {allowedTransitions.map((to: string) => (
              <button key={to} className={`btn ${to === "PAUSED" ? "danger-soft" : to === "DORMANT" ? "ghost" : "primary"}`} onClick={() => transition(to)}>
                {to === "PAUSED" ? <Icon name="stop" /> : null}
                {ACTION_LABEL[to] ?? t(to)}
              </button>
            ))}
            {p.status === "PAUSED" && (
              <button
                className="btn primary"
                onClick={() =>
                  ui.form({
                    title: "חידוש התיק החי",
                    fields: [REASON_FIELD, OTP_FIELD],
                    submitLabel: "חידוש",
                    onSubmit: async (v) => {
                      await api(`/api/portfolios/${p.id}/resume`, { method: "POST", body: v });
                      ui.toast("התיק החי חודש למצב בטוח");
                      reload();
                    },
                  })
                }
              >
                <Icon name="play" /> חידוש
              </button>
            )}
          </div>
        )}
        {readiness && (
          <div className="mt-16">
            <Alert tone={readiness.ready ? "info" : "warn"} title={readiness.ready ? "מוכן" : "לא מוכן"} />
            <div className="list mt-8">
              {readiness.checks.map((c: any) => (
                <div key={c.code} className="list-row">
                  <Icon name={c.pass ? "check" : "x"} className={c.pass ? "good" : "bad"} style={{ width: 18, height: 18, flex: "none", marginTop: 2 }} />
                  <div className="list-main">
                    <div className="list-title">{t(c.code)}</div>
                    <div className="list-sub">{c.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      <SectionHead title="שער הקידום" hint="התוצאה האחרונה לכל תיק דמה" />
      <Card>
        {gates.length === 0 ? (
          <Empty text="השער טרם הוערך — הוא רץ פעם ביום אחרי סגירת המסחר." />
        ) : (
          gates.map((g: any) => (
            <Acc
              key={g.id}
              summary={
                <span className="row nowrap">
                  <Badge value={g.decision} />
                  <span className="small">
                    {g.portfolio_code} · {g.strategy_code} גרסה {g.version}
                  </span>
                </span>
              }
            >
              <div className="list">
                {g.checks.map((c: any) => (
                  <div key={c.code} className="list-row">
                    <Icon name={c.pass ? "check" : "x"} className={c.pass ? "good" : "bad"} style={{ width: 18, height: 18, flex: "none", marginTop: 2 }} />
                    <div className="list-main">
                      <div className="list-title">{t(c.code)}</div>
                      <div className="list-sub">{c.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Acc>
          ))
        )}
      </Card>

      {owner && <PolicyForm onSigned={reload} />}

      <SectionHead title="גרסאות מדיניות" />
      <Card>
        <RTable
          rowKey={(r: any) => r.id}
          rows={policies}
          empty="טרם נחתמה מדיניות."
          columns={[
            { key: "v", label: "גרסה", primary: true, render: (r: any) => `גרסה ${r.version}` },
            { key: "c", label: "הון", render: (r: any) => <span className="num">{usd(r.max_capital_usd, 0)}</span> },
            { key: "p", label: "פיילוט", render: (r: any) => <span className="num">{pct(r.pilot_fraction, 0)}</span> },
            { key: "o", label: "פקודה מרבית", render: (r: any) => <span className="num">{usd(r.max_order_usd, 0)}</span> },
            { key: "r", label: "סיכון", render: (r: any) => <span className="num">{pct(r.risk_budget_pct, 0)}</span> },
            { key: "s", label: "נחתם", render: (r: any) => dt(r.signed_at) },
          ]}
        />
      </Card>

      <SectionHead title="יומן מעברים" />
      <Card>
        {transitions.length === 0 ? (
          <Empty text="אין מעברים עדיין." />
        ) : (
          <div className="list">
            {transitions.map((x: any) => (
              <div key={x.id} className="list-row">
                <div className="list-main">
                  <div className="list-title">
                    {t(x.from_status)} ← {t(x.to_status)}
                  </div>
                  <div className="list-sub">
                    {x.reason} · {x.actor}
                    {x.mfa_verified ? " · 2FA" : ""}
                  </div>
                </div>
                <div className="list-meta">{dt(x.at)}</div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
