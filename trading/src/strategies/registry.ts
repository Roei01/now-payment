import { query, maybeOne, type Db } from "../db/pool.js";
import type { Strategy, StrategyVersionRow } from "./types.js";
import { TrendRotation } from "./trend.js";
import { BenchmarkHold, DefensiveRebalance } from "./defensive.js";
import { ValueDiscountAi } from "./valueDiscount.js";

export const STRATEGIES: Record<string, Strategy> = {
  [TrendRotation.code]: TrendRotation,
  [DefensiveRebalance.code]: DefensiveRebalance,
  [ValueDiscountAi.code]: ValueDiscountAi,
  [BenchmarkHold.code]: BenchmarkHold,
};

export interface StrategySeed {
  code: string;
  name: string;
  description: string;
  version: {
    params: Record<string, unknown>;
    universe: string[];
    horizonDays: number;
    rules: Record<string, unknown>;
    requiresAi: boolean;
  };
}

export const STRATEGY_SEEDS: StrategySeed[] = [
  {
    code: "TREND_ROTATION",
    name: "מומנטום ומגמה בקרנות סל",
    description: "מחזיק את 2 קרנות הסל החזקות ביותר שנסחרות מעל ממוצע 200 יום; השאר באג״ח קצר/מזומן.",
    version: {
      params: { lookbackDays: 126, skipDays: 5, smaDays: 200, topN: 2, weightEach: 0.4, cashProxy: "SHY", rebalanceDays: 21, driftBand: 0.05 },
      universe: ["SPY", "QQQ", "IWM", "EFA", "VWO", "TLT", "IEF", "GLD", "SHY"],
      horizonDays: 30,
      rules: {
        entry: "מומנטום חצי שנתי (ללא השבוע האחרון) חיובי ומחיר מעל ממוצע 200 יום; שתי הקרנות החזקות ביותר",
        exit: "קרן שיוצאת משתי המובילות או יורדת מתחת לממוצע 200 יום, בבדיקת האיזון החודשית",
        sizing: "40% לכל קרן, יתרה עד 60% ב־SHY, והשאר מזומן",
        rebalance: "כל 21 ימי מסחר, או כשהסטייה עולה על 10%",
      },
      requiresAi: false,
    },
  },
  {
    code: "DEFENSIVE_REBALANCE",
    name: "תיק הגנתי עם איזון",
    description: "הקצאה קבועה: מניות רחבות, אג״ח, זהב ואג״ח קצר; איזון כשהסטייה עולה על 5%.",
    version: {
      params: { targets: { VTI: 0.4, BND: 0.35, GLD: 0.1, SHY: 0.1 }, driftBand: 0.05 },
      universe: ["VTI", "BND", "GLD", "SHY"],
      horizonDays: 90,
      rules: { allocation: "VTI ‏40%, BND ‏35%, GLD ‏10%, SHY ‏10%, מזומן 5%", rebalance: "כשמשקל כלשהו סוטה ביותר מ־5 נקודות אחוז" },
      requiresAi: false,
    },
  },
  {
    code: "VALUE_DISCOUNT_AI",
    name: "קנייה מתחת לשווי מוערך (מנהל AI)",
    description:
      "סינון בקוד של מניות שירדו ביחס לשיא השנתי, ואז מנהל AI מעריך טווח שווי עם מקורות. קנייה רק במרווח ביטחון מול השווי הבסיסי; ירידת מחיר לבדה אינה אות.",
    version: {
      params: { minDiscountFromHigh: 0.15, maxCandidatesPerCycle: 1, reviewEveryDays: 7, maxPositions: 4, marginOfSafety: 0.2, maxWeightPerPosition: 0.2 },
      universe: ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "JNJ", "PG", "KO", "JPM", "XOM"],
      horizonDays: 180,
      rules: {
        screen: "מחיר נמוך ב־15% לפחות מהשיא השנתי — מועמדת לבדיקה בלבד, לא אות קנייה",
        entry: "הערכת שווי של מנהל ה־AI עם מקורות; מחיר לימיט עד שווי הבסיס פחות 20% ולא מעל מחיר הקנייה המרבי",
        exit: "מחיר בקצה העליון של טווח השווי, שבירת התזה, או דרישת מדיניות הסיכון",
        sizing: "חשיפת היעד של המודל, עד 20% לנייר; מנוע הסיכון רשאי להקטין",
        noData: "חסר מידע מהותי ← ההחלטה נדחית (החזקה)",
      },
      requiresAi: true,
    },
  },
  {
    code: "BENCHMARK_HOLD",
    name: "מדד ייחוס פסיבי (SPY)",
    description: "קנה והחזק SPY להשוואה בלבד. אינו מועמד לקידום.",
    version: { params: { symbol: "SPY", weight: 0.99 }, universe: ["SPY"], horizonDays: 365, rules: { hold: "קנייה חד־פעמית והחזקה" }, requiresAi: false },
  },
];

export async function seedStrategies(db: Db): Promise<void> {
  for (const s of STRATEGY_SEEDS) {
    const st = await maybeOne<{ id: string }>(
      db,
      `INSERT INTO strategies (code, name, description) VALUES ($1, $2, $3)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [s.code, s.name, s.description],
    );
    await query(
      db,
      `INSERT INTO strategy_versions (strategy_id, version, params, universe, horizon_days, rules, requires_ai, change_reason, created_by)
       VALUES ($1, 1, $2, $3, $4, $5, $6, 'גרסה ראשונה', 'seed') ON CONFLICT (strategy_id, version) DO NOTHING`,
      [st!.id, JSON.stringify(s.version.params), s.version.universe, s.version.horizonDays, JSON.stringify(s.version.rules), s.version.requiresAi],
    );
  }
}

const VERSION_SELECT = `SELECT v.*, s.code, s.name FROM strategy_versions v JOIN strategies s ON s.id = v.strategy_id`;

export async function activeStrategyVersion(db: Db, portfolioId: string): Promise<StrategyVersionRow | undefined> {
  return maybeOne<StrategyVersionRow>(
    db,
    `${VERSION_SELECT} JOIN strategy_assignments sa ON sa.strategy_version_id = v.id
      WHERE sa.portfolio_id = $1 AND sa.unassigned_at IS NULL`,
    [portfolioId],
  );
}

export async function getStrategyVersion(db: Db, id: string): Promise<StrategyVersionRow> {
  const row = await maybeOne<StrategyVersionRow>(db, `${VERSION_SELECT} WHERE v.id = $1`, [id]);
  if (!row) throw new Error(`strategy version ${id} not found`);
  return row;
}

export async function latestVersion(db: Db, code: string): Promise<StrategyVersionRow | undefined> {
  return maybeOne<StrategyVersionRow>(db, `${VERSION_SELECT} WHERE s.code = $1 ORDER BY v.version DESC LIMIT 1`, [code]);
}

/** New immutable version; the parent is never overwritten. */
export async function createStrategyVersion(
  db: Db,
  args: { code: string; params: Record<string, unknown>; universe?: string[]; horizonDays?: number; rules?: Record<string, unknown>; reason: string; supportingData?: Record<string, unknown>; by: string },
): Promise<StrategyVersionRow> {
  const parent = await latestVersion(db, args.code);
  if (!parent) throw new Error(`unknown strategy ${args.code}`);
  const row = await maybeOne<{ id: string }>(
    db,
    `INSERT INTO strategy_versions (strategy_id, version, parent_version_id, params, universe, horizon_days, rules, requires_ai, change_reason, supporting_data, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [
      parent.strategy_id,
      parent.version + 1,
      parent.id,
      JSON.stringify({ ...parent.params, ...args.params }),
      args.universe ?? parent.universe,
      args.horizonDays ?? parent.horizon_days,
      JSON.stringify(args.rules ?? parent.rules),
      parent.requires_ai,
      args.reason,
      JSON.stringify(args.supportingData ?? {}),
      args.by,
    ],
  );
  return getStrategyVersion(db, row!.id);
}

/** Switches the active strategy of a portfolio. Capital and history are kept (no reset). */
export async function assignStrategy(db: Db, portfolioId: string, strategyVersionId: string, reason: string, by: string): Promise<void> {
  await query(db, "UPDATE strategy_assignments SET unassigned_at = now() WHERE portfolio_id = $1 AND unassigned_at IS NULL", [portfolioId]);
  await query(db, "INSERT INTO strategy_assignments (portfolio_id, strategy_version_id, reason, assigned_by) VALUES ($1, $2, $3, $4)", [
    portfolioId,
    strategyVersionId,
    reason,
    by,
  ]);
}
