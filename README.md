# ATS Engine — Multi-Timeframe (MTF) Trading Screener & Charting Web App

A zero-cost, zero-maintenance quantitative trading screener and 6-pane interactive charting terminal built around the **Action Trading System (ATS)** methodology (**Jack**, **Oggy**, and **Didi** polarity matrices).

## Architecture & Zero-Cost Stack
- **Framework**: Next.js 15 (App Router) + TypeScript, ready for **Vercel Free Tier**.
- **Stateless Backend**: Purely stateless Next.js API routes (`/api/market` & `/api/screener`).
- **Zero External Database**: Watchlists, selected tickers, and chart indicator toggles persist locally via **Zustand** (`localStorage`).
- **$0 Market Data Providers**:
  - **Stocks & Forex**: `yahoo-finance2` (fetches 25+ years of daily OHLCV + live market quotes so Annual `12M` `Jack` lookbacks and `BB(20)` have full depth).
  - **Crypto**: Public REST APIs (`data-api.binance.vision` / `api.binance.com` multi-page klines + 24h ticker, with automatic fallback to Hyperliquid and CoinGecko public REST endpoints).
- **UI & Charting**: Tailwind CSS, Shadcn UI components, and **TradingView Lightweight Charts** (`lightweight-charts`) with 6-pane crosshair synchronization.

## Core ATS Modules
1. **`src/lib/dataResampler.ts`**: Groups daily OHLCV bars into 6 strict UTC timeframes:
   - `D` (Daily), `W` (ISO Week), `M` (Calendar Month), `3M` (Quarter Q1–Q4), `6M` (Bi-Annual H1–H2), `12M` (Calendar Year).
2. **`src/lib/atsIndicators.ts`**:
   - **Jack Matrix (M20 Baselines)**: `Jack_Minus1` (`t-21`), `Jack_0` (`t-20`), `Jack_Plus1` (`t-19`).
   - **Oggy Matrix (M7 Baselines)**: `Oggy_Minus1` (`t-8`), `Oggy_0` (`t-7`), `Oggy_Plus1` (`t-6`).
   - **Polarity Rule**: `Current Price >= Line => GREEN (Support)`, `Current Price < Line => RED (Resistance)`.
   - **Standard Indicators**: Bollinger Bands (`20, 2` + inward compression detection), Parabolic SAR (`0.02, 0.20` + exact flip detection), and **Didi** (nearest HTF overhead resistance).
3. **`src/lib/atsScreener.ts`**: Implements **Setup 1-2-3-4** Sniper Wall detection (`<=1%` proximity to HTF Green Supports), Stop Loss (`1%` below Wall), TP1 (`Didi`), TP2 (`HTF M20`), and 0–100% Confidence Scoring.
4. **`src/components/charts/ATSChart.tsx`**: Renders OHLC candlesticks, shaded Bollinger Band area cloud, Parabolic SAR dots, `createPriceLine` horizontal baselines for `Jack` and `Oggy` strictly colored Green/Red by polarity, and 60fps 6-timeframe crosshair synchronization.
5. **`src/components/search/GlobalAssetLookup.tsx` & `src/app/api/search/route.ts`**: Universal Spotlight search (`⌘K` / `Ctrl+K`) across global Stocks/ETFs, Crypto pairs, and ISO Currency Pairs with inline Quick ATS Check, watchlist pinning, and 1-click jump to 6-Pane Charts.

## Local Development

```bash
cd /Users/bct/.gemini/antigravity/scratch/ats-screener
npm install
npm run dev
```

Open `http://localhost:3000` in your browser.

## Free Deployment (Vercel Hobby Tier — \$0 Cost)

### Option A: One-Command CLI Deploy (Fastest, No GitHub Needed)
```bash
cd /Users/bct/.gemini/antigravity/scratch/ats-screener
npx vercel --prod
```

### Option B: GitHub + Vercel Auto-Deploy
1. Initialize Git and push to a new GitHub repository:
   ```bash
   cd /Users/bct/.gemini/antigravity/scratch/ats-screener
   git init
   git add .
   git commit -m "Initial ATS Multi-Timeframe Screener & Charting app"
   ```
2. Go to https://vercel.com/new (Free Hobby Account), import the GitHub repo, leave all Next.js settings on default (zero environment variables or database required), and click **Deploy**.

