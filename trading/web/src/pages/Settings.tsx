import { useState } from "react";
import { api } from "../api";
import type { Me } from "../App";
import { Badge, Loading, TotpField, useApi } from "../components/ui";
import { dt } from "../format";

function TwoFactor({ me, onChange }: { me: Me; onChange: () => void }) {
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  if (me.totpEnabled) return <p className="good">אימות דו־שלבי פעיל.</p>;
  return (
    <div>
      <p className="warn">אימות דו־שלבי כבוי — פעולות רגישות (לייב, מדיניות, שחרור עצירה, סיווג נכסים) חסומות עד הפעלה.</p>
      {!setup ? (
        <button className="btn primary" onClick={async () => setSetup(await api("/api/auth/totp/setup", { method: "POST", body: {} }))}>
          הפעלת 2FA
        </button>
      ) : (
        <>
          <p style={{ fontSize: 13 }}>הוסיפו לאפליקציית אימות (Google Authenticator / 1Password וכו׳) את המפתח:</p>
          <pre className="json">{setup.secret}</pre>
          <p className="muted ltr" style={{ fontSize: 11, wordBreak: "break-all" }}>{setup.uri}</p>
          <TotpField value={code} onChange={setCode} />
          <button
            className="btn primary"
            onClick={async () => {
              try {
                await api("/api/auth/totp/enable", { method: "POST", body: { code } });
                onChange();
              } catch (e) {
                setMsg((e as Error).message);
              }
            }}
          >
            אימות והפעלה
          </button>
          {msg && <p className="error">{msg}</p>}
        </>
      )}
    </div>
  );
}

function Assets({ me }: { me: Me }) {
  const { data, error, reload } = useApi<any[]>("/api/assets");
  const [totp, setTotp] = useState("");
  if (!data) return <Loading error={error} />;
  return (
    <div className="card table-wrap">
      <h2>יקום נכסים מותר</h2>
      <p className="muted" style={{ fontSize: 12 }}>
        רק נכס מאומת, פעיל, ללא מינוף/חשיפה הפוכה/קריפטו יכול להיקנות. הסיווג הוא נתון שנבדק — לא ניחוש של מודל.
      </p>
      {me.role === "owner" && me.totpEnabled && <TotpField value={totp} onChange={setTotp} />}
      <table>
        <thead>
          <tr><th>סימול</th><th>סוג</th><th>ענף</th><th>מאומת</th><th>מקור</th><th /></tr>
        </thead>
        <tbody>
          {data.map((a) => (
            <tr key={a.id}>
              <td className="ltr">{a.symbol}</td>
              <td>{a.asset_class}</td>
              <td className="ltr" style={{ fontSize: 11 }}>{a.sector}</td>
              <td><Badge value={a.verified && a.active ? "OK" : "FAILED"} text={a.verified ? (a.active ? "מאושר" : "לא פעיל") : "לא מאומת"} /></td>
              <td className="muted" style={{ fontSize: 11 }}>{a.verified_source}</td>
              <td>
                {me.role === "owner" && me.totpEnabled && (
                  <button
                    className="btn"
                    onClick={async () => {
                      const source = prompt("מקור האימות (למשל קישור לדף המנפיק):");
                      if (!source) return;
                      try {
                        await api(`/api/assets/${a.id}`, {
                          method: "PATCH",
                          body: { verified: !a.verified, is_leveraged: a.is_leveraged, is_inverse: a.is_inverse, crypto_exposure: a.crypto_exposure, active: a.active, source, totp },
                        });
                        reload();
                      } catch (e) {
                        alert((e as Error).message);
                      }
                    }}
                  >
                    {a.verified ? "ביטול אימות" : "אימות"}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Audit() {
  const { data, error } = useApi<any[]>("/api/audit");
  if (!data) return <Loading error={error} />;
  return (
    <div className="card table-wrap">
      <h2>יומן ביקורת</h2>
      <table>
        <tbody>
          {data.map((e) => (
            <tr key={e.id}>
              <td>{dt(e.at)}</td>
              <td>{e.actor}</td>
              <td className="ltr">{e.action}</td>
              <td className="muted ltr" style={{ fontSize: 11 }}>{JSON.stringify(e.details).slice(0, 140)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Settings({ me, onChange }: { me: Me; onChange: () => void }) {
  return (
    <>
      <div className="card">
        <h2>חשבון</h2>
        <p>
          {me.email} · הרשאה: {me.role === "owner" ? "בעלים" : "צפייה בלבד"}
        </p>
        <TwoFactor me={me} onChange={onChange} />
        <div className="row" style={{ marginTop: 12 }}>
          <button
            className="btn"
            onClick={async () => {
              await api("/api/auth/logout", { method: "POST", body: {} });
              location.reload();
            }}
          >
            יציאה
          </button>
        </div>
      </div>
      <div style={{ height: 12 }} />
      <Assets me={me} />
      <div style={{ height: 12 }} />
      <Audit />
    </>
  );
}
