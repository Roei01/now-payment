import { useEffect, useState } from "react";
import { api, setCsrf } from "./api";
import { Login } from "./pages/Login";
import { Overview } from "./pages/Overview";
import { PortfolioDetail } from "./pages/PortfolioDetail";
import { Strategies } from "./pages/Strategies";
import { DecisionTrace, DecisionList } from "./pages/Decisions";
import { LiveControl } from "./pages/LiveControl";
import { Operations } from "./pages/Operations";
import { Settings } from "./pages/Settings";

export interface Me {
  authenticated: boolean;
  setupRequired?: boolean;
  email?: string;
  role?: "owner" | "viewer";
  totpEnabled?: boolean;
  csrf?: string;
}

function useHash() {
  const [hash, setHash] = useState(location.hash || "#/");
  useEffect(() => {
    const on = () => setHash(location.hash || "#/");
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash.slice(1);
}

const NAV = [
  { href: "#/", label: "סקירה", ico: "◎" },
  { href: "#/decisions", label: "החלטות", ico: "☰" },
  { href: "#/strategies", label: "אסטרטגיות", ico: "⚙" },
  { href: "#/live", label: "לייב", ico: "⏻" },
  { href: "#/ops", label: "תפעול", ico: "♥" },
  { href: "#/settings", label: "הגדרות", ico: "⋯" },
];

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const route = useHash();
  const refreshMe = async () => {
    const m = await api<Me>("/api/auth/me");
    if (m.csrf) setCsrf(m.csrf);
    setMe(m);
  };
  useEffect(() => {
    refreshMe().catch(() => setMe({ authenticated: false }));
  }, []);

  if (!me) return <div className="center-screen muted">טוען…</div>;
  if (!me.authenticated) return <Login setupRequired={!!me.setupRequired} onDone={refreshMe} />;

  const [, first, second] = route.split("/");
  let page;
  if (first === "portfolio" && second) page = <PortfolioDetail id={second} me={me} />;
  else if (first === "decision" && second) page = <DecisionTrace id={second} />;
  else if (first === "decisions") page = <DecisionList />;
  else if (first === "strategies") page = <Strategies me={me} />;
  else if (first === "live") page = <LiveControl me={me} />;
  else if (first === "ops") page = <Operations me={me} />;
  else if (first === "settings") page = <Settings me={me} onChange={refreshMe} />;
  else page = <Overview me={me} />;

  const active = "#/" + (first ?? "");
  return (
    <div className="app">
      <header className="topbar">
        <h1>תיקי דמה ומסחר</h1>
        <span className="muted" style={{ fontSize: 12 }}>
          {me.email}
        </span>
      </header>
      <nav className="nav" aria-label="ניווט ראשי">
        {NAV.map((n) => (
          <a key={n.href} href={n.href} className={active === n.href || (n.href === "#/" && (active === "#/" || active === "#/portfolio")) ? "active" : ""}>
            <span className="ico" aria-hidden>
              {n.ico}
            </span>
            {n.label}
          </a>
        ))}
      </nav>
      <main>{page}</main>
    </div>
  );
}
