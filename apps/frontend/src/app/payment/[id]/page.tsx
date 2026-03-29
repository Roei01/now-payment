import { ChevronLeft } from "lucide-react";
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
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-5 py-6 md:px-8 md:py-8">
      <div className="flex items-center justify-between gap-4">
        <Link
          href="/"
          className="inline-flex h-12 items-center gap-2 rounded-2xl border border-white/20 bg-white/70 px-4 text-sm font-medium text-slate-900 shadow-lg shadow-slate-900/5 backdrop-blur dark:border-white/10 dark:bg-slate-950/60 dark:text-white"
        >
          <ChevronLeft className="h-4 w-4" />
          New payment
        </Link>
        <ThemeToggle />
      </div>

      <PaymentStatusCard paymentId={id} />
    </main>
  );
}
