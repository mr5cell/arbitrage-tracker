const KiteAutoAuth = require('./lib/auth');
const path = require('path');
const fs = require('fs');

// Singleton instance
let authInstance = null;

const TOKEN_CACHE_PATH = path.join(__dirname, '.token_cache.json');

// Simple API - just call login() to get token
async function login(options = {}) {
  if (!authInstance) {
    authInstance = new KiteAutoAuth(options.configPath);
  }
  
  // First try to load cached token
  const cachedToken = authInstance.loadCachedToken();
  if (cachedToken) {
    console.log('Using cached token');
    return cachedToken;
  }
  
  // Otherwise perform fresh login
  return await authInstance.login(options);
}

// Get authenticated KiteConnect instance
async function getKite(options = {}) {
  if (!authInstance) {
    authInstance = new KiteAutoAuth(options.configPath);
  }
  
  return await authInstance.getAuthenticatedKite();
}

// Force a fresh login: wipe the file token cache and in-memory cache,
// then run the full Puppeteer flow. Use at start-of-day to guarantee a
// new access token rather than passively re-using whatever is cached.
async function forceLogin(options = {}) {
  try {
    fs.unlinkSync(TOKEN_CACHE_PATH);
  } catch (e) {
    if (e.code !== 'ENOENT') console.log(`[kite-auto-auth] could not unlink token cache: ${e.message}`);
  }
  if (!authInstance) {
    authInstance = new KiteAutoAuth(options.configPath);
  } else {
    authInstance.tokenCache = null;
    authInstance.tokenExpiry = null;
  }
  return await authInstance.login(options);
}

// Export simple API
module.exports = {
  login,
  getKite,
  forceLogin,
  KiteAutoAuth
};