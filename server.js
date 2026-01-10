// في server.js، استبدل الأجزاء التالية:

// ===== عند استقبال رسالة =====
socket.on('sendMessage', (messageData) => {
    const user = activeUsers.get(socket.id);
    if (!user) {
        socket.emit('error', { message: 'يجب تسجيل الدخول أولاً' });
        return;
    }
    
    if (!messageData.text || messageData.text.trim().length === 0) {
        socket.emit('error', { message: 'الرسالة لا يمكن أن تكون فارغة' });
        return;
    }
    
    if (messageData.text.length > 500) {
        socket.emit('error', { message: 'الرسالة طويلة جداً (الحد الأقصى 500 حرف)' });
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
        replies: []
    };
    
    // تحديث نشاط المستخدم
    user.lastActive = Date.now();
    activeUsers.set(socket.id, user);
    
    // === الإصلاح هنا ===
    // 1. حفظ الرسالة في المصفوفة أولاً
    chatMessages.push(message);
    
    // 2. الحفاظ على 500 رسالة كحد أقصى
    if (chatMessages.length > 500) {
        chatMessages.splice(0, chatMessages.length - 500);
    }
    
    // 3. البث لجميع المستخدمين المتصلين
    // استخدم io.sockets.emit للتأكد من وصول الرسالة للجميع
    io.sockets.emit('newMessage', message);
    // === نهاية الإصلاح ===
    
    // سجل للتحقق
    console.log(`📨 [${message.time}] ${user.twitter}: ${message.text.substring(0, 50)}...`);
    console.log(`👥 تم إرسال الرسالة إلى ${io.engine.clientsCount} عميل`);
    
    // تأكيد للمرسل
    socket.emit('messageSent', { 
        id: message.id, 
        timestamp: message.timestamp 
    });
});

// ===== عند انضمام مستخدم جديد =====
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
    
    // === الإصلاح: إرسال البيانات بشكل موثوق ===
    const initialData = {
        poll: pollData,
        recentMessages: chatMessages.slice(-30),
        onlineUsers: Array.from(activeUsers.values()).map(u => ({
            name: u.name,
            twitter: u.twitter,
            avatar: u.avatar
        })),
        totalOnline: activeUsers.size,
        serverTime: new Date().toISOString()
    };
    
    // إرسال البيانات الأولية لهذا العميل فقط
    socket.emit('initialData', initialData);
    
    // إعلام الجميع بمستخدم جديد (باستثناء المستخدم الجديد نفسه)
    socket.broadcast.emit('userJoined', {
        user: {
            name: user.name,
            twitter: user.twitter,
            avatar: user.avatar
        },
        onlineCount: activeUsers.size,
        timestamp: new Date().toISOString()
    });
    
    // إرسال رسالة نظام للجميع
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
    io.sockets.emit('newMessage', systemMessage);
    
    console.log(`✅ ${user.twitter} انضم إلى الدردشة (المستخدمون: ${activeUsers.size})`);
});

// ===== إضافة دالة للبث الموثوق =====
function broadcastToAll(event, data) {
    // الحصول على جميع المقابس النشطة
    const sockets = io.sockets.sockets;
    let sentCount = 0;
    
    sockets.forEach((clientSocket) => {
        if (clientSocket.connected) {
            clientSocket.emit(event, data);
            sentCount++;
        }
    });
    
    console.log(`📤 تم إرسال ${event} إلى ${sentCount} عميل`);
    return sentCount;
}

// ===== استبدال جميع عمليات io.emit بـ broadcastToAll =====
// في مكان إرسال الرسائل النظامية
const systemMessage = {
    // ... بيانات الرسالة
};
chatMessages.push(systemMessage);
broadcastToAll('newMessage', systemMessage);
