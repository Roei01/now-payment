export const usd = (v: unknown, dp = 2) => (v === null || v === undefined || v === "" ? "—" : `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`);
export const ils = (v: unknown, dp = 2) => (v === null || v === undefined || v === "" ? "—" : `₪${Number(v).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`);
export const pct = (v: unknown, dp = 2) => (v === null || v === undefined || v === "" ? "—" : `${(Number(v) * 100).toFixed(dp)}%`);
export const num = (v: unknown, dp = 4) => (v === null || v === undefined ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: dp }));
export const signClass = (v: unknown) => (v === null || v === undefined ? "" : Number(v) > 0 ? "good" : Number(v) < 0 ? "bad" : "");
export const dt = (v: unknown) => (v ? new Date(String(v)).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" }) : "—");
export const ago = (v: unknown) => {
  if (!v) return "—";
  const m = (Date.now() - new Date(String(v)).getTime()) / 60000;
  if (m < 1) return "עכשיו";
  if (m < 60) return `לפני ${Math.round(m)} ד׳`;
  if (m < 60 * 48) return `לפני ${Math.round(m / 60)} ש׳`;
  return `לפני ${Math.round(m / 1440)} ימים`;
};

export const STATUS_HE: Record<string, string> = {
  ACTIVE: "פעיל",
  PAUSED: "מושהה",
  DORMANT: "רדום",
  ELIGIBLE: "זכאי",
  ARMED: "דרוך",
  PILOT: "פיילוט",
  EXECUTED: "בוצע",
  PARTIAL: "חלקי",
  REJECTED: "נדחה",
  DEFERRED: "נדחה לבירור",
  NO_ACTION: "ללא פעולה",
  APPROVED: "אושר",
  PROPOSED: "הוצע",
  HOLD: "החזקה",
  BUY: "קנייה",
  SELL: "מכירה",
  REBALANCE: "איזון",
  PASS: "עבר",
  FAIL: "נכשל",
  INSUFFICIENT_DATA: "אין מספיק נתונים",
};
export const he = (s: unknown) => STATUS_HE[String(s)] ?? String(s ?? "—");
