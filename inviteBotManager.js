import wolf from "wolf.js";
const { WOLF, Privilege } = wolf;
import dbManager from "./DatabaseManager.js";
import dotenv from 'dotenv';
dotenv.config();

const SPAM_EMOJIS = [
    '🔥', '✨', '🌹', '💯', '🚀', '💡', '🌟', '✅', '👑', '🎉', '👋', '❤️', '💙', '💚', '💛', '💜',
    '🧡', '🖤', '🤍', '🤎', '💔', '❤️‍🔥', '❤️‍🩹', '💖', '💗', '💓', '💞', '💕', '💟', '❣️',
    '👍', '👌', '✌️', '🤞', '🤙', '🤘', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '💪', '🦵', '🦶',
    '😎', '🤓', '🧐', '🤠', '🥳', '🥸', '🤩', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛',
    '💎', '🔮', '🧿', '🪬', '🎊', '🎈', '🎀', '🎁', '🪄', '🏆', '🏅', '🥇', '🥈', '🥉'
];

const proxyListEnv = process.env.PROXY_LIST || process.env.PROXY_URL;
const proxyList = proxyListEnv ? proxyListEnv.split(',').map(p => p.trim()) : [];

class InviteBot {
    constructor() {
        this.client = null;
        this.isRunning = false;
        this.manualSentToday = 0;
        this.massSentToday = 0;
        this.MAX_MANUAL = 200;

        this.queueLength = 0;
        this.isProcessingQueue = false;
        this.isConnected = false;

        // استرجاع طول الطابور من قاعدة البيانات عند بدء التشغيل
        dbManager.getQueueLength().then(length => {
            this.queueLength = length;
            if (this.queueLength > 0) {
                this.addLog(`[ℹ] تم استرجاع طابور يحتوي على ${this.queueLength} عضو من الجلسة السابقة.`);
            }
        }).catch(err => console.error("Error getting queue length:", err));
        this.adMessage = null;
        this.botName = null;
        this.minDelay = 7000;
        this.maxDelay = 15000;

        this.wizardState = 0;
        this.tempGroupIds = null;
        this.tempAdMessage = null;

        // Auto Sleep properties
        this.messagesSentSinceWakeup = 0;
        this.isSleeping = false;
        this.sleepThreshold = this.getRandomDelay(150, 250);

        this.logs = [];

        // تتبع تقدم السحب
        this.scrapeProgress = null;
        this.fetchProgress = null;
        this.fetchedMembers = null;
    }

    addLog(message) {
        console.log(message);
        const timestamp = new Date().toLocaleTimeString('ar-SA');
        this.logs.push(`[${timestamp}] ${message}`);
        if (this.logs.length > 200) {
            this.logs.shift();
        }
    }

    getRandomDelay(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async start(email, password, token = null) {
        if (this.isRunning) return { success: false, message: "البوت يعمل بالفعل!" };

        this.addLog("🔄 جاري إعداد الاتصال بالسيرفر...");
        this.client = new WOLF();

        if (proxyList.length > 0) {
            const randomProxy = proxyList[Math.floor(Math.random() * proxyList.length)];
            
            // For wolf.js native WebSocket proxy
            process.env.PROXY_URL = randomProxy;
            
            // For all REST/HTTP traffic via global-agent
            if (global.GLOBAL_AGENT) {
                global.GLOBAL_AGENT.HTTP_PROXY = randomProxy;
            }
            
            const displayIp = randomProxy.includes('@') ? randomProxy.split('@')[1].split(':')[0] : (randomProxy.includes('://') ? randomProxy.split('://')[1].split(':')[0] : randomProxy.split(':')[0]);
            this.addLog(`[!] تم اختيار بروكسي: ${displayIp}`);
        } else {
            this.addLog(`[!] تحذير: لا توجد بروكسيات في ملف .env`);
        }

        this.client = new WOLF();

        const handleReady = async () => {
            this.addLog(`[✔] تم تسجيل الدخول بنجاح!`);
            this.isRunning = true;
            this.isConnected = true;

            try {
                const deleted = await dbManager.cleanupOldRecords();
                if (deleted > 0) this.addLog(`[🧹] تم مسح ${deleted} سجل قديم.`);
            } catch (e) {
                console.error("Cleanup error:", e);
            }

            try {
                const me = await this.client.subscriber.getById(this.client.currentSubscriber.id);
                this.botName = me.nickname || me.id;
            } catch (e) { }

            if (this.queueLength > 0 && !this.isProcessingQueue) {
                this.processMassInviteQueue();
            }
        };

        this.client.on('ready', handleReady);
        this.client.on('resume', handleReady);

        this.client.on('connected', () => {
            this.addLog(`[✔] عاد الاتصال بنجاح!`);
            this.isConnected = true;
            if (this.isRunning && this.queueLength > 0 && !this.isProcessingQueue) {
                this.processMassInviteQueue();
            }
        });

        this.client.on('disconnected', () => {
            this.addLog(`[!] انقطع الاتصال باللعبة!`);
            this.isConnected = false;
        });

        this.client.on('failed', (err) => {
            this.addLog(`❌ فشل تسجيل الدخول: ${err}`);
            this.isRunning = false;
        });

        this.client.on('message', async (message) => {
            if (message.isGroup) return;
            if (message.sourceSubscriberId === this.client.currentSubscriber.id) return;

            const text = message.body ? message.body.trim() : "";
            const senderId = message.sourceSubscriberId;

            if (this.wizardState > 0) {
                if (text === 'الغاء' || text === 'ايقاف') {
                    this.wizardState = 0;
                    await this.client.messaging.sendPrivateMessage(senderId, "تم إلغاء الإعداد.");
                    return;
                }

                if (this.wizardState === 1) {
                    this.tempGroupIds = text;
                    this.wizardState = 2;
                    await this.client.messaging.sendPrivateMessage(senderId, "ممتاز، ماهي رسالة الإعلان؟");
                    return;
                }

                if (this.wizardState === 2) {
                    this.tempAdMessage = text;
                    this.wizardState = 3;
                    await this.client.messaging.sendPrivateMessage(senderId, "تم الحفظ. ماهي السرعة بالثواني؟ (مثال: 5 15)");
                    return;
                }

                if (this.wizardState === 3) {
                    const parts = text.split(' ').map(n => parseInt(n));
                    if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                        this.minDelay = parts[0] * 1000;
                        this.maxDelay = parts[1] * 1000;
                        this.wizardState = 0;
                        await this.client.messaging.sendPrivateMessage(senderId, "اكتملت الإعدادات! جاري سحب الأعضاء والبدء 🚀");
                        this.massInvite(this.tempGroupIds, this.tempAdMessage).catch(console.error);
                    } else {
                        await this.client.messaging.sendPrivateMessage(senderId, "الرجاء كتابة رقمين صحيحين (مثال: 5 15)");
                    }
                    return;
                }
            }

            if (text === 'ابدا') {
                if (this.queueLength > 0) {
                    await this.client.messaging.sendPrivateMessage(senderId, "يوجد طابور محفوظ. اكتب (كمل) أو (جديد).");
                } else {
                    this.wizardState = 1;
                    await this.client.messaging.sendPrivateMessage(senderId, "أهلاً، ماهي أرقام الغرف؟");
                }
            } else if (text === 'جديد') {
                await this.clearQueue();
                this.wizardState = 1;
                await this.client.messaging.sendPrivateMessage(senderId, "أهلاً، ماهي أرقام الغرف؟");
            } else if (text === 'كمل') {
                if (this.queueLength > 0) {
                    this.isSleeping = false;
                    await this.client.messaging.sendPrivateMessage(senderId, "جاري إكمال الإرسال 🫡");
                    if (!this.isProcessingQueue) {
                        this.processMassInviteQueue();
                    }
                } else {
                    await this.client.messaging.sendPrivateMessage(senderId, "الطابور فارغ!");
                }
            } else if (text === 'ايقاف' || text === 'وقف') {
                this.isProcessingQueue = false;
                await this.client.messaging.sendPrivateMessage(senderId, "تم إيقاف الإرسال مؤقتاً.");
                this.addLog("[⏸] تم الإيقاف المؤقت عبر الشات.");
            } else if (text === 'وضع') {
                const p = process.env.PROXY_URL || '';
                const proxyIP = p ? (p.includes('@') ? p.split('@')[1].split(':')[0] : (p.includes('://') ? p.split('://')[1].split(':')[0] : p.split(':')[0])) : 'بدون بروكسي';
                let statusStr = this.isProcessingQueue ? 'يعمل 🟢' : 'متوقف 🔴';
                if (this.isSleeping) statusStr = 'في استراحة 💤';
                
                const sentToday = this.massSentToday + this.manualSentToday;
                const nextSleep = this.sleepThreshold - this.messagesSentSinceWakeup;
                
                const report = `📊 تقرير البوت الشامل:
                
⚙️ الحالة: ${statusStr}
🌐 البروكسي: ${proxyIP}

📦 الطابور المتبقي: ${this.queueLength} عضو
✅ أرسل اليوم: ${sentToday} رسالة

⏱️ سرعة الإرسال: من ${this.minDelay/1000} إلى ${this.maxDelay/1000} ثواني
💤 النوم القادم: بعد إرسال ${nextSleep} رسالة`;

                await this.client.messaging.sendPrivateMessage(senderId, report);
            }
        });

        try {
            if (token) {
                this.client.config.framework.login.token = token;
                await this.client.connect();
            } else {
                await this.client.login(email, password);
            }
            return { success: true, message: "جاري تسجيل الدخول..." };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    async loginWithToken(token) {
        return this.start(null, null, token);
    }

    stop() {
        if (this.client && this.isRunning) {
            this.client.logout();
            this.client = null;
            this.isRunning = false;
            this.botName = null;
            this.isProcessingQueue = false;
            return { success: true, message: "تم إيقاف البوت." };
        }
        return { success: false, message: "البوت لا يعمل حالياً." };
    }

    pause() {
        if (this.isRunning && this.isProcessingQueue) {
            this.isProcessingQueue = false;
            this.addLog("[⏸] تم الإيقاف المؤقت عبر الداشبورد.");
            return { success: true, message: "تم إيقاف الإرسال مؤقتاً." };
        }
        return { success: false, message: "الطابور لا يعمل حالياً." };
    }

    resumeQueue() {
        if (this.isRunning && !this.isProcessingQueue && this.queueLength > 0) {
            this.isSleeping = false;
            this.addLog("[▶] تم استئناف الإرسال عبر الداشبورد.");
            this.processMassInviteQueue();
            return { success: true, message: "تم استئناف الإرسال." };
        }
        return { success: false, message: "لا يوجد شيء لاستئنافه أو الطابور فارغ." };
    }

    async sendInvite(targetId, customMessage) {
        if (!this.isRunning) return { success: false, message: "يجب تشغيل البوت أولاً." };
        if (this.manualSentToday >= this.MAX_MANUAL) return { success: false, message: "تم بلوغ الحد الأقصى اليومي." };
        if (!customMessage) return { success: false, message: "يجب كتابة رسالة." };

        try {
            await this.client.messaging.sendPrivateMessage(targetId, customMessage);
            this.manualSentToday++;
            this.addLog(`[+] تم الإرسال اليدوي لـ ${targetId}`);
            return { success: true, message: `تم الإرسال لـ ${targetId}` };
        } catch (error) {
            this.addLog(`[-] فشل الإرسال لـ ${targetId}: ${error.message}`);
            return { success: false, message: `فشل الإرسال: ${error.message}` };
        }
    }

    async massInvite(sourceGroupIds, customAdMessage, minDelay = 7, maxDelay = 300) {
        if (!this.isRunning) return { success: false, message: "يجب تشغيل البوت أولاً." };
        if (!customAdMessage) return { success: false, message: "يجب كتابة الرسالة الجماعية." };

        this.adMessage = customAdMessage;
        this.minDelay = minDelay * 1000;
        this.maxDelay = maxDelay * 1000;

        try {
            const groupIds = sourceGroupIds.split(',').map(id => id.trim()).filter(id => id);
            let totalPulled = 0;

            for (const sourceGroupId of groupIds) {
                this.addLog(`[~] الانضمام للغرفة: ${sourceGroupId}`);
                try {
                    await this.client.channel.joinById(sourceGroupId);
                } catch (e) {
                    this.addLog(`[!] ملاحظة: ${e.message}`);
                }

                this.addLog(`[~] جاري سحب أعضاء الغرفة: ${sourceGroupId}`);
                const membersList = await this.client.channel.member.getRegularList(sourceGroupId);

                if (membersList && membersList.length > 0) {
                    const memberIds = [...new Set(membersList.map(m => m?.id).filter(id => id && typeof id === 'number' && id > 0))];
                    this.addLog(`[~] جاري تصفية ${memberIds.length} عضو...`);

                    let validIds = [];
                    for (const memberId of memberIds) {
                        const alreadySent = await dbManager.hasBeenMessagedRecently(memberId);
                        if (!alreadySent) {
                            validIds.push(memberId);
                        }
                    }
                    if (validIds.length > 0) {
                        await dbManager.addToQueueBatch(validIds);
                        totalPulled += validIds.length;
                    }
                }
            }

            this.queueLength = await dbManager.getQueueLength();
            this.processMassInviteQueue();

            return { success: true, message: `تم إضافة ${totalPulled} عضو جديد. الإجمالي: ${this.queueLength}` };
        } catch (error) {
            this.addLog(`[-] فشل سحب الأعضاء: ${error.message}`);
            return { success: false, message: `فشل: ${error.message}` };
        }
    }

    async processMassInviteQueue() {
        if (this.isProcessingQueue) return;
        this.isProcessingQueue = true;

        this.queueLength = await dbManager.getQueueLength();
        this.addLog(`[~] بدء إرسال الدعوات لـ ${this.queueLength} عضو...`);

        while (this.queueLength > 0) {
            if (!this.isRunning || !this.isConnected) {
                this.addLog(`[⏸] توقف الطابور. المتبقي: ${this.queueLength}`);
                this.isProcessingQueue = false;
                return;
            }

            const targetId = await dbManager.peekQueue();
            if (!targetId) {
                this.queueLength = 0;
                break;
            }

            let adMessageText = this.adMessage || `أهلاً بك!`;
            const randomEmoji = SPAM_EMOJIS[Math.floor(Math.random() * SPAM_EMOJIS.length)];
            adMessageText = `${adMessageText} ${randomEmoji}`;

            let shouldRemoveFromQueue = true;

            try {
                const subscriber = await this.client.subscriber.getById(targetId);
                if (subscriber && subscriber.privilegeList) {
                    const isBot = subscriber.privilegeList.includes(Privilege.BOT);
                    const isStaff = subscriber.privilegeList.includes(Privilege.STAFF);
                    if (isBot || isStaff) {
                        this.addLog(`[~] تخطي ${targetId} (بوت/إدارة)`);
                        await dbManager.removeFromQueue(targetId);
                        this.queueLength--;
                        continue;
                    }
                }

                await this.client.messaging.sendPrivateMessage(targetId, adMessageText);
                await dbManager.markAsMessaged(targetId);

                this.massSentToday++;
                this.messagesSentSinceWakeup++;
                this.queueLength--;
                this.addLog(`[+] إرسال لـ ${targetId} (المتبقي: ${this.queueLength})`);
            } catch (error) {
                const errMsg = error.message ? error.message.toLowerCase() : '';
                this.addLog(`[-] خطأ إرسال لـ ${targetId}: ${errMsg}`);

                // Anti-Spam protection
                if (errMsg.includes('spam') || errMsg.includes('banned') || errMsg.includes('restrict') || errMsg.includes('limit')) {
                    this.addLog(`[🚨] تحذير خطير: تم اكتشاف منع أو حظر من السيرفر! سيتم إيقاف الطابور فوراً لحماية الحساب.`);
                    this.isProcessingQueue = false;
                    shouldRemoveFromQueue = false; // Keep user in queue
                    break;
                } else {
                    this.queueLength--; // Skip error (like user blocked bot), remove from queue
                }
            }

            if (shouldRemoveFromQueue) {
                await dbManager.removeFromQueue(targetId);
            }

            if (this.messagesSentSinceWakeup >= this.sleepThreshold) {
                this.isSleeping = true;
                this.addLog(`[💤] استراحة بشرية لساعتين...`);

                let sleepMinutes = 120;
                while (sleepMinutes > 0 && this.isSleeping && this.isProcessingQueue) {
                    if (!this.isRunning || !this.isProcessingQueue) {
                        this.isSleeping = false;
                        break;
                    }
                    await this.delay(60000);
                    sleepMinutes--;
                }

                if (this.isProcessingQueue) {
                    this.isSleeping = false;
                    this.messagesSentSinceWakeup = 0;
                    this.sleepThreshold = this.getRandomDelay(150, 250);
                    this.addLog(`[☀️] استيقظ البوت!`);
                }
            }

            if (this.queueLength > 0 && !this.isSleeping && this.isProcessingQueue) {
                const delayMs = this.getRandomDelay(this.minDelay, this.maxDelay);
                this.addLog(`[~] انتظار ${(delayMs / 1000).toFixed(1)} ثانية...`);
                
                const checkInterval = 1000;
                let waited = 0;
                while (waited < delayMs && this.isProcessingQueue && this.isRunning) {
                    await this.delay(Math.min(checkInterval, delayMs - waited));
                    waited += checkInterval;
                }
            }
        }

        this.isProcessingQueue = false;
        this.addLog("[+] انتهى إرسال الدعوات الجماعية.");
    }

    async clearQueue() {
        this.isProcessingQueue = false;
        await dbManager.clearQueue();
        this.queueLength = 0;
        this.addLog("[!] تم إيقاف الطابور وتفريغه بالكامل.");
        return { success: true, message: "تم إيقاف الطابور ومسح جميع الأعضاء." };
    }

    getStatus() {
        return {
            isRunning: this.isRunning,
            isProcessingQueue: this.isProcessingQueue,
            botName: this.botName,
            manualSent: this.manualSentToday,
            massSent: this.massSentToday,
            queueLength: this.queueLength || 0,
            scrapeProgress: this.scrapeProgress,
            fetchProgress: this.fetchProgress,
            isFetchComplete: this.fetchedMembers !== null
        };
    }

    // ===== جلب قائمة الغرف التي ينتمي إليها البوت =====
    async getJoinedRooms() {
        if (!this.isRunning || !this.client) {
            return { success: false, message: 'البوت غير مشغل' };
        }
        try {
            const channels = await this.client.channel.list();
            if (!channels || channels.length === 0) {
                return { success: true, rooms: [] };
            }

            const channelIds = channels.map(c => c.id);
            const scrapeLogs = await dbManager.getRoomScrapeLogs(channelIds);
            const scrapeLogMap = {};
            scrapeLogs.forEach(log => {
                scrapeLogMap[log.channel_id] = log;
            });

            const rooms = channels.map(ch => {
                const log = scrapeLogMap[ch.id] || null;
                return {
                    id: ch.id,
                    name: ch.name || `غرفة ${ch.id}`,
                    membersCount: ch.memberCount || ch.subscribers || 0,
                    lastScraped: log ? log.last_scraped : null,
                    lastMembersScraped: log ? log.members_scraped : 0,
                    lastMembersAdded: log ? log.members_added : 0
                };
            });

            return { success: true, rooms };
        } catch (err) {
            this.addLog(`[-] خطأ في جلب قائمة الغرف: ${err.message}`);
            return { success: false, message: err.message };
        }
    }

    // ===== الجلب الآمن للأعضاء (تجاوزاً لأخطاء المكتبة وحماية من الباند) =====
    async _getSafeRegularList(channelId) {
        let membersList = [];
        let lastId = undefined;
        let isComplete = false;

        while (!isComplete) {
            // توقف إذا تم إلغاء السحب أو الفحص يدوياً
            if (!this.scrapeProgress && !this.fetchProgress) {
                this.addLog(`[⏹] تم إيقاف عملية جلب الأعضاء.`);
                break;
            }

            try {
                const response = await this.client.websocket.emit('group member regular list', {
                    headers: { version: 1 },
                    body: {
                        id: channelId,
                        limit: 100,
                        after: lastId
                    }
                });

                if (response.code !== 200 || !response.body || !Array.isArray(response.body)) {
                    this.addLog(`[!] توقف الجلب. الكود: ${response.code}`);
                    break;
                }

                const batch = response.body;
                membersList.push(...batch);

                if (batch.length < 100) {
                    isComplete = true; // وصلنا لآخر الروم
                } else {
                    lastId = batch[batch.length - 1].id;
                    this.addLog(`[⏳] تم جلب ${membersList.length} آيدي... إراحة ثانية واحدة...`);
                    await this.delay(1000); // 1-second delay to avoid ban!
                }
            } catch (err) {
                this.addLog(`[!] خطأ أثناء سحب الدفعة: ${err.message}`);
                break;
            }
        }
        return membersList;
    }

    // ===== سحب أعضاء غرفة بالدُفعات مع الفلترة =====
    async scrapeRoom(channelId, filters = {}) {
        if (!this.isRunning || !this.client) {
            return { success: false, message: 'البوت غير مشغل' };
        }
        if (this.scrapeProgress) {
            return { success: false, message: 'يوجد سحب جارٍ بالفعل، انتظر!' };
        }

        const { gender = 'all', minLevel = 0, maxLevel = 9999, excludeStaff = true, ignoreHistory = false } = filters;

        this.scrapeProgress = { channelId, current: 0, total: 0, added: 0, status: 'جاري السحب...' };
        this.addLog(`[🔍] سحب الغرفة ${channelId} | جنس: ${gender} | مستوى: ${minLevel}-${maxLevel}`);

        try {
            // الانضمام للغرفة إن لم يكن فيها
            try {
                await this.client.channel.joinById(channelId);
                this.addLog(`[✔] انضم للغرفة ${channelId}.`);
            } catch (e) {
                this.addLog(`[~] البوت في الغرفة ${channelId} مسبقاً.`);
            }

            // تأخير ثانيتين لضمان تسجيل الانضمام
            await this.delay(2000);

            this.addLog(`[⏳] جاري جلب قائمة الأعضاء من سيرفرات اللعبة، يرجى الانتظار...`);
            const waitInterval = setInterval(() => {
                if (this.scrapeProgress) {
                    this.addLog(`[⏳] لا زال الجلب مستمراً... (الرجاء الانتظار)`);
                }
            }, 15000);

            // ===== الطريقة الآمنة المخصصة (Safe Pagination) =====
            clearInterval(waitInterval);
            let membersList = await this._getSafeRegularList(channelId);
            this.addLog(`[✔] تم جلب ${membersList.length} آيدي بنجاح.`);

            if (!membersList || membersList.length === 0) {
                this.scrapeProgress = null;
                const msg = `الغرفة ${channelId} فارغة أو مقفلة.`;
                this.addLog(`[-] ${msg}`);
                return { success: false, message: msg };
            }

            // استخراج الآيديات — ChannelMember.id هو آيدي المشترك
            const allIds = [...new Set(
                membersList
                    .map(m => m?.id)
                    .filter(id => id && typeof id === 'number' && id > 0)
            )];

            this.scrapeProgress.total = allIds.length;
            this.addLog(`[✔] ${allIds.length} آيدي فريد. بدء الفلترة...`);

            if (allIds.length === 0) {
                this.scrapeProgress = null;
                this.addLog(`[-] لم يُستخرج أي آيدي! (كائنات الأعضاء لا تحتوي على id)`);
                return { success: false, message: 'فشل استخراج الآيديات' };
            }

            // ===== معالجة بالدُفعات — 50 آيدي في كل طلب =====
            // subscribe=false لتجنب تعارض الكاش
            const BATCH_SIZE = 50;
            let addedCount = 0;
            let processedCount = 0;
            let filteredGender = 0, filteredLevel = 0, filteredStaff = 0, filteredSent = 0, filteredDup = 0;

            for (let i = 0; i < allIds.length; i += BATCH_SIZE) {
                if (!this.scrapeProgress) {
                    this.addLog(`[⏹] السحب أُلغي يدوياً.`);
                    break;
                }

                const batch = allIds.slice(i, i + BATCH_SIZE);

                let subscribers = [];
                try {
                    subscribers = await this.client.subscriber.getByIds(batch, false);
                } catch (e) {
                    this.addLog(`[!] خطأ في دُفعة ${i}→${i + BATCH_SIZE}: ${e.message}. تجاوز...`);
                    await this.delay(3000);
                    processedCount += batch.length;
                    this.scrapeProgress.current = processedCount;
                    continue;
                }

                if (!subscribers || subscribers.length === 0) {
                    this.addLog(`[!] دُفعة ${i}→${i + BATCH_SIZE} فارغة!`);
                    processedCount += batch.length;
                    this.scrapeProgress.current = processedCount;
                    continue;
                }

                let batchValidIds = [];
                for (const sub of subscribers) {
                    if (!sub || !sub.id || !sub.exists) continue;

                    // فلتر المستوى
                    const reputationNum = typeof sub.reputation === 'number' ? sub.reputation : 0;
                    const level = Math.floor(reputationNum);
                    if (level < minLevel || level > maxLevel) { filteredLevel++; continue; }

                    // فلتر الجنس
                    if (gender !== 'all') {
                        const subGender = sub.extended?.gender ?? 0;
                        if (gender === 'male' && subGender !== 1) { filteredGender++; continue; }
                        if (gender === 'female' && subGender !== 2) { filteredGender++; continue; }
                    }

                    // فلتر الإدارة والبوتات
                    if (excludeStaff && sub.privilegeList && sub.privilegeList.length > 0) {
                        const isBotOrStaff = sub.privilegeList.some(p =>
                            [Privilege.BOT, Privilege.STAFF, Privilege.VOLUNTEER,
                            Privilege.USER_ADMIN, Privilege.GROUP_ADMIN].includes(p)
                        );
                        if (isBotOrStaff) { filteredStaff++; continue; }
                    }

                    batchValidIds.push(sub.id);
                }

                if (batchValidIds.length > 0) {
                    let unmessagedIds = batchValidIds;
                    if (!ignoreHistory) {
                        unmessagedIds = await dbManager.filterUnmessagedIds(batchValidIds);
                        filteredSent += (batchValidIds.length - unmessagedIds.length);
                    }

                    if (unmessagedIds.length > 0) {
                        const changes = await dbManager.addToQueueBatch(unmessagedIds);
                        addedCount += changes;
                        filteredDup += (unmessagedIds.length - changes);
                    }
                }

                processedCount += batch.length;
                this.scrapeProgress.current = processedCount;
                this.scrapeProgress.added = addedCount;

                await this.delay(500);
            }

            // تقرير تفصيلي
            this.addLog(`[📊] تقرير السحب:`);
            this.addLog(`   الكلي: ${allIds.length} | أضيف: ${addedCount}`);
            this.addLog(`   حُذف جنس: ${filteredGender} | مستوى: ${filteredLevel} | إدارة: ${filteredStaff}`);
            this.addLog(`   حُذف مُرسل مسبقاً: ${filteredSent} | تكرار: ${filteredDup}`);

            if (addedCount === 0) {
                this.addLog(`[⚠️] لم يُضف أحد! الأسباب المحتملة:`);
                if (filteredSent > 0) this.addLog(`   → ${filteredSent} تم إرسالهم مسبقاً خلال 7 أيام`);
                if (filteredLevel > 0) this.addLog(`   → ${filteredLevel} خارج نطاق المستوى (${minLevel}-${maxLevel})`);
                if (filteredGender > 0) this.addLog(`   → ${filteredGender} لا يطابقون فلتر الجنس`);
            }

            await dbManager.updateRoomScrapeLog(channelId, allIds.length, addedCount);

            this.queueLength = await dbManager.getQueueLength();

            this.scrapeProgress = null;
            this.addLog(`[✅] اكتمل السحب. الطابور: ${this.queueLength} عضو.`);
            return { success: true, message: `تم إضافة ${addedCount} عضو للطابور.`, added: addedCount };

        } catch (err) {
            this.scrapeProgress = null;
            const errMsg = `خطأ: ${err.message}`;
            this.addLog(`[-] ${errMsg}`);
            return { success: false, message: errMsg };
        }
    }

    // ===== فحص الغرفة (جلب القائمة كاملة بدون إضافة للطابور) =====
    async fetchRoomMembers(channelId) {
        if (!this.isRunning || !this.client) {
            return { success: false, message: 'البوت غير مشغل' };
        }
        if (this.fetchProgress || this.scrapeProgress) {
            return { success: false, message: 'يوجد عملية سحب جارية بالفعل، انتظر!' };
        }

        this.fetchProgress = { channelId, current: 0, total: 0, status: 'جاري السحب...' };
        this.fetchedMembers = null;
        this.addLog(`[🔍] بدء فحص أعضاء الغرفة ${channelId} للحفظ في الذاكرة...`);

        try {
            try {
                await this.client.channel.joinById(channelId);
                this.addLog(`[✔] انضم للغرفة ${channelId}.`);
            } catch (e) {
                this.addLog(`[~] البوت في الغرفة ${channelId} مسبقاً.`);
            }

            await this.delay(2000);

            this.addLog(`[⏳] جاري جلب قائمة الأعضاء من سيرفرات اللعبة، يرجى الانتظار...`);
            const waitInterval = setInterval(() => {
                if (this.fetchProgress) {
                    this.addLog(`[⏳] لا زال الجلب مستمراً...`);
                }
            }, 15000);

            clearInterval(waitInterval);
            let membersList = await this._getSafeRegularList(channelId);
            this.addLog(`[✔] تم جلب ${membersList.length} آيدي للجدول.`);

            if (!membersList || membersList.length === 0) {
                this.fetchProgress = null;
                return { success: false, message: 'الغرفة فارغة' };
            }

            const allIds = [...new Set(membersList.map(m => m?.id).filter(id => id && typeof id === 'number' && id > 0))];
            this.fetchProgress.total = allIds.length;

            if (allIds.length === 0) {
                this.fetchProgress = null;
                return { success: false, message: 'فشل استخراج الآيديات' };
            }

            const BATCH_SIZE = 50;
            let processedCount = 0;
            let tempArray = [];

            for (let i = 0; i < allIds.length; i += BATCH_SIZE) {
                if (!this.fetchProgress) {
                    this.addLog(`[⏹] فحص الروم أُلغي يدوياً.`);
                    break;
                }

                const batch = allIds.slice(i, i + BATCH_SIZE);
                let subscribers = [];
                try {
                    subscribers = await this.client.subscriber.getByIds(batch, false);
                } catch (e) {
                    await this.delay(3000);
                    processedCount += batch.length;
                    this.fetchProgress.current = processedCount;
                    continue;
                }

                if (subscribers && subscribers.length > 0) {
                    for (const sub of subscribers) {
                        if (!sub || !sub.id || !sub.exists) continue;

                        const reputationNum = typeof sub.reputation === 'number' ? sub.reputation : 0;
                        const level = Math.floor(reputationNum);
                        const gender = sub.extended?.gender ?? 0;

                        let isStaff = false;
                        if (sub.privilegeList && sub.privilegeList.length > 0) {
                            isStaff = sub.privilegeList.some(p =>
                                [Privilege.BOT, Privilege.STAFF, Privilege.VOLUNTEER,
                                Privilege.USER_ADMIN, Privilege.GROUP_ADMIN].includes(p)
                            );
                        }

                        const alreadySent = await dbManager.hasBeenMessagedRecently(sub.id);

                        tempArray.push({
                            id: sub.id,
                            name: sub.nickname || 'Unknown',
                            level,
                            gender,
                            isStaff,
                            alreadySent
                        });
                    }
                }

                processedCount += batch.length;
                this.fetchProgress.current = processedCount;
                await this.delay(500);
            }

            this.fetchedMembers = tempArray;
            this.fetchProgress = null;
            this.addLog(`[✅] انتهى الفحص وتم تحميل ${tempArray.length} عضو للجدول.`);
            return { success: true };
        } catch (err) {
            this.fetchProgress = null;
            this.addLog(`[-] خطأ فحص الغرفة: ${err.message}`);
            return { success: false, message: err.message };
        }
    }

    stopScrape() {
        if (this.scrapeProgress || this.fetchProgress) {
            this.scrapeProgress = null;
            this.fetchProgress = null;
            this.addLog(`[⏹] تم إلغاء السحب أو الفحص.`);
            return { success: true, message: 'تم إلغاء السحب/الفحص.' };
        }
        return { success: false, message: 'لا يوجد سحب جارٍ.' };
    }
}

export const inviteBot = new InviteBot();
