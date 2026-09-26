import { useState } from "react";
import { api } from "../api";
import type { Me } from "../App";
import { Icon } from "../components/icons";
import { OTP_FIELD, useUI } from "../components/overlay";
import { Alert, Badge, Card, KV, LoadError, PageSkeleton, RTable, SectionHead, useApi } from "../components/ui";
import { t } from "../i18n";
import { dt } from "../format";

function TwoFactor({ me, onChange }: { me: Me; onChange: () => void }) {
  const ui = useUI();
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  if (me.totpEnabled)
    return (
      <Alert tone="info" title="אימות דו־שלבי פעיל" icon="shield">
        פעולות רגישות מאומתות בקוד מהאפליקציה.
      </Alert>
    );
  return (
    <div className="stack" style={{ gap: 12 }}>
      <Alert tone="warn" title="אימות דו־שלבי כבוי">
        פעולות רגישות (לייב, מדיניות, שחרור עצירה, סיווג נכסים, ריצה חדשה) חסומות עד ההפעלה.
      </Alert>
      {!setup ? (
        <div className="actions">
          <button className="btn primary" onClick={async () => setSetup(await api("/api/auth/totp/setup", { method: "POST", body: {} }))}>
            <Icon name="shield" /> הפעלת אימות דו־שלבי
          </button>
        </div>
      ) : (
        <>
          <p className="small">
            הוסיפו חשבון באפליקציית אימות (Google Authenticator, 1Password, Authy) באמצעות המפתח הבא, או פתחו את הקישור בטלפון:
          </p>
          <pre className="code" style={{ fontSize: 16, letterSpacing: "0.08em", textAlign: "center" }}>
            {setup.secret}
          </pre>
          <div className="actions">
            <a className="btn" href={setup.uri}>
              פתיחה באפליקציית האימות
            </a>
            <button
              className="btn primary"
              onClick={() =>
                ui.form({
                  title: "אימות והפעלה",
                  fields: [OTP_FIELD],
                  submitLabel: "הפעלה",
                  onSubmit: async (v) => {
                    await api("/api/auth/totp/enable", { method: "POST", body: { code: v.totp } });
                    ui.toast("אימות דו־שלבי הופעל");
                    onChange();
                  },
                })
              }
            >
              הזנת קוד ואישור
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Assets({ me }: { me: Me }) {
  const { data, error, reload } = useApi<any[]>("/api/assets");
  const ui = useUI();
  if (error && !data) return <LoadError error={error} retry={reload} />;
  if (!data) return <PageSkeleton />;
  const toggle = (a: any) =>
    ui.form({
      title: a.verified ? `ביטול אימות ${a.symbol}` : `אימות ${a.symbol}`,
      description: "רק נייר מאומת, פעיל, ללא מינוף, ללא חשיפה הפוכה וללא קריפטו יכול להיקנות.",
      fields: [{ name: "source", label: "מקור האימות", required: true, placeholder: "למשל קישור לדף המנפיק" }, OTP_FIELD],
      submitLabel: "שמירה",
      onSubmit: async (v) => {
        await api(`/api/assets/${a.id}`, {
          method: "PATCH",
          body: { verified: !a.verified, is_leveraged: a.is_leveraged, is_inverse: a.is_inverse, crypto_exposure: a.crypto_exposure, active: a.active, source: v.source, totp: v.totp },
        });
        ui.toast("הסיווג עודכן");
        reload();
      },
    });
  return (
    <Card title="יקום נכסים מותר" desc="סיווג המוצר הוא נתון שנבדק, לא ניחוש של מודל">
      <RTable
        rowKey={(r: any) => r.id}
        rows={data}
        columns={[
          { key: "s", label: "נייר", primary: true, render: (r: any) => <span><span className="ltr">{r.symbol}</span> <span className="muted small">· {r.name}</span></span> },
          { key: "c", label: "סוג", render: (r: any) => (r.asset_class === "ETF" ? "קרן סל" : "מניה") },
          { key: "v", label: "סטטוס", render: (r: any) => <Badge value={r.verified && r.active ? "OK" : "WARNING"} text={r.verified ? (r.active ? "מאושר" : "לא פעיל") : "לא מאומת"} /> },
          {
            key: "a",
            label: "",
            render: (r: any) =>
              me.role === "owner" && me.totpEnabled ? (
                <button className="btn sm" onClick={() => toggle(r)}>
                  {r.verified ? "ביטול אימות" : "אימות"}
                </button>
              ) : null,
          },
        ]}
      />
    </Card>
  );
}

function Audit() {
  const { data, error, reload } = useApi<any[]>("/api/audit");
  if (error && !data) return <LoadError error={error} retry={reload} />;
  if (!data) return <PageSkeleton />;
  return (
    <Card title="יומן ביקורת" desc="כל פעולה רגישה נרשמת ואינה ניתנת למחיקה">
      <RTable
        rowKey={(r: any) => String(r.id)}
        rows={data.slice(0, 50)}
        empty="אין אירועים."
        columns={[
          { key: "a", label: "פעולה", primary: true, render: (r: any) => <span className="ltr">{r.action}</span> },
          { key: "u", label: "משתמש", render: (r: any) => <span className="ltr">{r.actor}</span> },
          { key: "t", label: "זמן", render: (r: any) => dt(r.at) },
        ]}
      />
    </Card>
  );
}

export function Settings({ me, onChange }: { me: Me; onChange: () => void }) {
  const ui = useUI();
  const changePassword = () =>
    ui.form({
      title: "שינוי סיסמה",
      fields: [
        { name: "current", label: "סיסמה נוכחית", type: "password", required: true },
        { name: "next", label: "סיסמה חדשה", type: "password", required: true, help: "12 תווים לפחות" },
      ],
      submitLabel: "שמירה",
      onSubmit: async (v) => {
        if (v.next!.length < 12) throw new Error("הסיסמה החדשה קצרה מדי");
        await api("/api/auth/password", { method: "POST", body: { current: v.current, next: v.next } });
        ui.toast("הסיסמה עודכנה");
      },
    });
  return (
    <div className="stack">
      <Card title="חשבון">
        <KV
          rows={[
            ["דוא״ל", <span className="ltr">{me.email}</span>],
            ["הרשאה", me.role === "owner" ? "בעלים" : "צפייה בלבד"],
          ]}
        />
        <div className="mt-16">
          <TwoFactor me={me} onChange={onChange} />
        </div>
        <div className="actions stretch mt-16">
          <button className="btn" onClick={changePassword}>
            <Icon name="lock" /> שינוי סיסמה
          </button>
          <button
            className="btn ghost"
            onClick={async () => {
              await api("/api/auth/logout", { method: "POST", body: {} });
              location.reload();
            }}
          >
            <Icon name="logout" /> יציאה
          </button>
        </div>
      </Card>
      <SectionHead title="נכסים" />
      <Assets me={me} />
      <SectionHead title="ביקורת" />
      <Audit />
      <p className="xsmall muted" style={{ textAlign: "center" }}>
        {t("PAPER")} · תשואת עבר בתיק דמה אינה מבטיחה תוצאה בתיק אמיתי.
      </p>
    </div>
  );
}
