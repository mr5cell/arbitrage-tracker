# 🚀 Kite Auto-Auth

Automated Kite Connect authentication with TOTP support. Zero manual input required.

## ✨ Features

- **Fully Automated Login** - Handles username, password, and TOTP
- **Token Caching** - Reuses valid tokens (8-hour validity)
- **Simple API** - Just one function call
- **Headless Operation** - Runs in background
- **Error Recovery** - Automatic retry on failures

## 📦 Installation

```bash
# Clone repository
git clone [your-repo-url] kite-auto-auth
cd kite-auto-auth

# Install dependencies
npm install
```

## ⚙️ Configuration

1. Copy `config.example.json` to `config.json`
2. Fill in your credentials:

```json
{
  "username": "YOUR_USER_ID",
  "password": "YOUR_PASSWORD",
  "totpSecret": "YOUR_TOTP_SECRET",
  "apiKey": "YOUR_API_KEY",
  "apiSecret": "YOUR_API_SECRET"
}
```

### Getting TOTP Secret
- During Zerodha 2FA setup, click "Can't scan? Enter manually"
- Copy the secret key shown (like: `JBSWY3DPEHPK3PXP`)

## 🔧 Usage

### Get Access Token

```javascript
const KiteAuth = require('./kite-auto-auth');

// Get access token
const token = await KiteAuth.login();
console.log('Token:', token);

// Use with KiteConnect
const kite = new KiteConnect({ api_key: 'your_api_key' });
kite.setAccessToken(token);
```

### Get Authenticated Kite Instance

```javascript
const KiteAuth = require('./kite-auto-auth');

// Get Kite instance with token already set
const kite = await KiteAuth.getKite();

// Use immediately
const positions = await kite.getPositions();
const orders = await kite.getOrders();
```

## 📁 Project Structure

```
kite-auto-auth/
├── config.json         # Your credentials (gitignored)
├── config.example.json # Template
├── index.js           # Main entry point
├── lib/
│   ├── auth.js        # Authentication logic
│   └── totp.js        # TOTP generator
├── example.js         # Usage example
└── README.md          # This file
```

## 🔒 Security

- `config.json` is gitignored
- `.token_cache.json` is gitignored
- Credentials stay local only
- Tokens expire after 8 hours

## 🧪 Testing

```bash
# Test authentication
node example.js
```

## 🔍 Debugging

```javascript
// Show browser window
await KiteAuth.login({ headless: false });

// Enable debug logs
await KiteAuth.login({ debug: true });
```

## 📝 API Reference

### `KiteAuth.login(options)`
Returns access token string.

**Options:**
- `headless` (boolean): Hide browser. Default: `true`
- `debug` (boolean): Show debug logs. Default: `false`

### `KiteAuth.getKite(options)`
Returns authenticated KiteConnect instance.

## ⚠️ Troubleshooting

| Issue | Solution |
|-------|----------|
| Config not found | Create `config.json` from template |
| Login fails | Verify credentials are correct |
| TOTP invalid | Check system time is synchronized |
| Token expired | Normal - will auto-refresh on next call |

## 📚 Learning Resources

For detailed code explanations and learning materials, check out:
**[kite-trading-learning](../kite-trading-learning)** - Complete beginner's guide to understanding this code

## 📄 License

MIT

---

**Note:** Use responsibly and comply with Zerodha's terms of service.