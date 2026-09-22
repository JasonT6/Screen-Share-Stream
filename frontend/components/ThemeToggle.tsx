"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export default function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.dataset.theme === "dark");
  }, []);

  function toggleTheme() {
    const next =
      document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    setDark(next === "dark");
    try {
      localStorage.setItem("private-stream-theme", next);
    } catch {
      // The control still works when browser storage is unavailable.
    }
  }

  return (
    <button
      className="theme-toggle"
      type="button"
      aria-label="Dark mode"
      aria-pressed={dark}
      onClick={toggleTheme}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
    >
      <span className="theme-option theme-light">
        <Sun size={16} />
        <span>Light</span>
      </span>
      <span className="theme-option theme-dark">
        <Moon size={16} />
        <span>Dark</span>
      </span>
    </button>
  );
}
