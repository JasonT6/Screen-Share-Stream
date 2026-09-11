import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#17202A",
        muted: "#607083",
        line: "#D8DEE6",
        surface: "#F7F8FA",
        brand: "#2563EB",
        good: "#18815C",
        warn: "#B7791F",
        danger: "#C2413D"
      },
      boxShadow: {
        panel: "0 1px 2px rgba(23, 32, 42, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
