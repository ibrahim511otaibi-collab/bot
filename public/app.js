document.addEventListener('DOMContentLoaded', () => {

    // ===== المتغيرات الأساسية =====
    const apiPasswordInput = document.getElementById('apiPassword');
    const saveCheck = document.getElementById('saveCredentials');
    const configForm = document.getElementById('config-form');
    const startBtn = document.getElementById('start-btn');
    const stopBtn = document.getElementById('stop-btn');
    const pauseBtn = document.getElementById('pause-btn');
    const resumeBtn = document.getElementById('resume-btn');
    const statusBadge = document.getElementById('status-badge');
    const statusText = document.getElementById('status-text');

    // الإرسال الجماعي
    const massMessage = document.getElementById('mass-message');
    const massMinDelay = document.getElementById('mass-min-delay');
    const massMaxDelay = document.getElementById('mass-max-delay');
    const startSendingBtn = document.getElementById('start-sending-btn');
    const stopSendingBtn = document.getElementById('stop-sending-btn');
    const queueBadge = document.getElementById('queue-badge');

    // اليدوي
    const targetIdInput = document.getElementById('targetId');
    const manualAdMessageInput = document.getElementById('manualAdMessage');
    const sendInviteBtn = document.getElementById('send-invite-btn');

    // إدارة الغرف
    const refreshRoomsBtn = document.getElementById('refresh-rooms-btn');
    const roomsList = document.getElementById('rooms-list');

    // سجل
    const logsContainer = document.getElementById('logs-container');
    const clearLogsBtn = document.getElementById('clear-logs-btn');

    // الإحصائيات
    const statMass = document.getElementById('stat-mass');
    const statManual = document.getElementById('stat-manual');
    const statQueue = document.getElementById('stat-queue');
    const statBotname = document.getElementById('stat-botname');

    // شريط التقدم
    const scrapeProgressCard = document.getElementById('scrape-progress-card');
    const progressBarFill = document.getElementById('progress-bar-fill');
    const progCurrent = document.getElementById('prog-current');
    const progTotal = document.getElementById('prog-total');
    const progAdded = document.getElementById('prog-added');
    const stopScrapeProgressBtn = document.getElementById('stop-scrape-progress-btn');

    // المودال
    const scrapeModal = document.getElementById('scrape-modal');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const startScrapeBtn = document.getElementById('start-scrape-btn');
    const modalChannelId = document.getElementById('modal-channel-id');
    const modalRoomName = document.getElementById('modal-room-name');

    // الفلاتر في المودال
    const genderPills = document.querySelectorAll('#gender-filter .pill');
    const minLevelInput = document.getElementById('min-level');
    const maxLevelInput = document.getElementById('max-level');
    const excludeStaffCheck = document.getElementById('exclude-staff');
    const ignoreHistoryCheck = document.getElementById('ignore-history');

    // ===== الحالة =====
    let lastLogCount = 0;
    let allLogs = [];
    let isBotRunning = false;
    let isFetchingData = false;
    let cachedMembers = [];
    let filteredMembers = [];

    // ===== استرجاع البيانات المحفوظة =====
    if (localStorage.getItem('apiPassword')) {
        apiPasswordInput.value = localStorage.getItem('apiPassword');
        saveCheck.checked = true;
    }
    if (localStorage.getItem('massMessage')) massMessage.value = localStorage.getItem('massMessage');
    if (localStorage.getItem('manualAdMessage')) manualAdMessageInput.value = localStorage.getItem('manualAdMessage');

    massMessage.addEventListener('input', () => localStorage.setItem('massMessage', massMessage.value));
    manualAdMessageInput.addEventListener('input', () => localStorage.setItem('manualAdMessage', manualAdMessageInput.value));

    // ===== الهيدر المشترك =====
    const getHeaders = () => ({
        'Content-Type': 'application/json',
        'x-api-password': apiPasswordInput.value
    });

    // ===== التوست =====
    const showToast = (msg, type = 'default') => {
        const toast = document.getElementById('toast');
        toast.textContent = msg;
        toast.className = `toast show`;
        clearTimeout(toast._t);
        toast._t = setTimeout(() => toast.classList.remove('show'), 3200);
    };

    // ===== التنقل بين الأقسام =====
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
            btn.classList.add('active');
            const sectionId = btn.dataset.section;
            document.getElementById(sectionId)?.classList.add('active');
        });
    });

    // ===== تحديث واجهة الحالة =====
    const updateStatusUI = (status) => {
        isBotRunning = status.isRunning;

        if (status.isRunning) {
            statusBadge.className = 'badge on';
            statusText.textContent = status.botName ? `شغال: ${status.botName}` : 'شغال';
            startBtn.classList.add('hidden');
            stopBtn.classList.remove('hidden');
            
            // إظهار وإخفاء أزرار الإيقاف المؤقت والاستئناف بناء على حالة الطابور
            if (status.isProcessingQueue) {
                pauseBtn.classList.remove('hidden');
                resumeBtn.classList.add('hidden');
            } else {
                pauseBtn.classList.add('hidden');
                resumeBtn.classList.remove('hidden');
            }
            
            statBotname.textContent = status.botName || '—';
        } else {
            statusBadge.className = 'badge off';
            statusText.textContent = 'متوقف';
            startBtn.classList.remove('hidden');
            stopBtn.classList.add('hidden');
            pauseBtn.classList.add('hidden');
            resumeBtn.classList.add('hidden');
            statBotname.textContent = '—';
        }

        statMass.textContent = status.massSent || 0;
        statManual.textContent = status.manualSent || 0;
        statQueue.textContent = status.queueLength || 0;
        queueBadge.textContent = `${status.queueLength || 0} عضو`;

        // شريط التقدم
        const prog = status.scrapeProgress || status.fetchProgress;
        if (prog) {
            scrapeProgressCard.classList.remove('hidden');
            const pct = prog.total > 0 ? Math.round((prog.current / prog.total) * 100) : 0;
            progressBarFill.style.width = `${pct}%`;
            progCurrent.textContent = prog.current.toLocaleString('ar');
            progTotal.textContent = prog.total.toLocaleString('ar');
            progAdded.textContent = prog.added !== undefined ? prog.added.toLocaleString('ar') : 'فحص فقط';
            
            const headerSpan = document.querySelector('#scrape-progress-card .progress-header span');
            if (headerSpan) {
                headerSpan.innerHTML = status.fetchProgress 
                    ? '<i class="fa-solid fa-spinner fa-spin"></i> جاري الفحص واستخراج البيانات...' 
                    : '<i class="fa-solid fa-spinner fa-spin"></i> جاري السحب والفلترة...';
            }
        } else {
            scrapeProgressCard.classList.add('hidden');
        }

        if (status.isFetchComplete && !isFetchingData) {
            fetchInspectData();
        }
    };

    // ===== جلب الحالة =====
    const fetchStatus = async () => {
        if (!apiPasswordInput.value) return;
        try {
            const res = await fetch('/api/status', { headers: getHeaders() });
            if (!res.ok) return;
            const data = await res.json();
            updateStatusUI(data);
        } catch (e) {}
    };

    // ===== جلب السجلات (تراكمي) =====
    const fetchLogs = async () => {
        if (!apiPasswordInput.value) return;
        try {
            const res = await fetch('/api/logs', { headers: getHeaders() });
            if (!res.ok) return;
            const data = await res.json();
            if (data.logs && data.logs.length > lastLogCount) {
                const newLogs = data.logs.slice(lastLogCount);
                const newText = [...newLogs].reverse().join('\n');
                if (lastLogCount === 0) {
                    logsContainer.textContent = newText;
                } else {
                    logsContainer.textContent = newText + '\n' + logsContainer.textContent;
                }
                lastLogCount = data.logs.length;
                allLogs = data.logs;
            }
        } catch (e) {}
    };

    clearLogsBtn.addEventListener('click', () => {
        logsContainer.textContent = '';
        lastLogCount = 0;
        allLogs = [];
    });

    // ===== تشغيل البوت =====
    configForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (saveCheck.checked) localStorage.setItem('apiPassword', apiPasswordInput.value);
        else localStorage.removeItem('apiPassword');

        setLoading(startBtn, true, 'جاري التشغيل...');
        try {
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            const res = await fetch('/api/start', {
                method: 'POST', headers: getHeaders(),
                body: JSON.stringify({ email, password })
            });
            const data = await res.json();
            if (res.status === 401) showToast('كلمة سر اللوحة خاطئة!');
            else { showToast(data.message); setTimeout(fetchStatus, 3000); }
        } catch { showToast('خطأ في الاتصال'); }
        finally { setLoading(startBtn, false); }
    });

    // ===== نظام الدخول الشامل (التوكن / الإضافة) =====
    const extensionLoginBtn = document.getElementById('extension-login-btn');
    const directTokenInput = document.getElementById('direct-token');

    // الدالة المسؤولة عن إرسال التوكن للباك-إند
    const loginWithToken = async (token) => {
        if (saveCheck.checked) localStorage.setItem('apiPassword', apiPasswordInput.value);
        else localStorage.removeItem('apiPassword');

        setLoading(extensionLoginBtn, true, 'جاري الاتصال...');
        try {
            const res = await fetch('/api/start-token', {
                method: 'POST', headers: getHeaders(),
                body: JSON.stringify({ token })
            });
            const data = await res.json();
            if (res.status === 401) showToast('كلمة سر اللوحة خاطئة!');
            else { 
                showToast(data.message); 
                directTokenInput.value = ''; // تفريغ الخانة بعد النجاح
                setTimeout(fetchStatus, 3000); 
            }
        } catch { showToast('خطأ في الاتصال بالتوكن'); }
        finally { setLoading(extensionLoginBtn, false); }
    };

    // 1. الدخول عبر الإضافة (يفتح نافذة وينتظر التوكن)
    extensionLoginBtn?.addEventListener('click', () => {
        const popup = window.open('https://wolf.live', 'wolf_login', 'width=500,height=600');
        
        // الاستماع للرسائل القادمة من الإضافة (content.js)
        const messageListener = (event) => {
            // نتحقق من محتوى الرسالة
            if (event.data && event.data.type === 'WOLF_TOKEN') {
                const token = event.data.token;
                console.log("تم استلام التوكن من الإضافة!");
                showToast("تم سحب التوكن! جاري الاتصال...", "success");
                loginWithToken(token);
                // إزالة المستمع بعد النجاح
                window.removeEventListener('message', messageListener);
            }
        };
        window.addEventListener('message', messageListener);

        // مراقبة إغلاق النافذة يدوياً
        const checkClosed = setInterval(() => {
            if (popup && popup.closed) {
                clearInterval(checkClosed);
                window.removeEventListener('message', messageListener);
            }
        }, 1000);
    });

    // 2. الدخول عبر اللصق اليدوي للتوكن
    directTokenInput?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const token = directTokenInput.value.trim();
            if (token) loginWithToken(token);
        }
    });

    // ===== إيقاف البوت =====
    stopBtn.addEventListener('click', async () => {
        setLoading(stopBtn, true, 'جاري الإيقاف...');
        try {
            const res = await fetch('/api/stop', { method: 'POST', headers: getHeaders() });
            const data = await res.json();
            showToast(data.message);
            fetchStatus();
        } catch { showToast('خطأ في الاتصال'); }
        finally { setLoading(stopBtn, false); }
    });

    pauseBtn.addEventListener('click', async () => {
        setLoading(pauseBtn, true, 'جاري...');
        try {
            const res = await fetch('/api/pause', { method: 'POST', headers: getHeaders() });
            const data = await res.json();
            showToast(data.message);
            fetchStatus();
        } catch { showToast('خطأ في الاتصال'); }
        finally { setLoading(pauseBtn, false); }
    });

    resumeBtn.addEventListener('click', async () => {
        setLoading(resumeBtn, true, 'جاري...');
        try {
            const res = await fetch('/api/resume', { method: 'POST', headers: getHeaders() });
            const data = await res.json();
            showToast(data.message);
            fetchStatus();
        } catch { showToast('خطأ في الاتصال'); }
        finally { setLoading(resumeBtn, false); }
    });

    // ===== بدء الإرسال من الطابور =====
    startSendingBtn.addEventListener('click', async () => {
        const msg = massMessage.value.trim();
        if (!msg) return showToast('اكتب رسالة الإعلان أولاً');
        setLoading(startSendingBtn, true, 'جاري البدء...');
        try {
            const res = await fetch('/api/start-sending', {
                method: 'POST', headers: getHeaders(),
                body: JSON.stringify({ customMessage: msg, minDelay: massMinDelay.value, maxDelay: massMaxDelay.value })
            });
            const data = await res.json();
            showToast(data.message);
        } catch { showToast('خطأ في الاتصال'); }
        finally { setLoading(startSendingBtn, false); }
    });

    // ===== مسح الطابور =====
    stopSendingBtn.addEventListener('click', async () => {
        if (!confirm('هل أنت متأكد من مسح الطابور كاملاً؟')) return;
        try {
            const res = await fetch('/api/stop-mass-invite', { method: 'POST', headers: getHeaders() });
            const data = await res.json();
            showToast(data.message);
            fetchStatus();
        } catch { showToast('خطأ في الاتصال'); }
    });

    // ===== تصفير سجل الإرسال (قانون 7 أيام) =====
    const clearHistoryBtn = document.getElementById('clear-history-btn');
    if (clearHistoryBtn) {
        clearHistoryBtn.addEventListener('click', async () => {
            if (!confirm('هل أنت متأكد من مسح ذاكرة الـ 7 أيام؟ البوت سيعتبر جميع الأعضاء جدداً!')) return;
            try {
                const res = await fetch('/api/history/clear', { method: 'POST', headers: getHeaders() });
                const data = await res.json();
                showToast(data.message);
            } catch { showToast('خطأ في الاتصال'); }
        });
    }

    // ===== إيقاف السحب (من شريط التقدم) =====
    stopScrapeProgressBtn.addEventListener('click', async () => {
        try {
            const res = await fetch('/api/rooms/stop-scrape', { method: 'POST', headers: getHeaders() });
            const data = await res.json();
            showToast(data.message);
        } catch { showToast('خطأ في الاتصال'); }
    });

    // ===== الإرسال اليدوي =====
    sendInviteBtn.addEventListener('click', async () => {
        const id = targetIdInput.value;
        const msg = manualAdMessageInput.value;
        if (!id) return showToast('أدخل الآيدي أولاً');
        if (!msg) return showToast('أدخل الرسالة أولاً');
        setLoading(sendInviteBtn, true);
        try {
            const res = await fetch('/api/invite', {
                method: 'POST', headers: getHeaders(),
                body: JSON.stringify({ targetId: id, customMessage: msg })
            });
            const data = await res.json();
            showToast(data.message);
            if (data.success) targetIdInput.value = '';
            fetchStatus();
        } catch { showToast('خطأ في الاتصال'); }
        finally { setLoading(sendInviteBtn, false); }
    });

    // ===== جلب وعرض الغرف =====
    const loadRooms = async () => {
        roomsList.innerHTML = '<div class="empty-state"><i class="fa-solid fa-spinner fa-spin"></i><p>جاري جلب الغرف...</p></div>';
        try {
            const res = await fetch('/api/rooms', { headers: getHeaders() });
            const data = await res.json();

            if (!data.success) {
                roomsList.innerHTML = `<div class="empty-state"><i class="fa-solid fa-circle-exclamation"></i><p>${data.message || 'فشل جلب الغرف'}</p></div>`;
                return;
            }

            if (!data.rooms || data.rooms.length === 0) {
                roomsList.innerHTML = '<div class="empty-state"><i class="fa-solid fa-door-open"></i><p>البوت غير منضم لأي غرفة حالياً</p></div>';
                return;
            }

            roomsList.innerHTML = `
                <table class="rooms-table">
                    <thead>
                        <tr>
                            <th>الغرفة</th>
                            <th>الأعضاء</th>
                            <th>آخر سحب</th>
                            <th>تم إضافة</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody id="rooms-tbody"></tbody>
                </table>
            `;

            const tbody = document.getElementById('rooms-tbody');
            data.rooms.forEach(room => {
                const initial = (room.name || 'G').charAt(0).toUpperCase();
                const lastScrapedTag = buildLastScrapedTag(room.lastScraped);
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>
                        <div class="room-name-cell">
                            <div class="room-avatar">${initial}</div>
                            <div>
                                <div>${room.name}</div>
                                <div class="room-id">#${room.id}</div>
                            </div>
                        </div>
                    </td>
                    <td>${(room.membersCount || 0).toLocaleString('ar')}</td>
                    <td>${lastScrapedTag}</td>
                    <td>${room.lastMembersAdded > 0 ? `<span style="color: var(--success);">+${room.lastMembersAdded}</span>` : '—'}</td>
                    <td>
                        <button class="btn-small secondary scrape-btn" data-id="${room.id}" data-name="${room.name}" style="margin-bottom: 5px; width: 100%;">
                            <i class="fa-solid fa-download"></i> سحب للطابور
                        </button>
                        <button class="btn-small primary inspect-btn" data-id="${room.id}" style="width: 100%;">
                            <i class="fa-solid fa-magnifying-glass"></i> فحص الغرفة
                        </button>
                    </td>
                `;
                tbody.appendChild(row);
            });

            // ربط أزرار السحب والفحص
            document.querySelectorAll('.scrape-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    openScrapeModal(btn.dataset.id, btn.dataset.name);
                });
            });

            document.querySelectorAll('.inspect-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const channelId = btn.dataset.id;
                    document.querySelector('[data-section="section-control"]').click();
                    try {
                        const res = await fetch('/api/rooms/fetch-members', {
                            method: 'POST', headers: getHeaders(),
                            body: JSON.stringify({ channelId: parseInt(channelId) })
                        });
                        const data = await res.json();
                        showToast(data.message);
                    } catch(err) { showToast('خطأ في الاتصال'); }
                });
            });

        } catch (err) {
            roomsList.innerHTML = `<div class="empty-state"><i class="fa-solid fa-circle-exclamation"></i><p>خطأ: ${err.message}</p></div>`;
        }
    };

    const buildLastScrapedTag = (dateStr) => {
        if (!dateStr) return `<span class="last-scraped-tag never"><i class="fa-solid fa-clock"></i> لم يتم</span>`;
        const date = new Date(dateStr);
        const diffHours = (Date.now() - date.getTime()) / 3600000;
        const label = formatTimeAgo(date);
        if (diffHours < 24) return `<span class="last-scraped-tag recent"><i class="fa-solid fa-circle-check"></i> ${label}</span>`;
        if (diffHours < 168) return `<span class="last-scraped-tag old"><i class="fa-solid fa-triangle-exclamation"></i> ${label}</span>`;
        return `<span class="last-scraped-tag never"><i class="fa-solid fa-clock"></i> ${label}</span>`;
    };

    const formatTimeAgo = (date) => {
        const diff = Date.now() - date.getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 60) return `منذ ${mins} دقيقة`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `منذ ${hrs} ساعة`;
        const days = Math.floor(hrs / 24);
        return `منذ ${days} يوم`;
    };

    refreshRoomsBtn.addEventListener('click', loadRooms);

    // تحميل الغرف تلقائياً عند الانتقال لقسم الغرف
    document.querySelector('[data-section="section-rooms"]').addEventListener('click', () => {
        if (isBotRunning) loadRooms();
    });

    // ===== المودال =====
    const openScrapeModal = (channelId, roomName) => {
        modalChannelId.value = channelId;
        modalRoomName.innerHTML = `<i class="fa-solid fa-filter"></i> سحب أعضاء: ${roomName}`;
        scrapeModal.classList.remove('hidden');
    };

    closeModalBtn.addEventListener('click', () => scrapeModal.classList.add('hidden'));
    scrapeModal.addEventListener('click', (e) => { if (e.target === scrapeModal) scrapeModal.classList.add('hidden'); });

    // فلاتر الجنس
    genderPills.forEach(pill => {
        pill.addEventListener('click', () => {
            genderPills.forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
        });
    });

    // تأكيد السحب من المودال
    startScrapeBtn.addEventListener('click', async () => {
        const channelId = modalChannelId.value;
        const gender = document.querySelector('#gender-filter .pill.active')?.dataset.value || 'all';
        const minLevel = parseInt(minLevelInput.value) || 0;
        const maxLevel = parseInt(maxLevelInput.value) || 9999;
        const excludeStaff = excludeStaffCheck.checked;
        const ignoreHistory = ignoreHistoryCheck ? ignoreHistoryCheck.checked : false;

        scrapeModal.classList.add('hidden');

        // الانتقال لقسم التحكم لرؤية شريط التقدم
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
        document.querySelector('[data-section="section-control"]').classList.add('active');
        document.getElementById('section-control').classList.add('active');

        setLoading(startScrapeBtn, true, 'جاري البدء...');
        try {
            const res = await fetch('/api/rooms/scrape', {
                method: 'POST', headers: getHeaders(),
                body: JSON.stringify({ channelId: parseInt(channelId), filters: { gender, minLevel, maxLevel, excludeStaff, ignoreHistory } })
            });
            const data = await res.json();
            showToast(data.message);
        } catch { showToast('خطأ في الاتصال'); }
        finally { setLoading(startScrapeBtn, false); }
    });

    // ===== منطق غرفة الفحص والجدول =====
    const inspectTableContainer = document.getElementById('inspect-table-container');
    const inspectControls = document.getElementById('inspect-controls');
    const inspectStats = document.getElementById('inspect-stats');

    const fetchInspectData = async () => {
        if (isFetchingData) return;
        isFetchingData = true;
        
        const btn = document.getElementById('fetch-data-btn');
        if (btn) setLoading(btn, true);

        try {
            const res = await fetch('/api/rooms/fetched-data', { headers: getHeaders() });
            const data = await res.json();
            if (data.success && data.members) {
                cachedMembers = data.members;
                applyInspectFilters();
                showToast('تم استلام بيانات الغرفة بنجاح!');
                document.querySelector('[data-section="section-inspect"]').click();
            } else if (data.message) {
                showToast(data.message);
            }
        } catch (e) {
            showToast('خطأ في الاتصال');
        }
        
        if (btn) setLoading(btn, false);
        isFetchingData = false;
    };

    document.getElementById('fetch-data-btn')?.addEventListener('click', fetchInspectData);

    const applyInspectFilters = () => {
        if (!cachedMembers || cachedMembers.length === 0) return;
        
        inspectControls.style.display = 'block';
        
        const q = document.getElementById('inspect-search').value.trim().toLowerCase();
        const minLvl = parseInt(document.getElementById('inspect-min-level').value) || 0;
        const maxLvl = parseInt(document.getElementById('inspect-max-level').value) || 9999;
        const genderVal = document.getElementById('inspect-gender').value;
        const hideStaff = document.getElementById('inspect-hide-staff').checked;
        const hideSent = document.getElementById('inspect-hide-sent').checked;
        
        filteredMembers = cachedMembers.filter(m => {
            if (q && !m.id.toString().includes(q) && !(m.name && m.name.toLowerCase().includes(q))) return false;
            if (m.level < minLvl || m.level > maxLvl) return false;
            if (genderVal !== 'all' && m.gender.toString() !== genderVal) return false;
            if (hideStaff && m.isStaff) return false;
            if (hideSent && m.alreadySent) return false;
            return true;
        });
        
        inspectStats.textContent = `محدد: ${filteredMembers.length} / ${cachedMembers.length}`;
        renderInspectTable();
    };

    const renderInspectTable = () => {
        if (filteredMembers.length === 0) {
            inspectTableContainer.innerHTML = '<div class="empty-state"><p>لا يوجد أعضاء يطابقون الفلاتر الحالية.</p></div>';
            return;
        }
        
        const displayList = filteredMembers.slice(0, 1000);
        let html = `<table class="rooms-table">
            <thead>
                <tr>
                    <th>الآيدي</th>
                    <th>الاسم</th>
                    <th>المستوى</th>
                    <th>الجنس</th>
                    <th>مُرسَل مسبقاً؟</th>
                </tr>
            </thead>
            <tbody>`;
            
        displayList.forEach(m => {
            html += `<tr>
                <td>${m.id}</td>
                <td>${m.name}</td>
                <td>${m.level}</td>
                <td>${m.gender === 1 ? 'ذكر' : m.gender === 2 ? 'أنثى' : 'غير محدد'}</td>
                <td>${m.alreadySent ? '<span style="color:var(--danger)">نعم (7 أيام)</span>' : '<span style="color:var(--success)">لا (جديد)</span>'}</td>
            </tr>`;
        });
        
        html += `</tbody></table>`;
        if (filteredMembers.length > 1000) {
            html += `<p style="text-align:center; padding:1rem; color:var(--text-secondary);">تم إخفاء باقي ${filteredMembers.length - 1000} عضو لتسريع المتصفح، لكن سيتم إضافتهم للطابور عند الاعتماد.</p>`;
        }
        
        inspectTableContainer.innerHTML = html;
    };

    ['inspect-search', 'inspect-min-level', 'inspect-max-level', 'inspect-gender'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', applyInspectFilters);
    });
    ['inspect-hide-staff', 'inspect-hide-sent'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', applyInspectFilters);
    });

    document.getElementById('inspect-add-queue-btn')?.addEventListener('click', async () => {
        if (filteredMembers.length === 0) return showToast('لا يوجد أعضاء محددين للإضافة!');
        const targetIds = filteredMembers.map(m => m.id);
        const btn = document.getElementById('inspect-add-queue-btn');
        setLoading(btn, true, 'جاري الإضافة...');
        
        try {
            const res = await fetch('/api/queue/add', {
                method: 'POST', headers: getHeaders(),
                body: JSON.stringify({ targetIds })
            });
            const data = await res.json();
            showToast(data.message);
            if (data.success) {
                // Remove added from cached to prevent re-adding
                cachedMembers = cachedMembers.filter(m => !targetIds.includes(m.id));
                applyInspectFilters();
                fetchStatus();
                document.querySelector('[data-section="section-sending"]').click();
            }
        } catch {
            showToast('خطأ في الاتصال');
        } finally {
            setLoading(btn, false);
        }
    });

    // ===== مساعد Loading =====
    const loadingStates = new Map();
    function setLoading(btn, loading, text = '') {
        if (loading) {
            loadingStates.set(btn, btn.innerHTML);
            if (text) btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${text}`;
            btn.disabled = true;
        } else {
            btn.innerHTML = loadingStates.get(btn) || btn.innerHTML;
            btn.disabled = false;
        }
    }

    // ===== الدورة الرئيسية =====
    fetchStatus();
    fetchLogs();
    setInterval(() => {
        if (apiPasswordInput.value) {
            fetchStatus();
            fetchLogs();
        }
    }, 5000);
});
