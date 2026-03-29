import { BadgeCheck, CreditCard, TimerReset } from "lucide-react";

import { PaymentForm } from "../components/payment-form";
import { ThemeToggle } from "../components/theme-toggle";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-4 py-5 md:px-8 md:py-8">
      <header className="flex items-start justify-between gap-4">
        <div className="max-w-3xl space-y-4 rounded-[1.75rem] bg-white/72 px-5 py-4 shadow-sm shadow-slate-900/5 backdrop-blur-sm dark:bg-transparent dark:p-0 dark:shadow-none">
          <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
            NOW Payment
          </p>
          <div className="space-y-3">
            <h1 className="text-3xl font-bold tracking-tight text-slate-950 dark:text-white md:text-5xl">
              מסך תשלום ברור, מהיר ונוח לצוות וללקוחות
            </h1>
            <p className="max-w-2xl text-base leading-7 text-slate-700 dark:text-slate-300 md:text-lg">
              יצירת תשלום קריפטו בכמה שניות, עם QR ברור, סטטוס חי והמשך אוטומטי
              לחשבונית.
            </p>
          </div>
        </div>
        <ThemeToggle />
      </header>

      <PaymentForm />
    </main>
  );
}

function Highlight({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-2xl border border-slate-200/80 bg-white/90 px-4 py-3 text-sm font-medium text-slate-700 shadow-sm shadow-slate-900/5 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-200">
      <div className="rounded-xl bg-emerald-50 p-2 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300">
        {icon}
      </div>
      <span>{text}</span>
    </div>
  );
}
