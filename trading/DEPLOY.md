# העלאה ל־Render: רשימת צעדים

## 1. חשבונות ומפתחות שצריך להכין מראש

| # | מה | איפה | חובה? | ישמש כ־ |
|---|---|---|---|---|
| 1 | חשבון GitHub עם ה־repo והענף הזה (ממוזג ל־main או נבחר ב־Blueprint) | github.com | חובה | — |
| 2 | חשבון Render עם כרטיס אשראי. שירות Starter אחד בכ־7$ לחודש (השירות החינמי נרדם כשאין תנועה, ואז המחזורים לא רצים) | render.com | חובה | — |
| 2א | Postgres חיצוני קבוע, למשל Neon או Supabase במסלול החינמי. יוצרים פרויקט ומעתיקים את ה־connection string | neon.tech / supabase.com | חובה | `DATABASE_URL` |
| 3 | מפתחות Alpaca **Paper**: Key ID ו־Secret | alpaca.markets ← Paper ← API Keys | חובה | `MARKET_DATA_API_KEY`, `MARKET_DATA_API_SECRET` |
| 4 | מפתח API של ספק AI אחד לבחירתכם (ראו סעיף 4) | console.anthropic.com / platform.openai.com / openrouter.ai … | מומלץ (בלעדיו תיק 3 רק מחזיק) | `AI_API_KEY` |
| 5 | שורת זיהוי ל־SEC: `YourName your@email.com` | לא צריך הרשמה | מומלץ (נדרש לתיק 3) | `SEC_EDGAR_USER_AGENT` |
| 6 | חשבון Resend ומפתח API | resend.com ← API Keys | מומלץ (בלעדיו אין מייל, ההתראות מוצגות באתר) | `NOTIFICATIONS_API_KEY` |
| 7 | כתובת שולח וכתובת נמען | Resend: בלי דומיין מאומת אפשר לשלוח מ־`onboarding@resend.dev` רק לכתובת של בעל החשבון. עם דומיין אפשר מכל כתובת בו | עם 6 | `ALERT_EMAIL_FROM`, `ALERT_EMAIL_TO` |
| 8 | סיסמה אקראית חד־פעמית ליצירת המשתמש הראשון | אתם ממציאים | חובה | `SETUP_TOKEN` |

`APP_SECRET` נוצר אוטומטית על ידי Render ואין צורך להזין אותו.

## 2. יצירת השירותים

1. Render Dashboard ← **New** ← **Blueprint** ← בוחרים את ה־repo `now-payment` ואת הענף.
2. Render קורא את `render.yaml` ויוצר שירות אחד בשם `trading-web`. השירות מריץ את האתר, את ה־API ואת מחזורי המסחר (`RUN_WORKER_IN_WEB=true`).
3. Render מבקש את ערכי ה־`sync: false`. **חשוב במיוחד:** ‏`DATABASE_URL` הוא ה־connection string של Neon או Supabase. השאר:
   - `MARKET_DATA_API_KEY`, `MARKET_DATA_API_SECRET`
   - `AI_API_KEY`
   - `SEC_EDGAR_USER_AGENT`
   - `NOTIFICATIONS_API_KEY`, `ALERT_EMAIL_TO`, `ALERT_EMAIL_FROM`
   - `SETUP_TOKEN`

   ערך שעוד אין לכם אפשר להשאיר ריק ולהוסיף אחר כך. חוץ ממפתחות Alpaca, שבלעדיהם השרת לא יעלה בכוונה, כי בפרודקשן אסור לו לרוץ על מחירים מדומים.
4. **Apply**. ה־build מריץ את `npm ci` ו־`npm run build`, ובעלייה השרת מריץ את המיגרציות ויוצר את התיקים.

## 3. כניסה ראשונה

1. פותחים את כתובת `trading-web` (בערך `https://trading-web.onrender.com`).
2. מזינים את `SETUP_TOKEN`, מייל וסיסמה (12 תווים לפחות). כך נוצר משתמש הבעלים.
3. **הגדרות ← הפעלת 2FA** בעזרת אפליקציית אימות. בלי 2FA פעולות רגישות חסומות.
4. אחרי ההקמה כדאי למחוק את `SETUP_TOKEN` מ־Render, או לשנות אותו לערך אחר. הקמה נוספת כבר חסומה בכל מקרה.
5. בנייד: פותחים את הכתובת בדפדפן ובוחרים "הוסף למסך הבית".
6. **מסך תפעול ← חיבורים**: שם רואים מה מחובר. `marketData` צריך להראות `alpaca (iex)`, ו־`ai` צריך להראות את הספק והמודל.

המחזורים רצים בשעות המסחר בארה״ב (16:30–23:00 שעון ישראל בדרך כלל), ומחזור נוסף רץ אחרי הסגירה. אפשר גם ללחוץ "הרצת מחזור עכשיו" במסך תפעול.

## 4. בחירת ספק AI (אפשר להחליף בכל רגע בלי שינוי קוד)

ב־Env Group ‏`trading-settings` משנים את `AI_PROVIDER` ואת `AI_MANAGER_MODEL`, ומזינים `AI_API_KEY` של אותו ספק:

| ספק | `AI_PROVIDER` | `AI_MANAGER_MODEL` (דוגמה, בדקו את השם העדכני אצל הספק) |
|---|---|---|
| Anthropic Claude | `anthropic` | `claude-opus-5` |
| OpenAI | `openai` | מזהה מודל של OpenAI |
| Meta Llama ורבים אחרים דרך OpenRouter | `openrouter` | `meta-llama/…`, וגם `openai/…`, `google/…`, `mistralai/…` |
| Meta Llama דרך Together / Groq | `together` / `groq` | מזהה מודל Llama אצל הספק |
| Google Gemini | `google` | מזהה מודל Gemini |
| Mistral / DeepSeek / xAI | `mistral` / `deepseek` / `xai` | מזהה מודל של הספק |
| Llama על שרת משלכם (Ollama) | `ollama` + `AI_BASE_URL` | למשל `llama3.1` |
| כל ספק אחר עם API תואם OpenAI | `openai-compatible` + `AI_BASE_URL` | מזהה המודל |

- **עלויות**: למודלים שלא מופיעים בטבלה המובנית מגדירים `AI_PRICE_INPUT_PER_MTOK` ו־`AI_PRICE_OUTPUT_PER_MTOK` (בדולרים למיליון טוקנים). בלי זה, המערכת מחשבת כל קריאה לפי המחיר הגבוה ביותר, כדי לא לחרוג מהתקרה של 150 ₪.
- **הוספת ספק חדש**: שורה אחת ב־`src/ai/registry.ts`. ספק שהוא לא תואם OpenAI דורש מחלקה אחת עם מתודה `structuredCall`.
- **כל ספק עובר את אותן בדיקות**: פלט JSON לפי חוזה, מקורות קיימים בלבד ומרווח ביטחון שמחושב בקוד. אם ספק מסרב או נופל, ההחלטה נדחית.

## 5. עלות חודשית משוערת (תבדקו את המחירים העדכניים ב־Render)

- Render: שירות Starter אחד, בערך 7$ לחודש, כלומר כ־26 ₪. זה הערך שהוגדר ב־`INFRA_MONTHLY_ESTIMATE_ILS`. כדאי לבדוק את המחיר העדכני.
- Postgres ב־Neon או Supabase במסלול החינמי: 0 ₪. יש מגבלות נפח, אבל הן מספיקות בהרבה לפרויקט כזה. כדאי לבדוק את התנאים העדכניים. אם תעדיפו הכול ב־Render, ה־Postgres שלהם בתשלום עולה בערך 6$ לחודש. ה־Postgres החינמי של Render, לפי מה שאני יודע, נמחק אחרי כ־30 יום ולכן לא מתאים.
- הגדלה בעתיד: מוסיפים שירות worker נפרד (`npm run start:worker`) ומשנים `RUN_WORKER_IN_WEB=false`. אין צורך לשנות קוד.
- AI: תקרה של 60 ₪ (`AI_MONTHLY_BUDGET_ILS`). המערכת עוצרת קריאות חדשות לפני חריגה.
- Alpaca IEX, שער המטבע, SEC ו־Resend (בנפח קטן): 0 ₪.

## 6. לייב, בעתיד (לא נדרש עכשיו)

- מזינים `BROKER_LIVE_KEY` ו־`BROKER_LIVE_SECRET` (חשבון Alpaca Live מאומת) ומשנים `LIVE_TRADING_ENABLED=true`.
- את השאר עושים באתר: חתימה על מדיניות, בדיקת מוכנות והפעלת פיילוט, כל שלב עם 2FA. עדיין לא נבדק אם תושב ישראל יכול לפתוח חשבון Live ב־Alpaca.
