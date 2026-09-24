"use client";

/* Full navigation deliberately tears down the active stream and its URL fragment. */
/* eslint-disable @next/next/no-html-link-for-pages */
import { useEffect, useState } from "react";
import { MonitorPlay } from "lucide-react";
import LandingPage from "./LandingPage";
import ThemeToggle from "./ThemeToggle";
import Session from "./stream/Session";

export default function StreamApp() {
  const [room, setRoom] = useState<string | null>(null);
  useEffect(() => {
    const route = () => {
      const hash = window.location.hash.slice(1);
      setRoom(
        hash === "create"
          ? ""
          : hash
            ? new URLSearchParams(hash).get("room") || "invalid"
            : null
      );
    };
    route();
    window.addEventListener("hashchange", route);
    return () => window.removeEventListener("hashchange", route);
  }, []);
  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="wordmark" href="/" aria-label="Private Stream home">
          <span className="brand-icon">
            <MonitorPlay size={22} />
          </span>
          private<span>stream</span>
          <span className="beta-tag">P2P</span>
        </a>
        <div className="header-actions">
          <span className="header-note">
            A little closer, wherever you are.
          </span>
          <ThemeToggle />
        </div>
      </header>
      <main>
        {room === null ? (
          <LandingPage />
        ) : (
          <Session key={room} roomId={room || null} />
        )}
      </main>
      <footer>
        <span>Private Stream</span>
        <span>Your screens. Shared together.</span>
      </footer>
    </div>
  );
}
