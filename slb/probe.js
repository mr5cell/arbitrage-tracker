// Exploratory probe: navigate NSE SLB page, surface filter selects,
// download buttons, and any CSV-shaped network responses.
// Run: node slb/probe.js

const puppeteer = require('puppeteer-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
const path = require('path');
const fs = require('fs');

puppeteer.use(stealth());

const DOWNLOAD_DIR = path.resolve(__dirname, 'downloads');
const URL = 'https://www.nseindia.com/market-data/securities-lending-and-borrowing';

(async () => {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setExtraHTTPHeaders({ 'accept-language': 'en-US,en;q=0.9' });

  const client = await page.target().createCDPSession();
  await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOAD_DIR });

  const interestingResponses = [];
  page.on('response', (res) => {
    const url = res.url();
    const ct = res.headers()['content-type'] || '';
    if (/\.csv($|\?)/i.test(url) || /text\/csv/i.test(ct) || /slb/i.test(url)) {
      interestingResponses.push({ status: res.status(), url, contentType: ct });
    }
  });

  console.log(`[probe] navigating to ${URL}`);
  try {
    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 90000 });
  } catch (e) {
    console.log(`[probe] goto warning: ${e.message} (continuing)`);
  }

  // Wait a little for JS-driven widgets to mount
  await new Promise((r) => setTimeout(r, 5000));

  console.log(`[probe] title="${await page.title()}"`);

  const inventory = await page.evaluate(() => {
    const selects = Array.from(document.querySelectorAll('select')).map((s) => ({
      name: s.name || null,
      id: s.id || null,
      ariaLabel: s.getAttribute('aria-label'),
      options: Array.from(s.options).slice(0, 20).map((o) => ({ value: o.value, text: o.text.trim() })),
    }));

    const candidateButtons = Array.from(document.querySelectorAll('a, button, span, div'))
      .filter((el) => /(csv|download|excel)/i.test((el.textContent || '').trim()) && (el.textContent || '').length < 60)
      .slice(0, 25)
      .map((el) => ({
        tag: el.tagName,
        text: el.textContent.trim(),
        href: el.tagName === 'A' ? el.href : null,
        id: el.id || null,
        classes: el.className || null,
      }));

    const seriesRadios = Array.from(document.querySelectorAll('input[type=radio], input[type=checkbox]'))
      .map((el) => ({ name: el.name, value: el.value, id: el.id, label: el.getAttribute('aria-label') || (el.labels?.[0]?.innerText) }));

    return { selects, candidateButtons, seriesRadios };
  });

  console.log('[probe] inventory:');
  console.log(JSON.stringify(inventory, null, 2));

  console.log('[probe] CSV-ish network responses observed:');
  console.log(JSON.stringify(interestingResponses, null, 2));

  console.log('[probe] downloads dir contents:');
  console.log(fs.readdirSync(DOWNLOAD_DIR));

  await browser.close();
  console.log('[probe] done');
})().catch((e) => {
  console.error('[probe] fatal:', e);
  process.exit(1);
});
