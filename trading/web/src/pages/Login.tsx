import { useState } from "react";
import { api, ApiError, setCsrf } from "../api";
import { Icon } from "../components/icons";

export function Login({ setupRequired, onDone }: { setupRequired: boolean; onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [needTotp, setNeedTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = setupRequired
        ? await api<{ csrf: string }>("/api/auth/setup", { method: "POST", body: { setupToken, email, password } })
        : await api<{ csrf: string }>("/api/auth/login", { method: "POST", body: { email, password, totp: totp || undefined } });
      setCsrf(r.csrf);
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.body?.needTotp) setNeedTotp(true);
      else if (err instanceof ApiError && err.status === 401) setError("פרטי הכניסה שגויים");
      else if (err instanceof ApiError && err.status === 429) setError("יותר מדי ניסיונות. נסו שוב בעוד רבע שעה.");
      else setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <form className="auth-card stack" onSubmit={submit}>
        <div>
          <img className="logo" src="/icon.svg" alt="" />
          <h1>{setupRequired ? "הקמת חשבון בעלים" : needTotp ? "אימות דו־שלבי" : "ברוכים השבים"}</h1>
          <p className="muted small mt-4">
            {setupRequired ? "הזינו את קוד ההקמה מהגדרות השרת ובחרו פרטי כניסה." : needTotp ? "הזינו את הקוד מאפליקציית האימות." : "כניסה למערכת תיקי הדמה והמסחר."}
          </p>
        </div>
        {!needTotp && (
          <>
            {setupRequired && (
              <div className="field">
                <label htmlFor="st">קוד הקמה (SETUP_TOKEN)</label>
                <input id="st" className="input ltr" value={setupToken} onChange={(e) => setSetupToken(e.target.value)} required autoComplete="off" />
              </div>
            )}
            <div className="field">
              <label htmlFor="em">דוא״ל</label>
              <input id="em" className="input ltr" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="pw">סיסמה</label>
              <input id="pw" className="input ltr" type="password" autoComplete={setupRequired ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={setupRequired ? 12 : 1} />
              {setupRequired && <div className="help">12 תווים לפחות</div>}
            </div>
          </>
        )}
        {needTotp && (
          <div className="field">
            <label htmlFor="tp">קוד אימות</label>
            <input id="tp" className="input otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, ""))} autoFocus placeholder="••••••" />
          </div>
        )}
        {error && (
          <div className="alert bad" role="alert">
            <Icon name="alert" />
            <div className="body">{error}</div>
          </div>
        )}
        <button className="btn primary block" disabled={busy || (needTotp && totp.length !== 6)}>
          {busy && <span className="spinner" />}
          {setupRequired ? "יצירה וכניסה" : needTotp ? "אימות" : "כניסה"}
        </button>
        <p className="muted xsmall" style={{ textAlign: "center" }}>
          תיקי דמה אינם כסף אמיתי. רווח בדמה אינו מבטיח רווח במסחר חי.
        </p>
      </form>
    </div>
  );
}
