import { query, type Db } from "../db/pool.js";
import { enqueueNotification } from "./outbox.js";

const pct = (v: string | number | null | undefined) => (v === null || v === undefined ? "—" : `${(Number(v) * 100).toFixed(2)}%`);

/** One consolidated daily e-mail for all portfolios (deduplicated per date). */
export async function queueDailyDigest(db: Db, date: string): Promise<boolean> {
  const perf = await query<{
    code: string;
    name: string;
    kind: string;
    status: string;
    value_usd: string;
    value_ils: string;
    net_return_pct: string;
    return_ils_pct: string;
    loss_from_initial_pct: string;
    drawdown_pct: string;
    simulated_data: boolean;
  }>(
    db,
    `SELECT p.code, p.name, p.kind, p.status, pd.value_usd, pd.value_ils, pd.net_return_pct, pd.return_ils_pct, pd.loss_from_initial_pct, pd.drawdown_pct, pd.simulated_data
       FROM portfolios p LEFT JOIN performance_daily pd ON pd.portfolio_id = p.id AND pd.date = $1 ORDER BY p.kind DESC, p.code`,
    [date],
  );
  const decisions = await query<{ code: string; action: string; status: string; n: number }>(
    db,
    `SELECT p.code, d.action, d.status, COUNT(*)::int AS n FROM decisions d JOIN portfolios p ON p.id = d.portfolio_id
      WHERE d.created_at::date = $1::date GROUP BY 1, 2, 3 ORDER BY 1`,
    [date],
  );
  const incidents = await query<{ severity: string; kind: string; message: string }>(
    db,
    "SELECT severity, kind, message FROM incidents WHERE resolved_at IS NULL ORDER BY opened_at DESC LIMIT 10",
  );
  const costs = await query<{ category: string; ils: string }>(
    db,
    "SELECT category, SUM(amount_ils) AS ils FROM cost_ledger WHERE occurred_at >= date_trunc('month', now()) GROUP BY 1",
  );
  const lines: string[] = [`סיכום יומי — ${date}`, ""];
  for (const p of perf) {
    if (!p.value_usd) {
      lines.push(`${p.name} [${p.status}]: אין נתוני שווי להיום`);
      continue;
    }
    lines.push(
      `${p.name} [${p.status}]${p.simulated_data ? " (נתונים מדומים)" : ""}: $${Number(p.value_usd).toFixed(2)} / ₪${Number(p.value_ils).toFixed(2)} | תשואה $ ${pct(p.net_return_pct)} | תשואה ₪ ${pct(p.return_ils_pct)} | הפסד מההון ההתחלתי ${pct(p.loss_from_initial_pct)} | ירידה מהשיא ${pct(p.drawdown_pct)}`,
    );
  }
  lines.push("", "החלטות היום:");
  for (const d of decisions) lines.push(`  ${d.code}: ${d.action}/${d.status} × ${d.n}`);
  if (!decisions.length) lines.push("  אין");
  lines.push("", "תקלות פתוחות:");
  for (const i of incidents) lines.push(`  [${i.severity}] ${i.kind}: ${i.message}`);
  if (!incidents.length) lines.push("  אין");
  lines.push("", `עלויות החודש: ${costs.map((c) => `${c.category} ₪${Number(c.ils).toFixed(2)}`).join(", ") || "₪0"}`);
  lines.push("", "תשואת עבר בתיק דמה אינה מבטיחה תוצאה בתיק אמיתי.");
  return enqueueNotification(db, { dedupeKey: `digest:${date}`, kind: "digest.daily", subject: `סיכום יומי תיקים — ${date}`, body: lines.join("\n") });
}
