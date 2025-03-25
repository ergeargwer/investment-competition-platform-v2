const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// 初始資料
const initialState = {
  userFunds: {
    '復忠': { allocated: 30000000, available: 10500000, invested: 19500000 },
    '信全': { allocated: 70000000, available: 15000000, invested: 55000000 }
  },
  teamStats: {
    initialAssets: 100000000,
    currentAssets: 103500000,
    investmentRatio: 74.5,
    totalProfit: 3500000,
    totalStocks: 12,
    totalTransactions: 28
  },
  holdings: [
    {
      id: '1',
      code: '2330',
      name: '台積電',
      quantity: 10,
      buyPrice: 550.0,
      currentPrice: 580.0,
      profit: 300000,
      profitPercentage: 5.45,
      owner: '復忠'
    },
    {
      id: '2',
      code: '2454',
      name: '聯發科',
      quantity: 5,
      buyPrice: 1050.0,
      currentPrice: 1100.0,
      profit: 250000,
      profitPercentage: 4.76,
      owner: '信全'
    }
  ],
  activities: [
    {
      id: '1',
      time: '2025-03-15 09:30',
      user: '復忠',
      action: '買入台積電(2330) 10張，價格550元'
    },
    {
      id: '2',
      time: '2025-03-15 10:15',
      user: '信全',
      action: '買入聯發科(2454) 5張，價格1050元'
    }
  ],
  warnings: [
    {
      id: '1',
      type: 'investment_ratio',
      message: '團隊投資比例低於70%',
      severity: 'warning'
    }
  ]
};

// 追蹤連接的用戶
const connectedUsers = new Set();

io.on('connection', (socket) => {
  console.log('新連接:', socket.id);
  let currentUser = null;

  // 發送初始狀態
  socket.emit('initialState', initialState);

  // 設置用戶身份
  socket.on('setUser', (user) => {
    currentUser = user;
    connectedUsers.add(user);
    console.log(`用戶 ${user} 已連接`);
    
    // 通知所有客戶端更新在線用戶列表
    io.emit('activeUsers', Array.from(connectedUsers));
  });

  // 處理股票搜尋
  socket.on('searchStock', (query) => {
    console.log(`用戶 ${currentUser} 搜尋股票: ${query}`);
    
    // 模擬延遲和股票搜尋結果
    setTimeout(() => {
      const result = {
        code: query.includes('台積') || query === '2330' ? '2330' : '2454',
        name: query.includes('台積') || query === '2330' ? '台積電' : '聯發科',
        price: query.includes('台積') || query === '2330' ? 580.0 : 1100.0,
        volume: query.includes('台積') || query === '2330' ? 15000 : 8500
      };
      
      socket.emit('searchResult', result);
      
      // 記錄活動
      const newActivity = {
        id: Date.now().toString(),
        time: new Date().toLocaleString(),
        user: currentUser,
        action: `搜尋股票: ${query}`
      };
      
      initialState.activities.unshift(newActivity);
      io.emit('newActivity', newActivity);
    }, 500);
  });

  // 處理交易操作
  socket.on('makeTrade', (trade) => {
    console.log(`用戶 ${currentUser} 進行交易:`, trade);
    
    const { type, code, name, quantity, price, owner } = trade;
    const tradeAmount = quantity * price * 1000; // 單位轉換為元
    
    if (type === 'buy') {
      // 檢查資金是否足夠
      if (initialState.userFunds[owner].available < tradeAmount) {
        socket.emit('error', { message: '可用資金不足' });
        return;
      }
      
      // 更新資金
      initialState.userFunds[owner].available -= tradeAmount;
      initialState.userFunds[owner].invested += tradeAmount;
      
      // 更新持股
      const existingHolding = initialState.holdings.find(h => h.code === code && h.owner === owner);
      if (existingHolding) {
        existingHolding.quantity += quantity;
        // 重新計算平均成本和利潤
        const totalCost = (existingHolding.quantity - quantity) * existingHolding.buyPrice + quantity * price;
        existingHolding.buyPrice = totalCost / existingHolding.quantity;
        existingHolding.profit = (existingHolding.currentPrice - existingHolding.buyPrice) * existingHolding.quantity * 1000;
        existingHolding.profitPercentage = ((existingHolding.currentPrice / existingHolding.buyPrice) - 1) * 100;
      } else {
        const newHolding = {
          id: Date.now().toString(),
          code,
          name,
          quantity,
          buyPrice: price,
          currentPrice: price,
          profit: 0,
          profitPercentage: 0,
          owner
        };
        initialState.holdings.push(newHolding);
      }
      
      // 更新團隊統計
      initialState.teamStats.totalStocks = initialState.holdings.length;
      initialState.teamStats.totalTransactions += 1;
      initialState.teamStats.investmentRatio = ((initialState.userFunds['復忠'].invested + initialState.userFunds['信全'].invested) / initialState.teamStats.initialAssets) * 100;
    } else if (type === 'sell') {
      // 查找持股
      const holdingIndex = initialState.holdings.findIndex(h => h.code === code && h.owner === owner);
      if (holdingIndex === -1 || initialState.holdings[holdingIndex].quantity < quantity) {
        socket.emit('error', { message: '持股不足' });
        return;
      }
      
      const holding = initialState.holdings[holdingIndex];
      
      // 計算收益
      const sellAmount = quantity * price * 1000;
      const buyAmount = quantity * holding.buyPrice * 1000;
      const profit = sellAmount - buyAmount;
      
      // 更新資金
      initialState.userFunds[owner].available += sellAmount;
      initialState.userFunds[owner].invested -= buyAmount;
      
      // 更新總利潤
      initialState.teamStats.totalProfit += profit;
      initialState.teamStats.currentAssets += profit;
      
      // 更新持股
      if (holding.quantity === quantity) {
        // 全部賣出
        initialState.holdings.splice(holdingIndex, 1);
      } else {
        // 部分賣出
        holding.quantity -= quantity;
        // 利潤不變，只調整數量
        holding.profit = (holding.currentPrice - holding.buyPrice) * holding.quantity * 1000;
      }
      
      // 更新團隊統計
      initialState.teamStats.totalStocks = initialState.holdings.length;
      initialState.teamStats.totalTransactions += 1;
      initialState.teamStats.investmentRatio = ((initialState.userFunds['復忠'].invested + initialState.userFunds['信全'].invested) / initialState.teamStats.initialAssets