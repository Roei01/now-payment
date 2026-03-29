import { PaymentForm } from "../components/payment-form";
import { ThemeToggle } from "../components/theme-toggle";

export default function HomePage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl px-4 py-5 md:px-6 md:py-8">
      <div className="grid items-start gap-4 md:grid-cols-[auto_minmax(0,1fr)]" dir="ltr">
        <div className="shrink-0">
          <ThemeToggle />
        </div>
        <div dir="rtl">
          <PaymentForm />
        </div>
      </div>
    </main>
  );
}
