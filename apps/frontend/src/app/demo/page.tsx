"use client";

import { ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";

import { EmbedButtonShowcase } from "../../components/embed-button-showcase";

type DemoFormState = {
  amountILS: string;
  businessId: string;
  description: string;
  fullName: string;
  phone: string;
  email: string;
  currency: "USDT" | "USDC" | "BTC" | "ETH";
  network: "ERC20" | "TRC20" | "BTC" | "ETH";
};

const initialState: DemoFormState = {
  amountILS: "180",
  businessId: "default",
  description: "Order #12345",
  fullName: "",
  phone: "",
  email: "",
  currency: "USDC",
  network: "ERC20",
};

export default function DemoCheckoutPage() {
  const [form, setForm] = useState<DemoFormState>(initialState);
  const paymentUrl = useMemo(() => {
    const params = new URLSearchParams();

    params.set("amountILS", form.amountILS);
    params.set("businessId", form.businessId);
    params.set("description", form.description);
    params.set("fullName", form.fullName);
    params.set("phone", form.phone);
    params.set("email", form.email);
    params.set("cryptoCurrency", form.currency);
    params.set("network", form.network);

    return `/?${params.toString()}`;
  }, [form]);

  const updateField =
    <TKey extends keyof DemoFormState>(key: TKey) =>
    (value: DemoFormState[TKey]) => {
      setForm((current) => ({ ...current, [key]: value }));
    };

  return (
    <main className="min-h-screen bg-white px-4 py-6 text-slate-950 md:px-6 md:py-10">
      <div className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[0.92fr_1.08fr]">
        <EmbedButtonShowcase />

        <section className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-[0_24px_60px_-34px_rgba(15,23,42,0.2)] md:p-6">
          <div className="mb-5">
            <p className="text-sm font-semibold text-emerald-600">
              Checkout form
            </p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">
              פרטי תשלום רגילים
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              מלא פרטים כאן ולחץ על הכפתור. אם חלק מהשדות ריקים, עמוד התשלום
              ייפתח ועדיין יהיה אפשר להשלים אותם שם.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <DemoField label='סכום לתשלום (ש"ח)'>
              <input
                value={form.amountILS}
                onChange={(event) =>
                  updateField("amountILS")(event.target.value)
                }
                type="number"
                min="1"
                step="0.01"
                className={inputClassName}
              />
            </DemoField>

            <DemoField label="מזהה עסק">
              <input
                value={form.businessId}
                onChange={(event) =>
                  updateField("businessId")(event.target.value)
                }
                className={inputClassName}
                dir="ltr"
              />
            </DemoField>

            <div className="sm:col-span-2">
              <DemoField label="תיאור עסקה / מס׳ עסקה">
                <input
                  value={form.description}
                  onChange={(event) =>
                    updateField("description")(event.target.value)
                  }
                  className={inputClassName}
                  placeholder="Order #12345"
                />
              </DemoField>
            </div>

            <DemoField label="שם מלא">
              <input
                value={form.fullName}
                onChange={(event) =>
                  updateField("fullName")(event.target.value)
                }
                className={inputClassName}
                placeholder="שם הלקוח"
              />
            </DemoField>

            <DemoField label="טלפון">
              <input
                value={form.phone}
                onChange={(event) => updateField("phone")(event.target.value)}
                className={inputClassName}
                placeholder="05X-XXX-XXXX"
                dir="ltr"
              />
            </DemoField>

            <div className="sm:col-span-2">
              <DemoField label="אימייל">
                <input
                  value={form.email}
                  onChange={(event) => updateField("email")(event.target.value)}
                  type="email"
                  className={inputClassName}
                  placeholder="customer@example.com"
                  dir="ltr"
                />
              </DemoField>
            </div>

            <DemoField label="מטבע">
              <select
                value={form.currency}
                onChange={(event) =>
                  updateField("currency")(
                    event.target.value as DemoFormState["currency"],
                  )
                }
                className={inputClassName}
              >
                <option value="USDC">USDC</option>
                <option value="USDT">USDT</option>
                <option value="BTC">BTC</option>
                <option value="ETH">ETH</option>
              </select>
            </DemoField>

            <DemoField label="רשת">
              <select
                value={form.network}
                onChange={(event) =>
                  updateField("network")(
                    event.target.value as DemoFormState["network"],
                  )
                }
                className={inputClassName}
              >
                <option value="ERC20">ERC20</option>
                <option value="TRC20">TRC20</option>
                <option value="BTC">BTC</option>
                <option value="ETH">ETH</option>
              </select>
            </DemoField>
          </div>

          <div className="mt-6 rounded-[1.5rem] bg-slate-50 p-4">
            <a
              href={paymentUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-14 w-full items-center justify-center gap-3 rounded-full bg-gradient-to-l from-emerald-500 to-emerald-600 px-6 text-base font-bold text-white shadow-[0_18px_38px_rgba(16,185,129,0.28)] transition hover:translate-y-[-1px] hover:shadow-[0_22px_44px_rgba(16,185,129,0.34)]"
            >
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-lg">
                ₿
              </span>
              Pay with Crypto
            </a>
            <p className="mt-3 text-center text-xs leading-5 text-slate-500">
              הכפתור הזה מדגים את אותו רעיון כמו סקריפט ההטמעה: הוא מעביר את
              הפרטים לכתובת האתר ופותח את עמוד התשלום.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

function DemoField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[13px] font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

const inputClassName =
  "h-12 w-full min-w-0 rounded-[1.1rem] border border-slate-200 bg-white px-3.5 text-[15px] font-medium text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-emerald-300 focus:ring-3 focus:ring-emerald-100";
