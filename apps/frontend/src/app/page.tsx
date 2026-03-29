import { CreditCard, ShieldCheck, Sparkles } from "lucide-react";

import { PaymentForm } from "../components/payment-form";
import { ThemeToggle } from "../components/theme-toggle";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-8 px-5 py-6 md:px-8 md:py-8">
      <header className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-violet-600 dark:text-violet-300">NOW Payment</p>
          <h1 className="text-4xl font-semibold tracking-tight text-slate-950 dark:text-white">
            Premium crypto checkout for restaurants
          </h1>
        </div>
        <ThemeToggle />
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        <FeatureCard
          icon={<CreditCard className="h-5 w-5" />}
          title="Fast service flow"
          description="Built for waiters on iPad with large touch targets and minimal friction."
        />
        <FeatureCard
          icon={<ShieldCheck className="h-5 w-5" />}
          title="Secure by default"
          description="Secrets stay server-side while the UI talks through safe internal routes."
        />
        <FeatureCard
          icon={<Sparkles className="h-5 w-5" />}
          title="Automated ops"
          description="Payments, invoicing, and Sheets sync are handled in one streamlined flow."
        />
      </section>

      <PaymentForm />
    </main>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-[1.75rem] border border-white/20 bg-white/70 p-5 shadow-xl shadow-slate-900/5 backdrop-blur dark:border-white/10 dark:bg-slate-950/60">
      <div className="inline-flex rounded-2xl bg-slate-950/5 p-3 text-slate-900 dark:bg-white/10 dark:text-white">
        {icon}
      </div>
      <h2 className="mt-4 text-lg font-semibold text-slate-950 dark:text-white">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{description}</p>
    </div>
  );
}
