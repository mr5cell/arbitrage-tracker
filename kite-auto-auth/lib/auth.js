const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const KiteConnect = require('kiteconnect').KiteConnect;
const TOTP = require('./totp');
const fs = require('fs');
const path = require('path');

// Use stealth plugin
puppeteer.use(StealthPlugin());

class KiteAutoAuth {
  constructor(configPath = null) {
    // Check if config is available globally (for production environments)
    if (global.kiteConfig) {
      console.log('Using global config from environment variables');
      this.config = global.kiteConfig;
    } else {
      // Load config from file
      const configFile = configPath || path.join(__dirname, '..', 'config.json');
      
      if (!fs.existsSync(configFile)) {
        throw new Error(`Config file not found at ${configFile}. Please create it from config.example.json`);
      }
      
      this.config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    }
    
    // Validate config
    const required = ['username', 'password', 'totpSecret', 'apiKey', 'apiSecret'];
    for (const field of required) {
      if (!this.config[field] || this.config[field].includes('YOUR_')) {
        throw new Error(`Please set ${field} in config.json`);
      }
    }
    
    this.kite = new KiteConnect({ api_key: this.config.apiKey });
    this.totp = new TOTP(this.config.totpSecret);
    this.tokenCache = null;
    this.tokenExpiry = null;
  }
  
  // Check if cached token is still valid
  isTokenValid() {
    if (!this.tokenCache || !this.tokenExpiry) return false;
    
    // Add 5 minute buffer before expiry
    const bufferTime = 5 * 60 * 1000;
    return new Date() < new Date(this.tokenExpiry.getTime() - bufferTime);
  }
  
  // Main login function
  async login(options = {}) {
    // Return cached token if still valid
    if (this.isTokenValid()) {
      console.log('Using cached token (still valid)');
      return this.tokenCache;
    }
    
    console.log('Starting automated Kite login...');
    
    const headless = options.headless !== false;
    const debug = options.debug || false;
    
    let browser = null;
    
    try {
      console.log('🚀 Launching Puppeteer browser...');
      // Launch browser with Railway-specific configuration
      browser = await puppeteer.launch({
        headless: headless ? 'new' : false,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor',
          '--disable-background-timer-throttling',
          '--disable-renderer-backgrounding',
          '--disable-backgrounding-occluded-windows',
          '--disable-ipc-flooding-protection'
        ],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
      });
      console.log('✅ Puppeteer browser launched successfully');
      
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
      // Navigate to Kite login
      const loginUrl = `https://kite.zerodha.com/connect/login?v=3&api_key=${this.config.apiKey}`;
      console.log('Navigating to Kite login page...');
      await page.goto(loginUrl, { waitUntil: 'networkidle2' });
      
      // Enter username
      console.log('Entering username...');
      await page.waitForSelector('input[type="text"]');
      await page.type('input[type="text"]', this.config.username, { delay: 100 });
      
      // Enter password
      console.log('Entering password...');
      await page.type('input[type="password"]', this.config.password, { delay: 100 });
      
      // Click login
      await page.click('button[type="submit"]');
      
      // Wait for TOTP page
      await page.waitForSelector('input[maxlength="6"]', { timeout: 10000 });
      
      // Generate and enter TOTP
      console.log('Generating TOTP...');
      const totpCode = await this.totp.getFreshToken();
      console.log('Entering TOTP...');
      await page.type('input[maxlength="6"]', totpCode, { delay: 100 });
      
      // Sometimes auto-submits, sometimes needs click
      try {
        await page.click('button[type="submit"]');
      } catch (e) {
        // Button might not exist if auto-submitted
      }
      
      // Wait for redirect with request token
      console.log('Waiting for authorization...');
      await page.waitForFunction(
        () => window.location.href.includes('request_token='),
        { timeout: 15000 }
      );
      
      // Extract request token from URL
      const url = page.url();
      const urlParams = new URLSearchParams(new URL(url).search);
      const requestToken = urlParams.get('request_token');
      
      if (!requestToken) {
        throw new Error('Failed to get request token from redirect');
      }
      
      console.log('Got request token, generating access token...');
      
      // Close browser
      await browser.close();
      browser = null;
      
      // Generate access token
      const session = await this.kite.generateSession(requestToken, this.config.apiSecret);
      
      console.log('✅ Login successful!');
      
      // Cache token with 8 hour expiry
      this.tokenCache = session.access_token;
      this.tokenExpiry = new Date(Date.now() + 8 * 60 * 60 * 1000);
      
      // Save to file for persistence across runs
      const tokenData = {
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
        userId: session.user_id,
        createdAt: new Date().toISOString(),
        expiresAt: this.tokenExpiry.toISOString()
      };
      
      // Try to cache token (skip if filesystem is read-only)
      try {
        const tokenFile = path.join(__dirname, '..', '.token_cache.json');
        fs.writeFileSync(tokenFile, JSON.stringify(tokenData, null, 2));
        console.log('✅ Token cached successfully');
      } catch (cacheError) {
        console.log('⚠️ Cannot cache token (read-only filesystem), continuing without cache');
      }
      
      return session.access_token;
      
    } catch (error) {
      console.error('❌ Kite authentication failed:', error.message);
      console.error('Full error:', error);
      
      // Check if it's a Puppeteer launch error
      if (error.message.includes('Failed to launch') || error.message.includes('spawn') || error.message.includes('Chrome')) {
        console.error('🚨 Puppeteer launch error - Chromium may not be available in container');
        console.error('Error details:', error.message);
        try {
          const execPath = process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath();
          console.error('Environment check:', {
            NODE_ENV: process.env.NODE_ENV,
            PUPPETEER_EXECUTABLE_PATH: process.env.PUPPETEER_EXECUTABLE_PATH,
            puppeteerExecPath: execPath,
            platform: process.platform,
            arch: process.arch
          });
          
          // Check if executable exists
          const fs = require('fs');
          if (execPath && fs.existsSync(execPath)) {
            console.error(`✅ Chromium found at: ${execPath}`);
          } else {
            console.error(`❌ Chromium NOT found at: ${execPath}`);
          }
        } catch (e) {
          console.error('Cannot get Puppeteer executable path:', e.message);
        }
      }
      
      // Take screenshot for debugging if browser is open
      if (browser) {
        try {
          const pages = await browser.pages();
          if (pages.length > 0) {
            await pages[0].screenshot({ path: 'login-error.png' });
            console.log('Screenshot saved: login-error.png');
          }
        } catch (e) {
          // Ignore screenshot errors
        }
        
        try {
          await browser.close();
        } catch (e) {
          console.error('Error closing browser:', e.message);
        }
      }
      
      throw error;
    }
  }
  
  // Get KiteConnect instance with valid token
  async getAuthenticatedKite() {
    const token = await this.login();
    this.kite.setAccessToken(token);
    return this.kite;
  }
  
  // Load cached token if exists
  loadCachedToken() {
    try {
      const tokenFile = path.join(__dirname, '..', '.token_cache.json');
      if (fs.existsSync(tokenFile)) {
        const data = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
        
        // Check if token is still valid
        const expiry = new Date(data.expiresAt);
        if (new Date() < expiry) {
          this.tokenCache = data.accessToken;
          this.tokenExpiry = expiry;
          return data.accessToken;
        }
      }
    } catch (e) {
      // Ignore cache errors
    }
    return null;
  }
}

module.exports = KiteAutoAuth;