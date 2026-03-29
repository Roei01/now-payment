import { ChevronRight } from "lucide-react";
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
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-4 py-5 md:px-8 md:py-8">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-3">
          <Link
            href="/"
            className="inline-flex h-11 items-center gap-2 rounded-2xl border border-slate-200/80 bg-white/90 px-4 text-sm font-medium text-slate-900 shadow-sm shadow-slate-900/5 dark:border-slate-800 dark:bg-slate-900/80 dark:text-white"
          >
            <ChevronRight className="h-4 w-4" />
            תשלום חדש
          </Link>
          <div>
            <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-300">
              סטטוס תשלום
            </p>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-950 dark:text-white md:text-4xl">
              מסך תשלום ללקוח
            </h1>
          </div>
        </div>
        <ThemeToggle />
      </div>

      <PaymentStatusCard paymentId={id} />
    </main>
  );
}
