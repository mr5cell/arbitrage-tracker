const KiteAutoAuth = require('./lib/auth');
const path = require('path');

// Singleton instance
let authInstance = null;

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

// Export simple API
module.exports = {
  login,
  getKite,
  KiteAutoAuth
};