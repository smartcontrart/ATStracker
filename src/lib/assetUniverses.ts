import { RUSSELL_2000_TICKERS } from '../data/russell2000.ts';
import { STOXX_600_TICKERS } from '../data/stoxx600.ts';
import type { AssetCategory } from '../types/ats.ts';

/**
 * 14 Curated AT.S / ProRealTime Thematic Stock Lists matching the user's 14 .itf sector files.
 */
export const THEMATIC_STOCK_LISTS: Record<
  string,
  { id: string; label: string; description: string; tickers: string[] }
> = {
  thematic_uranium: {
    id: 'thematic_uranium',
    label: '☢️ Uranium',
    description: 'Mineurs et cycle du combustible uranium (URANIUM.itf)',
    tickers: [
      'CCJ', 'UEC', 'NXE', 'DNN', 'UUUU', 'LEU', 'URG', 'EU', 'UROY',
      'URA', 'URNM', 'BWXT', 'NNE',
    ],
  },
  thematic_rare_earths: {
    id: 'thematic_rare_earths',
    label: '⛏️ Terres Rares',
    description: 'Terres rares, lithium et métaux critiques (TERRES_RARES.itf)',
    tickers: [
      'MP', 'ALB', 'SQM', 'LAC', 'SGML', 'USAR', 'NB', 'TMRC',
      'FCX', 'SCCO', 'AA', 'ERO', 'REMX',
    ],
  },
  thematic_space: {
    id: 'thematic_space',
    label: '🚀 Spatial',
    description: 'Lanceurs, satellites et infrastructures spatiales (SPATIAL.itf)',
    tickers: [
      'RKLB', 'ASTS', 'LUNR', 'RDW', 'PL', 'BKSY', 'SPIR', 'IRDM',
      'VSAT', 'GSAT', 'SATS', 'KTOS', 'KBR', 'LHX', 'LMT', 'NOC', 'RTX',
    ],
  },
  thematic_semis: {
    id: 'thematic_semis',
    label: '🔬 Semi-Conducteurs',
    description: 'Fondeurs, équipementiers et puces IA (SEMI-CONDUCTEURS.itf)',
    tickers: [
      'NVDA', 'AVGO', 'TSM', 'AMD', 'ASML', 'AMAT', 'LRCX', 'KLAC',
      'MU', 'ARM', 'MRVL', 'QCOM', 'TXN', 'ADI', 'NXPI', 'MPWR',
      'ON', 'MCHP', 'TER', 'SNPS', 'CDNS', 'STM', 'INTC', 'ONTO', 'ENTG',
    ],
  },
  thematic_robotics: {
    id: 'thematic_robotics',
    label: '🤖 Robotique',
    description: 'Robotique chirurgicale, logistique et automatisation (ROBOTIQUE.itf)',
    tickers: [
      'ISRG', 'SYM', 'ROK', 'TER', 'ABB', 'CGNX', 'ZBRA', 'SERV',
      'PATH', 'NOVT', 'CLPT', 'EMR', 'HON', 'TSLA', 'AUR', 'OUST', 'BOTZ',
    ],
  },
  thematic_quantum: {
    id: 'thematic_quantum',
    label: '⚛️ Quantique',
    description: 'Calcul quantique et cryptographie post-quantique (QUANTIQUE.itf)',
    tickers: [
      'IONQ', 'RGTI', 'QBTS', 'QUBT', 'ARQQ', 'QMCO', 'LAES',
      'IBM', 'GOOGL', 'HON', 'QTUM',
    ],
  },
  thematic_nuclear: {
    id: 'thematic_nuclear',
    label: '⚡ Nucléaire',
    description: 'Producteurs électronucléaires et ingénierie (NUCLÉAIRE.itf)',
    tickers: [
      'CEG', 'VST', 'TLN', 'PEG', 'NEE', 'SO', 'DUK', 'D',
      'ETR', 'EXC', 'BWXT', 'FLR', 'GEV', 'MIR', 'NLR',
    ],
  },
  thematic_immo_supplies: {
    id: 'thematic_immo_supplies',
    label: '🧱 Immo - Fournitures',
    description: 'Matériaux, équipement et fournitures bâtiment (IMMO_-_FOURNITURES.itf)',
    tickers: [
      'HD', 'LOW', 'BLDR', 'SHW', 'MAS', 'FBIN', 'OC', 'MLM', 'VMC',
      'URI', 'FAST', 'GWW', 'POOL', 'TREX', 'AZEK', 'SSD', 'UFPI',
      'IBP', 'BLD', 'TT', 'CARR', 'LII', 'WSO', 'SNA', 'SWK', 'MHK', 'FND',
    ],
  },
  thematic_immo_construction: {
    id: 'thematic_immo_construction',
    label: '🏗️ Immo - Construction',
    description: 'Constructeurs résidentiels et infrastructures (IMMO_-_CONSTRUCTION.itf)',
    tickers: [
      'DHI', 'LEN', 'PHM', 'NVR', 'TOL', 'KBH', 'TMHC', 'MTH', 'MHO',
      'LGIH', 'CCS', 'SKY', 'CVCO', 'GRBK', 'DFH', 'TPH', 'PWR',
      'EME', 'FIX', 'MTZ', 'ACM', 'J', 'ITB', 'XHB',
    ],
  },
  thematic_ai_power: {
    id: 'thematic_ai_power',
    label: '🔌 IA - Électricité',
    description: 'Réseaux électriques, transformateurs et énergie IA (IA_-_ÉLECTRICITÉ.itf)',
    tickers: [
      'ETN', 'GEV', 'SU.PA', 'PWR', 'VRT', 'HUBB', 'NRG', 'VST', 'CEG', 'TLN',
      'POWL', 'MYRG', 'EME', 'FIX', 'FSLR', 'NXT', 'GNRC', 'BE', 'AES',
    ],
  },
  thematic_ai_smr: {
    id: 'thematic_ai_smr',
    label: '🔋 IA - SMR',
    description: 'Petits réacteurs modulaires nucléaires pour IA (IA_-_SMR.itf)',
    tickers: [
      'OKLO', 'SMR', 'NNE', 'BWXT', 'LEU', 'LTBR', 'CCJ', 'GEV', 'FLR', 'MIR',
    ],
  },
  thematic_ai_photonics: {
    id: 'thematic_ai_photonics',
    label: '💡 IA - Photonique',
    description: 'Optique, transceivers et interconnexions IA (IA_-_PHOTONIQUE.itf)',
    tickers: [
      'COHR', 'LITE', 'AAOI', 'FN', 'CIEN', 'POET', 'ALAB', 'CRDO',
      'MTSI', 'MRVL', 'AVGO', 'ANET', 'GLW', 'VIAV', 'SMTC',
    ],
  },
  thematic_ai_datacenter: {
    id: 'thematic_ai_datacenter',
    label: '🖥️ IA - Datas Center',
    description: 'Serveurs, refroidissement, REITs et néoclouds IA (IA_-_DATAS_CENTER.itf)',
    tickers: [
      'VRT', 'SMCI', 'DELL', 'HPE', 'ANET', 'EQIX', 'DLR', 'IRM',
      'APLD', 'CORZ', 'IREN', 'WULF', 'CIFR', 'CLSK', 'HUT', 'MARA',
      'RIOT', 'NBIS', 'CRWV', 'MOD', 'NTAP', 'PSTG', 'STX', 'WDC',
    ],
  },
  thematic_cyber: {
    id: 'thematic_cyber',
    label: '🛡️ Cybersécurité',
    description: 'Sécurité cloud, réseau, identité et endpoint (CYBERSÉCURITÉ.itf)',
    tickers: [
      'PANW', 'CRWD', 'FTNT', 'ZS', 'NET', 'S', 'OKTA', 'CYBR',
      'CHKP', 'GEN', 'QLYS', 'TENB', 'RPD', 'VRNS', 'RDWR', 'CIBR',
    ],
  },
};

export const ALL_THEMATIC_TICKERS: string[] = Array.from(
  new Set(
    Object.values(THEMATIC_STOCK_LISTS).flatMap((sector) => sector.tickers)
  )
);

/**
 * Complete S&P 500 Equities Universe (~502 constituents, Yahoo Finance format).
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
  'HWM', 'KMB', 'FIS', 'MSCI', 'TEL', 'PRU', 'PEG', 'KVUE', 'FAST',
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
  'K', 'WAT', 'IX', 'ZBH', 'CCL', 'COO', 'TER', 'CMS', 'ESS',
  'LDOS', 'STX', 'CBOE', 'TSN', 'PKG', 'BLDR', 'CFG', 'MKC', 'NTRS',
  'DRI', 'BALL', 'LUV', 'LH', 'GPC', 'EXPE', 'NRG', 'CLX', 'FSLR',
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
  'WDAY', 'TPL', 'LII', 'BA', 'SOFI', 'HOOD', 'MELI', 'VEEV', 'CRSP', 'ANDE',
  'KBR', 'CLPT', 'TCEHY', 'SU.PA', 'MRNA', 'EL', 'KHC', 'HRL', 'FDS',
  'WDC', 'DASH', 'ANF', 'SPY', 'QQQ', 'IWM', 'DIA', '^DJI',
];

export const UNIQUE_SP500_TICKERS: string[] = Array.from(new Set(SP500_TICKERS));

/**
 * Full STOXX Europe 600 constituent list (599 verified Yahoo Finance tickers in src/data/stoxx600.ts).
 */
export const STOXX_600_FALLBACK_TICKERS: string[] = STOXX_600_TICKERS;

/**
 * Full Russell 2000 constituent list (1,977 verified Yahoo Finance tickers in src/data/russell2000.ts).
 */
export const RUSSELL_2000_FALLBACK_TICKERS: string[] = RUSSELL_2000_TICKERS;

export const MASTER_STOCKS_UNIVERSE: string[] = Array.from(
  new Set([
    ...ALL_THEMATIC_TICKERS,
    ...UNIQUE_SP500_TICKERS,
    ...STOXX_600_FALLBACK_TICKERS,
    ...RUSSELL_2000_FALLBACK_TICKERS,
  ])
);

export const SP100_TICKERS: string[] = UNIQUE_SP500_TICKERS.slice(0, 100);

/**
 * Top 100 Liquid Cryptocurrencies (USDT pairs on Binance / Hyperliquid).
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
 * Top 50 Free-Floating USD & Major Global Forex Pairs (Yahoo Finance =X convention).
 */
export const TOP_50_FOREX_TICKERS: string[] = [
  'DX-Y.NYB', 'EURUSD=X', 'GBPUSD=X', 'USDJPY=X', 'AUDUSD=X', 'USDCAD=X',
  'USDCHF=X', 'NZDUSD=X', 'USDSEK=X', 'USDNOK=X', 'USDDKK=X',
  'USDSGD=X', 'EURSEK=X', 'USDCNH=X', 'USDINR=X', 'USDKRW=X',
  'USDTWD=X', 'USDTHB=X', 'USDIDR=X', 'USDMYR=X', 'USDPHP=X',
  'USDMXN=X', 'USDBRL=X', 'USDCLP=X', 'USDCOP=X', 'USDPEN=X',
  'USDZAR=X', 'USDTRY=X', 'USDPLN=X', 'USDCZK=X', 'USDHUF=X',
  'USDILS=X', 'EURNOK=X', 'GBPNZD=X',
  'EURGBP=X', 'EURJPY=X', 'GBPJPY=X', 'AUDJPY=X', 'CADJPY=X',
  'CHFJPY=X', 'NZDJPY=X', 'EURAUD=X', 'EURCAD=X', 'EURCHF=X',
  'EURNZD=X', 'GBPAUD=X', 'GBPCAD=X', 'GBPCHF=X', 'AUDCAD=X',
  'AUDNZD=X',
];

export interface UniversePresetOption {
  id: string;
  label: string;
  description: string;
  tickers: string[] | null;
  group?: 'core' | 'thematic';
}

export const UNIVERSE_PRESETS: Record<AssetCategory, UniversePresetOption[]> = {
  stocks: [
    {
      id: 'all_combined',
      label: 'All Markets (S&P + STOXX 600 + R2000)',
      description: 'S&P 500 + STOXX Europe 600 + Russell 2000 + 14 Thématiques AT.S (via Daily Snapshot)',
      tickers: MASTER_STOCKS_UNIVERSE,
      group: 'core',
    },
    {
      id: 'sp500',
      label: `S&P 500 (${UNIQUE_SP500_TICKERS.length})`,
      description: 'Indice S&P 500 complet',
      tickers: UNIQUE_SP500_TICKERS,
      group: 'core',
    },
    {
      id: 'stoxx600',
      label: '🇪🇺 STOXX Europe 600',
      description: 'STOXX Europe 600 complet (iShares EXSA · .PA, .DE, .L, .SW, .AS, .MI, .MC, .ST, .CO...)',
      tickers: STOXX_600_FALLBACK_TICKERS,
      group: 'core',
    },
    {
      id: 'russell2000',
      label: '🇺🇸 Russell 2000',
      description: 'Russell 2000 Small-Caps complet (iShares IWM)',
      tickers: RUSSELL_2000_FALLBACK_TICKERS,
      group: 'core',
    },
    {
      id: 'thematic_all',
      label: `14 Thématiques AT.S (${ALL_THEMATIC_TICKERS.length})`,
      description: 'Toutes les valeurs des 14 listes sectorielles (IA, Uranium, Spatial, Quantique...)',
      tickers: ALL_THEMATIC_TICKERS,
      group: 'core',
    },
    {
      id: 'custom',
      label: 'Ma Watchlist',
      description: 'Watchlist personnalisée (localStorage)',
      tickers: null,
      group: 'core',
    },
    ...Object.values(THEMATIC_STOCK_LISTS).map((sector) => ({
      id: sector.id,
      label: `${sector.label} (${sector.tickers.length})`,
      description: sector.description,
      tickers: sector.tickers,
      group: 'thematic' as const,
    })),
  ],
  crypto: [
    {
      id: 'top100',
      label: `Top 100 Crypto (${TOP_100_CRYPTO_TICKERS.length})`,
      description: 'Top 100 paires crypto USDT',
      tickers: TOP_100_CRYPTO_TICKERS,
      group: 'core',
    },
    {
      id: 'top25',
      label: 'Top 25 Crypto',
      description: 'Top 25 majors crypto',
      tickers: TOP_25_CRYPTO_TICKERS,
      group: 'core',
    },
    {
      id: 'custom',
      label: 'Ma Watchlist',
      description: 'Watchlist crypto personnalisée',
      tickers: null,
      group: 'core',
    },
  ],
  forex: [
    {
      id: 'top50',
      label: `Top 50 FX & USD (${TOP_50_FOREX_TICKERS.length})`,
      description: '50 paires de devises flottantes USD & G10',
      tickers: TOP_50_FOREX_TICKERS,
      group: 'core',
    },
    {
      id: 'custom',
      label: 'Ma Watchlist',
      description: 'Watchlist FX personnalisée',
      tickers: null,
      group: 'core',
    },
  ],
};
