"use client";

import {
  createPaymentInputSchema,
  networkOptionsByCurrency,
} from "@now-payment/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowLeft,
  BadgeCheck,
  Landmark,
  LoaderCircle,
  Receipt,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";

import { useCreatePayment } from "../hooks/use-create-payment";
import { formatIlsAmount } from "../lib/utils";
import { usePaymentDraftStore } from "../store/payment-draft.store";

type PaymentFormValues = z.input<typeof createPaymentInputSchema>;

export function PaymentForm() {
  const router = useRouter();
  const { draft, setDraft } = usePaymentDraftStore();
  const createPaymentMutation = useCreatePayment();

  const {
    register,
    watch,
    handleSubmit,
    formState: { errors },
    setValue,
  } = useForm<PaymentFormValues>({
    resolver: zodResolver(createPaymentInputSchema),
    defaultValues: draft,
  });

  const selectedCurrency = watch("cryptoCurrency");
  const networkOptions = networkOptionsByCurrency[selectedCurrency];

  useEffect(() => {
    const nextNetwork = networkOptions[0];

    if (nextNetwork) {
      setValue("network", nextNetwork);
    }
  }, [networkOptions, setValue]);

  const onSubmit = handleSubmit(async (values) => {
    const payload = createPaymentInputSchema.parse(values);
    setDraft(payload);
    const payment = await createPaymentMutation.mutateAsync(payload);
    router.push(`/payment/${payment.payment_id}`);
  });

  return (
    <form
      onSubmit={onSubmit}
      className="grid gap-6 rounded-[2rem] border border-slate-200/80 bg-white/95 p-4 shadow-[0_24px_80px_-30px_rgba(15,23,42,0.28)] dark:border-slate-800 dark:bg-slate-950/90 md:p-6 lg:grid-cols-[1.45fr_0.85fr]"
    >
      <div className="space-y-5">
        <div className="flex items-center gap-3 rounded-[1.5rem] border border-slate-200/80 bg-slate-50/80 p-5 dark:border-slate-800 dark:bg-slate-900/60">
          <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300">
            <Receipt className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
              עמדת תשלום למסעדה
            </p>
            <h2 className="text-2xl font-semibold text-slate-950 dark:text-white">
              יצירת תשלום חדש
            </h2>
          </div>
        </div>

        <section className="rounded-[1.75rem] border border-slate-200/80 bg-slate-50/80 p-5 dark:border-slate-800 dark:bg-slate-900/60">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
            <Landmark className="h-4 w-4 text-emerald-500" />
            פרטי התשלום
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label='סכום לתשלום (ש"ח)' error={errors.amountILS?.message}>
              <input
                {...register("amountILS", { valueAsNumber: true })}
                type="number"
                min="1"
                step="0.01"
                className={inputClassName}
                placeholder="180"
              />
            </Field>

            <Field label="מזהה עסק" error={errors.businessId?.message}>
              <input
                {...register("businessId")}
                className={inputClassName}
                dir="ltr"
              />
            </Field>

            <Field label="מטבע" error={errors.cryptoCurrency?.message}>
              <select
                {...register("cryptoCurrency")}
                className={inputClassName}
              >
                <option value="BTC">BTC</option>
                <option value="ETH">ETH</option>
                <option value="USDT">USDT</option>
              </select>
            </Field>

            <Field label="רשת" error={errors.network?.message}>
              <select {...register("network")} className={inputClassName}>
                {networkOptions.map((network) => (
                  <option key={network} value={network}>
                    {network}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="mt-4">
            <Field
              label="תיאור / מספר שולחן"
              error={errors.description?.message}
            >
              <input
                {...register("description")}
                className={inputClassName}
                placeholder="שולחן 12"
              />
            </Field>
          </div>
        </section>

        <section className="rounded-[1.75rem] border border-slate-200/80 bg-slate-50/80 p-5 dark:border-slate-800 dark:bg-slate-900/60">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
            <UserRound className="h-4 w-4 text-emerald-500" />
            פרטי הלקוח
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="שם מלא" error={errors.customer?.fullName?.message}>
              <input
                {...register("customer.fullName")}
                className={inputClassName}
                placeholder="שם הלקוח"
              />
            </Field>

            <Field label="טלפון" error={errors.customer?.phone?.message}>
              <input
                {...register("customer.phone")}
                className={inputClassName}
                placeholder="05x-xxxxxxx"
                dir="rtr"
              />
            </Field>
          </div>

          <div className="mt-4">
            <Field label="אימייל" error={errors.customer?.email?.message}>
              <input
                {...register("customer.email")}
                type="email"
                className={inputClassName}
                placeholder="name@example.com"
                dir="rtr"
              />
            </Field>
          </div>
        </section>
      </div>

      <aside className="flex flex-col gap-4 rounded-[1.75rem] border border-slate-200/80 bg-slate-50/95 p-5 dark:border-slate-800 dark:bg-slate-900/65">
        <div className="grid gap-3">
          <SummaryRow
            label="סכום"
            value={formatIlsAmount(Number(watch("amountILS") || 0))}
          />
          <SummaryRow label="מטבע" value={watch("cryptoCurrency")} />
          <SummaryRow label="רשת" value={watch("network")} />
          <SummaryRow label="תיאור" value={watch("description") || "-"} />
        </div>

        <div className="rounded-[1.5rem] border border-slate-200/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-950/80">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 text-emerald-500" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-900 dark:text-white">
                לאחר יצירת התשלום
              </p>
              <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
                יוצג QR גדול, כתובת הארנק, וסטטוס תשלום חי עד לסיום.
              </p>
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={createPaymentMutation.isPending}
          className="mt-auto inline-flex h-14 items-center justify-center gap-2 rounded-2xl bg-slate-950 px-6 text-base font-semibold text-white transition hover:translate-y-[-1px] hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
        >
          {createPaymentMutation.isPending ? (
            <>
              <LoaderCircle className="h-5 w-5 animate-spin" />
              יוצר תשלום
            </>
          ) : (
            <>
              צור QR לתשלום
              <ArrowLeft className="h-5 w-5" />
            </>
          )}
        </button>

        {createPaymentMutation.error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200">
            לא הצלחנו ליצור תשלום. בדוק את הגדרות השרת ונסה שוב.
          </div>
        ) : null}
      </aside>
    </form>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}
      </span>
      {children}
      {error ? (
        <span className="text-sm text-rose-600 dark:text-rose-300">
          {error}
        </span>
      ) : null}
    </label>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-slate-200/70 bg-white px-4 py-3 dark:border-white/10 dark:bg-slate-950/80">
      <span>{label}</span>
      <span className="font-medium text-slate-950 dark:text-white">
        {value}
      </span>
    </div>
  );
}

function SummaryRow({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-slate-200/80 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-950/80">
      <span className="text-sm text-slate-500 dark:text-slate-400">
        {label}
      </span>
      <span className="text-sm font-semibold text-slate-950 dark:text-white">
        {value}
      </span>
    </div>
  );
}

const inputClassName =
  "h-13 rounded-2xl border border-slate-200 bg-white px-4 text-base font-medium text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/10 dark:border-slate-800 dark:bg-slate-950 dark:text-white dark:placeholder:text-slate-500";
