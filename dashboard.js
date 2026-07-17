import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { inviteBot } from './inviteBotManager.js';
import dbManager from './DatabaseManager.js';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// مسار للتحقق من كلمة المرور (Auth Middleware)
const authMiddleware = (req, res, next) => {
    const providedPassword = req.headers['x-api-password'] || req.query.apiPassword || req.body.apiPassword;
    const correctPassword = process.env.API_PASSWORD;
    
    if (correctPassword && providedPassword !== correctPassword) {
        return res.status(401).json({ success: false, message: "كلمة المرور غير صحيحة أو مفقودة!" });
    }
    next();
};

app.use('/api', authMiddleware);

app.get('/api/status', (req, res) => {
    res.json(inviteBot.getStatus());
});

app.get('/api/logs', (req, res) => {
    res.json({ logs: inviteBot.logs });
});

app.post('/api/start', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ success: false, message: "الرجاء إدخال الإيميل وكلمة المرور" });
    }
    const result = await inviteBot.start(email, password);
    res.json(result);
});

app.post('/api/start-token', async (req, res) => {
    const { token } = req.body;
    if (!token) {
        return res.status(400).json({ success: false, message: "الرجاء توفير التوكن" });
    }
    const result = await inviteBot.loginWithToken(token);
    res.json(result);
});

app.post('/api/stop', (req, res) => {
    const result = inviteBot.stop();
    res.json(result);
});

app.post('/api/pause', (req, res) => {
    const result = inviteBot.pause();
    res.json(result);
});

app.post('/api/resume', (req, res) => {
    const result = inviteBot.resumeQueue();
    res.json(result);
});

app.post('/api/invite', async (req, res) => {
    const { targetId, customMessage } = req.body;
    if (!targetId || !customMessage) return res.status(400).json({ success: false, message: "الرجاء إدخال الآيدي والرسالة" });
    const result = await inviteBot.sendInvite(parseInt(targetId), customMessage);
    res.json(result);
});

app.post('/api/mass-invite', async (req, res) => {
    const { sourceGroupId, customMessage, minDelay, maxDelay } = req.body;
    if (!sourceGroupId) return res.status(400).json({ success: false, message: "الرجاء إدخال أرقام الغرف" });
    const result = await inviteBot.massInvite(String(sourceGroupId), customMessage, minDelay, maxDelay);
    res.json(result);
});

app.post('/api/stop-mass-invite', (req, res) => {
    const result = inviteBot.clearQueue();
    res.json(result);
});

// ===== مسارات نظام إدارة الغرف الجديد =====

// جلب الغرف التي ينتمي إليها البوت
app.get('/api/rooms', async (req, res) => {
    const result = await inviteBot.getJoinedRooms();
    res.json(result);
});

// بدء سحب وفلترة أعضاء غرفة محددة
app.post('/api/rooms/scrape', async (req, res) => {
    const { channelId, filters } = req.body;
    if (!channelId) return res.status(400).json({ success: false, message: "الرجاء إدخال معرف الغرفة" });
    // يبدأ السحب في الخلفية ويعود فوراً
    inviteBot.scrapeRoom(parseInt(channelId), filters || {}).catch(console.error);
    res.json({ success: true, message: `بدأ سحب الغرفة ${channelId} في الخلفية. راقب شريط التقدم.` });
});

// إيقاف السحب الجاري
app.post('/api/rooms/stop-scrape', (req, res) => {
    const result = inviteBot.stopScrape();
    res.json(result);
});

// بدء فحص أعضاء الغرفة (استخراج القائمة كاملة للجدول)
app.post('/api/rooms/fetch-members', async (req, res) => {
    const { channelId } = req.body;
    if (!channelId) return res.status(400).json({ success: false, message: "الرجاء إدخال معرف الغرفة" });
    inviteBot.fetchRoomMembers(parseInt(channelId)).catch(console.error);
    res.json({ success: true, message: `بدأ فحص أعضاء الغرفة ${channelId} في الخلفية. راقب شريط التقدم.` });
});

// استلام القائمة المفحوصة وإفراغ الذاكرة
app.get('/api/rooms/fetched-data', (req, res) => {
    if (inviteBot.fetchedMembers !== null) {
        const data = inviteBot.fetchedMembers;
        inviteBot.fetchedMembers = null; // إفراغ الكاش لتوفير الرام
        res.json({ success: true, members: data });
    } else {
        res.json({ success: false, message: 'لا توجد بيانات مفحوصة أو الفحص لم يكتمل.' });
    }
});

// إضافة قائمة آيديات للطابور
app.post('/api/queue/add', async (req, res) => {
    const { targetIds } = req.body;
    if (!targetIds || !Array.isArray(targetIds)) return res.status(400).json({ success: false, message: "الرجاء تمرير مصفوفة آيديات صالحة" });
    try {
        const changes = await dbManager.addToQueueBatch(targetIds);
        inviteBot.queueLength = await dbManager.getQueueLength();
        res.json({ success: true, added: changes, message: `تمت إضافة ${changes} عضو للطابور بنجاح.` });
    } catch (err) {
        res.status(500).json({ success: false, message: `فشل الإضافة: ${err.message}` });
    }
});

// بدء الإرسال من الطابور الحالي (بدون سحب جديد)
app.post('/api/start-sending', async (req, res) => {
    const { customMessage, minDelay, maxDelay } = req.body;
    if (!customMessage) return res.status(400).json({ success: false, message: "الرجاء إدخال الرسالة" });
    inviteBot.adMessage = customMessage;
    if (minDelay) inviteBot.minDelay = parseInt(minDelay) * 1000;
    if (maxDelay) inviteBot.maxDelay = parseInt(maxDelay) * 1000;
    if (!inviteBot.isProcessingQueue && inviteBot.queueLength > 0) {
        inviteBot.processMassInviteQueue().catch(console.error);
        res.json({ success: true, message: `بدأ الإرسال لـ ${inviteBot.queueLength} عضو في الطابور.` });
    } else if (inviteBot.isProcessingQueue) {
        res.json({ success: false, message: 'الإرسال جارٍ بالفعل!' });
    } else {
        res.json({ success: false, message: 'الطابور فارغ! قم بسحب أعضاء أولاً.' });
    }
});

// تفريغ سجل الإرسال (قانون 7 أيام)
app.post('/api/history/clear', async (req, res) => {
    try {
        await dbManager.clearHistory();
        res.json({ success: true, message: "تم مسح سجل الإرسال بالكامل. البوت الآن سيعتبر جميع الأعضاء جدداً." });
    } catch (err) {
        res.status(500).json({ success: false, message: `فشل مسح السجل: ${err.message}` });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 لوحة التحكم تعمل الآن على الرابط: http://localhost:${PORT}`);
});
