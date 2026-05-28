const embedCode = `<script
  src="https://your-payment-domain.com/embed/pay-button.js"
  data-amount-ils="180"
  data-business-id="default"
  data-description="Order #12345"
  data-full-name="Customer Name"
  data-phone="0500000000"
  data-email="customer@example.com"
  data-currency="USDC"
  data-network="ERC20"
  data-label="Pay with Crypto"
  data-size="lg"
  data-full-width="false"
  data-target="_blank"
></script>`;

export function EmbedButtonShowcase() {
  return (
    <section className="mt-5 overflow-hidden rounded-[2rem] border border-slate-200 bg-slate-950 text-white shadow-[0_30px_80px_-36px_rgba(15,23,42,0.38)]">
      <div className="grid gap-5 p-5 md:grid-cols-[0.85fr_1.15fr] md:p-6">
        <div className="flex flex-col justify-between gap-5">
          <div>
            <p className="text-sm font-semibold text-emerald-300">
              התקנה באתרים חיצוניים
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">
              כפתור Pay with Crypto מוכן להטמעה
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              מוסיפים סקריפט אחד באתר חיצוני, והכפתור פותח את עמוד התשלום שלך
              עם סכום, מזהה עסק, פרטי לקוח, תיאור עסקה ומטבע מוכנים מראש.
              אפשר לשלוט בגודל עם <span dir="ltr">data-size</span> וברוחב עם{" "}
              <span dir="ltr">data-full-width</span>.
            </p>
          </div>

          <div className="inline-flex w-fit items-center gap-2 rounded-full bg-gradient-to-l from-emerald-500 to-emerald-600 px-5 py-3 text-sm font-bold text-white shadow-[0_18px_38px_rgba(16,185,129,0.28)]">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/20 text-base">
              ₿
            </span>
            Pay with Crypto
          </div>
        </div>

        <div className="min-w-0 rounded-[1.4rem] border border-white/10 bg-white/[0.06] p-4">
          <p className="mb-3 text-sm font-semibold text-slate-200">
            דוגמת הטמעה
          </p>
          <pre
            dir="ltr"
            className="overflow-x-auto whitespace-pre-wrap rounded-[1rem] bg-slate-900 p-4 text-left text-xs leading-5 text-emerald-100"
          >
            <code>{embedCode}</code>
          </pre>
        </div>
      </div>
    </section>
  );
}
