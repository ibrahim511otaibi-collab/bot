import sqlite3 from 'sqlite3';
import path from 'path';

class DatabaseManager {
    constructor() {
        const dbName = process.env.DB_FILE || 'history.db';
        const dbPath = path.join(process.cwd(), dbName);
        this.db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                console.error('Error opening database:', err.message);
            }
        });
        
        this.init();
    }

    init() {
        this.db.serialize(() => {
            // جدول سجل الإرسال
            this.db.run(`
                CREATE TABLE IF NOT EXISTS history (
                    target_id INTEGER PRIMARY KEY,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // جدول سجل السحب من الغرف
            this.db.run(`
                CREATE TABLE IF NOT EXISTS room_scrape_log (
                    channel_id INTEGER PRIMARY KEY,
                    last_scraped DATETIME,
                    members_scraped INTEGER DEFAULT 0,
                    members_added INTEGER DEFAULT 0
                )
            `);

            // جدول الطابور
            this.db.run(`
                CREATE TABLE IF NOT EXISTS invite_queue (
                    target_id INTEGER PRIMARY KEY,
                    added_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);
        });
    }

    // ينظف السجلات التي مر عليها أكثر من 7 أيام
    cleanupOldRecords() {
        return new Promise((resolve, reject) => {
            this.db.run(`DELETE FROM history WHERE timestamp < datetime('now', '-7 days')`, function(err) {
                if (err) reject(err);
                else resolve(this.changes);
            });
        });
    }

    // تفريغ سجل الإرسال بالكامل
    clearHistory() {
        return new Promise((resolve, reject) => {
            this.db.run(`DELETE FROM history`, function(err) {
                if (err) reject(err);
                else resolve(this.changes);
            });
        });
    }

    // يتحقق من مجموعة أشخاص ويُرجع فقط من لم يتم إرسال رسالة لهم مؤخراً
    async filterUnmessagedIds(targetIds, days = 7) {
        if (!targetIds || targetIds.length === 0) return [];
        const chunkSize = 900;
        let cleanIds = [];
        
        for (let i = 0; i < targetIds.length; i += chunkSize) {
            const chunk = targetIds.slice(i, i + chunkSize);
            const placeholders = chunk.map(() => '?').join(',');
            
            const chunkCleanIds = await new Promise((resolve, reject) => {
                this.db.all(`SELECT target_id FROM history WHERE target_id IN (${placeholders}) AND timestamp >= datetime('now', 'localtime', '-${days} days')`, chunk, (err, rows) => {
                    if (err) reject(err);
                    else {
                        const messagedIds = rows.map(r => r.target_id);
                        resolve(chunk.filter(id => !messagedIds.includes(id)));
                    }
                });
            });
            cleanIds = cleanIds.concat(chunkCleanIds);
        }
        return cleanIds;
    }

    // يتحقق هل تم إرسال رسالة لهذا الشخص خلال 7 أيام
    hasBeenMessagedRecently(targetId) {
        return new Promise((resolve, reject) => {
            this.db.get(`SELECT target_id FROM history WHERE target_id = ? AND timestamp >= datetime('now', 'localtime', '-7 days')`, [targetId], (err, row) => {
                if (err) reject(err);
                else resolve(!!row);
            });
        });
    }

    // يسجل الشخص في الذاكرة (أو يحدث تاريخه إذا كان موجوداً مسبقاً)
    markAsMessaged(targetId) {
        return new Promise((resolve, reject) => {
            this.db.run(`
                INSERT INTO history (target_id, timestamp) 
                VALUES (?, datetime('now', 'localtime')) 
                ON CONFLICT(target_id) 
                DO UPDATE SET timestamp = datetime('now', 'localtime')
            `, [targetId], function(err) {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    // يحدّث سجل السحب لغرفة معينة
    updateRoomScrapeLog(channelId, membersScraped, membersAdded) {
        return new Promise((resolve, reject) => {
            this.db.run(`
                INSERT INTO room_scrape_log (channel_id, last_scraped, members_scraped, members_added)
                VALUES (?, datetime('now', 'localtime'), ?, ?)
                ON CONFLICT(channel_id)
                DO UPDATE SET last_scraped = datetime('now', 'localtime'), members_scraped = ?, members_added = ?
            `, [channelId, membersScraped, membersAdded, membersScraped, membersAdded], function(err) {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    // يجلب سجل آخر سحب لقائمة غرف
    async getRoomScrapeLogs(channelIds) {
        if (!channelIds || channelIds.length === 0) return [];
        const chunkSize = 900;
        let allRows = [];
        
        for (let i = 0; i < channelIds.length; i += chunkSize) {
            const chunk = channelIds.slice(i, i + chunkSize);
            const placeholders = chunk.map(() => '?').join(',');
            
            const chunkRows = await new Promise((resolve, reject) => {
                this.db.all(`
                    SELECT channel_id, last_scraped, members_scraped, members_added
                    FROM room_scrape_log
                    WHERE channel_id IN (${placeholders})
                `, chunk, (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                });
            });
            allRows = allRows.concat(chunkRows);
        }
        return allRows;
    }

    // ===== دوال الطابور الجديد (Queue System) =====

    // إضافة مجموعة أعضاء للطابور وتجاهل الموجودين
    async addToQueueBatch(targetIds) {
        if (!targetIds || targetIds.length === 0) return 0;
        const chunkSize = 900;
        let totalChanges = 0;

        for (let i = 0; i < targetIds.length; i += chunkSize) {
            const chunk = targetIds.slice(i, i + chunkSize);
            const placeholders = chunk.map(() => '(?)').join(',');
            
            const changes = await new Promise((resolve, reject) => {
                this.db.run(`
                    INSERT OR IGNORE INTO invite_queue (target_id)
                    VALUES ${placeholders}
                `, chunk, function(err) {
                    if (err) reject(err);
                    else resolve(this.changes);
                });
            });
            totalChanges += changes;
        }
        return totalChanges;
    }

    // معاينة أقدم عضو بالطابور بدون حذفه
    peekQueue() {
        return new Promise((resolve, reject) => {
            this.db.get(`SELECT target_id FROM invite_queue ORDER BY added_at ASC LIMIT 1`, (err, row) => {
                if (err) reject(err);
                else resolve(row ? row.target_id : null);
            });
        });
    }

    // حذف عضو من الطابور (بعد التأكد من نجاح الإرسال أو فشله النهائي)
    removeFromQueue(targetId) {
        return new Promise((resolve, reject) => {
            this.db.run(`DELETE FROM invite_queue WHERE target_id = ?`, [targetId], function(err) {
                if (err) reject(err);
                else resolve(this.changes);
            });
        });
    }

    // جلب عدد الأعضاء في الطابور
    getQueueLength() {
        return new Promise((resolve, reject) => {
            this.db.get(`SELECT COUNT(*) as count FROM invite_queue`, (err, row) => {
                if (err) reject(err);
                else resolve(row ? row.count : 0);
            });
        });
    }

    // تفريغ الطابور بالكامل
    clearQueue() {
        return new Promise((resolve, reject) => {
            this.db.run(`DELETE FROM invite_queue`, function(err) {
                if (err) reject(err);
                else resolve(this.changes);
            });
        });
    }
}

export default new DatabaseManager();
