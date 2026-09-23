"use client";

import { useEffect, useRef, useState } from "react";
import { Moon, Sun } from "lucide-react";

export default function ThemeToggle() {
  const [dark, setDark] = useState(false);
  const illuminationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setDark(document.documentElement.dataset.theme === "dark");
    return () => {
      if (illuminationTimer.current) clearTimeout(illuminationTimer.current);
      delete document.documentElement.dataset.illuminating;
    };
  }, []);

  function toggleTheme() {
    const next =
      document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    if (illuminationTimer.current) clearTimeout(illuminationTimer.current);
    if (next === "dark") {
      document.documentElement.dataset.illuminating = "true";
      illuminationTimer.current = setTimeout(() => {
        delete document.documentElement.dataset.illuminating;
        illuminationTimer.current = null;
      }, 2000);
    } else {
      delete document.documentElement.dataset.illuminating;
    }
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
