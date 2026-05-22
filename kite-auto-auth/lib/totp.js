const { authenticator } = require('otplib');

class TOTP {
  constructor(secret) {
    this.secret = secret;
    authenticator.options = {
      digits: 6,
      step: 30
    };
  }
  
  generate() {
    return authenticator.generate(this.secret);
  }
  
  // Get fresh TOTP (wait if current one is about to expire)
  async getFreshToken() {
    const timeRemaining = 30 - (Math.floor(Date.now() / 1000) % 30);
    
    // If less than 5 seconds remaining, wait for new one
    if (timeRemaining < 5) {
      await new Promise(resolve => setTimeout(resolve, (timeRemaining + 1) * 1000));
    }
    
    return this.generate();
  }
}

module.exports = TOTP;