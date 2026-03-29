"use client";

import { Moon, SunMedium } from "lucide-react";
import { useTheme } from "next-themes";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/20 bg-white/70 text-slate-900 shadow-lg shadow-slate-900/5 backdrop-blur transition hover:scale-[1.02] dark:border-white/10 dark:bg-slate-900/70 dark:text-white"
      aria-label="Toggle theme"
    >
      {isDark ? <SunMedium className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}
