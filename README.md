# Arbitrage Tracker

Real-time arbitrage and reverse arbitrage opportunities tracker for equity-futures pairs with actual charges calculation from Kite Margins API.

## 🚀 Live Demo
- **GitHub**: https://github.com/mr5cell/arbitrage-tracker
- **Deploy on Railway**: Ready for one-click deployment

## ✨ Features

### Core Functionality
- **Cash and Carry Arbitrage**: Buy spot, sell futures when futures trade at premium
- **Reverse Arbitrage**: Sell spot (via SLB), buy futures when futures trade at discount
- **Multi-Month Analysis**: Track opportunities across current, next, and far month futures
- **Real Charges**: Actual brokerage and charges calculated via Kite Margins API
- **Live Updates**: Real-time price updates with automatic refresh

### Advanced UI Features
- **Smart Sorting**: Click column headers for ascending/descending sort
- **Search Bar**: Filter opportunities by symbol name
- **Column Filters**: Set minimum thresholds for returns (e.g., > 0.5%)
- **URL Hash Routing**: Bookmarkable month views (e.g., #current, #next, #far)
- **Responsive Design**: Zerodha-styled clean interface

### Technical Features
- **Automated Authentication**: Seamless Kite Connect login with TOTP
- **Intelligent Caching**: Charges cached per symbol and order type
- **ALL F&O Stocks**: Tracks all 207 F&O enabled stocks
- **Accurate Calculations**: Returns calculated post actual charges
- **Trade Integration**: Ready for Kite Publisher basket orders

## Setup Instructions

### Prerequisites

- Node.js 18+ and npm 8+
- Zerodha Kite Connect API credentials
- TOTP secret for two-factor authentication

### 🚀 Quick Start

1. **Clone the repository**
   ```bash
   git clone https://github.com/mr5cell/arbitrage-tracker.git
   cd arbitrage-tracker
   npm install
   ```

2. **Configure environment variables**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` file with your Kite credentials:
   ```env
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
   - **Arbitrage**: http://localhost:3000 or http://localhost:3000/#current
   - **Reverse Arbitrage**: http://localhost:3000/reverse
   - **API Status**: http://localhost:3000/api/status

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

## 📊 How It Works

### Arbitrage Calculation (Buy Spot, Sell Futures)
```
Premium = Futures Price - Spot Price
Premium % = (Premium / Spot Price) × 100
Actual Charges = Kite Margins API (STT, exchange fees, brokerage, GST)
Net Return = Premium % - Actual Charges %
Annualized Return = (Net Return × 365) / Days to Expiry
```

### Reverse Arbitrage (Sell Spot via SLB, Buy Futures)
```
Discount = Spot Price - Futures Price  
Discount % = (Discount / Spot Price) × 100
Net Return = Discount % - Actual Charges % - SLB Fee %
Annualized Return = (Net Return × 365) / Days to Expiry
```

### Real Charges via Kite Margins API
- **No estimates or hardcoded values**
- Actual charges fetched for each order basket
- Includes: STT, Exchange fees, SEBI charges, Brokerage, Stamp duty, GST
- Cached per symbol and order type for optimization

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

## 🔧 Technical Details

### Data Source
- **All 207 F&O stocks** from NSE instruments master
- **HTTP Quote API** for price fetching (1-minute intervals)
- **Real-time WebSocket** for tick data (when available)
- **Automatic expiry detection** from futures instruments

### Performance Optimizations
- **Intelligent caching**: Charges cached for 10 minutes per symbol/order type
- **Batch API calls**: Quotes fetched in batches of 500
- **Parallel processing**: Arbitrage calculations run concurrently
- **Frontend filtering**: All sorting/filtering done client-side for instant response

### UI Features
- **Column Sorting**: Click headers to sort ascending/descending
- **Live Search**: Filter symbols as you type
- **Smart Filters**: Set minimum return thresholds
- **URL Routing**: Direct links to specific months (#current, #next, #far)
- **Auto-refresh**: Data updates every 5 seconds

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

## 📸 Screenshots

### Arbitrage Opportunities
- Shows futures trading at premium to spot
- Green highlights for positive returns
- Sortable columns with filters

### Reverse Arbitrage
- Shows futures trading at discount to spot  
- Requires SLB for shorting spot
- Higher returns due to discount capture

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📝 License

This project is for educational purposes. Please ensure compliance with exchange regulations when using for actual trading.

## 🙏 Acknowledgments

- Built with Kite Connect API by Zerodha
- Styled to match Zerodha's clean interface
- Automated auth inspired by community solutions