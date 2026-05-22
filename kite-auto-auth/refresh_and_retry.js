/**
 * Script to refresh access token and retry the full profile API call
 */

const KiteAuth = require('./index');
const fs = require('fs');

async function refreshAndRetry() {
  try {
    // Delete any cached token to force fresh login
    const tokenCachePath = './token_cache.json';
    if (fs.existsSync(tokenCachePath)) {
      fs.unlinkSync(tokenCachePath);
      console.log('Deleted cached token');
    }
    
    console.log('Generating fresh access token...');
    console.log('========================================\n');
    
    // Force fresh login by passing forceRefresh option
    const kite = await KiteAuth.getKite({ forceRefresh: true });
    
    // Get the fresh access token and API key
    const accessToken = kite.access_token;
    const apiKey = kite.api_key;
    
    console.log('\n========================================');
    console.log('Fresh Access Token obtained:', accessToken);
    console.log('API Key:', apiKey);
    
    // Save fresh token
    fs.writeFileSync('access_token.txt', accessToken);
    console.log('Fresh access token saved to access_token.txt');
    
    // Try the full profile endpoint with phone
    console.log('\n========================================');
    console.log('Attempting /user/profile/full?include=phone with fresh token...\n');
    
    const { execSync } = require('child_process');
    
    // Build curl command
    const curlCommand = `curl -H 'Authorization: token ${apiKey}:${accessToken}' -H 'X-Kite-Version: 3' 'https://api.kite.trade/user/profile/full?include=phone'`;
    
    console.log('Executing:', curlCommand);
    console.log('\nResponse:');
    
    try {
      const result = execSync(curlCommand, { encoding: 'utf8' });
      console.log(result);
      
      // Try to parse and pretty print if it's JSON
      try {
        const parsed = JSON.parse(result);
        console.log('\nParsed Response:');
        console.log(JSON.stringify(parsed, null, 2));
        
        if (parsed.data && parsed.data.phone) {
          console.log('\n✅ Phone Number:', parsed.data.phone);
        }
      } catch (e) {
        // Not JSON, already printed raw
      }
    } catch (curlError) {
      console.error('Curl command failed:', curlError.message);
    }
    
    // Also try regular profile endpoint for comparison
    console.log('\n========================================');
    console.log('Also trying regular /user/profile endpoint for comparison...\n');
    
    const regularCommand = `curl -s -H 'Authorization: token ${apiKey}:${accessToken}' -H 'X-Kite-Version: 3' 'https://api.kite.trade/user/profile'`;
    
    try {
      const regularResult = execSync(regularCommand, { encoding: 'utf8' });
      const parsed = JSON.parse(regularResult);
      console.log('Regular Profile Response:');
      console.log(JSON.stringify(parsed, null, 2));
    } catch (e) {
      console.error('Regular profile request failed:', e.message);
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
  }
}

// Run the script
refreshAndRetry();