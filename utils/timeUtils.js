// Time utilities for NSE Auction Market hours management
// All times are in IST (Indian Standard Time)

// Get current time in IST
function getISTTime() {
  const now = new Date();
  // IST is UTC+5:30
  const istOffset = 5.5 * 60 * 60 * 1000;
  const utcTime = now.getTime() + (now.getTimezoneOffset() * 60 * 1000);
  const istTime = new Date(utcTime + istOffset);
  
  return {
    date: istTime,
    hours: istTime.getHours(),
    minutes: istTime.getMinutes(),
    seconds: istTime.getSeconds(),
    day: istTime.getDay(), // 0 = Sunday, 6 = Saturday
    formatted: istTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
  };
}

// Check if current day is a weekday (Mon-Fri)
function isWeekday() {
  const ist = getISTTime();
  return ist.day >= 1 && ist.day <= 5;
}

// Check if current time is within auction market hours (2:30 PM - 3:00 PM IST)
function isAuctionMarketHours() {
  if (!isWeekday()) return false;
  
  const ist = getISTTime();
  const currentMinutes = ist.hours * 60 + ist.minutes;
  const auctionStart = 14 * 60 + 30; // 2:30 PM = 14:30
  const auctionEnd = 15 * 60; // 3:00 PM = 15:00
  
  return currentMinutes >= auctionStart && currentMinutes < auctionEnd;
}

// Check if it's time to clear data (9:00 AM IST)
function shouldClearData(lastClearDate) {
  const ist = getISTTime();
  const currentMinutes = ist.hours * 60 + ist.minutes;
  const clearTime = 9 * 60; // 9:00 AM
  
  // Check if it's 9:00 AM and we haven't cleared today
  if (currentMinutes === clearTime) {
    if (!lastClearDate) return true;
    
    const lastClear = new Date(lastClearDate);
    const today = new Date(ist.date);
    today.setHours(0, 0, 0, 0);
    lastClear.setHours(0, 0, 0, 0);
    
    return today.getTime() > lastClear.getTime();
  }
  
  return false;
}

// Check if it's time to auto-initialize (2:30 PM IST)
function shouldAutoInitialize() {
  if (!isWeekday()) return false;
  
  const ist = getISTTime();
  const currentMinutes = ist.hours * 60 + ist.minutes;
  const initTime = 14 * 60 + 30; // 2:30 PM
  
  // Check if it's exactly 2:30 PM
  return currentMinutes === initTime;
}

// Get market status
function getMarketStatus() {
  const ist = getISTTime();
  
  if (!isWeekday()) {
    return {
      status: 'CLOSED',
      message: 'Market closed (Weekend)',
      nextOpen: getNextMarketOpen()
    };
  }
  
  const currentMinutes = ist.hours * 60 + ist.minutes;
  const dataClearTime = 9 * 60; // 9:00 AM
  const auctionStart = 14 * 60 + 30; // 2:30 PM
  const auctionEnd = 15 * 60; // 3:00 PM
  
  if (currentMinutes < dataClearTime) {
    return {
      status: 'SHOWING_PREVIOUS',
      message: `Yesterday's data (clears at 9:00 AM)`,
      nextEvent: '9:00 AM - Data Clear'
    };
  } else if (currentMinutes >= dataClearTime && currentMinutes < auctionStart) {
    const minutesUntilOpen = auctionStart - currentMinutes;
    return {
      status: 'WAITING',
      message: `Auction market opens at 2:30 PM IST`,
      countdown: formatCountdown(minutesUntilOpen),
      nextEvent: '2:30 PM - Market Opens'
    };
  } else if (currentMinutes >= auctionStart && currentMinutes < auctionEnd) {
    const minutesRemaining = auctionEnd - currentMinutes;
    return {
      status: 'LIVE',
      message: `Auction Market LIVE (Closes 3:00 PM)`,
      countdown: formatCountdown(minutesRemaining),
      nextEvent: '3:00 PM - Market Closes'
    };
  } else {
    return {
      status: 'CLOSED',
      message: `Auction Market CLOSED - Today's final prices`,
      nextOpen: getNextMarketOpen()
    };
  }
}

// Get appropriate refresh rate based on time
function getRefreshRate() {
  const status = getMarketStatus();
  
  switch(status.status) {
    case 'LIVE':
      return 2000; // 2 seconds during live market
    case 'WAITING':
      return 0; // No refresh while waiting
    case 'SHOWING_PREVIOUS':
    case 'CLOSED':
      return 300000; // 5 minutes after market close or showing old data
    default:
      return 300000; // 5 minutes default
  }
}

// Format countdown from minutes to HH:MM:SS
function formatCountdown(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes} minutes`;
}

// Get next market opening time
function getNextMarketOpen() {
  const ist = getISTTime();
  const tomorrow = new Date(ist.date);
  
  // If it's Friday, next open is Monday
  if (ist.day === 5) {
    tomorrow.setDate(tomorrow.getDate() + 3);
  } 
  // If it's Saturday, next open is Monday
  else if (ist.day === 6) {
    tomorrow.setDate(tomorrow.getDate() + 2);
  }
  // Weekday after 3 PM, next open is tomorrow
  else if (ist.hours >= 15) {
    tomorrow.setDate(tomorrow.getDate() + 1);
  }
  
  return `${tomorrow.toLocaleDateString('en-IN', { weekday: 'long' })} 2:30 PM IST`;
}

// Export for Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getISTTime,
    isWeekday,
    isAuctionMarketHours,
    shouldClearData,
    shouldAutoInitialize,
    getMarketStatus,
    getRefreshRate,
    formatCountdown,
    getNextMarketOpen
  };
}