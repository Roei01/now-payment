"use client";

import { CheckCircle2, Clock3, Copy, LoaderCircle, RefreshCw } from "lucide-react";

import { usePaymentStatus } from "../hooks/use-payment-status";
import { formatIlsAmount, truncateMiddle } from "../lib/utils";

export function PaymentStatusCard({ paymentId }: { paymentId: string }) {
  const paymentQuery = usePaymentStatus(paymentId);

  const copyAddress = async () => {
    if (!paymentQuery.data?.payAddress) {
      return;
    }

    await navigator.clipboard.writeText(paymentQuery.data.payAddress);
  };

  if (paymentQuery.isLoading) {
    return (
      <div className="flex min-h-[28rem] items-center justify-center rounded-[2rem] border border-white/20 bg-white/80 shadow-2xl shadow-slate-900/10 backdrop-blur dark:border-white/10 dark:bg-slate-950/75">
        <div className="inline-flex items-center gap-3 text-slate-600 dark:text-slate-300">
          <LoaderCircle className="h-5 w-5 animate-spin" />
          Loading payment
        </div>
      </div>
    );
  }

  if (paymentQuery.isError || !paymentQuery.data) {
    return (
      <div className="rounded-[2rem] border border-rose-200 bg-rose-50 p-8 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200">
        <p className="text-lg font-semibold">Unable to load payment status.</p>
        <button
          type="button"
          onClick={() => paymentQuery.refetch()}
          className="mt-4 inline-flex h-12 items-center gap-2 rounded-2xl bg-slate-950 px-5 text-white dark:bg-white dark:text-slate-950"
        >
          <RefreshCw className="h-4 w-4" />
          Retry
        </button>
      </div>
    );
  }

  const statusTone =
    paymentQuery.data.nowPaymentStatus === "finished"
      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : paymentQuery.data.nowPaymentStatus === "confirming"
        ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
        : "bg-slate-500/10 text-slate-700 dark:text-slate-300";

  const statusLabel =
    paymentQuery.data.nowPaymentStatus === "finished"
      ? "Paid"
      : paymentQuery.data.nowPaymentStatus === "confirming"
        ? "Confirming"
        : "Waiting";

  return (
    <div className="grid gap-6 rounded-[2rem] border border-white/20 bg-white/80 p-6 shadow-2xl shadow-slate-900/10 backdrop-blur dark:border-white/10 dark:bg-slate-950/75 lg:grid-cols-[1fr_1.1fr]">
      <div className="flex flex-col items-center justify-center rounded-[1.75rem] border border-slate-200/70 bg-slate-50/80 p-6 dark:border-white/10 dark:bg-white/5">
        <img
          src={paymentQuery.data.qrCodeUrl}
          alt="Payment QR code"
          className="h-[320px] w-[320px] rounded-[1.5rem] border border-white bg-white p-4 shadow-lg shadow-slate-900/5"
        />
        <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
          Ask the guest to scan and pay with the selected wallet.
        </p>
      </div>

      <div className="flex flex-col gap-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-slate-500 dark:text-slate-400">Payment status</p>
            <h2 className="text-3xl font-semibold text-slate-950 dark:text-white">
              {paymentQuery.data.description}
            </h2>
          </div>
          <div className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold ${statusTone}`}>
            {paymentQuery.data.nowPaymentStatus === "finished" ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <Clock3 className="h-4 w-4" />
            )}
            {statusLabel}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <MetricCard label="Amount due" value={paymentQuery.data.payAmount.toString()} helper={paymentQuery.data.cryptoCurrency} />
          <MetricCard label="Fiat value" value={formatIlsAmount(paymentQuery.data.amountILS)} helper="ILS" />
        </div>

        <div className="rounded-[1.5rem] border border-slate-200/70 bg-slate-50/80 p-5 dark:border-white/10 dark:bg-white/5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm text-slate-500 dark:text-slate-400">Wallet address</p>
              <p className="mt-1 break-all font-mono text-sm text-slate-950 dark:text-white">
                {paymentQuery.data.payAddress}
              </p>
            </div>
            <button
              type="button"
              onClick={copyAddress}
              className="inline-flex h-12 shrink-0 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 transition hover:translate-y-[-1px] dark:border-white/10 dark:bg-slate-950 dark:text-white"
            >
              <Copy className="h-4 w-4" />
              Copy
            </button>
          </div>
        </div>

        <div className="grid gap-3 text-sm text-slate-600 dark:text-slate-300">
          <MetaRow label="Payment ID" value={truncateMiddle(paymentId, 6)} />
          <MetaRow label="Network" value={paymentQuery.data.network} />
          <MetaRow label="Customer" value={paymentQuery.data.customer.fullName} />
          <MetaRow
            label="Completion"
            value={
              paymentQuery.data.completionState === "completed"
                ? `Invoice ready${paymentQuery.data.invoiceId ? ` (#${paymentQuery.data.invoiceId})` : ""}`
                : paymentQuery.data.completionState
            }
          />
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <div className="rounded-[1.5rem] border border-slate-200/70 bg-slate-50/80 p-5 dark:border-white/10 dark:bg-white/5">
      <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
      <div className="mt-2 flex items-end gap-2">
        <span className="text-3xl font-semibold text-slate-950 dark:text-white">{value}</span>
        <span className="pb-1 text-sm text-slate-500 dark:text-slate-400">{helper}</span>
      </div>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-slate-200/70 bg-white px-4 py-3 dark:border-white/10 dark:bg-slate-950/80">
      <span>{label}</span>
      <span className="font-medium text-slate-950 dark:text-white">{value}</span>
    </div>
  );
}
