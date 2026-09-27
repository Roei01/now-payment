import { useEffect, useState } from "react";
import { useTopbar } from "../App";
import { Icon } from "../components/icons";
import { Acc, Alert, Badge, Card, Code, Empty, KV, LoadError, PageSkeleton, RTable, SectionHead, Segmented, useApi } from "../components/ui";
import { explain, t } from "../i18n";
import { dt, num, pct, spct, usd } from "../format";

type Filter = "" | "EXECUTED" | "REJECTED" | "DEFERRED" | "NO_ACTION";

export function DecisionList() {
  const [status, setStatus] = useState<Filter>("");
  const { data, error, reload } = useApi<any[]>(`/api/decisions?limit=100${status ? `&status=${status}` : ""}`, { refreshMs: 60_000 });
  return (
    <div className="stack">
      <Segmented<Filter>
        label="סינון לפי סטטוס"
        value={status}
        onChange={setStatus}
        options={[
          { value: "", label: "הכול" },
          { value: "EXECUTED", label: "בוצעו" },
          { value: "REJECTED", label: "נדחו" },
          { value: "DEFERRED", label: "לבירור" },
          { value: "NO_ACTION", label: "ללא פעולה" },
        ]}
      />
      {error && !data ? (
        <LoadError error={error} retry={reload} />
      ) : !data ? (
        <PageSkeleton />
      ) : (
        <Card>
          {data.length === 0 ? (
            <Empty text="אין החלטות בסינון הזה." />
          ) : (
            <div className="list">
              {data.map((d) => (
                <a key={d.id} href={`#/decision/${d.id}`} className="list-row">
                  <div className="list-main">
                    <div className="row nowrap">
                      <Badge value={d.status} />
                      <span className="list-title">
                        {t(d.action)} · {d.portfolio_name}
                      </span>
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
    </div>
  );
}

function Step({ n, title, children, i }: { n: number; title: string; children: React.ReactNode; i: number }) {
  return (
    <Card
      i={i}
      title={
        <span className="row nowrap">
          <span className="badge info plain num">{n}</span>
          {title}
        </span>
      }
    >
      {children}
    </Card>
  );
}

export function DecisionTrace({ id }: { id: string }) {
  const { data, error, reload } = useApi<any>(`/api/decisions/${id}`);
  const setTop = useTopbar();
  useEffect(() => {
    if (data) setTop({ sub: `${data.decision.portfolio_name} · ${dt(data.decision.created_at)}` });
  }, [data]);
  if (error && !data) return <LoadError error={error} retry={reload} />;
  if (!data) return <PageSkeleton />;
  const { decision: d, cycle, signals, riskChecks, orders, forecasts, prompt } = data;
  const ai = d.ai_output;

  return (
    <div className="stack">
      <Card i={0}>
        <div className="card-head">
          <div className="grow">
            <h2>{t(d.action)}</h2>
            <div className="desc">
              {d.strategy_code ?? "—"} · גרסה {d.strategy_version ?? "—"} · מדיניות <span className="ltr">{d.policy_version}</span>
            </div>
          </div>
          <Badge value={d.status} />
        </div>
        <p className="wrap-any">{d.rationale}</p>
        {d.model_version && <p className="small muted mt-8">מודל: <span className="ltr">{d.model_version}</span>{d.valid_until ? ` · בתוקף עד ${dt(d.valid_until)}` : ""}</p>}
      </Card>

      <SectionHead title="מסלול ההחלטה" hint="מהנתונים ועד הביצוע" />

      <Step n={1} title="הנתונים שהיו זמינים" i={1}>
        {cycle ? (
          <KV
            rows={[
              ["ספק", <span className="ltr">{`${cycle.provider} (${cycle.feed})${cycle.simulated ? " · מדומה" : ""}`}</span>],
              ["נכון ל־", dt(cycle.data_as_of)],
              ["סטטוס נתונים", <Badge value={cycle.batch_status} />],
              ["שוק", cycle.market_open ? "פתוח" : "סגור"],
              ["שער דולר/שקל", <span className="num">{cycle.stats?.fx?.rate ?? "—"}</span>],
            ]}
          />
        ) : (
          <Empty text="אין מחזור משויך." />
        )}
        {d.evidence?.sources?.length > 0 && (
          <Acc summary={<span className="small">מקורות שסופקו למודל ({d.evidence.sources.length})</span>}>
            <div className="list">
              {d.evidence.sources.map((s: any) => (
                <div className="list-row" key={s.id}>
                  <div className="list-main">
                    <div className="list-title">{s.title}</div>
                    <div className="list-sub ltr" style={{ textAlign: "right" }}>
                      {s.kind} · {s.id}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Acc>
        )}
      </Step>

      <Step n={2} title="אותות האסטרטגיה" i={2}>
        <RTable
          rowKey={(_r: any, i) => String(i)}
          rows={signals}
          empty="אין אותות במחזור זה."
          columns={[
            { key: "s", label: "נייר", primary: true, render: (r: any) => <span className="ltr">{r.symbol ?? "—"}</span> },
            { key: "k", label: "אות", render: (r: any) => <span className="ltr xsmall">{r.kind}</span> },
            { key: "v", label: "ערך", render: (r: any) => <span className="num">{r.value === null ? "—" : num(r.value, 4)}</span> },
          ]}
        />
        <Acc summary={<span className="small">ראיות מלאות</span>}>
          <Code value={d.evidence} />
        </Acc>
      </Step>

      {ai && (
        <Step n={3} title="מנהל ההשקעות (AI)" i={3}>
          {ai.valuation ? (
            <>
              <KV
                rows={[
                  ["המלצה", `${t(ai.action)} · ביטחון ${ai.confidence_label === "high" ? "גבוה" : ai.confidence_label === "medium" ? "בינוני" : "נמוך"} (תווית, לא הסתברות)`],
                  ["טווח שווי למניה", <span className="num">{`${usd(ai.valuation.per_share_low)} – ${usd(ai.valuation.per_share_base)} – ${usd(ai.valuation.per_share_high)}`}</span>],
                  ["שיטה", ai.valuation.method],
                  ["תרחישים", <span className="num">{`שלילי ${usd(ai.scenarios.bear.price)} · בסיס ${usd(ai.scenarios.base.price)} · חיובי ${usd(ai.scenarios.bull.price)}`}</span>],
                  ["מחיר קנייה מרבי", <span className="num">{usd(ai.max_buy_price)}</span>],
                  ["חשיפת יעד", <span className="num">{num(ai.target_exposure_pct, 1)}%</span>],
                  ["אופק", `${ai.horizon_days} ימים`],
                ]}
              />
              <div className="grid cols-2 mt-12">
                <div>
                  <div className="small good" style={{ fontWeight: 700 }}>
                    בעד
                  </div>
                  <ul className="small" style={{ paddingInlineStart: 18, margin: "6px 0" }}>
                    {(ai.evidence_for ?? []).map((e: any, i: number) => (
                      <li key={i}>{e.claim}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="small bad" style={{ fontWeight: 700 }}>
                    נגד
                  </div>
                  <ul className="small" style={{ paddingInlineStart: 18, margin: "6px 0" }}>
                    {(ai.evidence_against ?? []).map((e: any, i: number) => (
                      <li key={i}>{e.claim}</li>
                    ))}
                  </ul>
                </div>
              </div>
              {(ai.thesis_invalidation ?? []).length > 0 && (
                <Alert tone="info" title="תנאים לביטול התזה">
                  {ai.thesis_invalidation.join(" · ")}
                </Alert>
              )}
            </>
          ) : (
            <Empty text="המודל לא החזיר הערכה תקפה." />
          )}
          <Acc summary={<span className="small">פלט מלא</span>}>
            <Code value={ai} />
          </Acc>
          {prompt && (
            <Acc summary={<span className="small">גרסת פרומפט <span className="ltr">{prompt.prompt_hash.slice(0, 10)}</span></span>}>
              <Code value={prompt.prompt_text} />
            </Acc>
          )}
        </Step>
      )}

      <Step n={ai ? 4 : 3} title="שער הסיכון" i={4}>
        {riskChecks.length === 0 ? (
          <Empty text="לא הוצעה פקודה, לכן לא נדרשה בדיקת סיכון." icon="shield" />
        ) : (
          <div className="list">
            {riskChecks.map((r: any) => (
              <div key={r.id} className="list-row">
                <div className="list-main">
                  <div className="row between nowrap">
                    <span className="list-title">
                      {t(r.proposal.side)} <span className="ltr">{r.proposal.symbol}</span> · <span className="num">{num(r.proposal.qty, 6)}</span>
                    </span>
                    <Badge value={r.result} />
                  </div>
                  {r.reasons.map((x: any, i: number) => (
                    <div key={i} className="small mt-4">
                      <strong>{t(x.code)}</strong> <span className="muted">— {explain(x.message)}</span>
                    </div>
                  ))}
                  {r.metrics?.estimatedWorstLossFromInitialPct && (
                    <div className="xsmall muted mt-4">
                      הפסד מוערך בתרחיש הגרוע ({t(r.metrics.worstScenario)}): {pct(r.metrics.estimatedWorstLossFromInitialPct, 1)} מההון
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Step>

      <Step n={ai ? 5 : 4} title="פקודות וביצוע" i={5}>
        {orders.length === 0 ? (
          <Empty text="לא נשלחו פקודות." />
        ) : (
          <div className="list">
            {orders.map((o: any) => (
              <div key={o.id} className="list-row">
                <div className="list-main">
                  <div className="row between nowrap">
                    <span className="list-title">
                      {t(o.side)} <span className="ltr">{o.symbol}</span> · <span className="num">{num(o.qty, 6)}</span> · {o.order_type === "LIMIT" ? <>לימיט <span className="num">{usd(o.limit_price)}</span></> : "שוק"}
                    </span>
                    <Badge value={o.status} />
                  </div>
                  <div className="xsmall muted mt-4">
                    {t(o.venue)} · <span className="ltr">{o.client_order_id}</span>
                  </div>
                  <div className="mt-8 small">
                    {(o.events ?? []).map((e: any) => (
                      <div key={e.id} className="muted">
                        {dt(e.occurred_at)} · {t(e.event_type)}
                      </div>
                    ))}
                    {(o.fills ?? []).map((f: any) => (
                      <div key={f.id}>
                        מילוי: <span className="num">{num(f.qty, 6)}</span> ב־<span className="num">{usd(f.price)}</span> (עמלה <span className="num">{usd(f.fee, 4)}</span>)
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Step>

      {forecasts.length > 0 && (
        <Step n={ai ? 6 : 5} title="תחזית מול תוצאה" i={6}>
          <RTable
            rowKey={(r: any) => r.id}
            rows={forecasts}
            columns={[
              { key: "s", label: "נייר", primary: true, render: (r: any) => <span className="ltr">{r.symbol ?? "—"}</span> },
              { key: "p", label: "מחיר בתחזית", render: (r: any) => <span className="num">{usd(r.price_at_forecast)}</span> },
              { key: "h", label: "יבשיל ב־", render: (r: any) => dt(r.due_at) },
              {
                key: "o",
                label: "תוצאה",
                render: (r: any) =>
                  r.outcome ? (
                    <span>
                      {t(r.outcome.classification)} · <span className="num">{spct(r.outcome.excess_return_pct)}</span>
                    </span>
                  ) : (
                    <span className="muted">טרם הבשילה</span>
                  ),
              },
            ]}
          />
        </Step>
      )}
    </div>
  );
}
