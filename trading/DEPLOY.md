# העלאה לאוויר — רשימת סימון

## 1. מפתחות וחשבונות שצריך להשיג

| # | מה | מאיפה | מה מעתיקים | חובה? |
|---|---|---|---|---|
| 1 | **Alpaca Paper** (מחירי שוק אמיתיים) | alpaca.markets ← Sign Up ← **Trading API** ← בדשבורד לעבור ל־**Paper** ← **API Keys** ← Generate | Key ID + Secret Key. ה־Secret מוצג פעם אחת בלבד | **חובה** |
| 2 | **מסד נתונים Postgres** | neon.tech ← New Project, אזור **AWS US East** ← Connection string | מחרוזת שמתחילה ב־`postgresql://…?sslmode=require` | **חובה** |
| 3 | **מפתח AI** | Claude: console.anthropic.com ← API Keys (צריך להוסיף קרדיט ב־Billing). אפשר גם OpenAI / OpenRouter וכו' | המפתח | מומלץ (בלעדיו תיק 3 רק מחזיק) |
| 4 | **זיהוי ל־SEC** (דוחות חברות) | בלי הרשמה | שורה בפורמט `Roei royinagar1@gmail.com` | מומלץ (נדרש לתיק 3) |
| 5 | **Resend** (מיילים) | resend.com ← API Keys ← Create | המפתח | מומלץ |
| 6 | **כתובת שולח** | בלי דומיין: `onboarding@resend.dev`, שולח רק למייל שאיתו נרשמתם ל־Resend. עם דומיין: Domains ← Add ← אימות DNS | כתובת | עם 5 |
| 7 | **קוד הקמה** | ממציאים (למשל 24 תווים אקראיים) | — | **חובה** |
| 8 | **Render** | render.com, עם כרטיס אשראי | — | **חובה** |
| — | שער דולר/שקל (Frankfurter) | לא צריך מפתח | — | אוטומטי |
| — | Alpaca **Live** | רק בעתיד, אחרי אימות זהות. לא עכשיו | — | לא עכשיו |

## 2. יצירת השירות ב־Render

**אפשרות א' (מומלץ):** New ← **Blueprint** ← בוחרים את `Roei01/now-payment` ואת הענף. כל ההגדרות נקראות מ־`render.yaml`, ונשאר רק למלא את הסודות (סעיף 3).

**אפשרות ב' (ידני):** New ← **Web Service** ← בוחרים את ה־repo וממלאים:

| שדה ב־Render | ערך |
|---|---|
| Branch | `claude/portfolio-paper-live-trading-uf8o5u` (או `main` אחרי מיזוג) |
| **Root Directory** | `trading` |
| Language / Runtime | `Node` |
| **Build Command** | `npm ci --include=dev && npm run build` |
| **Start Command** | `npm run start:api` |
| Instance Type | **Starter** (לא Free, כי השרת החינמי נרדם והמחזורים לא ירוצו) |
| Region | **Virginia (US East)**, קרוב ל־Alpaca ול־Neon |
| **Health Check Path** (תחת Advanced) | `/api/health` |
| Auto-Deploy | On Commit |

## 3. משתני סביבה (Environment) ב־Render

| משתנה | ערך | חובה? |
|---|---|---|
| `NODE_ENV` | `production` | חובה |
| `NODE_VERSION` | `22` | חובה |
| `RUN_WORKER_IN_WEB` | `true` | חובה |
| `APP_SECRET` | 32+ תווים אקראיים (ב־Blueprint נוצר אוטומטית) | חובה |
| `DATABASE_URL` | ה־connection string מ־Neon | חובה |
| `DATABASE_SSL` | `true` | חובה |
| `SETUP_TOKEN` | קוד ההקמה שהמצאתם | חובה (עד ההקמה) |
| `MARKET_DATA_PROVIDER` | `alpaca` | חובה |
| `MARKET_DATA_API_KEY` | Key ID של Alpaca | חובה |
| `MARKET_DATA_API_SECRET` | Secret של Alpaca | חובה |
| `ALPACA_DATA_FEED` | `iex` | חובה |
| `FX_PROVIDER` | `frankfurter` | חובה |
| `AI_PROVIDER` | `anthropic` (או `openai` / `openrouter` וכו', ראו סעיף 6) | מומלץ |
| `AI_API_KEY` | מפתח ה־AI | מומלץ |
| `AI_MANAGER_MODEL` | `claude-opus-5` (או מזהה מודל של הספק שבחרתם) | מומלץ |
| `AI_MONTHLY_BUDGET_ILS` | `60` | מומלץ |
| `OPS_MONTHLY_CAP_ILS` | `150` | מומלץ |
| `INFRA_MONTHLY_ESTIMATE_ILS` | `26` | מומלץ |
| `SEC_EDGAR_USER_AGENT` | `Roei royinagar1@gmail.com` | מומלץ |
| `NOTIFICATIONS_PROVIDER` | `resend` | מומלץ |
| `NOTIFICATIONS_API_KEY` | מפתח Resend | מומלץ |
| `ALERT_EMAIL_TO` | המייל שלכם | מומלץ |
| `ALERT_EMAIL_FROM` | `onboarding@resend.dev` או כתובת בדומיין מאומת | מומלץ |
| `DIGEST_HOUR_IL` | `23` | רשות |
| `LIVE_TRADING_ENABLED` | `false` | חובה (נשאר `false` עד החלטה על לייב) |

אם חסר משתנה חובה, השרת לא יעלה ויכתוב בלוג בדיוק מה חסר. זה בכוונה, כדי שלא ירוץ בטעות על מחירים מדומים.

## 4. אחרי שהשירות עלה

| # | פעולה | איך בודקים שזה תקין |
|---|---|---|
| 1 | פותחים את כתובת השירות (`https://….onrender.com`) | מופיע מסך "הקמת חשבון בעלים" |
| 2 | מזינים `SETUP_TOKEN`, מייל וסיסמה (12+ תווים) | נכנסים לסקירה |
| 3 | הגדרות ← **הפעלת אימות דו־שלבי** | "אימות דו־שלבי פעיל" |
| 4 | תפעול ← חיבורים | נתוני שוק: `alpaca (iex)`, שער: `frankfurter`, AI: הספק והמודל, דוא״ל: מוגדר |
| 5 | ב־Render: מוחקים את `SETUP_TOKEN` או מחליפים אותו לערך אחר | — |
| 6 | בזמן מסחר בארה״ב (בדרך כלל 16:30–23:00 שעון ישראל): תפעול ← "הרצת מחזור" | החלטות וקניות ראשונות בתיקים 1, 2 ו־SPY |
| 7 | בטלפון: פותחים את הכתובת ← "הוסף למסך הבית" | אייקון אפליקציה |
| 8 | (מומלץ) ניטור חיצוני חינמי, למשל UptimeRobot, על `https://…/api/health` | התראה אם השרת נופל |
| 9 | בודקים שהגיע הסיכום היומי במייל אחרי 23:00 | מייל "סיכום יומי תיקים" |

## 5. עלות חודשית משוערת (לבדוק מחירים עדכניים)

| רכיב | עלות |
|---|---|
| Render Starter | כ־7$ (בערך 26 ₪) |
| Neon (מסלול חינמי) | 0 |
| AI | עד 60 ₪, עם עצירה אוטומטית לפני התקרה |
| Alpaca IEX, Frankfurter, SEC, Resend (נפח קטן) | 0 |

## 6. ספקי AI (מחליפים בלי קוד)

| ספק | `AI_PROVIDER` | `AI_MANAGER_MODEL` |
|---|---|---|
| Claude | `anthropic` | `claude-opus-5` |
| OpenAI | `openai` | מזהה מודל של OpenAI |
| Meta Llama, Gemini, Mistral ועוד דרך OpenRouter | `openrouter` | למשל `meta-llama/…` |
| Groq / Together / Mistral / DeepSeek / xAI / Google | שם הספק | מזהה המודל אצל הספק |
| כל API תואם OpenAI | `openai-compatible` + `AI_BASE_URL` | מזהה המודל |

למודל שאינו בטבלת המחירים המובנית מוסיפים `AI_PRICE_INPUT_PER_MTOK` ו־`AI_PRICE_OUTPUT_PER_MTOK` (בדולרים למיליון טוקנים). בלי זה המערכת מחשבת לפי המחיר המרבי, כדי לא לחרוג מהתקציב.

## 7. לייב (בעתיד)

מזינים `BROKER_LIVE_KEY` ו־`BROKER_LIVE_SECRET` ומשנים `LIVE_TRADING_ENABLED=true`. את השאר עושים באתר: חתימת מדיניות, בדיקת מוכנות והפעלת פיילוט, כל שלב עם 2FA. עדיין לא נבדק אם תושב ישראל יכול לפתוח חשבון Live ב־Alpaca.
