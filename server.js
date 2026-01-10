const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// تكوين Socket.io للعمل بشكل صحيح على Vercel
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============ تخزين البيانات ============
const activeUsers = new Map(); // المستخدمون المتصلون
const chatMessages = []; // جميع الرسائل
let pollData = { // بيانات التصويت
  nigeria: { votes: 150, percentage: 60 },
  algeria: { votes: 100, percentage: 40 },
  total: 250,
  lastUpdated: Date.now()
};
const userVotes = new Map(); // تصويت كل مستخدم

// ============ WebSocket Events ============
io.on('connection', (socket) => {
  console.log(`✅ اتصال جديد: ${socket.id} (المستخدمون: ${io.engine.clientsCount})`);
  
  // إرسال رسالة ترحيب
  socket.emit('welcome', {
    message: 'مرحباً بك في MisterAI TV!',
    serverTime: new Date().toISOString(),
    version: '4.0.0',
    socketId: socket.id
  });

  // ============ انضمام مستخدم جديد ============
  socket.on('join', (userData) => {
    console.log(`👤 محاولة انضمام: ${userData?.twitter || 'غير معروف'}`);
    
    if (!userData || !userData.twitter) {
      socket.emit('error', { message: 'بيانات المستخدم غير صالحة' });
      return;
    }

    const user = {
      id: `user_${Date.now()}`,
      socketId: socket.id,
      name: userData.name || `مستخدم ${userData.twitter}`,
      twitter: userData.twitter,
      avatar: userData.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(userData.twitter)}&background=00A859&color=fff&bold=true`,
      joinedAt: new Date().toISOString(),
      lastActive: Date.now(),
      isOnline: true
    };

    // حفظ المستخدم
    activeUsers.set(socket.id, user);
    
    console.log(`🎉 ${user.twitter} انضم بنجاح (المستخدمون: ${activeUsers.size})`);

    // إرسال البيانات الأولية للمستخدم
    const initialData = {
      poll: pollData,
      recentMessages: chatMessages.slice(-50),
      onlineUsers: Array.from(activeUsers.values()).map(u => ({
        name: u.name,
        twitter: u.twitter,
        avatar: u.avatar
      })),
      totalOnline: activeUsers.size,
      serverTime: new Date().toISOString(),
      userVote: userVotes.get(socket.id)?.team || null
    };

    socket.emit('initialData', initialData);
    
    // إعلام الجميع بمستخدم جديد (باستثناء المستخدم نفسه)
    socket.broadcast.emit('userJoined', {
      user: {
        name: user.name,
        twitter: user.twitter,
        avatar: user.avatar
      },
      onlineCount: activeUsers.size,
      timestamp: new Date().toISOString()
    });

    // إرسال رسالة ترحيب للجميع
    const welcomeMessage = {
      id: `sys_${Date.now()}`,
      type: 'system',
      user: 'نظام الدردشة',
      twitter: '@MisterAI_TV',
      avatar: 'https://ui-avatars.com/api/?name=MisterAI&background=1DA1F2&color=fff',
      text: `🎉 ${user.twitter} انضم إلى الدردشة! مرحباً بك!`,
      time: new Date().toLocaleTimeString('ar-EG', { 
        hour: '2-digit', 
        minute: '2-digit' 
      }),
      timestamp: Date.now()
    };

    chatMessages.push(welcomeMessage);
    
    // إرسال الرسالة للجميع
    io.emit('newMessage', welcomeMessage);
    
    // تحديث عدد المستخدمين للجميع
    io.emit('usersUpdate', {
      count: activeUsers.size,
      users: Array.from(activeUsers.values()).map(u => ({
        name: u.name,
        twitter: u.twitter,
        avatar: u.avatar
      }))
    });
  });

  // ============ استقبال رسالة جديدة ============
  socket.on('sendMessage', (messageData) => {
    const user = activeUsers.get(socket.id);
    
    if (!user) {
      socket.emit('error', { 
        message: 'يجب تسجيل الدخول أولاً قبل إرسال الرسائل' 
      });
      return;
    }

    if (!messageData || !messageData.text || messageData.text.trim().length === 0) {
      socket.emit('error', { 
        message: 'الرسالة لا يمكن أن تكون فارغة' 
      });
      return;
    }

    if (messageData.text.length > 500) {
      socket.emit('error', { 
        message: 'الرسالة طويلة جداً (الحد الأقصى 500 حرف)' 
      });
      return;
    }

    // إنشاء كائن الرسالة
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
      likedBy: []
    };

    // تحديث نشاط المستخدم
    user.lastActive = Date.now();
    activeUsers.set(socket.id, user);

    // حفظ الرسالة
    chatMessages.push(message);
    
    // الحفاظ على 1000 رسالة كحد أقصى
    if (chatMessages.length > 1000) {
      chatMessages.splice(0, 200); // إزالة أقدم 200 رسالة
    }

    // ✅ الإصلاح: إرسال الرسالة للجميع
    io.emit('newMessage', message);
    
    console.log(`📨 [${message.time}] ${user.twitter}: ${message.text.substring(0, 50)}...`);
    console.log(`👥 تم إرسال الرسالة إلى ${io.engine.clientsCount} عميل`);

    // تأكيد الإرسال للمستخدم
    socket.emit('messageSent', { 
      id: message.id, 
      timestamp: message.timestamp 
    });
  });

  // ============ استقبال تصويت ============
  socket.on('vote', (voteData) => {
    const user = activeUsers.get(socket.id);
    
    if (!user) {
      socket.emit('voteError', { 
        message: 'يجب تسجيل الدخول أولاً قبل التصويت' 
      });
      return;
    }

    if (!voteData || !voteData.team || !['nigeria', 'algeria'].includes(voteData.team)) {
      socket.emit('voteError', { 
        message: 'فريق غير صالح للتصويت' 
      });
      return;
    }

    // التحقق إذا كان المستخدم صوت مسبقاً
    const hasVoted = userVotes.has(socket.id);
    
    if (hasVoted) {
      const previousVote = userVotes.get(socket.id);
      if (previousVote.team === voteData.team) {
        socket.emit('voteError', { 
          message: 'لقد قمت بالتصويت لهذا الفريق مسبقاً!' 
        });
        return;
      }
      
      // إزالة التصويت السابق
      pollData[previousVote.team].votes--;
      pollData.total--;
    }

    // إضافة التصويت الجديد
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

    console.log(`🗳️ ${user.twitter} صوت لـ ${voteData.team} (إجمالي: ${pollData.total})`);

    // ✅ الإصلاح: إرسال تحديث التصويت للجميع
    io.emit('pollUpdate', pollData);

    // إرسال رسالة نظام عن التصويت
    const teamName = voteData.team === 'nigeria' ? 'نيجيريا 🇳🇬' : 'الجزائر 🇩🇿';
    const voteMessage = {
      id: `vote_${Date.now()}`,
      type: 'vote',
      user: 'نظام التصويت',
      twitter: '@MisterAI_TV',
      avatar: 'https://ui-avatars.com/api/?name=Vote&background=FFD700&color=000',
      text: hasVoted 
        ? `🔄 ${user.twitter} غير تصويته لصالح ${teamName}`
        : `🎯 ${user.twitter} صوت لصالح ${teamName} لأول مرة!`,
      time: new Date().toLocaleTimeString('ar-EG', { 
        hour: '2-digit', 
        minute: '2-digit' 
      }),
      timestamp: Date.now()
    };

    chatMessages.push(voteMessage);
    io.emit('newMessage', voteMessage);
  });

  // ============ إعجاب على رسالة ============
  socket.on('likeMessage', (messageId) => {
    const user = activeUsers.get(socket.id);
    if (!user) return;

    const messageIndex = chatMessages.findIndex(msg => msg.id === messageId);
    if (messageIndex === -1) return;

    const message = chatMessages[messageIndex];
    
    // التحقق إذا كان المستخدم أعجب بالرسالة مسبقاً
    if (!message.likedBy) message.likedBy = [];
    
    const alreadyLiked = message.likedBy.includes(socket.id);
    
    if (!alreadyLiked) {
      message.likes = (message.likes || 0) + 1;
      message.likedBy.push(socket.id);
      
      // إرسال تحديث الإعجاب للجميع
      io.emit('messageLiked', {
        messageId: messageId,
        likes: message.likes,
        user: user.twitter,
        totalLikes: message.likes
      });
      
      console.log(`❤️ ${user.twitter} أعجب برسالة ${messageId}`);
    }
  });

  // ============ تفعيل مؤشر الكتابة ============
  socket.on('typing', () => {
    const user = activeUsers.get(socket.id);
    if (!user) return;

    // إرسال لمستخدمين آخرين أن هذا المستخدم يكتب
    socket.broadcast.emit('userTyping', {
      user: user.twitter,
      timestamp: Date.now()
    });
  });

  // ============ إعادة تعيين التصويت (للتطوير) ============
  socket.on('resetPoll', () => {
    pollData = {
      nigeria: { votes: 150, percentage: 60 },
      algeria: { votes: 100, percentage: 40 },
      total: 250,
      lastUpdated: Date.now()
    };
    
    userVotes.clear();
    
    io.emit('pollUpdate', pollData);
    
    const resetMessage = {
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

    chatMessages.push(resetMessage);
    io.emit('newMessage', resetMessage);
    
    console.log('🔄 تم إعادة تعيين التصويت');
  });

  // ============ ping/pong للحفاظ على الاتصال ============
  socket.on('ping', () => {
    socket.emit('pong', { 
      serverTime: Date.now(),
      uptime: process.uptime()
    });
  });

  // ============ حدث انقطاع الاتصال ============
  socket.on('disconnect', (reason) => {
    const user = activeUsers.get(socket.id);
    
    if (user) {
      // تحديث حالة المستخدم
      user.isOnline = false;
      user.lastActive = Date.now();
      
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

      // رسالة وداع
      const goodbyeMessage = {
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

      chatMessages.push(goodbyeMessage);
      io.emit('newMessage', goodbyeMessage);
      
      // تحديث عدد المستخدمين
      io.emit('usersUpdate', {
        count: activeUsers.size,
        users: Array.from(activeUsers.values())
          .filter(u => u.isOnline)
          .map(u => ({
            name: u.name,
            twitter: u.twitter,
            avatar: u.avatar
          }))
      });

      console.log(`👋 ${user.twitter} انقطع (السبب: ${reason})`);
    }
  });
});

// ============ Routes ============
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API للإحصائيات
app.get('/api/stats', (req, res) => {
  res.json({
    onlineUsers: io.engine.clientsCount,
    activeUsers: activeUsers.size,
    totalMessages: chatMessages.length,
    totalVotes: pollData.total,
    serverTime: new Date().toISOString(),
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage()
  });
});

// API لسجل المحادثة
app.get('/api/chat/history', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const offset = parseInt(req.query.offset) || 0;
  
  const messages = chatMessages
    .slice()
    .reverse()
    .slice(offset, offset + limit);
  
  res.json({
    messages: messages,
    total: chatMessages.length,
    hasMore: offset + limit < chatMessages.length
  });
});

// API لحالة التصويت
app.get('/api/poll', (req, res) => {
  res.json(pollData);
});

// API للمستخدمين المتصلين
app.get('/api/users/online', (req, res) => {
  const onlineUsers = Array.from(activeUsers.values())
    .filter(user => user.isOnline)
    .map(user => ({
      name: user.name,
      twitter: user.twitter,
      avatar: user.avatar,
      lastActive: user.lastActive
    }));
  
  res.json({
    users: onlineUsers,
    count: onlineUsers.length,
    timestamp: new Date().toISOString()
  });
});

// صفحة مراقبة الاتصالات (للتطوير)
app.get('/admin/connections', (req, res) => {
  const stats = {
    totalConnections: io.engine.clientsCount,
    activeUsers: Array.from(activeUsers.values()).filter(u => u.isOnline).length,
    chatMessages: chatMessages.length,
    pollVotes: pollData.total,
    serverUptime: process.uptime()
  };
  
  const users = Array.from(activeUsers.values()).map(user => ({
    ...user,
    isConnected: user.isOnline
  }));
  
  const html = `
  <!DOCTYPE html>
  <html dir="rtl">
  <head>
    <meta charset="UTF-8">
    <title>مراقبة اتصالات MisterAI TV</title>
    <style>
      * {
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      
      body {
        background: linear-gradient(135deg, #050505, #0a1929);
        color: #fff;
        min-height: 100vh;
        padding: 20px;
      }
      
      .container {
        max-width: 1200px;
        margin: 0 auto;
      }
      
      header {
        text-align: center;
        margin-bottom: 30px;
        padding: 20px;
        background: rgba(0, 40, 40, 0.3);
        border-radius: 15px;
        border: 2px solid #00A859;
      }
      
      h1 {
        color: #00A859;
        font-size: 2.5rem;
        margin-bottom: 10px;
      }
      
      .subtitle {
        color: #aaa;
        font-size: 1.2rem;
      }
      
      .stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
        gap: 20px;
        margin-bottom: 30px;
      }
      
      .stat-card {
        background: rgba(20, 30, 40, 0.8);
        padding: 20px;
        border-radius: 10px;
        text-align: center;
        border: 1px solid rgba(0, 168, 89, 0.3);
        transition: transform 0.3s ease;
      }
      
      .stat-card:hover {
        transform: translateY(-5px);
        border-color: #00A859;
      }
      
      .stat-card h3 {
        color: #FFD700;
        margin-bottom: 10px;
        font-size: 1.1rem;
      }
      
      .stat-card .value {
        font-size: 2rem;
        font-weight: bold;
        color: #00A859;
        margin-bottom: 5px;
      }
      
      .stat-card .label {
        color: #aaa;
        font-size: 0.9rem;
      }
      
      .users-section {
        background: rgba(20, 30, 40, 0.8);
        border-radius: 10px;
        padding: 20px;
        margin-bottom: 30px;
      }
      
      .users-section h2 {
        color: #FFD700;
        margin-bottom: 20px;
        padding-bottom: 10px;
        border-bottom: 2px solid #00A859;
      }
      
      .users-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: 15px;
      }
      
      .user-card {
        background: rgba(30, 40, 50, 0.9);
        padding: 15px;
        border-radius: 8px;
        display: flex;
        align-items: center;
        gap: 15px;
        border: 1px solid rgba(255, 255, 255, 0.1);
      }
      
      .user-card.online {
        border-left: 4px solid #00A859;
      }
      
      .user-card.offline {
        border-left: 4px solid #D62828;
        opacity: 0.7;
      }
      
      .user-avatar {
        width: 50px;
        height: 50px;
        border-radius: 50%;
        background: linear-gradient(45deg, #00A859, #1DA1F2);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.5rem;
      }
      
      .user-info {
        flex: 1;
      }
      
      .user-name {
        font-weight: bold;
        color: #fff;
        margin-bottom: 5px;
      }
      
      .user-twitter {
        color: #1DA1F2;
        font-size: 0.9rem;
      }
      
      .user-status {
        display: flex;
        align-items: center;
        gap: 5px;
        font-size: 0.8rem;
        margin-top: 5px;
      }
      
      .status-online {
        color: #00A859;
      }
      
      .status-offline {
        color: #D62828;
      }
      
      .actions {
        text-align: center;
        margin-top: 30px;
      }
      
      .btn {
        background: linear-gradient(45deg, #00A859, #1DA1F2);
        color: white;
        border: none;
        padding: 12px 25px;
        border-radius: 25px;
        font-size: 1rem;
        font-weight: bold;
        cursor: pointer;
        transition: all 0.3s ease;
        margin: 0 10px;
      }
      
      .btn:hover {
        transform: translateY(-3px);
        box-shadow: 0 5px 15px rgba(0, 168, 89, 0.3);
      }
      
      .btn.reset {
        background: linear-gradient(45deg, #D62828, #FFD700);
      }
      
      .last-update {
        text-align: center;
        color: #aaa;
        margin-top: 20px;
        font-size: 0.9rem;
      }
      
      @media (max-width: 768px) {
        .stats-grid {
          grid-template-columns: 1fr;
        }
        
        .users-grid {
          grid-template-columns: 1fr;
        }
        
        h1 {
          font-size: 2rem;
        }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <header>
        <h1>🖥️ لوحة مراقبة MisterAI TV</h1>
        <p class="subtitle">مراقبة حية للدردشة والاتصالات</p>
      </header>
      
      <div class="stats-grid">
        <div class="stat-card">
          <h3>👥 المستخدمون المتصلون</h3>
          <div class="value">${stats.totalConnections}</div>
          <div class="label">اتصال نشط</div>
        </div>
        
        <div class="stat-card">
          <h3>💬 الرسائل</h3>
          <div class="value">${stats.chatMessages}</div>
          <div class="label">رسالة في السجل</div>
        </div>
        
        <div class="stat-card">
          <h3>🗳️ التصويتات</h3>
          <div class="value">${stats.pollVotes}</div>
          <div class="label">إجمالي الأصوات</div>
        </div>
        
        <div class="stat-card">
          <h3>⏱️ وقت التشغيل</h3>
          <div class="value">${Math.floor(stats.serverUptime / 60)}:${Math.floor(stats.serverUptime % 60).toString().padStart(2, '0')}</div>
          <div class="label">دقيقة:ثانية</div>
        </div>
      </div>
      
      <div class="users-section">
        <h2>👤 المستخدمون النشطون (${users.length})</h2>
        <div class="users-grid">
          ${users.map(user => `
            <div class="user-card ${user.isOnline ? 'online' : 'offline'}">
              <div class="user-avatar">
                ${user.twitter.charAt(1).toUpperCase()}
              </div>
              <div class="user-info">
                <div class="user-name">${user.name}</div>
                <div class="user-twitter">${user.twitter}</div>
                <div class="user-status">
                  <span class="status-${user.isOnline ? 'online' : 'offline'}">
                    ${user.isOnline ? '🟢 متصل' : '🔴 غير متصل'}
                  </span>
                  <span>•</span>
                  <span>انضم: ${new Date(user.joinedAt).toLocaleTimeString('ar-EG')}</span>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
      
      <div class="actions">
        <button class="btn" onclick="location.reload()">🔄 تحديث الصفحة</button>
        <button class="btn reset" onclick="resetPoll()">🗳️ إعادة تعيين التصويت</button>
        <button class="btn" onclick="window.open('/')">🏠 العودة للتطبيق</button>
      </div>
      
      <div class="last-update" id="lastUpdate">
        آخر تحديث: ${new Date().toLocaleString('ar-EG')}
      </div>
    </div>
    
    <script>
      // تحديث تلقائي كل 10 ثواني
      setInterval(() => {
        location.reload();
      }, 10000);
      
      function resetPoll() {
        if (confirm('هل تريد إعادة تعيين جميع التصويتات؟')) {
          fetch('/api/poll/reset', { method: 'POST' })
            .then(() => {
              alert('تم إعادة تعيين التصويتات');
              location.reload();
            })
            .catch(err => {
              alert('خطأ في إعادة التعيين');
              console.error(err);
            });
        }
      }
    </script>
  </body>
  </html>
  `;
  
  res.send(html);
});

// صفحة اختبار WebSocket
app.get('/debug/websocket', (req, res) => {
  res.send(`
  <!DOCTYPE html>
  <html>
  <head>
    <title>اختبار WebSocket</title>
    <script src="https://cdn.socket.io/4.7.2/socket.io.min.js"></script>
    <style>
      body { font-family: Arial; padding: 20px; }
      .status { padding: 10px; margin: 10px 0; border-radius: 5px; }
      .connected { background: #d4edda; color: #155724; }
      .disconnected { background: #f8d7da; color: #721c24; }
      .message { background: #e9ecef; padding: 10px; margin: 5px 0; border-radius: 5px; }
    </style>
  </head>
  <body>
    <h1>🔧 اختبار WebSocket</h1>
    
    <div id="status" class="status disconnected">❌ غير متصل</div>
    
    <button onclick="connect()">🔗 الاتصال</button>
    <button onclick="sendTest()">📨 إرسال رسالة اختبار</button>
    <button onclick="disconnect()">🔌 قطع الاتصال</button>
    
    <div id="messages"></div>
    
    <script>
      let socket;
      
      function connect() {
        socket = io(window.location.origin, {
          transports: ['websocket', 'polling']
        });
        
        socket.on('connect', () => {
          document.getElementById('status').className = 'status connected';
          document.getElementById('status').innerHTML = '✅ متصل - ID: ' + socket.id;
          addMessage('✅ متصل بالخادم');
        });
        
        socket.on('newMessage', (msg) => {
          addMessage('📨 رسالة جديدة: ' + JSON.stringify(msg));
        });
        
        socket.on('disconnect', () => {
          document.getElementById('status').className = 'status disconnected';
          document.getElementById('status').innerHTML = '❌ انقطع الاتصال';
          addMessage('❌ انقطع الاتصال');
        });
        
        socket.on('error', (err) => {
          addMessage('❌ خطأ: ' + JSON.stringify(err));
        });
      }
      
      function sendTest() {
        if (socket && socket.connected) {
          socket.emit('sendMessage', {
            text: 'رسالة اختبار من صفحة التصحيح',
            timestamp: Date.now()
          });
          addMessage('📤 أرسلت رسالة اختبار');
        } else {
          addMessage('❌ غير متصل - لا يمكن الإرسال');
        }
      }
      
      function disconnect() {
        if (socket) {
          socket.disconnect();
          addMessage('🔌 تم قطع الاتصال يدوياً');
        }
      }
      
      function addMessage(text) {
        const div = document.createElement('div');
        div.className = 'message';
        div.textContent = text;
        document.getElementById('messages').appendChild(div);
      }
      
      // اتصال تلقائي
      connect();
    </script>
  </body>
  </html>
  `);
});

// API لإعادة تعيين التصويت
app.post('/api/poll/reset', (req, res) => {
  pollData = {
    nigeria: { votes: 150, percentage: 60 },
    algeria: { votes: 100, percentage: 40 },
    total: 250,
    lastUpdated: Date.now()
  };
  
  userVotes.clear();
  
  // إرسال تحديث للجميع
  io.emit('pollUpdate', pollData);
  
  res.json({ 
    success: true, 
    message: 'تم إعادة تعيين التصويت',
    poll: pollData 
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

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'الصفحة غير موجودة',
    path: req.path 
  });
});

// ============ بدء الخادم ============
server.listen(PORT, () => {
  console.log(`🚀 الخادم يعمل على المنفذ ${PORT}`);
  console.log(`🌐 افتح http://localhost:${PORT}`);
  console.log(`🔗 WebSocket: ws://localhost:${PORT}`);
  console.log(`📊 لوحة المراقبة: http://localhost:${PORT}/admin/connections`);
  console.log(`🔧 اختبار WebSocket: http://localhost:${PORT}/debug/websocket`);
});

// تنظيف دوري للمستخدمين غير النشطين
setInterval(() => {
  const now = Date.now();
  const INACTIVE_TIMEOUT = 5 * 60 * 1000; // 5 دقائق
  
  activeUsers.forEach((user, socketId) => {
    if (now - user.lastActive > INACTIVE_TIMEOUT && user.isOnline) {
      user.isOnline = false;
      console.log(`🕐 ${user.twitter} تم تعطيله بسبب عدم النشاط`);
      
      // إرسال تحديث للمستخدمين
      io.emit('usersUpdate', {
        count: Array.from(activeUsers.values()).filter(u => u.isOnline).length,
        users: Array.from(activeUsers.values())
          .filter(u => u.isOnline)
          .map(u => ({
            name: u.name,
            twitter: u.twitter,
            avatar: u.avatar
          }))
      });
    }
  });
}, 60 * 1000); // كل دقيقة

// Export للـ Vercel
module.exports = app;
