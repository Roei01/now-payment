/** Hebrew labels for every code the API returns. Unknown codes fall back to the raw value. */
const DICT: Record<string, string> = {
  // portfolio / live status
  ACTIVE: "פעיל",
  PAUSED: "מושהה",
  ARCHIVED: "ארכיון",
  DORMANT: "רדום",
  ELIGIBLE: "זכאי",
  ARMED: "דרוך",
  PILOT: "פיילוט",
  // kinds
  PAPER: "דמה",
  LIVE: "חי",
  BENCHMARK: "מדד ייחוס",
  // decisions
  EXECUTED: "בוצע",
  PARTIAL: "בוצע חלקית",
  REJECTED: "נדחה",
  DEFERRED: "נדחה לבירור",
  NO_ACTION: "ללא פעולה",
  APPROVED: "אושר",
  PROPOSED: "הוצע",
  EXPIRED: "פג תוקף",
  HOLD: "החזקה",
  BUY: "קנייה",
  SELL: "מכירה",
  REBALANCE: "איזון",
  // gate
  PASS: "עבר",
  FAIL: "נכשל",
  INSUFFICIENT_DATA: "אין מספיק נתונים",
  // generic status
  OK: "תקין",
  FAILED: "נכשל",
  RUNNING: "רץ",
  SKIPPED: "דולג",
  SENT: "נשלח",
  PENDING: "ממתין",
  SUPPRESSED: "לא נשלח (אין ספק)",
  STALE: "ישן",
  UNVERIFIED: "לא אומת",
  ERROR: "שגיאה",
  DISABLED: "כבוי",
  INFO: "מידע",
  WARNING: "אזהרה",
  CRITICAL: "קריטי",
  // orders
  PENDING_SUBMIT: "ממתין לשליחה",
  SUBMITTED: "נשלח",
  ACCEPTED: "התקבל",
  PARTIALLY_FILLED: "בוצע חלקית",
  FILLED: "בוצע",
  CANCELED: "בוטל",
  UNKNOWN: "לא ודאי",
  MARKET: "שוק",
  LIMIT: "לימיט",
  FILL: "מילוי",
  FOUND_AT_BROKER: "נמצא אצל הברוקר",
  SUBMIT_UNCERTAIN: "תשובה לא ודאית",
  NOT_FOUND_AT_BROKER: "לא נמצא אצל הברוקר",
  CANCELED_RUN_ARCHIVED: "בוטל — ריצה לארכיון",
  // risk engine
  ALLOW: "אושר",
  RESIZE: "הוקטן",
  REJECT: "נחסם",
  BLOCKED: "חסימה תפעולית",
  ASSET_NOT_IN_REGISTRY: "נייר לא ברשימה המותרת",
  ASSET_INACTIVE: "נייר לא פעיל",
  ASSET_CLASSIFICATION_NOT_VERIFIED: "סיווג הנייר לא אומת",
  ASSET_CLASS_NOT_ALLOWED: "סוג נכס לא מותר",
  LEVERAGED_PRODUCT: "מוצר ממונף",
  INVERSE_PRODUCT: "מוצר הפוך",
  CRYPTO_EXPOSURE: "חשיפה לקריפטו",
  MARKET_NOT_ENABLED: "שוק לא מאופשר",
  NOT_IN_LIVE_ALLOWLIST: "לא ברשימת הלייב",
  ORDER_TYPE_NOT_ALLOWED: "סוג פקודה לא מותר",
  LIMIT_PRICE_REQUIRED: "חסר מחיר לימיט",
  INVALID_QTY: "כמות לא תקינה",
  MARKET_CLOSED: "השוק סגור",
  NO_QUOTE: "אין מחיר עדכני",
  STALE_QUOTE: "מחיר ישן",
  INVALID_PRICE: "מחיר לא תקין",
  STALE_DATA: "נתונים ישנים",
  AVERAGING_DOWN_BLOCKED: "מיצוע כלפי מטה חסום",
  BELOW_MIN_ORDER: "מתחת לפקודה מינימלית",
  ABOVE_MAX_ORDER: "מעל פקודה מרבית",
  FRACTIONAL_NOT_ALLOWED: "אין שברי מניות לנייר",
  SELL_EXCEEDS_HOLDINGS: "מכירה מעבר להחזקה (אין שורט)",
  INSUFFICIENT_CASH: "אין מספיק מזומן",
  POSITION_LIMIT: "חריגה ממשקל מרבי לנייר",
  SECTOR_LIMIT: "חריגה ממשקל מרבי לענף",
  LIVE_CAPITAL_CAP: "חריגה מתקרת הון הלייב",
  INSUFFICIENT_RISK_DATA: "אין מספיק היסטוריה להערכת סיכון",
  RISK_BUDGET: "חריגה מיעד הסיכון המוערך",
  // scenarios
  MARKET_CRASH: "קריסת שוק",
  RATES_SHOCK: "זעזוע ריבית",
  SINGLE_NAME: "אירוע חברה בודדת",
  CORRELATED_VOL: "ירידה מתואמת",
  COMBINED: "תרחיש משולב",
  // incidents
  DATA_FEED: "תקלת נתוני שוק",
  STALE_DATA_INCIDENT: "נתונים לא עדכניים",
  MARKET_CLOCK: "שעון מסחר לא זמין",
  JOB_FAILED: "משימה נכשלה",
  CYCLE_ERROR: "שגיאת מחזור",
  PORTFOLIO_PAUSED: "תיק הושהה",
  RECONCILIATION_MISMATCH: "פער פיוס מול הברוקר",
  OVERFILL: "מילוי חורג",
  DATA_SOURCE_CHANGED: "מקור הנתונים השתנה",
  // gate checks
  FORWARD_DAYS: "ימי מסחר בדמה",
  TRADES: "מספר עסקאות",
  REAL_DATA: "נתונים אמיתיים",
  DATA_COVERAGE: "כיסוי נתונים",
  MAX_DRAWDOWN: "ירידה מרבית מהשיא",
  LOSS_FROM_INITIAL: "הפסד מההון ההתחלתי",
  EXCESS_RETURN: "תשואה מעל המדד",
  SIGNIFICANCE_MULTIPLE_TESTING: "מובהקות (מתוקנת לריבוי ניסויים)",
  STABILITY: "יציבות בין תקופות",
  // readiness
  LIVE_FLAG: "דגל לייב בשרת",
  SIGNED_POLICY: "מדיניות חתומה",
  BROKER: "ברוקר מוגדר",
  BROKER_ACCOUNT: "חשבון ברוקר תקין",
  CASH_ACCOUNT: "חשבון מזומן (ללא אשראי)",
  CURRENCY: "מטבע החשבון",
  FUNDS: "יתרה מספקת",
  NO_FOREIGN_OPEN_ORDERS: "אין פקודות פתוחות זרות",
  NO_CRITICAL_INCIDENTS: "אין תקלות קריטיות",
  // jobs
  decision_cycle: "מחזור החלטה",
  daily: "משימות יומיות",
  // integrations
  marketData: "נתוני שוק",
  fx: "שער מטבע",
  ai: "מנהל השקעות AI",
  fundamentals: "דוחות חברות",
  paperBroker: "ברוקר דמה",
  liveBroker: "ברוקר חי",
  liveTradingEnabled: "מסחר חי מאופשר",
  email: "דוא״ל",
  worker: "מנוע רקע",
  // ledger
  INITIAL_DEPOSIT: "הפקדה התחלתית",
  FEE: "עמלה",
  DIVIDEND: "דיבידנד",
  FX_COST: "עלות המרה",
  RECONCILE_ADJUSTMENT: "תיקון פיוס",
  SPLIT: "פיצול",
  // venues
  INTERNAL_SIM: "סימולטור פנימי",
  ALPACA_PAPER: "Alpaca דמה",
  ALPACA_LIVE: "Alpaca חי",
  // forecast outcomes
  THESIS_SUPPORTED: "התזה נתמכה",
  THESIS_CONTRADICTED: "התזה נסתרה",
  MARKET_DRIVEN: "השפעת שוק",
  NO_PRICE: "אין מחיר",
  // experiments
  TESTING: "בבדיקה",
  PASSED: "עבר",
  ABANDONED: "ננטש",
  CANDIDATE: "מועמד",
  RETIRED: "הוצא משימוש",
  DEV: "פיתוח",
  TEST: "בדיקה",
  FULL: "מלא",
};

export const t = (code: unknown): string => {
  if (code === null || code === undefined || code === "") return "—";
  const s = String(code);
  return DICT[s] ?? s;
};

/** "KILL_SWITCH: reason" / "MAINTENANCE: …" style messages from the server. */
export function explain(message: string): string {
  return message
    .replace(/^KILL_SWITCH:/, "עצירת חירום:")
    .replace(/^MAINTENANCE:/, "תחזוקה:")
    .replace(/^BROKER_UNAVAILABLE:/, "ברוקר לא זמין:")
    .replace(/^BROKER_STATE_UNKNOWN/, "מצב הברוקר לא ודאי")
    .replace(/^LIVE_TRADING_ENABLED=false/, "מסחר חי כבוי בשרת")
    .replace(/^no signed live policy/, "אין מדיניות לייב חתומה");
}

export type Tone = "good" | "bad" | "warn" | "info" | "neutral";

const TONES: Record<string, Tone> = {
  ACTIVE: "good",
  EXECUTED: "good",
  FILLED: "good",
  PASS: "good",
  PASSED: "good",
  OK: "good",
  SENT: "good",
  ALLOW: "good",
  APPROVED: "info",
  THESIS_SUPPORTED: "good",
  PAUSED: "bad",
  REJECTED: "bad",
  REJECT: "bad",
  FAIL: "bad",
  FAILED: "bad",
  CRITICAL: "bad",
  ERROR: "bad",
  UNKNOWN: "bad",
  THESIS_CONTRADICTED: "bad",
  WARNING: "warn",
  DEFERRED: "warn",
  PARTIAL: "warn",
  PARTIALLY_FILLED: "warn",
  RESIZE: "warn",
  ARMED: "warn",
  PILOT: "warn",
  SUPPRESSED: "warn",
  INSUFFICIENT_DATA: "warn",
  PENDING: "info",
  ACCEPTED: "info",
  SUBMITTED: "info",
  ELIGIBLE: "info",
  TESTING: "info",
  CANDIDATE: "info",
};

export const tone = (code: unknown): Tone => TONES[String(code)] ?? "neutral";

/** Hebrew text for API error messages (server errors are English codes/phrases). Unknown messages pass through. */
const API_ERRORS: [RegExp, string][] = [
  [/^invalid setup token$/, "קוד ההקמה שגוי"],
  [/^already set up$/, "המערכת כבר הוקמה. היכנסו עם החשבון הקיים."],
  [/^invalid credentials$/, "פרטי הכניסה שגויים"],
  [/^too many failed attempts/, "יותר מדי ניסיונות. נסו שוב בעוד רבע שעה."],
  [/^not authenticated$/, "פג תוקף ההתחברות. היכנסו שוב."],
  [/^CSRF token missing or invalid$/, "פג תוקף ההתחברות. רעננו את הדף."],
  [/^owner role required$/, "הפעולה זמינה לבעלים בלבד"],
  [/^enable 2FA before performing this action$/, "יש להפעיל אימות דו־שלבי לפני פעולה זו (בהגדרות)"],
  [/^invalid 2FA code$|^invalid code$/, "קוד האימות שגוי או שפג תוקפו"],
  [/^run 2FA setup first$/, "יש להתחיל את הגדרת האימות הדו־שלבי מחדש"],
  [/^2FA already enabled$/, "אימות דו־שלבי כבר פעיל"],
  [/^a cycle is already running$/, "מחזור כבר רץ כרגע. נסו שוב בעוד רגע."],
  [/not found$/, "לא נמצא"],
  [/^invalid request$/, "הנתונים שהוזנו אינם תקינים"],
  [/^internal error$/, "שגיאת שרת. נסו שוב."],
  [/^Failed to fetch$|NetworkError|Load failed/, "אין חיבור לשרת"],
];
export function apiError(message: string): string {
  for (const [re, he] of API_ERRORS) if (re.test(message)) return he;
  return explain(message);
}
