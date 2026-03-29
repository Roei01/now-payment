"use client";

import {
  CheckCircle2,
  Clock3,
  Copy,
  ExternalLink,
  LoaderCircle,
  QrCode,
  RefreshCw,
  Wallet,
} from "lucide-react";

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

  const copyPaymentLink = async () => {
    if (!paymentQuery.data?.paymentUrl) {
      return;
    }

    await navigator.clipboard.writeText(paymentQuery.data.paymentUrl);
  };

  if (paymentQuery.isLoading) {
    return (
      <div className="flex min-h-[24rem] items-center justify-center rounded-[1.6rem] border border-slate-200 bg-white shadow-[0_18px_48px_-28px_rgba(15,23,42,0.16)]">
        <div className="inline-flex items-center gap-3 text-slate-600">
          <LoaderCircle className="h-5 w-5 animate-spin" />
          טוען פרטי תשלום
        </div>
      </div>
    );
  }

  if (paymentQuery.isError || !paymentQuery.data) {
    return (
      <div className="rounded-[1.6rem] border border-rose-200 bg-rose-50 p-6 text-rose-700">
        <p className="text-base font-semibold">לא הצלחנו לטעון את סטטוס התשלום.</p>
        <button
          type="button"
          onClick={() => paymentQuery.refetch()}
          className="mt-4 inline-flex h-11 items-center gap-2 rounded-2xl bg-slate-900 px-5 text-white"
        >
          <RefreshCw className="h-4 w-4" />
          נסה שוב
        </button>
      </div>
    );
  }

  const statusTone =
    paymentQuery.data.nowPaymentStatus === "finished"
      ? "bg-emerald-50 text-emerald-700"
      : paymentQuery.data.nowPaymentStatus === "confirming"
        ? "bg-amber-50 text-amber-700"
        : "bg-slate-100 text-slate-700";

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
    <div className="grid gap-4 rounded-[1.7rem] border border-slate-200 bg-white p-3 shadow-[0_18px_48px_-28px_rgba(15,23,42,0.16)] md:p-4 lg:grid-cols-[0.92fr_1.08fr]">
      <div className="flex flex-col items-center justify-center rounded-[1.45rem] border border-slate-200 bg-white p-4">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
          <QrCode className="h-4 w-4" />
          QR לתשלום
        </div>
        <div className="rounded-[1.4rem] border border-slate-200 bg-white p-3 shadow-sm shadow-slate-900/5">
          <img
            src={paymentQuery.data.qrCodeUrl}
            alt="קוד QR לתשלום"
            className="h-[220px] w-[220px] rounded-[1rem] bg-white sm:h-[250px] sm:w-[250px] md:h-[270px] md:w-[270px]"
          />
        </div>
        <p className="mt-4 text-center text-[13px] leading-5 text-slate-500">
          סריקת ה-QR תפתח את עמוד התשלום ישירות. לאחר התשלום הסטטוס יתעדכן
          אוטומטית.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <div className="rounded-[1.45rem] border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-slate-500">סטטוס תשלום</p>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950 md:text-[2rem]">
                {paymentQuery.data.description}
              </h2>
              <p className="mt-1.5 text-sm text-slate-500">
                לקוח: {paymentQuery.data.customer.fullName}
              </p>
            </div>
            <div
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${statusTone}`}
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

        <div className="grid gap-3 md:grid-cols-2">
          <MetricCard
            label="סכום בקריפטו"
            value={paymentQuery.data.payAmount.toString()}
            helper={paymentQuery.data.cryptoCurrency}
          />
          <MetricCard label="שווי בשקלים" value={formatIlsAmount(paymentQuery.data.amountILS)} helper='ש"ח' />
        </div>

        <div className="rounded-[1.45rem] border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <ExternalLink className="h-4 w-4 text-emerald-500" />
            קישור לתשלום
          </div>
          <p
            dir="ltr"
            className="mt-3 break-all rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left text-[13px] leading-6 text-slate-900"
          >
            {paymentQuery.data.paymentUrl}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href={paymentQuery.data.paymentUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-11 items-center gap-2 rounded-2xl bg-emerald-500 px-4 text-sm font-semibold text-white transition hover:bg-emerald-600"
            >
              <ExternalLink className="h-4 w-4" />
              פתח קישור
            </a>
            <button
              type="button"
              onClick={copyPaymentLink}
              className="inline-flex h-11 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 transition hover:translate-y-[-1px]"
            >
              <Copy className="h-4 w-4" />
              העתק קישור
            </button>
          </div>
        </div>

        <div className="rounded-[1.45rem] border border-slate-200 bg-slate-50 p-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Wallet className="h-4 w-4 text-emerald-500" />
              כתובת ארנק
            </div>
            <p
              dir="ltr"
              className="mt-3 break-all rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left font-mono text-[13px] leading-6 text-slate-900"
            >
              {paymentQuery.data.payAddress}
            </p>
          </div>
          <button
            type="button"
            onClick={copyAddress}
            className="mt-3 inline-flex h-11 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 transition hover:translate-y-[-1px]"
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

        <div className="rounded-[1.35rem] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-5 text-emerald-900">
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
    <div className="rounded-[1.35rem] border border-slate-200 bg-slate-50 p-4">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <div className="mt-2.5 flex items-end gap-2">
        <span className="text-[1.8rem] font-semibold tracking-tight text-slate-950">
          {value}
        </span>
        <span className="pb-1 text-sm font-medium text-slate-500">{helper}</span>
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
    <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3">
      <span className="text-sm text-slate-500">{label}</span>
      <span
        dir={ltrValue ? "ltr" : undefined}
        className="text-sm font-semibold text-slate-950"
      >
        {value}
      </span>
    </div>
  );
}
