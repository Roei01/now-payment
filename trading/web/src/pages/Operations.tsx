import { api } from "../api";
import type { Me } from "../App";
import { Icon } from "../components/icons";
import { OTP_FIELD, REASON_FIELD, useUI } from "../components/overlay";
import { Acc, Alert, Badge, Card, Empty, KV, LoadError, PageSkeleton, Progress, RTable, SectionHead, useApi } from "../components/ui";
import { t } from "../i18n";
import { ago, dt, ils } from "../format";
import { useKillSwitch } from "./Overview";

export function Operations({ me }: { me: Me }) {
  const { data, error, reload } = useApi<any>("/api/operations", { refreshMs: 30_000 });
  const overview = useApi<any>("/api/overview", { refreshMs: 30_000 });
  const ui = useUI();
  const refreshAll = () => {
    reload();
    overview.reload();
  };
  const kill = useKillSwitch(refreshAll);
  if (error && !data) return <LoadError error={error} retry={reload} />;
  if (!data) return <PageSkeleton />;
  const ks = overview.data?.system.killSwitch;
  const owner = me.role === "owner";
  const open = data.incidents.filter((i: any) => !i.resolved_at);
  const closed = data.incidents.filter((i: any) => i.resolved_at);
  const worker = data.heartbeats.find((h: any) => h.component === "worker");
  const workerAge = worker ? (Date.now() - new Date(worker.last_beat_at).getTime()) / 60000 : Infinity;

  const release = () =>
    ui.form({
      title: "שחרור עצירת החירום",
      description: "המערכת תחזור לשלוח פקודות לפי הכללים.",
      fields: [REASON_FIELD, OTP_FIELD],
      submitLabel: "שחרור",
      onSubmit: async (v) => {
        await api("/api/control/kill-switch", { method: "POST", body: { active: false, reason: v.reason, totp: v.totp } });
        ui.toast("עצירת החירום שוחררה");
        refreshAll();
      },
    });
  const runCycle = () =>
    ui.form({
      title: "הרצת מחזור עכשיו",
      description: "ירוץ מחזור החלטה מלא לכל התיקים לפי אותם כללי סיכון. אם השוק סגור, לא יישלחו פקודות.",
      submitLabel: "הרצה",
      onSubmit: async () => {
        const r = await api<any>("/api/operations/run-cycle", { method: "POST", body: {} });
        ui.toast(`המחזור הסתיים: ${r.decisions} החלטות, ${r.orders} פקודות`);
        refreshAll();
      },
    });

  return (
    <div className="stack">
      {ks?.active && (
        <Alert tone="bad" title="עצירת חירום פעילה" icon="stop">
          {ks.reason} · {dt(ks.at)}
        </Alert>
      )}

      <div className="grid cols-3">
        <Card title="מנוע הרקע" i={0} action={<Badge value={workerAge < 5 ? "OK" : "FAILED"} text={workerAge < 5 ? "פעיל" : "לא פעיל"} live={workerAge < 5} />}>
          <KV
            rows={[
              ["דיווח אחרון", ago(worker?.last_beat_at)],
              ["מחזור אחרון", data.cycles[0] ? `${ago(data.cycles[0].started_at)} · ${t(data.cycles[0].status)}` : "—"],
              ["נתוני שוק אחרונים", data.batches[0] ? `${ago(data.batches[0].ingested_at)} · ${t(data.batches[0].status)}` : "—"],
            ]}
          />
        </Card>
        <Card title="בקרה" i={1}>
          {owner ? (
            <div className="actions stretch">
              {ks?.active ? (
                <button className="btn primary" onClick={release}>
                  <Icon name="play" /> שחרור עצירה
                </button>
              ) : (
                <button className="btn danger" onClick={kill}>
                  <Icon name="stop" /> עצירת חירום
                </button>
              )}
              <button className="btn" onClick={runCycle}>
                <Icon name="refresh" /> הרצת מחזור
              </button>
            </div>
          ) : (
            <Empty text="פעולות בקרה זמינות לבעלים בלבד." icon="lock" />
          )}
        </Card>
        <Card title="עלויות החודש" i={2}>
          <div className="row between small">
            <span>סה״כ</span>
            <span className="num">
              {ils(data.budget.monthTotalIls)} / {ils(data.budget.opsCapIls, 0)}
            </span>
          </div>
          <div className="mt-8">
            <Progress value={data.budget.monthTotalIls} max={data.budget.opsCapIls} />
          </div>
          <div className="xsmall muted mt-8">
            AI {ils(data.budget.monthAiIls)} מתוך {ils(data.budget.aiBudgetIls, 0)} · שרת (הערכה) {ils(data.budget.infraEstimateIls, 0)}
          </div>
        </Card>
      </div>

      <SectionHead title="חיבורים" />
      <Card>
        <div className="list">
          {Object.entries(data.integrations).map(([k, v]) => {
            const s = String(v);
            const ok = k === "liveTradingEnabled" ? true : !/SIMULATED|STATIC|not configured|off \(|internal simulator only/.test(s);
            return (
              <div key={k} className="list-row">
                <div className="list-main">
                  <div className="list-title">{t(k)}</div>
                  <div className="list-sub ltr" style={{ textAlign: "right" }}>
                    {k === "liveTradingEnabled" ? (v ? "true" : "false") : s}
                  </div>
                </div>
                <Badge value={ok ? "OK" : "WARNING"} text={k === "liveTradingEnabled" ? (v ? "מאופשר" : "כבוי") : ok ? "תקין" : "חסר"} />
              </div>
            );
          })}
        </div>
      </Card>

      <SectionHead title="תקלות" hint={`${open.length} פתוחות`} />
      <Card>
        {open.length === 0 ? (
          <Empty text="אין תקלות פתוחות." icon="check" />
        ) : (
          <div className="list">
            {open.map((i: any) => (
              <div key={i.id} className="list-row">
                <div className="list-main">
                  <div className="row nowrap">
                    <Badge value={i.severity} />
                    <span className="list-title">{t(i.kind)}</span>
                  </div>
                  <div className="list-sub mt-4">{i.message}</div>
                  <div className="xsmall muted mt-4">{dt(i.opened_at)}</div>
                </div>
                {owner && (
                  <button
                    className="btn sm"
                    onClick={async () => {
                      await api(`/api/incidents/${i.id}/resolve`, { method: "POST", body: {} });
                      ui.toast("התקלה סומנה כסגורה");
                      reload();
                    }}
                  >
                    סגירה
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {closed.length > 0 && (
          <Acc summary={<span className="small muted">תקלות סגורות ({closed.length})</span>}>
            <div className="list">
              {closed.map((i: any) => (
                <div key={i.id} className="list-row">
                  <div className="list-main">
                    <div className="list-title">{t(i.kind)}</div>
                    <div className="list-sub">{i.message}</div>
                  </div>
                  <div className="list-meta">{dt(i.resolved_at)}</div>
                </div>
              ))}
            </div>
          </Acc>
        )}
      </Card>

      <SectionHead title="נתוני שוק" hint="גיל הנתונים" />
      <Card>
        <RTable
          rowKey={(r: any) => r.id}
          rows={data.batches.slice(0, 10)}
          empty="עוד לא נאספו נתונים."
          columns={[
            { key: "p", label: "ספק", primary: true, render: (r: any) => <span className="ltr">{`${r.provider}/${r.feed}${r.simulated ? " (sim)" : ""}`}</span> },
            { key: "a", label: "נקלט", render: (r: any) => ago(r.ingested_at) },
            { key: "s", label: "סטטוס", render: (r: any) => <Badge value={r.status} /> },
            { key: "m", label: "חסרים / ישנים", render: (r: any) => <span className="ltr xsmall">{[...(r.missing ?? []), ...(r.stale ?? [])].join(", ") || "—"}</span> },
          ]}
        />
      </Card>

      <div className="grid cols-2">
        <Card title="מחזורי החלטה">
          <RTable
            rowKey={(r: any) => r.id}
            rows={data.cycles.slice(0, 10)}
            empty="עוד לא רצו מחזורים."
            columns={[
              { key: "t", label: "זמן", primary: true, render: (r: any) => dt(r.started_at) },
              { key: "s", label: "סטטוס", render: (r: any) => <Badge value={r.status} /> },
              { key: "m", label: "שוק", render: (r: any) => (r.market_open ? "פתוח" : "סגור") },
            ]}
          />
        </Card>
        <Card title="משימות רקע">
          <RTable
            rowKey={(r: any) => r.id}
            rows={data.jobs.slice(0, 10)}
            empty="עוד לא רצו משימות."
            columns={[
              { key: "j", label: "משימה", primary: true, render: (r: any) => t(r.job) },
              { key: "t", label: "זמן", render: (r: any) => dt(r.started_at) },
              { key: "s", label: "סטטוס", render: (r: any) => <Badge value={r.status} /> },
            ]}
          />
        </Card>
      </div>

      <SectionHead title="התראות דוא״ל" />
      <Card>
        <div className="row">
          {data.notificationQueue.map((q: any) => (
            <Badge key={q.status} value={q.status} text={`${t(q.status)} · ${q.n}`} />
          ))}
        </div>
        <div className="mt-12">
          <RTable
            rowKey={(r: any) => r.id}
            rows={data.notifications.slice(0, 15)}
            empty="אין התראות."
            columns={[
              { key: "s", label: "נושא", primary: true, render: (r: any) => r.subject },
              { key: "t", label: "זמן", render: (r: any) => dt(r.created_at) },
              { key: "st", label: "סטטוס", render: (r: any) => <Badge value={r.status} /> },
            ]}
          />
        </div>
      </Card>

      <Acc summary={<span className="small muted">מודל הסיכון והנחות העלות</span>}>
        <div className="list">
          {data.riskModel.scenarios.map((s: any) => (
            <div key={s.code} className="list-row">
              <div className="list-main">
                <div className="list-title">{t(s.code)}</div>
                <div className="list-sub">{s.description}</div>
              </div>
            </div>
          ))}
        </div>
        <p className="small muted mt-8">{data.riskModel.costs.note}</p>
      </Acc>
    </div>
  );
}
