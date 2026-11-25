import type { AssetCategory } from '../types/ats.ts';

/**
 * Complete S&P 500 Equities Universe (~503 constituents, Yahoo Finance format: BRK-B, BF-B).
 */
export const SP500_TICKERS: readonly string[] = [
  'AAPL', 'NVDA', 'MSFT', 'AMZN', 'META', 'GOOGL', 'GOOG', 'BRK-B', 'AVGO', 'TSLA',
  'LLY', 'JPM', 'WMT', 'V', 'XOM', 'MA', 'UNH', 'ORCL', 'COST', 'HD',
  'PG', 'NFLX', 'JNJ', 'BAC', 'CRM', 'ABBV', 'CVX', 'KO', 'MRK', 'WFC',
  'CSCO', 'AMD', 'NOW', 'PEP', 'ACN', 'TMO', 'LIN', 'MCD', 'ISRG', 'IBM',
  'DIS', 'PM', 'ABT', 'ADBE', 'GS', 'GE', 'TXN', 'CAT', 'AXP', 'INTU',
  'QCOM', 'VZ', 'BKNG', 'DHR', 'MS', 'T', 'RTX', 'AMGN', 'SPGI', 'PFE',
  'BLK', 'NEE', 'LOW', 'SYK', 'PGR', 'UNP', 'UBER', 'ETN', 'AMAT', 'TJX',
  'CMCSA', 'C', 'HON', 'SCHW', 'COP', 'BSX', 'PLTR', 'DE', 'ADP', 'VRTX',
  'PANW', 'FI', 'BMY', 'KKR', 'LMT', 'GILD', 'MMC', 'MU', 'CB', 'PLD',
  'ADI', 'ANET', 'MDT', 'BX', 'NKE', 'SBUX', 'GEV', 'TMUS', 'LRCX', 'KLAC',
  'ICE', 'SO', 'AMT', 'MO', 'SHW', 'ELV', 'EQIX', 'CRWD', 'UPS', 'CI',
  'DUK', 'CME', 'PH', 'INTC', 'WM', 'MDLZ', 'TT', 'ABNB', 'PYPL', 'CDNS',
  'SNPS', 'APH', 'USB', 'MSI', 'MCK', 'AON', 'PNC', 'CMG', 'ZTS', 'MCO',
  'CTAS', 'CL', 'REGN', 'TDG', 'CEG', 'GD', 'EMR', 'WELL', 'ITW', 'ORLY',
  'MMM', 'EOG', 'MAR', 'NOC', 'FDX', 'COF', 'CSX', 'AJG', 'WMB', 'APD',
  'APO', 'ECL', 'HCA', 'TGT', 'CARR', 'FTNT', 'BDX', 'ADSK', 'RSG', 'TFC',
  'HLT', 'SLB', 'GM', 'OKE', 'ROP', 'PCAR', 'FCX', 'TRV', 'NSC', 'PSA',
  'DLR', 'BK', 'KMI', 'NXPI', 'AZO', 'SRE', 'URI', 'JCI', 'AFL', 'SPG',
  'AMP', 'PSX', 'MET', 'ALL', 'CPRT', 'GWW', 'MPC', 'PWR', 'DHI', 'NEM',
  'AEP', 'FICO', 'ROST', 'CMI', 'O', 'LHX', 'VST', 'PAYX', 'D', 'AIG',
  'HWM', 'KMB', 'FIS', 'MSCI', 'TEL', 'PRU', 'PEG', 'KVUE', 'FAST', 'MPC',
  'AME', 'PCG', 'ODFL', 'DAL', 'VLO', 'EW', 'COR', 'KR', 'BKR', 'CTVA',
  'TRGP', 'CBRE', 'VRSK', 'AXON', 'OTIS', 'LEN', 'EXC', 'GLW', 'A', 'IR',
  'DFS', 'YUM', 'IT', 'EA', 'MNST', 'CTSH', 'HES', 'XEL', 'SYY', 'ACGL',
  'HPQ', 'CHTR', 'KDP', 'GEHC', 'VMC', 'STZ', 'IDXX', 'IQV', 'DELL', 'NUE',
  'LULU', 'RCL', 'MLM', 'GIS', 'DD', 'HIG', 'ED', 'RMD', 'OXY', 'WAB',
  'MTB', 'EXR', 'F', 'AVB', 'MCHP', 'HUM', 'EFX', 'GRMN', 'EBAY', 'VICI',
  'EIX', 'WEC', 'IRM', 'FITB', 'ROK', 'MPWR', 'CSGP', 'CNC', 'ETR', 'NDAQ',
  'RJF', 'WTW', 'ANSS', 'TSCO', 'TTWO', 'STT', 'DXCM', 'GPN', 'KEYS', 'UAL',
  'PHM', 'FANG', 'DOW', 'HSY', 'CAH', 'ON', 'PPG', 'AWK', 'DECK', 'HPE',
  'TROW', 'CHD', 'DOV', 'EQR', 'BR', 'SBAC', 'FTV', 'NVR', 'DTE', 'CDW',
  'BRO', 'VTR', 'SYF', 'TYL', 'HAL', 'GDDY', 'HUBB', 'SW', 'MTD', 'PPL',
  'AEE', 'ADM', 'BIIB', 'FE', 'LYB', 'WY', 'IFF', 'VLTO', 'CINF', 'HBAN',
  'CPAY', 'DVN', 'EQT', 'PTC', 'WST', 'STE', 'NTAP', 'ES', 'TDY', 'RF',
  'K', 'WAT', 'IX', 'ZBH', 'CCL', 'AWK', 'COO', 'TER', 'CMS', 'ESS',
  'LDOS', 'STX', 'CBOE', 'PHM', 'TSN', 'PKG', 'BLDR', 'CFG', 'MKC', 'NTRS',
  'DRI', 'BALL', 'SYF', 'LUV', 'LH', 'GPC', 'EXPE', 'NRG', 'CLX', 'FSLR',
  'STLD', 'MAS', 'OMC', 'INVH', 'SNA', 'J', 'ZBRA', 'WRB', 'ULTA', 'ARE',
  'MAA', 'HOLX', 'TXT', 'DOC', 'BBY', 'PFG', 'EXPD', 'IEX', 'DGX', 'BAX',
  'AVY', 'JBHT', 'TRMB', 'PODD', 'SWKS', 'MOH', 'L', 'DG', 'KIM', 'CF',
  'AMCR', 'GEN', 'ALGN', 'NDSN', 'VRSN', 'APTV', 'DPZ', 'KEY', 'EG', 'NI',
  'PNR', 'POOL', 'JBL', 'LNT', 'RVTY', 'FFIV', 'BG', 'AKAM', 'ROL', 'CAG',
  'EVRG', 'DLTR', 'UDR', 'JKHY', 'BXP', 'CPT', 'JNPR', 'SWK', 'CHRW', 'UHS',
  'VTRS', 'TECH', 'ALLE', 'KMX', 'REG', 'EPAM', 'DAY', 'IP', 'HST', 'AIZ',
  'SJM', 'EMN', 'PAYC', 'NWSA', 'NWS', 'GNRC', 'ALB', 'LW', 'TAP', 'GL',
  'CRL', 'TPR', 'CTLT', 'AOS', 'LKQ', 'FOXA', 'FOX', 'AES', 'MKTX', 'RL',
  'HSIC', 'CPB', 'MOS', 'APA', 'HII', 'FRT', 'TFX', 'PNW', 'BIO', 'MTCH',
  'WYNN', 'INCY', 'MHK', 'HAS', 'CZR', 'IVZ', 'PARA', 'FMC', 'BWA', 'DVA',
  'SOLV', 'QRVO', 'BEN', 'WBA', 'ETSY', 'MGM', 'NCLH', 'ENPH', 'SMCI', 'COIN',
  'WDAY', 'TPL', 'LII', 'BA', 'SOFI', 'MRNA', 'EL', 'KHC', 'HRL', 'FDS',
  'WDC', 'DASH', 'PODD', 'COR', 'DECK', 'HUBB', 'BLDR', 'SPY', 'QQQ', 'IWM', 'DIA',
];

export const UNIQUE_SP500_TICKERS: string[] = Array.from(new Set(SP500_TICKERS));

export const SP100_TICKERS: string[] = UNIQUE_SP500_TICKERS.slice(0, 100);

/**
 * Top 100 Liquid Cryptocurrencies (USDT pairs on Binance / Hyperliquid, excluding stablecoins).
 */
export const TOP_100_CRYPTO_TICKERS: string[] = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
  'DOGEUSDT', 'ADAUSDT', 'TRXUSDT', 'AVAXUSDT', 'SHIBUSDT',
  'TONUSDT', 'LINKUSDT', 'DOTUSDT', 'BCHUSDT', 'NEARUSDT',
  'SUIUSDT', 'LTCUSDT', 'APTUSDT', 'UNIUSDT', 'PEPEUSDT',
  'ICPUSDT', 'FETUSDT', 'ETCUSDT', 'RENDERUSDT', 'KASUSDT',
  'TAOUSDT', 'STXUSDT', 'XLMUSDT', 'HBARUSDT', 'ATOMUSDT',
  'OKBUSDT', 'FILUSDT', 'IMXUSDT', 'ARBUSDT', 'WIFUSDT',
  'OPUSDT', 'VETUSDT', 'INJUSDT', 'MKRUSDT', 'AAVEUSDT',
  'GRTUSDT', 'SEIUSDT', 'THETAUSDT', 'BONKUSDT', 'FLOKIUSDT',
  'RUNEUSDT', 'ARUSDT', 'FTMUSDT', 'ALGOUSDT', 'TIAUSDT',
  'PYTHUSDT', 'JUPUSDT', 'GALAUSDT', 'FLOWUSDT', 'LDOUSDT',
  'QNTUSDT', 'BEAMXUSDT', 'COREUSDT', 'STRKUSDT', 'BSVUSDT',
  'JASMYUSDT', 'AXSUSDT', 'SANDUSDT', 'EGLDUSDT', 'EOSUSDT',
  'MANAUSDT', 'XTZUSDT', 'DYDXUSDT', 'NEOUSDT', 'PENDLEUSDT',
  'WLDUSDT', 'ENAUSDT', 'ORDIUSDT', 'CHZUSDT', 'MINAUSDT',
  'SNXUSDT', 'APEUSDT', 'CFXUSDT', 'CAKEUSDT', 'ROSEUSDT',
  'CRVUSDT', 'IOTAUSDT', 'GNOUSDT', 'KLAYUSDT', 'COMPUSDT',
  '1INCHUSDT', 'ENSUSDT', 'BLURUSDT', 'ZKUSDT', 'NOTUSDT',
  'IOUSDT', 'ZROUSDT', 'EIGENUSDT', 'TURBOUSDT', 'POPCATUSDT',
  'RAYUSDT', 'ONDOUSDT', 'KAVAUSDT', 'ZILUSDT', 'ENJUSDT',
];

export const TOP_25_CRYPTO_TICKERS: string[] = TOP_100_CRYPTO_TICKERS.slice(0, 25);

/**
 * Top 50 USD & Major Global Forex Pairs (Yahoo Finance =X convention).
 * Covers all G10 USD pairs, ~25 EM/Global USD pairs, and major liquid G10 FX crosses.
 */
export const TOP_50_FOREX_TICKERS: string[] = [
  // G10 USD Majors
  'EURUSD=X', 'GBPUSD=X', 'USDJPY=X', 'AUDUSD=X', 'USDCAD=X',
  'USDCHF=X', 'NZDUSD=X', 'USDSEK=X', 'USDNOK=X', 'USDDKK=X',
  // Asian & APAC USD Pairs
  'USDSGD=X', 'USDHKD=X', 'USDCNH=X', 'USDINR=X', 'USDKRW=X',
  'USDTWD=X', 'USDTHB=X', 'USDIDR=X', 'USDMYR=X', 'USDPHP=X',
  // LatAm & EMEA USD Pairs
  'USDMXN=X', 'USDBRL=X', 'USDCLP=X', 'USDCOP=X', 'USDPEN=X',
  'USDZAR=X', 'USDTRY=X', 'USDPLN=X', 'USDCZK=X', 'USDHUF=X',
  'USDILS=X', 'USDRON=X', 'USDSAR=X', 'USDAED=X',
  // Major Liquid Crosses
  'EURGBP=X', 'EURJPY=X', 'GBPJPY=X', 'AUDJPY=X', 'CADJPY=X',
  'CHFJPY=X', 'NZDJPY=X', 'EURAUD=X', 'EURCAD=X', 'EURCHF=X',
  'EURNZD=X', 'GBPAUD=X', 'GBPCAD=X', 'GBPCHF=X', 'AUDCAD=X',
  'AUDNZD=X',
];

export interface UniversePresetOption {
  id: string;
  label: string;
  description: string;
  tickers: string[] | null; // null = user's custom localStorage watchlist
}

export const UNIVERSE_PRESETS: Record<AssetCategory, UniversePresetOption[]> = {
  stocks: [
    {
      id: 'custom',
      label: 'My Watchlist',
      description: 'Custom persistent watchlist in localStorage',
      tickers: null,
    },
    {
      id: 'sp100',
      label: 'S&P 100 Mega-Caps (100)',
      description: 'Top 100 S&P 500 leaders (~8s scan)',
      tickers: SP100_TICKERS,
    },
    {
      id: 'sp500',
      label: `All S&P 500 (${UNIQUE_SP500_TICKERS.length})`,
      description: 'Full S&P 500 index streamed in progressive batches',
      tickers: UNIQUE_SP500_TICKERS,
    },
  ],
  crypto: [
    {
      id: 'custom',
      label: 'My Watchlist',
      description: 'Custom persistent watchlist in localStorage',
      tickers: null,
    },
    {
      id: 'top25',
      label: 'Top 25 Crypto',
      description: 'Top 25 liquid crypto pairs (~2s scan)',
      tickers: TOP_25_CRYPTO_TICKERS,
    },
    {
      id: 'top100',
      label: `Top 100 Crypto (${TOP_100_CRYPTO_TICKERS.length})`,
      description: 'Top 100 crypto USDT pairs streamed in batches',
      tickers: TOP_100_CRYPTO_TICKERS,
    },
  ],
  forex: [
    {
      id: 'custom',
      label: 'My Watchlist',
      description: 'Custom persistent FX watchlist in localStorage',
      tickers: null,
    },
    {
      id: 'top50',
      label: `Top 50 USD & FX Pairs (${TOP_50_FOREX_TICKERS.length})`,
      description: '34 G10/EM USD pairs + 16 major G10 crosses',
      tickers: TOP_50_FOREX_TICKERS,
    },
  ],
};
