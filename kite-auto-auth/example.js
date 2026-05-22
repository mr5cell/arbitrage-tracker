/**
 * Simple example of using Kite Auto-Auth
 */

const KiteAuth = require('./index');

async function example() {
  try {
    // Method 1: Just get the access token
    console.log('Getting access token...');
    const accessToken = await KiteAuth.login();
    console.log('Access Token:', accessToken.substring(0, 20) + '...');
    
    // Method 2: Get authenticated Kite instance directly
    console.log('\nGetting authenticated Kite instance...');
    const kite = await KiteAuth.getKite();
    
    // Use Kite API
    const profile = await kite.getProfile();
    console.log('\nProfile:');
    console.log('- User ID:', profile.user_id);
    console.log('- Name:', profile.user_name);
    console.log('- Email:', profile.email);
    
    // Fetch some quotes
    const quotes = await kite.getQuote(['NSE:RELIANCE', 'NSE:INFY']);
    console.log('\nQuotes:');
    for (const [symbol, quote] of Object.entries(quotes)) {
      console.log(`${symbol}: ₹${quote.last_price}`);
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

// Run example
example();