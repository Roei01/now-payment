const embedCode = `<script
  src="https://your-payment-domain.com/embed/pay-button.js"
  data-amount-ils="180"
  data-business-id="default"
  data-description="Order #12345"
  data-full-name="Customer Name"
  data-phone="05X-XXX-XXXX"
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
    <section className="mt-5 overflow-hidden rounded-[1.5rem] border border-slate-200 bg-slate-950 text-white shadow-[0_30px_80px_-36px_rgba(15,23,42,0.38)] sm:rounded-[2rem]">
      <div className="flex flex-col gap-5 p-4 sm:p-6">
        <div>
          <p className="text-xs font-semibold text-emerald-300 sm:text-sm">
            התקנה באתרים חיצוניים
          </p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl md:text-3xl">
            כפתור Pay with Crypto מוכן להטמעה
          </h2>
          <p className="mt-3 text-[13px] leading-6 text-slate-300 sm:text-sm">
            מוסיפים סקריפט אחד באתר חיצוני, והכפתור פותח את עמוד התשלום שלך עם
            סכום, מזהה עסק, פרטי לקוח, תיאור עסקה ומטבע מוכנים מראש. אפשר לשלוט
            בגודל עם <span dir="ltr">data-size</span> וברוחב עם{" "}
            <span dir="ltr">data-full-width</span>.
          </p>
        </div>

        <div className="min-w-0 rounded-[1.2rem] border border-white/10 bg-white/[0.06] p-3 sm:p-4">
          <p className="mb-3 text-[13px] font-semibold text-slate-200 sm:text-sm">
            דוגמת הטמעה
          </p>
          <pre
            dir="ltr"
            className="max-w-full overflow-hidden whitespace-pre-wrap break-all rounded-[1rem] bg-slate-900 p-3 text-left text-[10px] leading-5 text-emerald-100 sm:p-4 sm:text-[11px]"
          >
            <code>{embedCode}</code>
          </pre>
        </div>
        <div className="inline-flex w-fit items-center gap-2 rounded-full bg-gradient-to-l from-emerald-500 to-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow-[0_18px_38px_rgba(16,185,129,0.28)] sm:px-5 sm:py-3">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/20 text-base">
            ₿
          </span>
          Pay with Crypto
        </div>
      </div>
    </section>
  );
}
