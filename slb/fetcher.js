// SLB fee fetcher.
// Public API:
//   refresh()                                 -> Promise<{ ok, fetchedAt, monthsFetched, symbolsLoaded }>
//   getFee(stockSymbol, futuresMonthSymbol)   -> { feePerShare: number } | { feePerShare: 'NA' }
//   getStatus()                               -> { fetchedAt, monthsLoaded, totalRows, lastError }
//
// Strategy:
//   - puppeteer-extra + stealth to warm NSE cookies on the SLB page.
//   - Then in-page fetch() against /api/live-analysis-slb?series=<code>.
//   - Series B only, one code per month (plain monthlies, no sub-series).
//   - Futures month N → SLB month N+1 (SLB contract expires ~1 week after futures).
//   - Persist last good fetch to slb/last.json (atomic write) so a restart keeps data.

const puppeteer = require('puppeteer-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

puppeteer.use(stealth());

const PAGE_URL = 'https://www.nseindia.com/market-data/securities-lending-and-borrowing';
const MASTER_URL = 'https://www.nseindia.com/api/live-analysis-slb-series-master';
const LIVE_URL = (code) => `https://www.nseindia.com/api/live-analysis-slb?series=${encodeURIComponent(code)}`;
const STORE_PATH = path.join(__dirname, 'last.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const MONTH_SHORT = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const MONTH_NSE = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

let state = {
  fetchedAt: null,
  fees: {},        // "26JUN:RELIANCE" -> number (₹/share). Missing key => NA.
  monthsLoaded: [],
  lastError: null,
  refreshing: false,
};

loadFromDisk();

function nextMonthNseFormat(futuresMonthSymbol) {
  const m = /^(\d{2})([A-Z]{3})$/.exec(futuresMonthSymbol);
  if (!m) throw new Error(`Bad futures month symbol: ${futuresMonthSymbol}`);
  const yy = parseInt(m[1], 10);
  const idx = MONTH_SHORT.indexOf(m[2]);
  if (idx < 0) throw new Error(`Bad month: ${m[2]}`);
  const nextIdx = (idx + 1) % 12;
  const nextYY = idx === 11 ? yy + 1 : yy;
  return `${MONTH_NSE[nextIdx]}-20${String(nextYY).padStart(2, '0')}`;
}

function feeKey(futuresMonthSymbol, stockSymbol) {
  return `${futuresMonthSymbol}:${stockSymbol}`;
}

function pickFeePerShare(row) {
  if (row.sellOrderPrice1 && row.sellOrderPrice1 > 0) return row.sellOrderPrice1;
  if (row.lastTradedPrice && row.lastTradedPrice > 0) return row.lastTradedPrice;
  return null;
}

function loadFromDisk() {
  try {
    if (!fs.existsSync(STORE_PATH)) return;
    const raw = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    state.fetchedAt = raw.fetchedAt || null;
    state.fees = raw.fees || {};
    state.monthsLoaded = raw.monthsLoaded || [];
    console.log(`[slb] loaded ${Object.keys(state.fees).length} cached fees from disk (fetchedAt=${state.fetchedAt})`);
  } catch (e) {
    console.log(`[slb] could not load ${STORE_PATH}: ${e.message}`);
  }
}

function persistToDisk() {
  const tmp = STORE_PATH + '.tmp';
  const payload = {
    fetchedAt: state.fetchedAt,
    monthsLoaded: state.monthsLoaded,
    fees: state.fees,
  };
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
  fs.renameSync(tmp, STORE_PATH);
}

async function refresh(futuresMonthSymbols) {
  if (state.refreshing) {
    console.log('[slb] refresh already in progress, skipping');
    return { ok: false, reason: 'in_progress' };
  }
  state.refreshing = true;
  let browser;
  try {
    if (!Array.isArray(futuresMonthSymbols) || futuresMonthSymbols.length === 0) {
      throw new Error('refresh requires a list of futures month symbols (e.g. ["26MAY","26JUN","26JUL"])');
    }

    console.log(`[slb] refresh starting for futures months: ${futuresMonthSymbols.join(', ')}`);
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
    });
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setExtraHTTPHeaders({ 'accept-language': 'en-US,en;q=0.9' });

    try {
      await page.goto(PAGE_URL, { waitUntil: 'networkidle2', timeout: 90000 });
    } catch (e) {
      console.log(`[slb] page goto warning: ${e.message} (continuing)`);
    }
    await new Promise((r) => setTimeout(r, 3000));

    const fetchJson = (url) => page.evaluate(async (u) => {
      const r = await fetch(u, { credentials: 'include', headers: { 'accept': 'application/json' } });
      const t = await r.text();
      try { return { status: r.status, body: JSON.parse(t) }; }
      catch { return { status: r.status, body: t.slice(0, 200) }; }
    }, url);

    const masterRes = await fetchJson(MASTER_URL);
    if (masterRes.status !== 200 || !masterRes.body?.data?.['Series B']) {
      throw new Error(`series-master fetch failed: status=${masterRes.status} body=${JSON.stringify(masterRes.body).slice(0,200)}`);
    }
    const seriesB = masterRes.body.data['Series B'];
    const seriesBMap = {};
    for (const entry of seriesB) {
      // Skip sub-series like "Jun-2026(U1)**", keep plain "Jun-2026"
      if (!/^[A-Z][a-z]{2}-\d{4}$/.test(entry.value)) continue;
      seriesBMap[entry.value] = entry.key;
    }
    console.log(`[slb] Series B monthly codes: ${JSON.stringify(seriesBMap)}`);

    const newFees = {};
    const monthsLoaded = [];

    for (const futMonth of futuresMonthSymbols) {
      let slbMonthName;
      try { slbMonthName = nextMonthNseFormat(futMonth); }
      catch (e) { console.log(`[slb] skip ${futMonth}: ${e.message}`); continue; }

      const code = seriesBMap[slbMonthName];
      if (!code) {
        console.log(`[slb] no Series B code for ${slbMonthName} (futures ${futMonth}) — leaving rows as NA`);
        continue;
      }

      const liveRes = await fetchJson(LIVE_URL(code));
      if (liveRes.status !== 200 || !Array.isArray(liveRes.body?.data)) {
        console.log(`[slb] live fetch failed for ${slbMonthName}/${code}: status=${liveRes.status}`);
        continue;
      }

      let rowsWithFee = 0;
      for (const row of liveRes.body.data) {
        if (!row.symbol) continue;
        const fee = pickFeePerShare(row);
        if (fee == null) continue;
        newFees[feeKey(futMonth, row.symbol)] = fee;
        rowsWithFee++;
      }
      console.log(`[slb] ${futMonth} → ${slbMonthName} (${code}): ${liveRes.body.data.length} rows, ${rowsWithFee} priced`);
      monthsLoaded.push({ futuresMonth: futMonth, slbMonth: slbMonthName, code, priced: rowsWithFee });
    }

    state.fees = newFees;
    state.monthsLoaded = monthsLoaded;
    state.fetchedAt = new Date().toISOString();
    state.lastError = null;
    persistToDisk();

    console.log(`[slb] refresh complete: ${Object.keys(newFees).length} priced (symbol,month) pairs across ${monthsLoaded.length} months`);
    return { ok: true, fetchedAt: state.fetchedAt, monthsLoaded, symbolsLoaded: Object.keys(newFees).length };
  } catch (e) {
    state.lastError = e.message;
    console.error(`[slb] refresh failed: ${e.message}`);
    return { ok: false, error: e.message };
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
    state.refreshing = false;
  }
}

function getFee(stockSymbol, futuresMonthSymbol) {
  const v = state.fees[feeKey(futuresMonthSymbol, stockSymbol)];
  if (typeof v === 'number' && v > 0) return { feePerShare: v };
  return { feePerShare: 'NA' };
}

function getStatus() {
  return {
    fetchedAt: state.fetchedAt,
    monthsLoaded: state.monthsLoaded,
    totalRows: Object.keys(state.fees).length,
    lastError: state.lastError,
    refreshing: state.refreshing,
  };
}

module.exports = { refresh, getFee, getStatus, nextMonthNseFormat };
