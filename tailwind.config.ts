import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        binance: {
          yellow: "#F0B90B",
          dark: "#0B0E11",
          card: "#1E2329",
          border: "#2B3139",
          green: "#03A66D",
          red: "#CF304A",
          text: "#B7BDC6",
          muted: "#707A8A",
        },
      },
    },
  },
  plugins: [],
};

export default config;
