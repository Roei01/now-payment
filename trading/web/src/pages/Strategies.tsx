import { useState } from "react";
import { api } from "../api";
import type { Me } from "../App";
import { Icon } from "../components/icons";
import { useUI } from "../components/overlay";
import { Acc, Alert, Badge, Card, Code, Empty, Kpi, KV, LoadError, PageSkeleton, RTable, SectionHead, useApi } from "../components/ui";
import { t } from "../i18n";
import { day, pct, signClass, spct, usd } from "../format";

const RULE_LABELS: Record<string, string> = {
  entry: "כניסה",
  exit: "יציאה",
  sizing: "גודל פוזיציה",
  rebalance: "איזון",
  allocation: "הקצאה",
  screen: "סינון",
  noData: "כשחסר מידע",
  hold: "החזקה",
};

function BacktestCard({ versions, onDone }: { versions: { id: string; label: string }[]; onDone: () => void }) {
  const [versionId, setVersionId] = useState(versions[0]?.id ?? "");
  const [start, setStart] = useState("2025-01-01");
  const [end, setEnd] = useState(new Date().toISOString().slice(0, 10));
  const [split, setSplit] = useState("DEV");
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      setResult(await api("/api/backtests", { method: "POST", body: { strategyVersionId: versionId, start, end, split } }));
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const s = result?.summary;
  return (
    <Card title="הרצת בדיקה היסטורית (Backtest)" desc="ללא מידע עתידי; עסקה בפתיחת היום שאחרי האות. אסטרטגיות AI אינן נבדקות היסטורית.">
      <div className="form-grid two">
        <div className="field">
          <label htmlFor="bt-v">גרסת אסטרטגיה</label>
          <select id="bt-v" className="select" value={versionId} onChange={(e) => setVersionId(e.target.value)}>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="bt-s">חלוקה</label>
          <select id="bt-s" className="select" value={split} onChange={(e) => setSplit(e.target.value)}>
            <option value="DEV">פיתוח — 70% הראשונים</option>
            <option value="TEST">בדיקה — 30% האחרונים (לא לכיול)</option>
            <option value="FULL">כל הטווח</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="bt-a">מתאריך</label>
          <input id="bt-a" className="input ltr" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="bt-b">עד תאריך</label>
          <input id="bt-b" className="input ltr" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
      </div>
      <div className="actions mt-16">
        <button className="btn primary" onClick={run} disabled={busy || !versionId}>
          {busy ? <span className="spinner" /> : <Icon name="play" />}
          הרצה
        </button>
      </div>
      {err && (
        <div className="mt-12">
          <Alert tone="bad">{err}</Alert>
        </div>
      )}
      {s && (
        <div className="kpis four mt-16">
          <Kpi label="תשואה" value={spct(s.totalReturn)} className={signClass(s.totalReturn)} sub={`${s.start} → ${s.end}`} />
          <Kpi label="מדד ייחוס" value={spct(s.benchmarkReturn)} sub={`פער ${spct(s.excessReturn)}`} />
          <Kpi label="ירידה מרבית" value={pct(s.maxDrawdown, 1)} sub={`תנודתיות ${pct(s.annualVol, 1)}`} />
          <Kpi label="עסקאות" value={s.trades} sub={`עמלות ${usd(s.fees, 3)}`} />
        </div>
      )}
    </Card>
  );
}

export function Strategies({ me }: { me: Me }) {
  const { data, error, reload } = useApi<any>("/api/strategies");
  const ui = useUI();
  if (error && !data) return <LoadError error={error} retry={reload} />;
  if (!data) return <PageSkeleton />;
  const { strategies, assignments, gates, backtests, experiments, versionWindows, lessons, forecastStats, gatePolicy } = data;
  const allVersions = strategies.flatMap((s: any) => (s.versions ?? []).map((v: any) => ({ ...v, code: s.code, name: s.name })));
  const vLabel = (id: string) => {
    const v = allVersions.find((x: any) => x.id === id);
    return v ? `${v.name} · גרסה ${v.version}` : id.slice(0, 8);
  };
  const owner = me.role === "owner";

  const addLesson = () =>
    ui.form({
      title: "לקח מחקר חדש",
      description: "לקח נשמר כמועמד ולא משפיע על החלטות עד שתאשרו אותו.",
      fields: [
        { name: "text", label: "הלקח", type: "textarea", required: true },
        { name: "tags", label: "תגיות", help: "סימול, ענף או קוד אסטרטגיה, מופרדים בפסיק", ltr: true },
        { name: "valid", label: "מתי הלקח תקף", type: "textarea" },
      ],
      submitLabel: "שמירה",
      onSubmit: async (v) => {
        await api("/api/lessons", {
          method: "POST",
          body: { text: v.text, tags: (v.tags ?? "").split(",").map((x) => x.trim()).filter(Boolean), validityConditions: v.valid || undefined },
        });
        ui.toast("הלקח נשמר כמועמד");
        reload();
      },
    });

  return (
    <div className="stack">
      <Alert tone="info" title="השוואה הוגנת">
        שלושת תיקי הדמה מתחילים באותו הון, באותו חלון זמן ובאותן הנחות עלות. החלפת שיטה בתיק לא מאפסת הון או הפסדים; ביצועים נמדדים גם לפי חלון הגרסה.
      </Alert>

      <div className="grid cols-2">
        {strategies.map((s: any, i: number) => {
          const versions = s.versions ?? [];
          const latest = versions.at(-1);
          const active = assignments.filter((a: any) => !a.unassigned_at && versions.some((v: any) => v.id === a.strategy_version_id));
          return (
            <Card key={s.id} i={i} title={s.name} desc={s.description} action={latest?.requires_ai ? <Badge value="INFO" text="AI" plain /> : undefined}>
              <div className="row small">
                <span className="muted">פעילה ב:</span>
                {active.length ? active.map((a: any) => <span key={a.portfolio_id} className="badge plain">{a.portfolio_code}</span>) : <span className="muted">—</span>}
              </div>
              {latest && (
                <div className="mt-12">
                  <KV
                    rows={[
                      ...Object.entries(latest.rules).map(([k, v]) => [RULE_LABELS[k] ?? k, String(v)] as [string, string]),
                      ["יקום נכסים", <span className="ltr">{latest.universe.join(", ")}</span>],
                      ["אופק", `${latest.horizon_days} ימים`],
                    ]}
                  />
                </div>
              )}
              <div className="mt-8">
                {versions
                  .slice()
                  .reverse()
                  .map((v: any) => {
                    const windows = versionWindows.filter((w: any) => w.strategy_version_id === v.id);
                    const g = gates.filter((x: any) => x.strategy_version_id === v.id);
                    const fs = forecastStats.find((f: any) => f.strategy_version_id === v.id);
                    return (
                      <Acc key={v.id} summary={<span className="small"><strong>גרסה {v.version}</strong> · {day(v.created_at)} · {v.change_reason}</span>}>
                        <div className="stack" style={{ gap: 10 }}>
                          {windows.length === 0 ? (
                            <span className="small muted">טרם רצה בדמה.</span>
                          ) : (
                            windows.map((w: any) => (
                              <div key={w.portfolio_id} className="small">
                                חלון דמה: {w.start} → {w.end} · {w.days} ימים ·{" "}
                                <span className={`num ${signClass(Number(w.end_value) / Number(w.start_value) - 1)}`}>{spct(Number(w.end_value) / Number(w.start_value) - 1)}</span>
                              </div>
                            ))
                          )}
                          {fs && (
                            <div className="small muted">
                              תחזיות {fs.forecasts} · הבשילו {fs.matured} · נתמכו {fs.supported} · נסתרו {fs.contradicted}
                            </div>
                          )}
                          {g.map((x: any) => (
                            <div key={x.id} className="row small">
                              שער קידום ({x.portfolio_code}): <Badge value={x.decision} />
                            </div>
                          ))}
                          <Code value={v.params} />
                        </div>
                      </Acc>
                    );
                  })}
              </div>
            </Card>
          );
        })}
      </div>

      {owner && <BacktestCard versions={allVersions.filter((v: any) => !v.requires_ai).map((v: any) => ({ id: v.id, label: `${v.name} · גרסה ${v.version}` }))} onDone={reload} />}

      <SectionHead title="בדיקות היסטוריות" />
      <Card>
        <RTable
          rowKey={(r: any) => r.id}
          rows={backtests}
          empty="עוד לא הורצו בדיקות."
          columns={[
            { key: "v", label: "גרסה", primary: true, render: (r: any) => vLabel(r.strategy_version_id) },
            { key: "s", label: "חלוקה", render: (r: any) => <span>{t(r.split)}{r.simulated_data ? " · מדומה" : ""}</span> },
            { key: "r", label: "תשואה", render: (r: any) => <span className={`num ${signClass(r.summary.totalReturn)}`}>{spct(r.summary.totalReturn)}</span> },
            { key: "b", label: "מדד", render: (r: any) => <span className="num">{spct(r.summary.benchmarkReturn)}</span> },
            { key: "d", label: "ירידה מרבית", render: (r: any) => <span className="num">{pct(r.summary.maxDrawdown, 1)}</span> },
            { key: "t", label: "עסקאות", render: (r: any) => <span className="num">{r.summary.trades}</span> },
          ]}
        />
      </Card>

      <SectionHead title="ניסויים" hint="כולל ניסויים שנכשלו" />
      <Card>
        {experiments.length === 0 ? (
          <Empty text="אין ניסויים רשומים." />
        ) : (
          <div className="list">
            {experiments.map((e: any) => (
              <div key={e.id} className="list-row">
                <div className="list-main">
                  <div className="list-title">{e.hypothesis}</div>
                  <div className="list-sub">{vLabel(e.strategy_version_id)}</div>
                </div>
                <Badge value={e.status} />
              </div>
            ))}
          </div>
        )}
      </Card>

      <SectionHead title="לקחי מחקר" hint="לקח משפיע רק אחרי אישור" />
      <Card
        action={
          owner ? (
            <button className="btn sm" onClick={addLesson}>
              <Icon name="plus" /> לקח חדש
            </button>
          ) : undefined
        }
        title="זיכרון מחקר"
      >
        {lessons.length === 0 ? (
          <Empty text="אין לקחים עדיין." />
        ) : (
          <div className="list">
            {lessons.map((l: any) => (
              <div key={l.id} className="list-row">
                <div className="list-main">
                  <div className="list-title">{l.text}</div>
                  <div className="list-sub">
                    מדגם {l.sample_size}
                    {l.tags.length ? ` · ${l.tags.join(", ")}` : ""}
                    {l.validity_conditions ? ` · תקף כאשר: ${l.validity_conditions}` : ""}
                  </div>
                </div>
                {owner && l.status === "CANDIDATE" ? (
                  <button
                    className="btn sm"
                    onClick={async () => {
                      try {
                        await api(`/api/lessons/${l.id}`, { method: "PATCH", body: { status: "APPROVED" } });
                        ui.toast("הלקח אושר");
                        reload();
                      } catch (e) {
                        ui.toast((e as Error).message, "bad");
                      }
                    }}
                  >
                    אישור
                  </button>
                ) : (
                  <Badge value={l.status === "APPROVED" ? "OK" : l.status} text={t(l.status === "APPROVED" ? "APPROVED" : l.status)} />
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Acc summary={<span className="small muted">תנאי שער הקידום (ערכי דיון, לא סופיים)</span>}>
        <KV
          rows={[
            ["ימי מסחר בדמה", gatePolicy.minForwardDays],
            ["מינימום עסקאות", gatePolicy.minTrades],
            ["ירידה מרבית", pct(gatePolicy.maxDrawdown, 0)],
            ["הפסד מרבי מההון", pct(gatePolicy.maxLossFromInitial, 0)],
            ["רמת מובהקות", `${gatePolicy.alpha} (מתוקן לריבוי ניסויים)`],
            ["כיסוי נתונים", pct(gatePolicy.minDataCoverage, 0)],
            ["נתונים אמיתיים בלבד", gatePolicy.requireRealData ? "כן" : "לא"],
          ]}
        />
      </Acc>
    </div>
  );
}
