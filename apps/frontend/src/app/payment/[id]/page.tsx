import type { ReactNode } from "react";
import { CheckCircle2, ChevronRight, QrCode, Wallet } from "lucide-react";
import Link from "next/link";

import { PaymentStatusCard } from "../../../components/payment-status-card";
import { ThemeToggle } from "../../../components/theme-toggle";

export default async function PaymentStatusPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-4 py-4 md:px-6 md:py-6">
      <div
        className="grid items-start gap-4 md:grid-cols-[auto_minmax(0,1fr)]"
        dir="ltr"
      >
        <div className="shrink-0">
          <ThemeToggle />
        </div>
        <div dir="rtl">
          <section className="overflow-hidden rounded-[1.8rem] border border-slate-200 bg-white shadow-[0_24px_60px_-32px_rgba(15,23,42,0.18)]">
            <div className="border-b border-slate-200 px-4 py-3 md:px-6">
              <div className="grid gap-2.5 sm:grid-cols-3">
                <StepItem
                  icon={<Wallet className="h-4 w-4" />}
                  title="שלב 1"
                  label="יצירת תשלום"
                  complete
                />
                <StepItem
                  icon={<QrCode className="h-4 w-4" />}
                  title="שלב 2"
                  label="סריקה ותשלום"
                  active
                />
                <StepItem
                  icon={<CheckCircle2 className="h-4 w-4" />}
                  title="שלב 3"
                  label="אישור סופי"
                />
              </div>
            </div>

            <div className="grid gap-4 p-3 sm:p-4 md:p-5">
              <div className="grid gap-4">
                <section className="min-w-0 rounded-[1.35rem] border border-slate-200 bg-white p-4 shadow-[0_12px_28px_-24px_rgba(15,23,42,0.18)]">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <Link
                      href="/"
                      className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-semibold text-slate-900 transition hover:bg-slate-100"
                    >
                      <ChevronRight className="h-4 w-4" />
                      תשלום חדש
                    </Link>

                    <div className="space-y-2">
                      <p className="text-sm font-semibold text-emerald-600">
                        סטטוס תשלום
                      </p>
                      <h1 className="text-[1.7rem] font-semibold tracking-tight text-slate-950 md:text-[2rem]">
                        מסך תשלום ללקוח
                      </h1>
                      <p className="text-sm leading-5 text-slate-500">
                        הצג ללקוח את ה-QR, עקוב אחר הסטטוס בזמן אמת וחזור בקלות
                        למסך יצירת תשלום חדש.
                      </p>
                    </div>
                  </div>
                </section>
              </div>

              <PaymentStatusCard paymentId={id} />
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function StepItem({
  icon,
  title,
  label,
  active = false,
  complete = false,
}: {
  icon: ReactNode;
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
    <div className="flex min-w-0 items-center gap-2">
      <div
        className={`inline-flex h-6 w-6 items-center justify-center rounded-full ${bubbleClass}`}
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
