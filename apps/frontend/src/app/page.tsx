import { PaymentForm } from "../components/payment-form";
import { ThemeToggle } from "../components/theme-toggle";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-4 py-5 md:px-6 md:py-8">
      <header className="flex items-center justify-between gap-4">
        <ThemeToggle />
      </header>

      <PaymentForm />
    </main>
  );
}
