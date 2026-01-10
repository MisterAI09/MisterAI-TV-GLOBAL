const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// تخزين البيانات
const activeUsers = new Map();
const chatMessages = [];
let pollData = {
  nigeria: { votes: 125, percentage: 62 },
  algeria: { votes: 75, percentage: 38 },
  total: 200,
  lastUpdated: Date.now()
};
const userVotes = new Map();

// تحسين الأداء: تخزين مؤقت للإحصائيات
let cachedStats = null;
let statsUpdateTime = 0;

// WebSocket Events
io.on('connection', (socket) => {
  console.log('✅ مستخدم جديد متصل:', socket.id);
  
  // إرسال الترحيب
  socket.emit('welcome', {
    message: 'مرحباً بك في MisterAI TV',
    serverTime: new Date().toISOString(),
    version: '3.0.0'
  });

  // انضمام مستخدم
  socket.on('join', (userData) => {
    const user = {
      id: socket.id,
      socketId: socket.id,
      name: userData.name,
      twitter: userData.twitter,
      avatar: userData.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(userData.name)}&background=00A859&color=fff`,
      joinedAt: new Date().toISOString(),
      lastActive: Date.now()
    };
    
    activeUsers.set(socket.id, user);
    
    // إرسال بيانات أولية
    socket.emit('initialData', {
      poll: pollData,
      recentMessages: chatMessages.slice(-30),
      onlineUsers: Array.from(activeUsers.values()).map(u => ({
        name: u.name,
        twitter: u.twitter,
        avatar: u.avatar
      })),
      totalOnline: activeUsers.size
    });
    
    // إعلام الجميع بمستخدم جديد
    io.emit('userJoined', {
      user: {
        name: user.name,
        twitter: user.twitter,
        avatar: user.avatar
      },
      onlineCount: activeUsers.size,
      timestamp: new Date().toISOString()
    });
    
    // رسالة نظام
    const systemMessage = {
      id: `sys_${Date.now()}`,
      type: 'system',
      user: 'نظام الدردشة',
      twitter: '@MisterAI_TV',
      avatar: 'https://ui-avatars.com/api/?name=MisterAI&background=1DA1F2&color=fff',
      text: `🎉 ${user.twitter} انضم إلى الدردشة!`,
      time: new Date().toLocaleTimeString('ar-EG', { 
        hour: '2-digit', 
        minute: '2-digit' 
      }),
      timestamp: Date.now()
    };
    
    chatMessages.push(systemMessage);
    io.emit('newMessage', systemMessage);
    
    console.log(`👤 ${user.twitter} انضم إلى الدردشة (المستخدمون: ${activeUsers.size})`);
  });

  // استقبال رسالة
  socket.on('sendMessage', (messageData) => {
    const user = activeUsers.get(socket.id);
    if (!user) return;
    
    if (!messageData.text || messageData.text.trim().length === 0) {
      socket.emit('error', { message: 'الرسالة لا يمكن أن تكون فارغة' });
      return;
    }
    
    if (messageData.text.length > 500) {
      socket.emit('error', { message: 'الرسالة طويلة جداً (الحد الأقصى 500 حرف)' });
      return;
    }
    
    const message = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: 'user',
      userId: socket.id,
      user: user.name,
      twitter: user.twitter,
      avatar: user.avatar,
      text: messageData.text.trim(),
      time: new Date().toLocaleTimeString('ar-EG', { 
        hour: '2-digit', 
        minute: '2-digit' 
      }),
      timestamp: Date.now(),
      likes: 0,
      replies: []
    };
    
    // تحديث نشاط المستخدم
    user.lastActive = Date.now();
    activeUsers.set(socket.id, user);
    
    // حفظ الرسالة
    chatMessages.push(message);
    
    // الحفاظ على 500 رسالة كحد أقصى
    if (chatMessages.length > 500) {
      chatMessages.splice(0, 100);
    }
    
    // إرسال للجميع
    io.emit('newMessage', message);
    
    console.log(`💬 ${user.twitter}: ${message.text.substring(0, 50)}...`);
  });

  // استقبال تصويت
  socket.on('vote', (voteData) => {
    const user = activeUsers.get(socket.id);
    if (!user) {
      socket.emit('voteError', { message: 'يجب تسجيل الدخول أولاً' });
      return;
    }
    
    if (!['nigeria', 'algeria'].includes(voteData.team)) {
      socket.emit('voteError', { message: 'فريق غير صالح' });
      return;
    }
    
    // التحقق من التصويت السابق
    if (userVotes.has(socket.id)) {
      const previousVote = userVotes.get(socket.id);
      if (previousVote.team === voteData.team) {
        socket.emit('voteError', { message: 'لقد قمت بالتصويت لهذا الفريق مسبقاً' });
        return;
      }
      
      // إزالة التصويت السابق
      pollData[previousVote.team].votes--;
      pollData.total--;
    }
    
    // تحديث التصويت الجديد
    pollData[voteData.team].votes++;
    pollData.total++;
    
    // حساب النسب المئوية
    pollData.nigeria.percentage = Math.round((pollData.nigeria.votes / pollData.total) * 100);
    pollData.algeria.percentage = Math.round((pollData.algeria.votes / pollData.total) * 100);
    pollData.lastUpdated = Date.now();
    
    // حفظ تصويت المستخدم
    userVotes.set(socket.id, {
      userId: socket.id,
      twitter: user.twitter,
      team: voteData.team,
      timestamp: Date.now()
    });
    
    // إرسال تحديث التصويت للجميع
    io.emit('pollUpdate', pollData);
    
    // رسالة نظام عن التصويت
    const teamName = voteData.team === 'nigeria' ? 'نيجيريا 🇳🇬' : 'الجزائر 🇩🇿';
    const systemMessage = {
      id: `vote_${Date.now()}`,
      type: 'vote',
      user: 'نظام التصويت',
      twitter: '@MisterAI_TV',
      avatar: 'https://ui-avatars.com/api/?name=Vote&background=FFD700&color=000',
      text: `🎯 ${user.twitter} صوت لصالح ${teamName}`,
      time: new Date().toLocaleTimeString('ar-EG', { 
        hour: '2-digit', 
        minute: '2-digit' 
      }),
      timestamp: Date.now()
    };
    
    chatMessages.push(systemMessage);
    io.emit('newMessage', systemMessage);
    
    console.log(`🗳️ ${user.twitter} صوت لـ ${voteData.team}`);
  });

  // استقبال تفاعل مع رسالة (إعجاب)
  socket.on('likeMessage', (messageId) => {
    const user = activeUsers.get(socket.id);
    if (!user) return;
    
    const messageIndex = chatMessages.findIndex(msg => msg.id === messageId);
    if (messageIndex !== -1) {
      chatMessages[messageIndex].likes = (chatMessages[messageIndex].likes || 0) + 1;
      io.emit('messageLiked', {
        messageId: messageId,
        likes: chatMessages[messageIndex].likes,
        user: user.twitter
      });
    }
  });

  // طلب إعادة تعيين التصويت (للتطوير)
  socket.on('resetPoll', () => {
    pollData = {
      nigeria: { votes: 125, percentage: 62 },
      algeria: { votes: 75, percentage: 38 },
      total: 200,
      lastUpdated: Date.now()
    };
    userVotes.clear();
    io.emit('pollUpdate', pollData);
    
    const systemMessage = {
      id: `reset_${Date.now()}`,
      type: 'system',
      user: 'نظام التصويت',
      twitter: '@MisterAI_TV',
      avatar: 'https://ui-avatars.com/api/?name=Reset&background=D62828&color=fff',
      text: '🔄 تم إعادة تعيين استطلاع الرأي',
      time: new Date().toLocaleTimeString('ar-EG', { 
        hour: '2-digit', 
        minute: '2-digit' 
      }),
      timestamp: Date.now()
    };
    
    chatMessages.push(systemMessage);
    io.emit('newMessage', systemMessage);
    
    console.log('🔄 تم إعادة تعيين التصويت');
  });

  // تحديث نشاط المستخدم
  socket.on('activity', () => {
    const user = activeUsers.get(socket.id);
    if (user) {
      user.lastActive = Date.now();
      activeUsers.set(socket.id, user);
    }
  });

  // ping/pong للحفاظ على الاتصال
  socket.on('ping', () => {
    socket.emit('pong', { serverTime: Date.now() });
  });

  // انفصال المستخدم
  socket.on('disconnect', () => {
    const user = activeUsers.get(socket.id);
    if (user) {
      activeUsers.delete(socket.id);
      
      // إعلام الجميع بمغادرة المستخدم
      io.emit('userLeft', {
        user: {
          name: user.name,
          twitter: user.twitter,
          avatar: user.avatar
        },
        onlineCount: activeUsers.size,
        timestamp: new Date().toISOString()
      });
      
      // رسالة نظام
      const systemMessage = {
        id: `leave_${Date.now()}`,
        type: 'system',
        user: 'نظام الدردشة',
        twitter: '@MisterAI_TV',
        avatar: 'https://ui-avatars.com/api/?name=System&background=666&color=fff',
        text: `👋 ${user.twitter} غادر الدردشة`,
        time: new Date().toLocaleTimeString('ar-EG', { 
          hour: '2-digit', 
          minute: '2-digit' 
        }),
        timestamp: Date.now()
      };
      
      chatMessages.push(systemMessage);
      io.emit('newMessage', systemMessage);
      
      console.log(`👋 ${user.twitter} غادر الدردشة (المستخدمون: ${activeUsers.size})`);
    }
  });
});

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/stats', (req, res) => {
  // تحسين الأداء باستخدام التخزين المؤقت
  const now = Date.now();
  if (!cachedStats || now - statsUpdateTime > 5000) { // تحديث كل 5 ثواني
    cachedStats = {
      onlineUsers: activeUsers.size,
      totalMessages: chatMessages.length,
      totalVotes: pollData.total,
      serverUptime: process.uptime(),
      serverTime: new Date().toISOString(),
      memoryUsage: process.memoryUsage()
    };
    statsUpdateTime = now;
  }
  
  res.json(cachedStats);
});

app.get('/api/chat/history', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const offset = parseInt(req.query.offset) || 0;
  
  const messages = chatMessages
    .slice(-(offset + limit), offset > 0 ? -offset : undefined)
    .reverse();
  
  res.json({
    messages: messages,
    total: chatMessages.length,
    hasMore: offset + limit < chatMessages.length
  });
});

app.get('/api/poll/status', (req, res) => {
  res.json(pollData);
});

app.get('/api/users/online', (req, res) => {
  const users = Array.from(activeUsers.values()).map(user => ({
    name: user.name,
    twitter: user.twitter,
    avatar: user.avatar,
    lastActive: user.lastActive
  }));
  
  res.json({
    users: users,
    count: users.length,
    timestamp: new Date().toISOString()
  });
});

// Middleware للتعامل مع الأخطاء
app.use((err, req, res, next) => {
  console.error('❌ خطأ في الخادم:', err);
  res.status(500).json({ 
    error: 'حدث خطأ في الخادم',
    message: err.message 
  });
});

// بدء الخادم
server.listen(PORT, () => {
  console.log(`🚀 الخادم يعمل على المنفذ ${PORT}`);
  console.log(`⚡ WebSocket جاهز على ws://localhost:${PORT}`);
  console.log(`🌐 افتح http://localhost:${PORT} في المتصفح`);
});

// تنظيف دوري للمستخدمين غير النشطين
setInterval(() => {
  const now = Date.now();
  const inactiveTime = 5 * 60 * 1000; // 5 دقائق
  
  for (const [socketId, user] of activeUsers.entries()) {
    if (now - user.lastActive > inactiveTime) {
      activeUsers.delete(socketId);
      io.emit('userLeft', {
        user: {
          name: user.name,
          twitter: user.twitter,
          avatar: user.avatar
        },
        onlineCount: activeUsers.size,
        timestamp: new Date().toISOString()
      });
      console.log(`🕐 ${user.twitter} تمت إزالته بسبب عدم النشاط`);
    }
  }
}, 60 * 1000); // كل دقيقة

// Export للـ Vercel
module.exports = app;
