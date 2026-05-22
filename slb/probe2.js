// Probe 2: warm cookies on the SLB page, then hit the JSON APIs from
// inside the browser context and dump shape + sample rows.

const puppeteer = require('puppeteer-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
puppeteer.use(stealth());

const PAGE = 'https://www.nseindia.com/market-data/securities-lending-and-borrowing';

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setExtraHTTPHeaders({ 'accept-language': 'en-US,en;q=0.9' });

  console.log('[probe2] warming cookies via page navigation...');
  try {
    await page.goto(PAGE, { waitUntil: 'networkidle2', timeout: 90000 });
  } catch (e) { console.log('[probe2] goto warn:', e.message); }
  await new Promise((r) => setTimeout(r, 4000));

  async function fetchJson(url) {
    return page.evaluate(async (u) => {
      const r = await fetch(u, { credentials: 'include', headers: { 'accept': 'application/json' } });
      const text = await r.text();
      let body;
      try { body = JSON.parse(text); } catch { body = text.slice(0, 300); }
      return { status: r.status, body };
    }, url);
  }

  console.log('\n=== series master ===');
  const master = await fetchJson('https://www.nseindia.com/api/live-analysis-slb-series-master');
  console.log(JSON.stringify(master, null, 2));

  console.log('\n=== live-analysis-slb?series=06 (first row + keys) ===');
  const live = await fetchJson('https://www.nseindia.com/api/live-analysis-slb?series=06');
  if (live.body && typeof live.body === 'object') {
    console.log('top-level keys:', Object.keys(live.body));
    const data = live.body.data || live.body.rows || live.body;
    if (Array.isArray(data) && data.length) {
      console.log('row count:', data.length);
      console.log('first row keys:', Object.keys(data[0]));
      console.log('first 3 rows:');
      console.log(JSON.stringify(data.slice(0, 3), null, 2));
    } else {
      console.log('(no obvious array of rows; dumping body head)');
      console.log(JSON.stringify(live.body).slice(0, 2000));
    }
  } else {
    console.log(live);
  }

  console.log('\n=== price-watch-slb?series=06 (first row + keys) ===');
  const pw = await fetchJson('https://www.nseindia.com/api/price-watch-slb?series=06');
  if (pw.body && typeof pw.body === 'object') {
    console.log('top-level keys:', Object.keys(pw.body));
    const data = pw.body.data || pw.body.rows || pw.body;
    if (Array.isArray(data) && data.length) {
      console.log('row count:', data.length);
      console.log('first row keys:', Object.keys(data[0]));
      console.log('first 3 rows:');
      console.log(JSON.stringify(data.slice(0, 3), null, 2));
    } else {
      console.log(JSON.stringify(pw.body).slice(0, 2000));
    }
  } else {
    console.log(pw);
  }

  await browser.close();
})().catch((e) => { console.error('[probe2] fatal', e); process.exit(1); });
