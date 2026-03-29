"use client";

import { Moon, SunMedium } from "lucide-react";

import { useTheme } from "../providers/theme-provider";

export function ThemeToggle() {
  const { mounted, resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200/80 bg-white/95 text-slate-900 shadow-sm shadow-slate-900/5 transition hover:scale-[1.02] dark:border-slate-800 dark:bg-slate-900/90 dark:text-white"
      aria-label="החלפת מצב תצוגה"
    >
      {!mounted ? (
        <span className="block h-5 w-5" />
      ) : isDark ? (
        <SunMedium className="h-5 w-5" />
      ) : (
        <Moon className="h-5 w-5" />
      )}
    </button>
  );
}
