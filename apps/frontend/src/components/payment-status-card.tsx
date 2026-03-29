"use client";

import { CheckCircle2, Clock3, Copy, LoaderCircle, QrCode, RefreshCw, Wallet } from "lucide-react";

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
      <div className="flex min-h-[28rem] items-center justify-center rounded-[2rem] border border-slate-200/80 bg-white/95 shadow-[0_24px_80px_-30px_rgba(15,23,42,0.28)] dark:border-slate-800 dark:bg-slate-950/90">
        <div className="inline-flex items-center gap-3 text-slate-600 dark:text-slate-300">
          <LoaderCircle className="h-5 w-5 animate-spin" />
          טוען פרטי תשלום
        </div>
      </div>
    );
  }

  if (paymentQuery.isError || !paymentQuery.data) {
    return (
      <div className="rounded-[2rem] border border-rose-200 bg-rose-50 p-8 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200">
        <p className="text-lg font-semibold">לא הצלחנו לטעון את סטטוס התשלום.</p>
        <button
          type="button"
          onClick={() => paymentQuery.refetch()}
          className="mt-4 inline-flex h-12 items-center gap-2 rounded-2xl bg-slate-950 px-5 text-white dark:bg-white dark:text-slate-950"
        >
          <RefreshCw className="h-4 w-4" />
          נסה שוב
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
      ? "שולם"
      : paymentQuery.data.nowPaymentStatus === "confirming"
        ? "באישור"
        : "ממתין לתשלום";

  const completionLabel =
    paymentQuery.data.completionState === "completed"
      ? `מוכנה${paymentQuery.data.invoiceId ? ` (#${paymentQuery.data.invoiceId})` : ""}`
      : paymentQuery.data.completionState === "processing"
        ? "בהכנה"
        : paymentQuery.data.completionState === "failed"
          ? "נכשל"
          : "ממתין";

  return (
    <div className="grid gap-6 rounded-[2rem] border border-slate-200/80 bg-white/95 p-4 shadow-[0_24px_80px_-30px_rgba(15,23,42,0.28)] dark:border-slate-800 dark:bg-slate-950/90 md:p-6 lg:grid-cols-[1.02fr_0.98fr]">
      <div className="flex flex-col items-center justify-center rounded-[1.75rem] border border-slate-200/80 bg-slate-50/80 p-6 dark:border-slate-800 dark:bg-slate-900/60">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
          <QrCode className="h-4 w-4" />
          QR לתשלום
        </div>
        <div className="rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-sm shadow-slate-900/5 dark:border-slate-700">
          <img
            src={paymentQuery.data.qrCodeUrl}
            alt="קוד QR לתשלום"
            className="h-[300px] w-[300px] rounded-[1.25rem] bg-white"
          />
        </div>
        <p className="mt-5 text-center text-sm leading-6 text-slate-500 dark:text-slate-400">
          הציגו ללקוח את הקוד לסריקה. לאחר התשלום הסטטוס יתעדכן אוטומטית.
        </p>
      </div>

      <div className="flex flex-col gap-5">
        <div className="rounded-[1.75rem] border border-slate-200/80 bg-slate-50/80 p-5 dark:border-slate-800 dark:bg-slate-900/60">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400">סטטוס תשלום</p>
              <h2 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">
                {paymentQuery.data.description}
              </h2>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                לקוח: {paymentQuery.data.customer.fullName}
              </p>
            </div>
            <div
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold ${statusTone}`}
            >
              {paymentQuery.data.nowPaymentStatus === "finished" ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <Clock3 className="h-4 w-4" />
              )}
              {statusLabel}
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <MetricCard
            label="סכום בקריפטו"
            value={paymentQuery.data.payAmount.toString()}
            helper={paymentQuery.data.cryptoCurrency}
          />
          <MetricCard label="שווי בשקלים" value={formatIlsAmount(paymentQuery.data.amountILS)} helper='ש"ח' />
        </div>

        <div className="rounded-[1.75rem] border border-slate-200/80 bg-slate-50/80 p-5 dark:border-slate-800 dark:bg-slate-900/60">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
              <Wallet className="h-4 w-4 text-emerald-500" />
              כתובת ארנק
            </div>
            <p
              dir="ltr"
              className="mt-3 break-all rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left font-mono text-sm leading-7 text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
            >
              {paymentQuery.data.payAddress}
            </p>
          </div>
          <button
            type="button"
            onClick={copyAddress}
            className="mt-4 inline-flex h-12 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 transition hover:translate-y-[-1px] dark:border-slate-800 dark:bg-slate-950 dark:text-white"
          >
            <Copy className="h-4 w-4" />
            העתק כתובת
          </button>
        </div>

        <div className="grid gap-3">
          <MetaRow label="מזהה תשלום" value={truncateMiddle(paymentId, 6)} ltrValue />
          <MetaRow label="רשת" value={paymentQuery.data.network} />
          <MetaRow label="לקוח" value={paymentQuery.data.customer.fullName} />
          <MetaRow label="חשבונית" value={completionLabel} />
          <MetaRow label="מצב מערכת" value={statusLabel} />
        </div>

        <div className="rounded-[1.5rem] border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm leading-6 text-emerald-900 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-100">
          ברגע שהתשלום יאושר, המערכת תמשיך אוטומטית להפקת חשבונית ולעדכון המעקב.
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
    <div className="rounded-[1.5rem] border border-slate-200/80 bg-slate-50/80 p-5 dark:border-slate-800 dark:bg-slate-900/60">
      <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <div className="mt-3 flex items-end gap-2">
        <span className="text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">
          {value}
        </span>
        <span className="pb-1 text-sm font-medium text-slate-500 dark:text-slate-400">{helper}</span>
      </div>
    </div>
  );
}

function MetaRow({
  label,
  value,
  ltrValue = false,
}: {
  label: string;
  value: string;
  ltrValue?: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-slate-200/80 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-950/80">
      <span className="text-sm text-slate-500 dark:text-slate-400">{label}</span>
      <span
        dir={ltrValue ? "ltr" : undefined}
        className="text-sm font-semibold text-slate-950 dark:text-white"
      >
        {value}
      </span>
    </div>
  );
}
