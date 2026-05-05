# Binance OHLCV Explorer

A real-time candlestick chart and OHLCV data explorer built with **Next.js 14**, **TypeScript**, **Tailwind CSS**, and **Lightweight Charts** (TradingView).

## Features

- 📈 Real-time candlestick chart with volume histogram
- 🔍 Searchable trading pair selector (all TRADING symbols from Binance)
- ⏱ Multiple timeframes: 1m · 5m · 15m · 30m · 1h · 4h · 1d · 1w
- 📋 Detailed OHLCV data table (most-recent first)
- 🔄 Manual refresh + optional 30-second auto-refresh
- 🔐 API keys stay server-side (never exposed to the browser)

---

## Local Development

```bash
# 1. Clone & install
git clone <your-repo>
cd binance-ohlcv
npm install

# 2. Set up environment
cp .env.local.example .env.local
# Edit .env.local and fill in your Binance API key & secret

# 3. Run dev server
npm run dev
# Open http://localhost:3000
```

---

## Deploy to Vercel

### Option A — Vercel Dashboard (recommended)

1. Push this repo to GitHub / GitLab / Bitbucket.
2. Go to [vercel.com](https://vercel.com) → **New Project** → import your repo.
3. In **Environment Variables**, add:

   | Name | Value |
   |------|-------|
   | `BINANCE_API_KEY` | your Binance API key |
   | `BINANCE_API_SECRET` | your Binance API secret |

4. Click **Deploy**. Vercel auto-detects Next.js and runs `npm run build`.

### Option B — Vercel CLI

```bash
npm i -g vercel
vercel login

# Add secrets once
vercel env add BINANCE_API_KEY
vercel env add BINANCE_API_SECRET

# Deploy
vercel --prod
```

---

## API Routes

All routes are server-side — API credentials are never sent to the browser.

| Route | Description |
|-------|-------------|
| `GET /api/klines?symbol=BTCUSDT&interval=1h&limit=200` | Fetch OHLCV candlestick data |
| `GET /api/symbols?quote=USDT&search=BTC` | List tradeable symbols |
| `GET /api/ticker?symbol=BTCUSDT` | Current price ticker |

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `BINANCE_API_KEY` | ✅ | Your Binance API key |
| `BINANCE_API_SECRET` | ✅ | Your Binance API secret |
| `BINANCE_BASE_URL` | ❌ | Override base URL (e.g. testnet) |

> **Note:** The public klines endpoint does not require authentication, but the API key is still sent as a header to increase rate limits.

---

## Tech Stack

- [Next.js 14](https://nextjs.org/) — App Router, API routes
- [Tailwind CSS](https://tailwindcss.com/) — Styling
- [Lightweight Charts](https://tradingview.github.io/lightweight-charts/) — Candlestick charts
- [Binance REST API](https://binance-docs.github.io/apidocs/) — Market data
