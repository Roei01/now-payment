"use client";

import { createPaymentInputSchema, networkOptionsByCurrency } from "@now-payment/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, Coins, LoaderCircle, Receipt, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";

import { useCreatePayment } from "../hooks/use-create-payment";
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
      className="grid gap-6 rounded-[2rem] border border-white/20 bg-white/80 p-6 shadow-2xl shadow-slate-900/10 backdrop-blur dark:border-white/10 dark:bg-slate-950/75 md:grid-cols-[1.4fr_1fr]"
    >
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-violet-500/10 p-3 text-violet-600 dark:text-violet-300">
            <Receipt className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm text-slate-500 dark:text-slate-400">Restaurant checkout</p>
            <h2 className="text-2xl font-semibold text-slate-950 dark:text-white">
              Create crypto payment
            </h2>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount (ILS)" error={errors.amountILS?.message}>
            <input
              {...register("amountILS", { valueAsNumber: true })}
              type="number"
              min="1"
              step="0.01"
              className={inputClassName}
            />
          </Field>

          <Field label="Business ID" error={errors.businessId?.message}>
            <input {...register("businessId")} className={inputClassName} />
          </Field>

          <Field label="Crypto" error={errors.cryptoCurrency?.message}>
            <select {...register("cryptoCurrency")} className={inputClassName}>
              <option value="BTC">BTC</option>
              <option value="ETH">ETH</option>
              <option value="USDT">USDT</option>
            </select>
          </Field>

          <Field label="Network" error={errors.network?.message}>
            <select {...register("network")} className={inputClassName}>
              {networkOptions.map((network) => (
                <option key={network} value={network}>
                  {network}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Description / table number" error={errors.description?.message}>
          <input {...register("description")} className={inputClassName} />
        </Field>

        <div className="grid gap-4 rounded-[1.5rem] border border-slate-200/80 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-white/5">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-white">
            <UserRound className="h-4 w-4" />
            Customer details
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" error={errors.customer?.fullName?.message}>
              <input {...register("customer.fullName")} className={inputClassName} />
            </Field>

            <Field label="Phone" error={errors.customer?.phone?.message}>
              <input {...register("customer.phone")} className={inputClassName} />
            </Field>
          </div>

          <Field label="Email" error={errors.customer?.email?.message}>
            <input {...register("customer.email")} type="email" className={inputClassName} />
          </Field>
        </div>
      </div>

      <div className="flex flex-col justify-between rounded-[1.75rem] border border-slate-200/80 bg-slate-50/80 p-5 dark:border-white/10 dark:bg-white/5">
        <div className="space-y-4">
          <div className="inline-flex w-fit items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1 text-sm font-medium text-emerald-700 dark:text-emerald-300">
            <Coins className="h-4 w-4" />
            iPad-ready cashier flow
          </div>

          <div className="space-y-2">
            <h3 className="text-xl font-semibold text-slate-950 dark:text-white">
              Built for fast table-side payments
            </h3>
            <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
              Generate a wallet-ready QR, track confirmations live, and trigger invoicing without
              leaving the payment flow.
            </p>
          </div>

          <div className="grid gap-3 text-sm text-slate-600 dark:text-slate-300">
            <InfoRow label="NOWPayments" value="Live crypto checkout" />
            <InfoRow label="GreenInvoice" value="Invoice + email" />
            <InfoRow label="Google Sheets" value="Automatic ledger sync" />
          </div>
        </div>

        <button
          type="submit"
          disabled={createPaymentMutation.isPending}
          className="mt-6 inline-flex h-14 items-center justify-center gap-2 rounded-2xl bg-slate-950 px-6 text-base font-semibold text-white transition hover:translate-y-[-1px] disabled:cursor-not-allowed disabled:opacity-70 dark:bg-white dark:text-slate-950"
        >
          {createPaymentMutation.isPending ? (
            <>
              <LoaderCircle className="h-5 w-5 animate-spin" />
              Creating payment
            </>
          ) : (
            <>
              Generate QR
              <ArrowRight className="h-5 w-5" />
            </>
          )}
        </button>

        {createPaymentMutation.error ? (
          <p className="mt-3 text-sm text-rose-600 dark:text-rose-300">
            Unable to create payment. Please check the backend configuration and try again.
          </p>
        ) : null}
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
    <label className="grid gap-2">
      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
      {children}
      {error ? <span className="text-sm text-rose-600 dark:text-rose-300">{error}</span> : null}
    </label>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-slate-200/70 bg-white px-4 py-3 dark:border-white/10 dark:bg-slate-950/80">
      <span>{label}</span>
      <span className="font-medium text-slate-950 dark:text-white">{value}</span>
    </div>
  );
}

const inputClassName =
  "h-12 rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:ring-4 focus:ring-violet-500/10 dark:border-white/10 dark:bg-slate-950 dark:text-white";
