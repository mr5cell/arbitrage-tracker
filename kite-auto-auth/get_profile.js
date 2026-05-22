/**
 * Script to get user profile with phone number using authenticated access token
 */

const KiteAuth = require('./index');
const fs = require('fs');

async function getProfile() {
  try {
    console.log('Authenticating with Kite Connect...');
    
    // Get authenticated Kite instance
    const kite = await KiteAuth.getKite();
    
    // Get the access token and API key
    const accessToken = kite.access_token;
    const apiKey = kite.api_key;
    
    console.log('Access Token obtained:', accessToken);
    console.log('API Key:', apiKey);
    
    // Save token info for curl command
    fs.writeFileSync('access_token.txt', accessToken);
    console.log('\nAccess token saved to access_token.txt');
    
    // Build and display curl command
    const curlCommand = `curl -H 'Authorization: token ${apiKey}:${accessToken}' -H 'X-Kite-Version: 3' 'https://api.kite.trade/user/profile/full?include=phone'`;
    console.log('\nCURL command to use:');
    console.log(curlCommand);
    
    // Also try with axios
    const axios = require('axios');
    console.log('\nTrying with axios...');
    
    try {
      const response = await axios.get('https://api.kite.trade/user/profile/full', {
        headers: {
          'Authorization': `token ${apiKey}:${accessToken}`,
          'X-Kite-Version': '3'
        },
        params: {
          include: 'phone'
        }
      });
      
      console.log('\nFull Profile Response:');
      console.log(JSON.stringify(response.data, null, 2));
      
      if (response.data.data && response.data.data.phone) {
        console.log('\nPhone Number:', response.data.data.phone);
      }
    } catch (axiosError) {
      if (axiosError.response) {
        console.log('\nAxios error response:', axiosError.response.data);
      }
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
  }
}

// Run the script
getProfile();