# Arbitrage Tracker

Real-time arbitrage and reverse arbitrage opportunities tracker for equity-futures pairs.

## Features

- **Cash and Carry Arbitrage**: Identifies opportunities where futures trade at premium to spot
- **Reverse Arbitrage**: Identifies opportunities where futures trade at discount to spot
- **Multi-Month Analysis**: Track opportunities across current, next, and far month futures
- **Real-time Updates**: Live price updates via WebSocket connection
- **Automated Authentication**: Seamless Kite Connect integration with auto-login
- **Returns Calculation**: Post-charges returns and annualized returns calculation
- **Trade Execution**: Integrated trade buttons (Kite Publisher basket - to be configured)

## Setup Instructions

### Prerequisites

- Node.js 18+ and npm 8+
- Zerodha Kite Connect API credentials
- TOTP secret for two-factor authentication

### Local Development

1. **Clone the repository**
   ```bash
   cd arbitrage-tracker
   npm install
   ```

2. **Configure environment variables**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` file with your Kite credentials:
   ```
   KITE_USERNAME=your_username
   KITE_PASSWORD=your_password
   KITE_TOTP_SECRET=your_totp_secret
   KITE_API_KEY=your_api_key
   KITE_API_SECRET=your_api_secret
   ```

3. **Run the application**
   ```bash
   npm start
   ```
   
   Access the application at:
   - Arbitrage Opportunities: http://localhost:3000
   - Reverse Arbitrage: http://localhost:3000/reverse

## Deployment on Railway

### Via GitHub

1. **Push to GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/YOUR_USERNAME/arbitrage-tracker.git
   git push -u origin main
   ```

2. **Deploy on Railway**
   - Go to [Railway](https://railway.app)
   - Create new project → Deploy from GitHub repo
   - Select your repository
   - Add environment variables in Railway dashboard:
     - `KITE_USERNAME`
     - `KITE_PASSWORD`
     - `KITE_TOTP_SECRET`
     - `KITE_API_KEY`
     - `KITE_API_SECRET`
   - Deploy

### Using Railway CLI

1. **Install Railway CLI**
   ```bash
   npm install -g @railway/cli
   ```

2. **Login and initialize**
   ```bash
   railway login
   railway init
   ```

3. **Add environment variables**
   ```bash
   railway variables set KITE_USERNAME=your_username
   railway variables set KITE_PASSWORD=your_password
   railway variables set KITE_TOTP_SECRET=your_totp_secret
   railway variables set KITE_API_KEY=your_api_key
   railway variables set KITE_API_SECRET=your_api_secret
   ```

4. **Deploy**
   ```bash
   railway up
   ```

## API Endpoints

- `GET /` - Arbitrage opportunities page
- `GET /reverse` - Reverse arbitrage opportunities page
- `GET /api/status` - Connection and authentication status
- `GET /api/arbitrage/normal/:month` - Get normal arbitrage data (current/next/far)
- `GET /api/arbitrage/reverse/:month` - Get reverse arbitrage data (current/next/far)
- `GET /api/expiries` - Get futures expiry dates

## Architecture

- **Backend**: Node.js + Express server
- **Authentication**: Kite Auto Auth with Puppeteer
- **Price Data**: Kite Quote API (HTTP polling every minute)
- **Charges Calculation**: Kite Margins API for actual trading costs
- **Frontend**: Vanilla JavaScript with real-time updates
- **Deployment**: Railway with Docker support

## Calculations

### Arbitrage Return
```
Difference = Futures Price - Spot Price
Return % = (Difference / Spot Price) × 100
Actual Charges = Calculated via Kite Margins API (includes STT, exchange fees, brokerage, GST)
Net Return = Return % - Actual Charges %
Annualized Return = (Net Return × 365) / Days to Expiry
```

### Reverse Arbitrage
- Identifies when futures trade at discount to spot
- SLB (Securities Lending & Borrowing) fee column for future implementation
- Requires short-selling spot through SLB and buying futures

## Configuration Files

- `.env` - Environment variables (local)
- `railway.json` - Railway deployment configuration
- `nixpacks.toml` - Build configuration for Railway
- `Dockerfile` - Docker container configuration

## Trading Integration

The trade buttons are currently placeholders. To integrate with Kite Publisher:

1. Register your app with Kite Publisher
2. Update the `executeTrade()` function in HTML files
3. Implement basket order creation with appropriate quantities

## Notes

- The application tracks all 207 F&O stocks from NSE instruments
- Uses HTTP quote API for fetching prices (once per minute refresh)
- Charges are calculated in real-time using Kite Margins API
- Charges include: STT, exchange fees, SEBI charges, brokerage, stamp duty, and GST
- Charges are cached for 5 minutes to optimize API usage
- SLB fees for reverse arbitrage need to be manually updated

## Troubleshooting

### Authentication Issues
- Verify TOTP secret is correct
- Check if Kite credentials are valid
- Ensure 2FA is enabled on your Kite account

### Connection Issues
- Check if market hours are active
- Verify API key and secret
- Check Railway logs for deployment issues

### Data Not Updating
- Verify WebSocket connection status
- Check if instruments are loaded properly
- Ensure market is open for trading

## Support

For issues or questions, please check:
- Railway deployment logs
- Browser console for frontend errors
- Server logs for backend issues