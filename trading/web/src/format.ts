const nf = (dp: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
const empty = (v: unknown) => v === null || v === undefined || v === "" || Number.isNaN(Number(v));

export const usd = (v: unknown, dp = 2) => (empty(v) ? "—" : `${Number(v) < 0 ? "-" : ""}$${nf(dp).format(Math.abs(Number(v)))}`);
export const ils = (v: unknown, dp = 2) => (empty(v) ? "—" : `${Number(v) < 0 ? "-" : ""}₪${nf(dp).format(Math.abs(Number(v)))}`);
export const pct = (v: unknown, dp = 2) => (empty(v) ? "—" : `${(Number(v) * 100).toFixed(dp)}%`);
export const spct = (v: unknown, dp = 2) => (empty(v) ? "—" : `${Number(v) > 0 ? "+" : ""}${(Number(v) * 100).toFixed(dp)}%`);
export const num = (v: unknown, dp = 4) => (empty(v) ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: dp }));
export const signClass = (v: unknown) => (empty(v) ? "" : Number(v) > 0 ? "good" : Number(v) < 0 ? "bad" : "");
export const dt = (v: unknown) => (v ? new Date(String(v)).toLocaleString("he-IL", { day: "numeric", month: "numeric", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
export const day = (v: unknown) => (v ? new Date(String(v)).toLocaleDateString("he-IL", { day: "numeric", month: "short", year: "numeric" }) : "—");
export const ago = (v: unknown) => {
  if (!v) return "—";
  const m = (Date.now() - new Date(String(v)).getTime()) / 60000;
  if (m < 1) return "עכשיו";
  if (m < 60) return `לפני ${Math.round(m)} דק׳`;
  if (m < 60 * 48) return `לפני ${Math.round(m / 60)} שע׳`;
  return `לפני ${Math.round(m / 1440)} ימים`;
};
