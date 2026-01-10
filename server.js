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
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// تخزين البيانات في الذاكرة
let pollData = {
  nigeria: { votes: 125, percentage: 62 },
  algeria: { votes: 75, percentage: 38 },
  total: 200,
  lastUpdated: Date.now()
};

let connectedUsers = new Map();
let chatMessages = [];
let userVotes = new Map();

// WebSocket Events
io.on('connection', (socket) => {
  console.log('مستخدم جديد متصل:', socket.id);

  // إرسال البيانات الأولية للمستخدم
  socket.emit('initialData', {
    poll: pollData,
    messages: chatMessages.slice(-50),
    users: Array.from(connectedUsers.values())
  });

  // مستخدم دخل
  socket.on('userLogin', (userData) => {
    const user = {
      id: socket.id,
      ...userData,
      joinedAt: Date.now()
    };
    
    connectedUsers.set(socket.id, user);
    
    // إرسال إشعار للمستخدمين
    io.emit('userJoined', user);
    
    // إرسال تحديث عدد المستخدمين
    io.emit('usersUpdate', Array.from(connectedUsers.values()));
    
    console.log(`المستخدم ${user.twitter} دخل الدردشة`);
  });

  // استقبال رسالة شات
  socket.on('sendMessage', (messageData) => {
    const user = connectedUsers.get(socket.id);
    if (!user) return;

    const message = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2),
      user: user.name,
      twitter: user.twitter,
      text: messageData.text,
      time: new Date().toLocaleTimeString('ar-EG', { 
        hour: '2-digit', 
        minute: '2-digit' 
      }),
      timestamp: Date.now(),
      userId: socket.id
    };

    // حفظ الرسالة
    chatMessages.push(message);
    
    // الحفاظ على 200 رسالة كحد أقصى
    if (chatMessages.length > 200) {
      chatMessages = chatMessages.slice(-200);
    }

    // إرسال الرسالة للجميع
    io.emit('newMessage', message);
    console.log(`رسالة جديدة من ${user.twitter}: ${messageData.text}`);
  });

  // استقبال تصويت
  socket.on('vote', (voteData) => {
    const user = connectedUsers.get(socket.id);
    if (!user) return;

    // التحقق إذا كان المستخدم صوت مسبقاً
    if (userVotes.has(socket.id)) {
      socket.emit('voteError', 'لقد قمت بالتصويت مسبقاً!');
      return;
    }

    // تحديث بيانات التصويت
    const team = voteData.team;
    pollData[team].votes++;
    pollData.total++;
    
    // حساب النسب المئوية
    pollData.nigeria.percentage = Math.round((pollData.nigeria.votes / pollData.total) * 100);
    pollData.algeria.percentage = Math.round((pollData.algeria.votes / pollData.total) * 100);
    pollData.lastUpdated = Date.now();

    // حفظ تصويت المستخدم
    userVotes.set(socket.id, {
      team: team,
      user: user,
      timestamp: Date.now()
    });

    // إرسال تحديث التصويت للجميع
    io.emit('pollUpdate', pollData);

    // إرسال رسالة في الشات عن التصويت
    const message = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2),
      user: 'نظام التصويت',
      twitter: '@MisterAI_TV',
      text: `🎯 ${user.twitter} صوت لصالح ${team === 'nigeria' ? 'نيجيريا 🇳🇬' : 'الجزائر 🇩🇿'}`,
      time: new Date().toLocaleTimeString('ar-EG', { 
        hour: '2-digit', 
        minute: '2-digit' 
      }),
      timestamp: Date.now(),
      isSystem: true
    };

    chatMessages.push(message);
    io.emit('newMessage', message);

    console.log(`تصويت جديد لـ ${team} من ${user.twitter}`);
  });

  // طلب إعادة تعيين التصويت (للتطوير فقط)
  socket.on('resetVotes', () => {
    pollData = {
      nigeria: { votes: 125, percentage: 62 },
      algeria: { votes: 75, percentage: 38 },
      total: 200,
      lastUpdated: Date.now()
    };
    userVotes.clear();
    io.emit('pollUpdate', pollData);
    console.log('تم إعادة تعيين التصويت');
  });

  // مستخدم انقطع
  socket.on('disconnect', () => {
    const user = connectedUsers.get(socket.id);
    if (user) {
      connectedUsers.delete(socket.id);
      
      // إرسال تحديث عدد المستخدمين
      io.emit('usersUpdate', Array.from(connectedUsers.values()));
      
      // إرسال إشعار مغادرة
      if (user.twitter) {
        io.emit('userLeft', user);
        console.log(`المستخدم ${user.twitter} غادر الدردشة`);
      }
    }
  });

  // ping/pong للحفاظ على الاتصال
  socket.on('ping', () => {
    socket.emit('pong');
  });
});

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/stats', (req, res) => {
  res.json({
    onlineUsers: connectedUsers.size,
    totalMessages: chatMessages.length,
    totalVotes: pollData.total,
    serverTime: new Date().toISOString()
  });
});

app.get('/api/users', (req, res) => {
  res.json(Array.from(connectedUsers.values()));
});

// API للحصول على آخر الرسائل
app.get('/api/messages', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json(chatMessages.slice(-limit));
});

// API للتصويت (للاستخدام المباشر إذا لزم الأمر)
app.post('/api/vote', (req, res) => {
  const { userId, team } = req.body;
  
  if (!userId || !['nigeria', 'algeria'].includes(team)) {
    return res.status(400).json({ error: 'بيانات غير صالحة' });
  }

  // تنفيذ التصويت عبر WebSocket
  const fakeSocket = { id: userId };
  io.emit('pollUpdate', pollData);
  
  res.json({ success: true, poll: pollData });
});

// البدء
server.listen(PORT, () => {
  console.log(`🚀 الخادم يعمل على المنفذ ${PORT}`);
  console.log(`⚡ الدردشة المباشرة جاهزة عبر WebSocket`);
  console.log(`👥 المستخدمون المتصلون: 0`);
});

// دالة للحفاظ على نظافة الرسائل القديمة
setInterval(() => {
  const oneHourAgo = Date.now() - (60 * 60 * 1000);
  chatMessages = chatMessages.filter(msg => msg.timestamp > oneHourAgo);
}, 30 * 60 * 1000); // كل 30 دقيقة

// Export للـ Vercel
module.exports = app;
