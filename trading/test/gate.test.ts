import { describe, expect, it } from "vitest";
import { evaluateGate, DEFAULT_GATE } from "../src/promotion/gate.js";
import { normInv } from "../src/promotion/stats.js";

function series(days: number, daily: number, noise = 0.001, simulated = false, trades = 20) {
  const rows = [];
  const bench = new Map<string, number>();
  let v = 100;
  let b = 100;
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.UTC(2026, 0, 5) + Math.floor(i / 5) * 7 * 86_400_000 + (i % 5) * 86_400_000).toISOString().slice(0, 10);
    v *= 1 + daily + noise * Math.sin(i);
    b *= 1 + noise * Math.sin(i);
    rows.push({ date: d, value_usd: String(v), trades_cum: Math.floor((trades * i) / days), simulated_data: simulated, loss_from_initial_pct: "0" });
    bench.set(d, b);
  }
  return { rows, bench };
}

describe("promotion gate", () => {
  it("normInv is accurate", () => {
    expect(normInv(0.975)).toBeCloseTo(1.959964, 5);
    expect(normInv(0.05)).toBeCloseTo(-1.644854, 5);
  });
  it("needs enough forward days", () => {
    const { rows, bench } = series(30, 0.001);
    expect(evaluateGate(rows, bench, 1).decision).toBe("INSUFFICIENT_DATA");
  });
  it("passes a strong, stable, real-data record", () => {
    const { rows, bench } = series(120, 0.002, 0.0005);
    const r = evaluateGate(rows, bench, 3);
    expect(r.decision).toBe("PASS");
  });
  it("fails on simulated data even when returns look good", () => {
    const { rows, bench } = series(120, 0.002, 0.0005, true);
    const r = evaluateGate(rows, bench, 3);
    expect(r.decision).toBe("FAIL");
    expect(r.checks.find((c) => c.code === "REAL_DATA")?.pass).toBe(false);
  });
  it("multiple-testing correction raises the bar as more candidates are tried", () => {
    const { rows, bench } = series(120, 0.0004, 0.004);
    const few = evaluateGate(rows, bench, 1).metrics.tCrit as number;
    const many = evaluateGate(rows, bench, 50).metrics.tCrit as number;
    expect(many).toBeGreaterThan(few);
    expect(DEFAULT_GATE.minForwardDays).toBe(90);
  });
  it("does not pass on profit alone when it merely matches the benchmark", () => {
    const { rows, bench } = series(120, 0, 0.001);
    expect(evaluateGate(rows, bench, 1).decision).toBe("FAIL");
  });
});
