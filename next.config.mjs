/** @type {import('next').NextConfig} */
const nextConfig = {
  // BINANCE_API_KEY and BINANCE_API_SECRET are server-only env vars.
  // They are read directly from process.env inside API route handlers
  // and are NEVER sent to the browser. Do NOT add them here under `env`.
};

export default nextConfig;
