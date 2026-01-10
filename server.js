const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API endpoint for stats (يمكن توسيعه لاحقاً)
app.get('/api/stats', (req, res) => {
    res.json({
        status: 'online',
        users: 0, // سيتم تحديثه لاحقاً
        streams: 16,
        version: '1.0.0'
    });
});

// إعادة توجيه جميع الطلبات إلى الصفحة الرئيسية (للتطبيقات ذات الصفحة الواحدة)
app.get('*', (req, res) => {
    res.redirect('/');
});

// Start server
app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🌍 Open http://localhost:${PORT} in your browser`);
});
