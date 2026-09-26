import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, setCsrf } from "./api";
import { Icon, type IconName } from "./components/icons";
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

const NAV: { href: string; label: string; icon: IconName }[] = [
  { href: "#/", label: "סקירה", icon: "home" },
  { href: "#/decisions", label: "החלטות", icon: "list" },
  { href: "#/strategies", label: "אסטרטגיות", icon: "layers" },
  { href: "#/live", label: "תיק חי", icon: "power" },
  { href: "#/ops", label: "תפעול", icon: "pulse" },
  { href: "#/settings", label: "הגדרות", icon: "settings" },
];

function useHash() {
  const [hash, setHash] = useState(location.hash || "#/");
  useEffect(() => {
    const on = () => {
      setHash(location.hash || "#/");
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash.slice(1);
}

/** Lets a page set the top-bar subtitle / actions. */
const TopbarCtx = createContext<(v: { sub?: ReactNode; action?: ReactNode }) => void>(() => undefined);
export const useTopbar = () => useContext(TopbarCtx);

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [extra, setExtra] = useState<{ sub?: ReactNode; action?: ReactNode }>({});
  const [scrolled, setScrolled] = useState(false);
  const route = useHash();

  const refreshMe = async () => {
    const m = await api<Me>("/api/auth/me");
    if (m.csrf) setCsrf(m.csrf);
    setMe(m);
  };
  useEffect(() => {
    refreshMe().catch(() => setMe({ authenticated: false }));
  }, []);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 4);
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  useEffect(() => setExtra({}), [route]);

  if (!me)
    return (
      <div className="center-screen">
        <span className="btn ghost" aria-busy="true">
          <span className="spinner" />
        </span>
      </div>
    );
  if (!me.authenticated) return <Login setupRequired={!!me.setupRequired} onDone={refreshMe} />;

  const [, first = "", second] = route.split("/");
  let page: ReactNode;
  let title = "סקירה";
  let back: string | undefined;
  if (first === "portfolio" && second) {
    page = <PortfolioDetail key={second} id={second} me={me} />;
    title = "תיק";
    back = "#/";
  } else if (first === "decision" && second) {
    page = <DecisionTrace key={second} id={second} />;
    title = "מעקב החלטה";
    back = "#/decisions";
  } else if (first === "decisions") {
    page = <DecisionList />;
    title = "החלטות";
  } else if (first === "strategies") {
    page = <Strategies me={me} />;
    title = "אסטרטגיות ומחקר";
  } else if (first === "live") {
    page = <LiveControl me={me} />;
    title = "תיק חי";
  } else if (first === "ops") {
    page = <Operations me={me} />;
    title = "תפעול";
  } else if (first === "settings") {
    page = <Settings me={me} onChange={refreshMe} />;
    title = "הגדרות";
  } else page = <Overview me={me} />;

  const activeHref = `#/${first === "portfolio" ? "" : first === "decision" ? "decisions" : first}`;

  return (
    <TopbarCtx.Provider value={setExtra}>
      <div className="shell">
        <aside className="sidebar" aria-label="ניווט ראשי">
          <div className="brand">
            <img src="/icon.svg" alt="" />
            <span>תיקי דמה ומסחר</span>
          </div>
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className={`side-link ${activeHref === n.href ? "active" : ""}`} aria-current={activeHref === n.href ? "page" : undefined}>
              <Icon name={n.icon} />
              {n.label}
            </a>
          ))}
          <div className="side-foot">
            {me.email}
            <br />
            {me.role === "owner" ? "בעלים" : "צפייה בלבד"} · {me.totpEnabled ? "2FA פעיל" : "2FA כבוי"}
          </div>
        </aside>
        <div className="main">
          <header className={`topbar ${scrolled ? "scrolled" : ""}`}>
            {back && (
              <a className="btn ghost icon back" href={back} aria-label="חזרה">
                <Icon name="back" />
              </a>
            )}
            <div className="topbar-title">
              <h1>{title}</h1>
              {extra.sub && <div className="sub">{extra.sub}</div>}
            </div>
            {extra.action}
          </header>
          <main className="page" key={route}>
            {page}
          </main>
        </div>
        <nav className="tabbar" aria-label="ניווט ראשי">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className={`tab ${activeHref === n.href ? "active" : ""}`} aria-current={activeHref === n.href ? "page" : undefined}>
              <Icon name={n.icon} />
              <span>{n.label}</span>
            </a>
          ))}
        </nav>
      </div>
    </TopbarCtx.Provider>
  );
}
