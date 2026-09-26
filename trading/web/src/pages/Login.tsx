import { useState } from "react";
import { api, ApiError, setCsrf } from "../api";

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
      else setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center-screen" style={{ padding: 16 }}>
      <form className="card login" onSubmit={submit}>
        <h2>{setupRequired ? "הקמת משתמש בעלים" : "כניסה"}</h2>
        {setupRequired && (
          <div className="field">
            <label htmlFor="st">קוד הקמה (SETUP_TOKEN מהשרת)</label>
            <input id="st" className="ltr" value={setupToken} onChange={(e) => setSetupToken(e.target.value)} required />
          </div>
        )}
        <div className="field">
          <label htmlFor="em">דוא״ל</label>
          <input id="em" className="ltr" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="pw">סיסמה{setupRequired ? " (12 תווים לפחות)" : ""}</label>
          <input id="pw" className="ltr" type="password" autoComplete={setupRequired ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {needTotp && (
          <div className="field">
            <label htmlFor="tp">קוד אימות דו־שלבי</label>
            <input id="tp" className="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={totp} onChange={(e) => setTotp(e.target.value)} autoFocus />
          </div>
        )}
        {error && <p className="error">{error}</p>}
        <button className="btn primary" disabled={busy} style={{ width: "100%" }}>
          {setupRequired ? "יצירה וכניסה" : "כניסה"}
        </button>
        <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
          מערכת לתיקי דמה. רווח בתיק דמה אינו מוכיח שהאסטרטגיה תרוויח בתיק אמיתי.
        </p>
      </form>
    </div>
  );
}
