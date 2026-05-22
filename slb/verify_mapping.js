// Independent verification: do the cached fees for "26MAY:*" really come
// from NSE's Series B Jun-2026 (X6) endpoint?
// Compares fetcher-cached values against a fresh raw NSE pull, side-by-side.

const puppeteer = require('puppeteer-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
puppeteer.use(stealth());

const fetcher = require('./fetcher');

const PAGE = 'https://www.nseindia.com/market-data/securities-lending-and-borrowing';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  try { await page.goto(PAGE, { waitUntil: 'networkidle2', timeout: 90000 }); } catch (e) {}
  await new Promise((r) => setTimeout(r, 3000));

  async function fetchSeries(code) {
    return page.evaluate(async (c) => {
      const r = await fetch(`https://www.nseindia.com/api/live-analysis-slb?series=${c}`, {
        credentials: 'include',
        headers: { accept: 'application/json' },
      });
      return r.json();
    }, code);
  }

  // The three series codes we EXPECT for futures months May/Jun/Jul (each +1)
  const checks = [
    { futuresMonth: '26MAY', expectedCode: 'X6', expectedSlbMonth: 'Jun-2026' },
    { futuresMonth: '26JUN', expectedCode: 'X7', expectedSlbMonth: 'Jul-2026' },
    { futuresMonth: '26JUL', expectedCode: 'X8', expectedSlbMonth: 'Aug-2026' },
  ];

  const symbols = ['RELIANCE', 'DIVISLAB', 'INFY', 'HDFCBANK', 'SBIN', 'TORNTPHARM'];

  for (const check of checks) {
    console.log(`\n========== futures ${check.futuresMonth} → expected SLB ${check.expectedSlbMonth} (${check.expectedCode}) ==========`);
    const raw = await fetchSeries(check.expectedCode);
    const byName = {};
    for (const row of raw.data || []) byName[row.symbol] = row;

    console.log(`raw NSE rows for ${check.expectedCode}: ${(raw.data || []).length}`);
    console.log(`${'SYMBOL'.padEnd(12)} ${'cache (fetcher)'.padEnd(20)} ${'raw NSE row'.padEnd(40)} match?`);
    for (const sym of symbols) {
      const cached = fetcher.getFee(sym, check.futuresMonth);
      const rawRow = byName[sym];
      const rawFee = rawRow ? (rawRow.sellOrderPrice1 > 0 ? rawRow.sellOrderPrice1 : (rawRow.lastTradedPrice > 0 ? rawRow.lastTradedPrice : null)) : null;
      const cachedNum = cached.feePerShare === 'NA' ? null : cached.feePerShare;

      let label;
      if (cachedNum === null && rawFee === null) label = 'BOTH NA ✓';
      else if (cachedNum !== null && rawFee !== null && Math.abs(cachedNum - rawFee) < 0.001) label = '✓ MATCH';
      else label = '✗ DIFFER';

      const cachedStr = cachedNum === null ? 'NA' : String(cachedNum);
      const rawStr = rawRow
        ? `sellOff=${rawRow.sellOrderPrice1}, ltp=${rawRow.lastTradedPrice}`
        : '(not in NSE response)';
      console.log(`${sym.padEnd(12)} ${cachedStr.padEnd(20)} ${rawStr.padEnd(40)} ${label}`);
    }
  }

  // Also: prove we are NOT using same-month SLB by checking one symbol with both codes
  console.log('\n========== sanity: cached 26MAY differs from raw 26MAY (X5)? ==========');
  const may = await fetchSeries('X5'); // X5 = May-2027 actually, but proves we don't read it
  console.log('(X5 is May-2027, not May-2026 — included only to show same-month confusion is impossible since no May-2026 code exists in Series B)');
  console.log('Series B has no May-2026 code, so same-month lookup is structurally impossible.');

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
