"use client";

import {
  createPaymentInputSchema,
  networkOptionsByCurrency,
} from "@now-payment/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowLeft,
  Box,
  CheckCircle2,
  Landmark,
  LoaderCircle,
  MailCheck,
  ShieldCheck,
  Truck,
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
      className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-[0_30px_80px_-36px_rgba(15,23,42,0.22)]"
    >
      <div className="border-b border-slate-200 px-5 py-4 md:px-8">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StepItem
            icon={<UserRound className="h-4 w-4" />}
            title="שלב 1"
            label="פרטי לקוח"
            complete
          />
          <StepItem
            icon={<Landmark className="h-4 w-4" />}
            title="שלב 2"
            label="תשלום"
          />
          <StepItem
            icon={<MailCheck className="h-4 w-4" />}
            title="שלב 3"
            label="אישור"
          />
        </div>
      </div>

      <div className="grid gap-5 p-4 sm:p-5 md:p-6 xl:grid-cols-[minmax(0,1fr)_minmax(17rem,0.4fr)]">
        <div className="min-w-0 space-y-5">
          <div className="grid gap-5 lg:grid-cols-2">
            <SectionCard title="פרטי תשלום">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label='סכום לתשלום (ש"ח)'
                  error={errors.amountILS?.message}
                >
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

                <div className="sm:col-span-2">
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
              </div>
            </SectionCard>

            <SidebarCard
              title="סיכום"
              subtitle="העלות הכוללת מחושבת לפי הסכום, המטבע והרשת שנבחרו."
            >
              <SummaryRow
                label="סכום"
                value={formatIlsAmount(Number(watch("amountILS") || 0))}
              />
              <SummaryRow label="מטבע" value={watch("cryptoCurrency")} />
              <SummaryRow label="רשת" value={watch("network")} />
              <SummaryRow label="תיאור" value={watch("description") || "-"} />
              <div className="border-t border-slate-200 pt-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-emerald-600">
                    תשלום ללקוח
                  </span>
                  <span className="text-2xl font-bold text-emerald-500">
                    {formatIlsAmount(Number(watch("amountILS") || 0))}
                  </span>
                </div>
              </div>
            </SidebarCard>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <SectionCard title="פרטי לקוח">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="שם מלא"
                  error={errors.customer?.fullName?.message}
                >
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
                    dir="ltr"
                  />
                </Field>

                <div className="sm:col-span-2">
                  <Field label="אימייל" error={errors.customer?.email?.message}>
                    <input
                      {...register("customer.email")}
                      type="email"
                      className={inputClassName}
                      placeholder="name@example.com"
                      dir="ltr"
                    />
                  </Field>
                </div>
              </div>
            </SectionCard>
          </div>
        </div>

        <div className="flex min-w-0 flex-col justify-between gap-4 rounded-[1.5rem] bg-slate-50 p-4">
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium text-slate-500">המשך פעולה</p>
              <h3 className="mt-1 text-[1.35rem] font-semibold tracking-tight text-slate-950">
                מעבר למסך התשלום
              </h3>
            </div>

            <InfoCard
              icon={<ShieldCheck className="h-5 w-5 text-emerald-500" />}
              title="לאחר יצירת התשלום"
              description="יוצג QR גדול, כתובת הארנק, וסטטוס תשלום חי עד לסיום."
            />
          </div>

          <div className="space-y-3">
            <button
              type="submit"
              disabled={createPaymentMutation.isPending}
              className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-6 text-base font-semibold text-white transition hover:translate-y-[-1px] hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {createPaymentMutation.isPending ? (
                <>
                  <LoaderCircle className="h-5 w-5 animate-spin" />
                  יוצר תשלום
                </>
              ) : (
                <>
                  המשך ליצירת QR
                  <ArrowLeft className="h-5 w-5" />
                </>
              )}
            </button>

            {createPaymentMutation.error ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                לא הצלחנו ליצור תשלום. בדוק את הגדרות השרת ונסה שוב.
              </div>
            ) : null}
          </div>
        </div>
      </div>
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
    <label className="grid min-w-0 gap-1.5">
      <span className="text-[13px] font-medium text-slate-700">{label}</span>
      {children}
      <span className="min-h-[1rem] text-xs text-rose-600">{error ?? ""}</span>
    </label>
  );
}

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-[0_14px_32px_-26px_rgba(15,23,42,0.24)]">
      <h3 className="mb-4 text-[1.12rem] font-semibold tracking-tight text-slate-950">
        {title}
      </h3>
      {children}
    </section>
  );
}

function SidebarCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <aside className="min-w-0 rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
      <h3 className="text-[1.12rem] font-semibold tracking-tight text-slate-950">
        {title}
      </h3>
      <p className="mt-2 text-[13px] leading-5 text-slate-500">{subtitle}</p>
      <div className="mt-4 space-y-3">{children}</div>
    </aside>
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
    <div className="flex min-w-0 items-center justify-between gap-3 border-b border-slate-200 py-2 last:border-b-0">
      <span className="text-[13px] text-slate-500">{label}</span>
      <span className="truncate text-[13px] font-semibold text-slate-950">
        {value}
      </span>
    </div>
  );
}

function StepItem({
  icon,
  title,
  label,
  active = false,
  complete = false,
}: {
  icon: React.ReactNode;
  title: string;
  label: string;
  active?: boolean;
  complete?: boolean;
}) {
  const bubbleClass = active
    ? "bg-emerald-500 text-white"
    : complete
      ? "bg-emerald-100 text-emerald-700"
      : "bg-slate-100 text-slate-400";

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <div
        className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${bubbleClass}`}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">
          {title}
        </p>
        <p className="truncate text-[13px] font-semibold text-slate-900">
          {label}
        </p>
      </div>
    </div>
  );
}

function InfoCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="min-w-0 rounded-[1.25rem] border border-slate-200 bg-white p-4">
      <div className="flex min-w-0 items-start gap-3">
        <div className="rounded-2xl bg-slate-50 p-3">{icon}</div>
        <div className="min-w-0 space-y-1">
          <p className="text-[13px] font-semibold text-slate-900">{title}</p>
          <p className="text-[13px] leading-5 text-slate-500">{description}</p>
        </div>
      </div>
    </div>
  );
}

const inputClassName =
  "h-12 w-full min-w-0 rounded-[1.1rem] border border-slate-200 bg-white px-3.5 text-[15px] font-medium text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-emerald-300 focus:ring-3 focus:ring-emerald-100";
