// End-to-end user flows through the real UI.
// Needs: server on BASE with seeded ui_demo (owner + viewer, owner 2FA *off*), server on SETUP_BASE with an empty users table.
// Run via e2e/run.sh (which resets that state) or: node e2e/flows.mjs
import fs from "node:fs";
import { BASE, SETUP_BASE, OUT, OWNER, VIEWER, SECRET_FILE, devices, launch, login, reporter, routes, settle, totp, savedSecret } from "./lib.mjs";

const R = reporter("flows");
const browser = await launch();
const device = process.env.DEVICE ? devices[process.env.DEVICE] : { viewport: { width: 1280, height: 860 } };
const newPage = async () => (await browser.newContext({ ...device, locale: "he-IL" })).newPage();

const sheet = (page) => page.locator(".sheet[role=dialog]");
async function dialog(page, fill, submit) {
  const s = sheet(page);
  await s.waitFor();
  for (const [label, value] of Object.entries(fill)) await s.getByLabel(label, { exact: true }).fill(value);
  await s.locator("button[type=submit]", { hasText: submit }).click();
  await s.waitFor({ state: "detached", timeout: 30000 });
}
async function toast(page, text) {
  try {
    await page.locator(".toast", { hasText: text }).first().waitFor({ timeout: 10000 });
    R.ok(`toast "${text}"`);
  } catch {
    const err = await sheet(page).locator(".alert").textContent().catch(() => null);
    R.fail(`toast "${text}" did not appear${err ? ` (dialog error: ${err})` : ""}`);
  }
}
const code = () => totp(savedSecret());
async function step(name, fn) {
  console.log(`\n# ${name}`);
  try {
    await fn();
  } catch (e) {
    R.fail(`${name}: ${e.message.split("\n")[0]}`);
  }
}

// ------------------------------------------------------------ first-run setup
await step("first-run setup", async () => {
  const page = await newPage();
  await page.goto(SETUP_BASE + "/");
  await page.getByRole("heading", { name: "הקמת חשבון בעלים" }).waitFor();
  R.ok("setup screen shown when no users exist");
  await page.fill("#st", "wrong-token");
  await page.fill("#em", "first@example.com");
  await page.fill("#pw", "a-very-long-password");
  await page.getByRole("button", { name: "יצירה וכניסה" }).click();
  const err = await page.locator(".alert.bad").textContent({ timeout: 5000 });
  R.check(/קוד ההקמה/.test(err ?? ""), `wrong setup token shows Hebrew error (got "${err}")`);
  await page.fill("#st", "setup-ui");
  await page.fill("#pw", "short");
  await page.getByRole("button", { name: "יצירה וכניסה" }).click();
  R.check(await page.locator("#pw").evaluate((el) => !el.validity.valid), "short password blocked by form validation");
  await page.fill("#pw", "a-very-long-password");
  await page.getByRole("button", { name: "יצירה וכניסה" }).click();
  await page.locator(".topbar h1").waitFor({ timeout: 10000 });
  R.ok("setup creates owner and signs in");
  await page.context().close();
});

// ------------------------------------------------------------ login errors + lockout
await step("wrong password + lockout", async () => {
  const page = await newPage();
  await page.goto(BASE + "/");
  await page.fill("#em", OWNER.email);
  await page.fill("#pw", "wrong-password-123");
  await page.getByRole("button", { name: "כניסה" }).click();
  const err = await page.locator(".alert.bad").textContent();
  R.check(err?.includes("פרטי הכניסה שגויים"), "wrong password message");
  const victim = `lock-${Date.now()}@example.com`;
  await page.fill("#em", victim);
  let last = "";
  for (let i = 0; i < 6; i++) {
    await page.fill("#pw", `nope-${i}`);
    await page.getByRole("button", { name: "כניסה" }).click();
    await page.waitForResponse((r) => r.url().endsWith("/api/auth/login"));
    await page.waitForTimeout(100);
    last = (await page.locator(".alert.bad").textContent()) ?? "";
  }
  R.check(last.includes("יותר מדי ניסיונות"), `lockout message after 5 failures (got "${last}")`);
  await page.context().close();
});

// ------------------------------------------------------------ owner flows
const page = await newPage();
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(String(e)));
page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && consoleErrors.push(m.text()));
await login(page, OWNER);
R.ok("owner login");
const R_ = Object.fromEntries(await routes(page));

await step("enable 2FA", async () => {
  await page.goto(BASE + "/#/settings");
  await settle(page);
  if (await page.getByText("אימות דו־שלבי פעיל").isVisible()) {
    R.check(!!savedSecret(), "2FA already on (using saved secret)");
    return;
  }
  await page.getByRole("button", { name: "הפעלת אימות דו־שלבי" }).click();
  const secret = (await page.locator("pre.code").first().textContent()).trim();
  R.check(/^[A-Z2-7]{16,}$/.test(secret), `secret shown (${secret.length} chars)`);
  fs.writeFileSync(SECRET_FILE, secret);
  await page.getByRole("button", { name: "הזנת קוד ואישור" }).click();
  // wrong code first: error stays inside the dialog
  await sheet(page).getByLabel("קוד אימות דו־שלבי").fill("000000");
  await sheet(page).locator("button[type=submit]").click();
  const e = await sheet(page).locator(".alert").textContent({ timeout: 5000 });
  R.check(/קוד/.test(e ?? ""), `wrong code shows error in dialog (got "${e}")`);
  await dialog(page, { "קוד אימות דו־שלבי": code() }, "הפעלה");
  await toast(page, "אימות דו־שלבי הופעל");
  await page.getByText("אימות דו־שלבי פעיל").waitFor({ timeout: 5000 });
  R.ok("settings shows 2FA active");
});

await step("sign live policy", async () => {
  await page.goto(BASE + "/#/live");
  await settle(page);
  const before = await page.locator("td.primary-cell", { hasText: "גרסה" }).count();
  await page.fill("#p1", "400");
  await page.fill("#p9", "e2e");
  await page.getByRole("button", { name: "המשך לחתימה" }).click();
  const desc = await sheet(page).textContent();
  R.check(desc.includes("400"), "confirmation dialog summarises the form");
  await dialog(page, { "קוד אימות דו־שלבי": code() }, "חתימה");
  await toast(page, "המדיניות נחתמה");
  await page.waitForFunction((n) => document.querySelectorAll("td.primary-cell").length > n, before, { timeout: 8000 }).catch(() => undefined);
  const after = await page.locator("td.primary-cell", { hasText: "גרסה" }).count();
  R.check(after === before + 1, `policy versions table grew (${before} -> ${after})`);
});

await step("kill switch engage + release", async () => {
  await page.goto(BASE + "/#/ops");
  await settle(page);
  await page.locator(".card").getByRole("button", { name: "עצירת חירום" }).click();
  await dialog(page, { "סיבה": "e2e test" }, "עצירה מיידית");
  await toast(page, "עצירת החירום הופעלה");
  await page.locator(".alert.bad", { hasText: "עצירת חירום פעילה" }).waitFor({ timeout: 8000 });
  R.ok("kill-switch banner visible");
  await page.goto(BASE + "/#/");
  await settle(page);
  R.check(await page.locator(".alert.bad", { hasText: "עצירת חירום פעילה" }).isVisible(), "overview shows kill-switch banner");
  R.check((await page.locator(".topbar").getByRole("button", { name: "עצירת חירום" }).count()) === 0, "top-bar kill button hidden while active");
  await page.goto(BASE + "/#/ops");
  await settle(page);
  await page.getByRole("button", { name: "שחרור עצירה" }).click();
  await dialog(page, { "סיבה": "e2e done", "קוד אימות דו־שלבי": code() }, "שחרור");
  await toast(page, "עצירת החירום שוחררה");
  await page.locator(".alert.bad", { hasText: "עצירת חירום פעילה" }).waitFor({ state: "detached", timeout: 8000 });
  R.ok("banner removed after release");
});

await step("pause / resume / new run", async () => {
  await page.goto(BASE + "/" + R_.portfolio);
  await settle(page);
  const head = page.locator(".card").first();
  if (await page.getByRole("button", { name: "חידוש" }).isVisible()) {
    await page.getByRole("button", { name: "חידוש" }).click();
    await dialog(page, { "סיבה": "reset" }, "חידוש");
  }
  await page.getByRole("button", { name: "השהיה" }).click();
  await dialog(page, { "סיבה": "e2e pause" }, "השהיה");
  await toast(page, "התיק הושהה");
  await head.locator(".badge", { hasText: "מושהה" }).waitFor({ timeout: 8000 });
  R.ok("status badge -> מושהה");
  await page.getByRole("button", { name: "חידוש" }).click();
  await dialog(page, { "סיבה": "e2e resume" }, "חידוש");
  await toast(page, "התיק חודש");
  await head.locator(".badge", { hasText: "פעיל" }).waitFor({ timeout: 8000 });
  R.ok("status badge -> פעיל");
  const oldHash = await page.evaluate(() => location.hash);
  await page.getByRole("button", { name: "ריצה חדשה" }).click();
  await dialog(page, { "סיבה": "e2e new run", "קוד אימות דו־שלבי": code() }, "פתיחת ריצה");
  await toast(page, "נפתחה ריצה חדשה");
  await page.waitForFunction((h) => location.hash !== h, oldHash, { timeout: 8000 });
  await settle(page);
  const sub = await page.locator(".topbar .sub").textContent();
  R.check(/ריצה \d+/.test(sub ?? ""), `navigated to the new run (${sub})`);
  // Segmented tab: runs list shows archived run.
  await page.getByRole("radio", { name: "ריצות" }).click();
  R.check((await page.getByText("ארכיון").count()) > 0, "runs tab lists the archived run");
});

await step("lesson add + approve", async () => {
  await page.goto(BASE + "/#/strategies");
  await settle(page);
  const text = `לקח בדיקה ${Date.now()}`;
  await page.getByRole("button", { name: "לקח חדש" }).click();
  await dialog(page, { "הלקח": text, "תגיות": "SPY, e2e" }, "שמירה");
  await toast(page, "הלקח נשמר כמועמד");
  const row = page.locator(".list-row", { hasText: text });
  await row.waitFor();
  await row.getByRole("button", { name: "אישור" }).click();
  await toast(page, "הלקח אושר");
  await row.locator(".badge").waitFor({ timeout: 8000 });
  R.ok("approved lesson shows a status badge");
});

await step("backtest", async () => {
  await page.goto(BASE + "/#/strategies");
  await settle(page);
  const card = page.locator(".card", { hasText: "הרצת בדיקה היסטורית" });
  await card.getByLabel("מתאריך").fill("2025-06-01");
  await card.getByRole("button", { name: "הרצה" }).click();
  await card.locator(".kpi").first().waitFor({ timeout: 60000 });
  R.ok("backtest KPIs rendered");
});

await step("run cycle from operations", async () => {
  await page.goto(BASE + "/#/ops");
  await settle(page);
  await page.getByRole("button", { name: "הרצת מחזור" }).click();
  await dialog(page, {}, "הרצה");
  await toast(page, "המחזור הסתיים");
});

await step("change password, logout, login with new password", async () => {
  const NEW = "another-long-password-42";
  await page.goto(BASE + "/#/settings");
  await settle(page);
  await page.getByRole("button", { name: "שינוי סיסמה" }).click();
  await dialog(page, { "סיסמה נוכחית": OWNER.password, "סיסמה חדשה": NEW }, "שמירה");
  await toast(page, "הסיסמה עודכנה");
  await page.getByRole("button", { name: "יציאה" }).click();
  await page.locator("#em").waitFor();
  R.ok("logout returns to login");
  await login(page, { ...OWNER, password: NEW });
  R.ok("login with new password + TOTP");
  await page.goto(BASE + "/#/settings");
  await settle(page);
  await page.getByRole("button", { name: "שינוי סיסמה" }).click();
  await dialog(page, { "סיסמה נוכחית": NEW, "סיסמה חדשה": OWNER.password }, "שמירה");
  await toast(page, "הסיסמה עודכנה");
});

R.check(consoleErrors.length === 0, `no JS errors on the page (${consoleErrors.slice(0, 3).join(" | ")})`);
await page.context().close();

// ------------------------------------------------------------ viewer role
await step("viewer sees no mutating buttons", async () => {
  const v = await newPage();
  await login(v, VIEWER);
  const MUTATING = /עצירת חירום|שחרור|השהיה|חידוש|ריצה חדשה|לקח חדש|אישור|הרצה|הרצת מחזור|המשך לחתימה|דריכה|פיילוט|הפעלה|סגירה|ביטול אימות|^אימות$|הפעלת אימות/;
  for (const [name, hash] of await routes(v)) {
    await v.goto(BASE + "/" + hash);
    await settle(v);
    const labels = await v.locator("button:visible").allTextContents();
    const bad = labels.map((l) => l.trim()).filter((l) => MUTATING.test(l));
    R.check(bad.length === 0, `viewer ${name}: no mutating buttons${bad.length ? " (found " + bad.join(", ") + ")" : ""}`);
  }
  await v.context().close();
});

await browser.close();
R.done();
