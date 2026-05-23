require('dotenv').config();

const express = require('express');
const axios = require('axios');
const KiteTicker = require('kiteconnect').KiteTicker;
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const { forceLogin, getKite } = require('./kite-auto-auth');
const timeUtils = require('./utils/timeUtils');
const slbFetcher = require('./slb/fetcher');

// Initialize environment variables and create config
function initializeConfig() {
  if (process.env.KITE_API_KEY) {
    console.log('Using environment variables for configuration');
    
    const config = {
      username: process.env.KITE_USERNAME,
      password: process.env.KITE_PASSWORD,
      totpSecret: process.env.KITE_TOTP_SECRET,
      apiKey: process.env.KITE_API_KEY,
      apiSecret: process.env.KITE_API_SECRET
    };

    const required = ['KITE_USERNAME', 'KITE_PASSWORD', 'KITE_TOTP_SECRET', 'KITE_API_KEY', 'KITE_API_SECRET'];
    for (const field of required) {
      if (!process.env[field]) {
        throw new Error(`Environment variable ${field} is required`);
      }
    }

    try {
      const configPath = path.join(__dirname, 'kite-auto-auth', 'config.json');
      const configDir = path.dirname(configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      console.log('Created config.json from environment variables');
    } catch (writeError) {
      console.log('Cannot write config.json (read-only filesystem), using environment variables directly');
      global.kiteConfig = config;
    }
  } else {
    console.log('Using existing config.json file');
  }
}

// Initialize configuration
initializeConfig();

const app = express();
const PORT = process.env.PORT || 3000;
console.log(`🔧 Using PORT: ${PORT}`);

const corsOptions = {
  origin: process.env.NODE_ENV === 'production'
    ? [process.env.FRONTEND_URL].filter(Boolean)
    : ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.static('public'));

// Store global state
let accessToken = null;
let kite = null;
let ticker = null;
let equityInstruments = [];
let futuresInstruments = [];
let tickData = {};
let arbitrageData = [];
let reverseArbitrageData = [];
let isInitialized = false;

// Daily lifecycle state machine.
// States: OFFLINE (default outside market hours / weekends),
//         WARMUP  (07:30–08:59 IST weekdays: fresh login, instruments, one SLB fetch),
//         LIVE    (09:00–15:29 IST weekdays: ticker + 60s quote poll + hourly SLB).
// At 15:30 IST → OFFLINE: intervals cleared, ticker disconnected, last data frozen in memory.
let state = 'OFFLINE';
let quotesInterval = null;
let slbInterval = null;
let masterTickInterval = null;
let lastWarmupDay = null;      // IST 'YYYY-MM-DD' — WARMUP runs at most once per calendar day.
let warmupAttempts = 0;
let lastWarmupAttemptAt = 0;

// Get futures expiry dates from actual instruments
function getFuturesExpiries() {
  // Get unique expiry dates from futures instruments
  const expiryMap = new Map();
  
  futuresInstruments.forEach(inst => {
    if (inst.instrument_type === 'FUT' && inst.expiry) {
      const expiryDate = new Date(inst.expiry);
      const expiryStr = inst.expiry;
      
      // Store the actual expiry date and corresponding symbol format
      if (!expiryMap.has(expiryStr)) {
        // Extract the symbol format from tradingsymbol
        // Examples: RELIANCE26MAYFUT, TCS26JUNFUT, INFY26JULFUT
        const match = inst.tradingsymbol.match(/[A-Z]+(\d{2}[A-Z]{3})FUT$/);
        if (match) {
          expiryMap.set(expiryStr, {
            date: expiryDate,
            symbol: match[1], // This gets "26MAY", "26JUN", etc.
            timestamp: expiryDate.getTime()
          });
        }
      }
    }
  });
  
  // Sort expiries by date and take first 3 unique ones
  const sortedExpiries = Array.from(expiryMap.values())
    .sort((a, b) => a.timestamp - b.timestamp)
    .filter((exp, index, self) => 
      index === self.findIndex(e => e.symbol === exp.symbol)
    )
    .slice(0, 3);
  
  // Map to current/next/far
  const expiries = sortedExpiries.map((exp, index) => ({
    type: index === 0 ? 'current' : index === 1 ? 'next' : 'far',
    date: exp.date,
    symbol: exp.symbol
  }));
  
  console.log('Actual expiries from instruments:', expiries.map(e => `${e.type}: ${e.symbol} (${e.date.toISOString().split('T')[0]})`));
  
  return expiries;
}

// Get F&O stocks and their futures
async function loadInstruments() {
  try {
    console.log('Loading instruments...');
    // Get instruments separately for each exchange
    const nseInstruments = await kite.getInstruments('NSE');
    const nfoInstruments = await kite.getInstruments('NFO');
    
    // Combine the instruments
    const allInstruments = [...nseInstruments, ...nfoInstruments];
    
    // Filter equity instruments (F&O stocks)
    equityInstruments = nseInstruments.filter(inst => 
      inst.instrument_type === 'EQ'
    );
    
    // Filter futures instruments
    futuresInstruments = nfoInstruments.filter(inst => 
      inst.instrument_type === 'FUT' &&
      inst.segment === 'NFO-FUT'
    );
    
    console.log(`Loaded ${equityInstruments.length} equity instruments`);
    console.log(`Loaded ${futuresInstruments.length} futures instruments`);
    
    return true;
  } catch (error) {
    console.error('Error loading instruments:', error);
    console.error('Error details:', error.message, error.data);
    return false;
  }
}

// Cache for charges calculation - separate caches for different order types
let chargesCache = {
  arbitrage: {},    // Buy spot, sell futures
  reverse: {},      // Sell spot (SLB), buy futures
  timestamp: {}     // Track when each was last updated
};

function cacheChargesFromResponse(response, cacheCategory, cacheKey, equityPrice, futuresPrice, lotSize, { logDetails = false, symbol = '' } = {}) {
  if (!response || !response.orders || response.orders.length === 0) return null;

  let totalCharge = 0;
  response.orders.forEach(order => {
    const c = order.charges || {};
    const orderCharge = (
      (c.transaction_tax || 0) +
      (c.exchange_turnover_charge || 0) +
      (c.sebi_turnover_charge || 0) +
      (c.brokerage || 0) +
      (c.stamp_duty || 0) +
      (c.gst?.total || c.gst || 0)
    );
    totalCharge += orderCharge;
    if (logDetails) {
      console.log(`    Order ${order.tradingsymbol}: ₹${orderCharge.toFixed(2)}`);
    }
  });

  const totalValue = (equityPrice * lotSize) + (futuresPrice * lotSize);
  const chargePercent = (totalCharge / totalValue) * 200;
  const marginRequired = response.final?.total || 0;

  if (logDetails) {
    console.log(`💰 Charges for ${symbol}: Total=₹${totalCharge.toFixed(2)} (${chargePercent.toFixed(3)}%)`);
    console.log(`   Lot Size: ${lotSize}, Trade Value: ₹${totalValue.toFixed(2)}`);
    console.log(`   Margin Required: ₹${marginRequired}`);
  }

  cacheCategory[cacheKey] = { chargePercent, chargeAmount: totalCharge, lotSize, marginRequired };
  chargesCache.timestamp[cacheKey] = Date.now();
  return cacheCategory[cacheKey];
}

// Get actual charges using Kite margins API
async function getActualCharges(symbol, equityPrice, futuresPrice, futuresSymbol, orderType = 'arbitrage') {
  try {
    console.log(`🔍 Calculating charges for ${symbol} (${futuresSymbol}): Spot=₹${equityPrice}, Futures=₹${futuresPrice}, Type=${orderType}`);
    
    // Cache key includes symbol, futures contract, and order type
    const cacheKey = `${symbol}_${futuresSymbol}_${orderType}`;
    const cacheCategory = orderType === 'reverse' ? chargesCache.reverse : chargesCache.arbitrage;
    
    // Check cache first (refresh every 10 minutes per symbol)
    if (cacheCategory[cacheKey] && chargesCache.timestamp[cacheKey] && 
        (Date.now() - chargesCache.timestamp[cacheKey] < 10 * 60 * 1000)) {
      const cachedData = cacheCategory[cacheKey];
      if (cachedData && typeof cachedData.chargePercent === 'number') {
        console.log(`📋 Using cached charges for ${symbol} (${orderType}): ${cachedData.chargePercent.toFixed(3)}%`);
        return cachedData;
      }
    }
    
    // Find the futures instrument to get lot size
    const futureInst = futuresInstruments.find(inst => 
      inst.tradingsymbol === futuresSymbol
    );
    const lotSize = futureInst ? futureInst.lot_size : 1;
    
    // Create basket based on order type
    const basket = orderType === 'reverse' ? [
      {
        exchange: "NSE",
        tradingsymbol: symbol,
        transaction_type: "SELL",  // Sell spot (via SLB)
        variety: "regular",
        product: "MIS",  // Intraday for SLB
        order_type: "MARKET",
        quantity: lotSize,
        price: equityPrice
      },
      {
        exchange: "NFO",
        tradingsymbol: futuresSymbol,
        transaction_type: "BUY",  // Buy futures
        variety: "regular", 
        product: "NRML",
        order_type: "MARKET",
        quantity: lotSize,
        price: futuresPrice
      }
    ] : [
      {
        exchange: "NSE",
        tradingsymbol: symbol,
        transaction_type: "BUY",  // Buy spot
        variety: "regular",
        product: "CNC",
        order_type: "MARKET",
        quantity: lotSize,
        price: equityPrice
      },
      {
        exchange: "NFO",
        tradingsymbol: futuresSymbol,
        transaction_type: "SELL",  // Sell futures
        variety: "regular", 
        product: "NRML",
        order_type: "MARKET",
        quantity: lotSize,
        price: futuresPrice
      }
    ];
    
    // Get basket margins and charges
    const response = await kite.orderBasketMargins(basket);
    const result = cacheChargesFromResponse(response, cacheCategory, cacheKey, equityPrice, futuresPrice, lotSize, { logDetails: true, symbol });
    if (result) return result;

    // Response invalid, retry once after a small delay
    console.log(`⚠️ Invalid response for ${symbol}, retrying...`);
    await new Promise(resolve => setTimeout(resolve, 1000));

    try {
      const retryResponse = await kite.orderBasketMargins(basket);
      const retryResult = cacheChargesFromResponse(retryResponse, cacheCategory, cacheKey, equityPrice, futuresPrice, lotSize);
      if (retryResult) {
        console.log(`✅ Retry successful for ${symbol}`);
        return retryResult;
      }
    } catch (retryError) {
      console.log(`❌ Retry failed for ${symbol}: ${retryError.message}`);
    }

    return null;

  } catch (error) {
    console.log(`❌ Charges API error for ${symbol}: ${error.message}`);

    // If rate limit error, wait and retry
    if (error.message && error.message.includes('rate')) {
      console.log(`⏳ Rate limited, waiting 2 seconds...`);
      await new Promise(resolve => setTimeout(resolve, 2000));

      try {
        const retryResponse = await kite.orderBasketMargins(basket);
        const retryResult = cacheChargesFromResponse(retryResponse, cacheCategory, cacheKey, equityPrice, futuresPrice, lotSize);
        if (retryResult) {
          console.log(`✅ Retry successful after rate limit for ${symbol}`);
          return retryResult;
        }
      } catch (retryError) {
        console.log(`❌ Retry after rate limit failed: ${retryError.message}`);
      }
    }

    return null;
  }
}

// Calculate arbitrage opportunities
async function calculateArbitrage(symbol, equityPrice, futuresPrice, expiryDays, futuresSymbol, expiryMonthSymbol) {
  if (!equityPrice || !futuresPrice || equityPrice <= 0 || futuresPrice <= 0) {
    return null;
  }

  const difference = futuresPrice - equityPrice;
  const percentageDiff = (difference / equityPrice) * 100;
  const orderType = difference < 0 ? 'reverse' : 'arbitrage';

  if (!kite) return null;

  const chargesData = await getActualCharges(symbol, equityPrice, futuresPrice, futuresSymbol, orderType);
  if (!chargesData) {
    console.log(`  ⚠️ No charges data for ${symbol}, skipping`);
    return null;
  }

  const charges = chargesData.chargePercent;
  console.log(`  📊 ${symbol}: Diff=${percentageDiff.toFixed(2)}%, Charges=${charges.toFixed(2)}%`);

  // Reverse arbitrage: subtract absolute SLB fee + charges per share, then convert to %.
  if (difference < 0) {
    const { feePerShare } = slbFetcher.getFee(symbol, expiryMonthSymbol);
    const base = {
      difference: difference.toFixed(2),
      percentageDiff: percentageDiff.toFixed(2),
      actualCharges: charges.toFixed(3),
      lotSize: chargesData.lotSize,
      marginRequired: chargesData.marginRequired,
    };
    if (feePerShare === 'NA') {
      return { ...base, slbFee: 'NA', netReturn: 'NA', annualizedReturn: 'NA' };
    }
    const chargesPerShare = chargesData.chargeAmount / chargesData.lotSize;
    const profitPerShare = equityPrice - futuresPrice;
    const netPerShare = profitPerShare - chargesPerShare - feePerShare;
    const netReturnPercent = (netPerShare / equityPrice) * 100;
    const annualizedReturn = (Math.abs(netReturnPercent) * 365) / expiryDays;
    return {
      ...base,
      slbFee: feePerShare.toFixed(2),
      netReturn: netReturnPercent.toFixed(2),
      annualizedReturn: annualizedReturn.toFixed(2),
    };
  }

  // Normal arbitrage (futures at premium): unchanged
  const netReturn = percentageDiff - charges;
  const annualizedReturn = (Math.abs(netReturn) * 365) / expiryDays;
  return {
    difference: difference.toFixed(2),
    percentageDiff: percentageDiff.toFixed(2),
    netReturn: netReturn.toFixed(2),
    annualizedReturn: annualizedReturn.toFixed(2),
    actualCharges: charges.toFixed(3),
    lotSize: chargesData.lotSize,
    marginRequired: chargesData.marginRequired,
  };
}

// Start WebSocket ticker for live data
async function startTicker() {
  try {
    if (!accessToken || !kite) {
      console.error('Cannot start ticker - not authenticated');
      return false;
    }
    
    const apiKey = global.kiteConfig?.apiKey || process.env.KITE_API_KEY;
    ticker = new KiteTicker({
      api_key: apiKey,
      access_token: accessToken
    });
    
    ticker.connect();
    
    ticker.on('ticks', (ticks) => {
      console.log(`Received ${ticks.length} ticks`);
      ticks.forEach(tick => {
        tickData[tick.instrument_token] = tick;
      });
      console.log(`Total tick data points: ${Object.keys(tickData).length}`);
      updateArbitrageData();
    });
    
    ticker.on('connect', () => {
      console.log('✅ WebSocket connected');
      // Gate resubscribe on state — a reconnect during WIND_DOWN must not
      // re-subscribe and start pulling ticks after 15:30.
      if (state === 'LIVE') subscribeToInstruments();
      else console.log(`[scheduler] suppressing resubscribe (state=${state})`);
    });
    
    ticker.on('disconnect', () => {
      console.log('⚠️ WebSocket disconnected');
    });
    
    ticker.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
    
    ticker.on('order_update', (order) => {
      console.log('Order update:', order);
    });
    
    ticker.on('message', (msg) => {
      console.log('WebSocket message:', msg);
    });
    
    return true;
  } catch (error) {
    console.error('Error starting ticker:', error);
    return false;
  }
}

// Subscribe to instruments for live data
function subscribeToInstruments() {
  if (!ticker) return;
  
  // Get top F&O stocks (limit to prevent overwhelming)
  const topStocks = ['RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 
                    'HDFC', 'SBIN', 'BHARTIARTL', 'KOTAKBANK', 'ITC',
                    'AXISBANK', 'LT', 'WIPRO', 'BAJFINANCE', 'MARUTI'];
  
  const tokens = [];
  const expiries = getFuturesExpiries();
  
  topStocks.forEach(symbol => {
    // Find equity instrument
    const equity = equityInstruments.find(inst => inst.tradingsymbol === symbol);
    if (equity) {
      tokens.push(equity.instrument_token);
    }
    
    // Find futures for current month
    expiries.forEach(expiry => {
      const futureSymbol = `${symbol}${expiry.symbol}FUT`;
      const future = futuresInstruments.find(inst => 
        inst.tradingsymbol === futureSymbol
      );
      if (future) {
        tokens.push(future.instrument_token);
      }
    });
  });
  
  if (tokens.length > 0) {
    console.log('Subscribing to tokens:', tokens);
    ticker.subscribe(tokens);
    // Use modeLTP for testing - just get last traded price
    ticker.setMode(ticker.modeLTP, tokens);
    console.log(`Subscribed to ${tokens.length} instruments in LTP mode`);
    
    // Log what we're subscribing to
    topStocks.slice(0, 3).forEach(symbol => {
      const equity = equityInstruments.find(inst => inst.tradingsymbol === symbol);
      if (equity) {
        console.log(`${symbol}: token=${equity.instrument_token}, exchange=${equity.exchange}`);
      }
    });
  } else {
    console.log('WARNING: No tokens to subscribe to!');
  }
}

// Update arbitrage data
async function updateArbitrageData() {
  arbitrageData = [];
  reverseArbitrageData = [];
  
  const expiries = getFuturesExpiries();
  const today = new Date();
  
  // Get all stocks that have tick data
  const stocksWithData = new Set();
  Object.values(tickData).forEach(tick => {
    if (tick.exchange === 'NSE' && tick.tradingsymbol) {
      stocksWithData.add(tick.tradingsymbol);
    }
  });
  
  const allStocks = Array.from(stocksWithData);
  console.log(`Checking arbitrage for ${allStocks.length} stocks`);
  console.log(`Total tick data entries: ${Object.keys(tickData).length}`);
  
  // Process all stocks in parallel for better performance
  const promises = [];
  
  for (const symbol of allStocks) {
    // Find equity tick data by symbol
    const equityKey = `NSE:${symbol}`;
    const equityTick = Object.values(tickData).find(tick => 
      tick.exchange === 'NSE' && tick.tradingsymbol === symbol
    );
    
    if (!equityTick || !equityTick.last_price) continue;
    
    for (const expiry of expiries) {
      // Calculate days to this specific expiry
      const daysToExpiry = Math.max(1, Math.ceil((expiry.date - today) / (1000 * 60 * 60 * 24)));
      
      // Find futures tick data
      const futureSymbol = `${symbol}${expiry.symbol}FUT`;
      const futureTick = Object.values(tickData).find(tick => 
        tick.exchange === 'NFO' && tick.tradingsymbol === futureSymbol
      );
      
      if (!futureTick || !futureTick.last_price) continue;
      
      const equityPrice = equityTick.last_price;
      const futuresPrice = futureTick.last_price;

      // Create async promise for calculating arbitrage with actual charges
      const promise = calculateArbitrage(symbol, equityPrice, futuresPrice, daysToExpiry, futureSymbol, expiry.symbol)
        .then(arb => {
          if (!arb) return;

          const dataPoint = {
            symbol,
            equityPrice: equityPrice.toFixed(2),
            futuresPrice: futuresPrice.toFixed(2),
            expiryType: expiry.type,
            expiry: expiry.symbol,
            daysToExpiry,
            ...arb
          };

          // Normal arbitrage (futures at premium)
          if (parseFloat(arb.difference) > 0 && parseFloat(arb.netReturn) > 0) {
            console.log(`✅ Normal arbitrage: ${symbol} - Net Return: ${arb.netReturn}%`);
            arbitrageData.push(dataPoint);
          }

          // Reverse arbitrage (futures at discount):
          // - show profitable rows (netReturn > 0)
          // - also show rows with no SLB data (slbFee === 'NA') so the trader sees the opportunity exists
          if (parseFloat(arb.difference) < 0) {
            if (arb.slbFee === 'NA' || parseFloat(arb.netReturn) > 0) {
              console.log(`✅ Reverse arbitrage: ${symbol} - SLB: ${arb.slbFee}, Net Return: ${arb.netReturn}`);
              reverseArbitrageData.push(dataPoint);
            }
          }
        });
      
      promises.push(promise);
    }
  }
  
  // Wait for all calculations to complete
  await Promise.all(promises);
  
  // Sort by annualized returns; reverse-arb sorted by discount magnitude with NA-SLB rows last.
  arbitrageData.sort((a, b) => parseFloat(b.annualizedReturn) - parseFloat(a.annualizedReturn));
  reverseArbitrageData.sort((a, b) => {
    const aNa = a.slbFee === 'NA';
    const bNa = b.slbFee === 'NA';
    if (aNa !== bNa) return aNa ? 1 : -1;
    return Math.abs(parseFloat(b.difference)) - Math.abs(parseFloat(a.difference));
  });
  
  console.log(`Found ${arbitrageData.length} arbitrage and ${reverseArbitrageData.length} reverse arbitrage opportunities`);
  console.log(`Charges cached: ${Object.keys(chargesCache.arbitrage).length} arbitrage, ${Object.keys(chargesCache.reverse).length} reverse`);
}

// Fetch quotes via HTTP API
async function fetchQuotesPeriodically() {
  if (state !== 'LIVE') return; // gated: only LIVE makes Kite calls

  if (!kite || !isInitialized || futuresInstruments.length === 0) {
    console.log('  ❌ Skipping fetch due to missing requirements');
    return;
  }
  
  try {
    // Get ALL F&O stocks from futures instruments - NO LIMITS!
    const fnoStocks = new Set();
    futuresInstruments.forEach(inst => {
      if (inst.instrument_type === 'FUT' && inst.name !== 'NIFTY' && inst.name !== 'BANKNIFTY') {
        // Extract stock symbol from futures symbol (e.g., RELIANCE26MAYFUT -> RELIANCE)
        const match = inst.tradingsymbol.match(/^([A-Z]+)\d{2}[A-Z]{3}FUT$/);
        if (match) {
          fnoStocks.add(match[1]);
        }
      }
    });
    
    // Convert to array and sort
    const allFnOStocks = Array.from(fnoStocks).sort();
    console.log(`Found ${allFnOStocks.length} F&O stocks - fetching ALL of them!`);
    
    const expiries = getFuturesExpiries();
    
    if (expiries.length === 0) {
      console.log('No expiries found, skipping quote fetch');
      return;
    }
    
    // Build instrument list for ALL stocks and ALL expiry months
    const instruments = [];
    
    // Fetch ALL F&O stocks - no arbitrary limits!
    allFnOStocks.forEach(symbol => {
      instruments.push(`NSE:${symbol}`);
      expiries.forEach(expiry => {
        const futureSymbol = `NFO:${symbol}${expiry.symbol}FUT`;
        instruments.push(futureSymbol);
      });
    });
    
    console.log(`Fetching quotes for ${instruments.length} instruments (${allFnOStocks.length} stocks × ${expiries.length} expiries + spot prices)`);
    
    // Batch the requests to avoid rate limits - fetch in chunks
    let quotes = {};
    const batchSize = 500; // Kite allows up to 500 instruments per call
    
    for (let i = 0; i < instruments.length; i += batchSize) {
      const batch = instruments.slice(i, Math.min(i + batchSize, instruments.length));
      try {
        const batchQuotes = await kite.getQuote(batch);
        Object.assign(quotes, batchQuotes);
        console.log(`Fetched batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(instruments.length/batchSize)}: ${Object.keys(batchQuotes).length} quotes`);
      } catch (err) {
        console.log(`Error fetching batch ${Math.floor(i/batchSize) + 1}: ${err.message}`);
      }
      
      // Small delay between batches to avoid rate limiting
      if (i + batchSize < instruments.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    console.log(`✅ Successfully fetched ${Object.keys(quotes).length} quotes out of ${instruments.length} requested`);

    // Convert quotes to tick format and store
    Object.keys(quotes).forEach(key => {
      const quote = quotes[key];
      tickData[quote.instrument_token] = {
        instrument_token: quote.instrument_token,
        last_price: quote.last_price,
        volume: quote.volume,
        buy_quantity: quote.buy_quantity,
        sell_quantity: quote.sell_quantity,
        last_trade_time: quote.last_trade_time,
        exchange: key.split(':')[0],
        tradingsymbol: key.split(':')[1]
      };
    });
    
    console.log(`✅ Updated ${Object.keys(quotes).length} quotes`);
    console.log(`Total tickData entries after update: ${Object.keys(tickData).length}`);
    updateArbitrageData();
    
  } catch (error) {
    console.error('Error fetching quotes:', error.message);
  }
}

// ─── Daily lifecycle scheduler ────────────────────────────────────────────
// computeDesiredState: pure function of the IST clock.
// 07:30–08:59 WARMUP, 09:00–15:29 LIVE, else OFFLINE. Weekends always OFFLINE.
function computeDesiredState() {
  const ist = timeUtils.getISTTime();
  if (!timeUtils.isWeekday()) return 'OFFLINE';
  const mins = ist.hours * 60 + ist.minutes;
  if (mins < 7 * 60 + 30) return 'OFFLINE';   // before 07:30
  if (mins < 9 * 60) return 'WARMUP';         // 07:30 – 08:59
  if (mins < 15 * 60 + 30) return 'LIVE';     // 09:00 – 15:29
  return 'OFFLINE';                           // 15:30 onwards
}

// Run SLB refresh if there are expiries known.
function refreshSlbNow() {
  if (state !== 'LIVE' && state !== 'WARMUP') return;
  const months = getFuturesExpiries().map(e => e.symbol);
  if (months.length === 0) { console.log('[slb] no expiries yet, skipping refresh'); return; }
  return slbFetcher.refresh(months).catch(e => console.error('[slb] refresh failed:', e.message));
}

async function enterWarmup() {
  console.log(`[scheduler] WARMUP starting at ${timeUtils.getISTTime().formatted}`);
  const token = await forceLogin();
  if (!token) throw new Error('forceLogin returned no token');
  accessToken = token;
  kite = await getKite();
  console.log(`[scheduler] auth ok, token=${token.substring(0, 10)}…`);

  const ok = await loadInstruments();
  if (!ok) throw new Error('loadInstruments failed');

  await refreshSlbNow();

  isInitialized = true;
  lastWarmupDay = timeUtils.getISTTime().dateStr;
  warmupAttempts = 0;
  console.log(`[scheduler] WARMUP complete (lastWarmupDay=${lastWarmupDay})`);
}

async function enterLive() {
  console.log(`[scheduler] LIVE starting at ${timeUtils.getISTTime().formatted}`);
  const tickerOk = await startTicker();
  if (!tickerOk) console.log('[scheduler] ticker failed; HTTP quote polling will still run');

  quotesInterval = setInterval(fetchQuotesPeriodically, 60_000);
  fetchQuotesPeriodically(); // first fetch immediately

  slbInterval = setInterval(refreshSlbNow, 60 * 60 * 1000);
  console.log('[scheduler] LIVE intervals started');
}

function enterWindDown() {
  console.log(`[scheduler] WIND_DOWN at ${timeUtils.getISTTime().formatted}`);
  if (quotesInterval) { clearInterval(quotesInterval); quotesInterval = null; }
  if (slbInterval)    { clearInterval(slbInterval); slbInterval = null; }
  if (ticker) {
    try { if (typeof ticker.autoReconnect === 'function') ticker.autoReconnect(false, 0, 0); } catch {}
    try { ticker.disconnect(); } catch {}
    ticker = null;
  }
  console.log('[scheduler] wound down; serving frozen snapshot');
}

// State must be set BEFORE enter functions run, so the state-gates inside
// fetchQuotesPeriodically / refreshSlbNow / ticker.on('connect') don't block
// legitimate transition-time work. On failure, roll state back so the next
// tick retries.
async function masterTick() {
  const desired = computeDesiredState();
  if (desired === state) return;
  console.log(`[scheduler] tick: ${state} → ${desired}`);

  // Throttle WARMUP retries: after 3 failures in a row, back off 5 min.
  const warmupBackedOff = warmupAttempts >= 3 && Date.now() - lastWarmupAttemptAt < 5 * 60 * 1000;
  const todayStr = timeUtils.getISTTime().dateStr;

  if (state === 'LIVE' && desired === 'OFFLINE') {
    state = 'OFFLINE';                      // set first so on('connect') / late timers won't fire LIVE work
    enterWindDown();
    return;
  }

  if (desired === 'WARMUP') {
    if (lastWarmupDay === todayStr) { state = 'WARMUP'; return; }      // already warmed today
    if (warmupBackedOff) { console.log('[scheduler] WARMUP backoff active'); return; }
    lastWarmupAttemptAt = Date.now();
    const prev = state;
    state = 'WARMUP';
    try { await enterWarmup(); }
    catch (e) { state = prev; warmupAttempts++; console.error(`[scheduler] WARMUP failed (attempt ${warmupAttempts}): ${e.message}`); }
    return;
  }

  if (state === 'WARMUP' && desired === 'LIVE') {
    state = 'LIVE';
    try { await enterLive(); }
    catch (e) { state = 'WARMUP'; console.error(`[scheduler] LIVE entry failed: ${e.message}`); }
    return;
  }

  if (state === 'OFFLINE' && desired === 'LIVE') {
    // Restart mid-LIVE: run WARMUP first if today's hasn't happened.
    if (lastWarmupDay !== todayStr) {
      if (warmupBackedOff) { console.log('[scheduler] WARMUP backoff active'); return; }
      lastWarmupAttemptAt = Date.now();
      state = 'WARMUP';
      try { await enterWarmup(); }
      catch (e) { state = 'OFFLINE'; warmupAttempts++; console.error(`[scheduler] WARMUP failed (attempt ${warmupAttempts}): ${e.message}`); return; }
    }
    state = 'LIVE';
    try { await enterLive(); }
    catch (e) { state = 'OFFLINE'; console.error(`[scheduler] LIVE entry failed: ${e.message}`); }
    return;
  }

  // Catch-all (e.g. WARMUP → OFFLINE without ever going LIVE — unlikely but safe to handle)
  console.log(`[scheduler] unhandled transition ${state} → ${desired}; updating state only`);
  state = desired;
}

// API Endpoints
app.get('/api/status', (req, res) => {
  res.json({
    authenticated: !!accessToken,
    connected: !!ticker,
    instrumentsLoaded: equityInstruments.length > 0,
    dataPoints: Object.keys(tickData).length,
    isInitialized,
    state,
    desiredState: computeDesiredState(),
    lastWarmupDay,
    warmupAttempts,
    istNow: timeUtils.getISTTime().formatted,
    slb: slbFetcher.getStatus(),
  });
});

app.get('/api/arbitrage/:type/:month', (req, res) => {
  const { type, month } = req.params;
  
  if (type === 'normal') {
    const filtered = month === 'all' 
      ? arbitrageData 
      : arbitrageData.filter(d => d.expiryType === month);
    res.json(filtered);
  } else if (type === 'reverse') {
    const filtered = month === 'all' 
      ? reverseArbitrageData 
      : reverseArbitrageData.filter(d => d.expiryType === month);
    res.json(filtered);
  } else {
    res.status(400).json({ error: 'Invalid type' });
  }
});

app.get('/api/expiries', (req, res) => {
  res.json(getFuturesExpiries());
});

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve the reverse arbitrage page
app.get('/reverse', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'reverse.html'));
});

// Start server
app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}`);

  // Catch up to current state immediately, then re-evaluate every minute.
  await masterTick();
  masterTickInterval = setInterval(masterTick, 60_000);
});