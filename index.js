const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const TOKEN = process.env.TOKEN;
if (!TOKEN) {
    console.error('❌ الرجاء تعيين متغير البيئة TOKEN');
    process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

// ==========================================
// إعداد قاعدة البيانات
// ==========================================
const dbPath = path.join(__dirname, 'data', 'subscriptions.db');
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS subscribers (
        user_id INTEGER PRIMARY KEY,
        plan TEXT DEFAULT 'free',
        start_date TEXT,
        end_date TEXT,
        campaigns_limit INTEGER DEFAULT 1,
        cards_limit INTEGER DEFAULT 10,
        active INTEGER DEFAULT 1
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS campaigns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        bin TEXT,
        total INTEGER,
        current INTEGER DEFAULT 0,
        hit INTEGER DEFAULT 0,
        status TEXT DEFAULT 'running',
        created_at TEXT
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS pending_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        plan TEXT,
        amount REAL,
        code TEXT,
        status TEXT DEFAULT 'waiting_payment',
        created_at TEXT
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS payment_proofs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        plan TEXT,
        photo_file_id TEXT,
        message_id INTEGER,
        status TEXT DEFAULT 'pending',
        created_at TEXT
    )`);
});

// ==========================================
// المتغيرات العامة
// ==========================================
const userLang = new Map();
const adminSet = new Set([643309456]);
const guessState = new Map();

const PLANS = {
    free: { name: 'مجاني', price: 0, cardsLimit: 10, campaignsLimit: 1, months: 0 },
    plus: { name: 'Plus', price: 3, cardsLimit: 70, campaignsLimit: 3, months: 1 },
    pro: { name: 'Pro', price: 5, cardsLimit: 150, campaignsLimit: 5, months: 1 },
    vip: { name: 'VIP', price: 8, cardsLimit: 350, campaignsLimit: 7, months: 1 }
};

const BINANCE_PAY_ID = '842505320';

// ==========================================
// دوال قاعدة البيانات (متزامنة باستخدام Promise)
// ==========================================
function dbGet(sql, params) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => { if (err) reject(err); else resolve(row); });
    });
}
function dbRun(sql, params) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) { if (err) reject(err); else resolve(this); });
    });
}
function dbAll(sql, params) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => { if (err) reject(err); else resolve(rows); });
    });
}

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
        if (!isSilent) await bot.sendMessage(chatId, '⚠️ خطأ في الاتصال بالخدمة.');
        return null;
    }
}

// ==========================================
// دوال الأزرار والنسخ
// ==========================================
function getCopyButtons(fullCard) {
    const [num, month, year, cvv] = fullCard.split('|');
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: '📋 نسخ الفيزا كاملة', callback_data: `copy_full_${fullCard}` }],
                [{ text: '🔢 نسخ الرقم', callback_data: `copy_num_${num}` }],
                [{ text: '📅 نسخ التاريخ', callback_data: `copy_exp_${month}|${year}` }],
                [{ text: '🔐 نسخ CVV', callback_data: `copy_cvv_${cvv}` }]
            ]
        }
    };
}

// ==========================================
// الترجمات الكاملة (عربي فقط للاختصار، يمكن إضافة الإنجليزي)
// ==========================================
const t = {
    ar: {
        choose_lang: 'اختر لغتك / Choose your language:',
        main_menu: '✨ *القائمة الرئيسية* ✨\nاختر أحد الخيارين:',
        btn_guess: '🎲 تخمين مجموعة فيزات',
        btn_single: '🔍 فحص فيزا واحدة',
        btn_subscribe: '💎 الاشتراكات',
        btn_my_campaigns: '📋 حملاي النشطة',
        cancel_btn: '❌ إلغاء',
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
        payment_received: '📸 تم استلام الصورة. سيتم مراجعتها قريباً.',
        payment_approved: '🎉 تم تفعيل اشتراك {plan} بنجاح!',
        payment_rejected: '❌ تم رفض طلب الاشتراك.',
        campaigns_limit_reached: '⚠️ لقد وصلت للحد الأقصى للحملات المتزامنة ({limit}).',
        campaign_stopped: '🛑 تم إيقاف الحملة {id}.',
        no_active_campaigns: '⚠️ لا توجد حملات نشطة.',
        active_campaigns: '📋 *حملاي النشطة*\n'
    }
    // يمكن إضافة en بنفس الهيكل
};

// ==========================================
// دوال إدارة المستخدمين والحملات (async)
// ==========================================
async function getUserPlan(userId) {
    let row = await dbGet(`SELECT * FROM subscribers WHERE user_id = ?`, [userId]);
    if (!row) {
        await dbRun(`INSERT INTO subscribers (user_id, plan, start_date, end_date, campaigns_limit, cards_limit) VALUES (?, 'free', datetime('now'), datetime('now', '+1 year'), 1, 10)`, [userId]);
        return { plan: 'free', campaigns_limit: 1, cards_limit: 10 };
    }
    if (row.plan !== 'free' && new Date(row.end_date) < new Date()) {
        await dbRun(`UPDATE subscribers SET plan = 'free', campaigns_limit = 1, cards_limit = 10, start_date = datetime('now'), end_date = datetime('now', '+1 year') WHERE user_id = ?`, [userId]);
        return { plan: 'free', campaigns_limit: 1, cards_limit: 10 };
    }
    return row;
}

async function getUserActiveCampaigns(userId) {
    return await dbAll(`SELECT * FROM campaigns WHERE user_id = ? AND status = 'running'`, [userId]);
}

async function createCampaign(userId, bin, total) {
    const result = await dbRun(`INSERT INTO campaigns (user_id, bin, total, created_at) VALUES (?, ?, ?, datetime('now'))`, [userId, bin, total]);
    return result.lastID;
}

async function updateCampaign(campaignId, current, hit, status) {
    await dbRun(`UPDATE campaigns SET current = ?, hit = ?, status = ? WHERE id = ?`, [current, hit, status, campaignId]);
}

async function deleteCampaign(campaignId) {
    await dbRun(`DELETE FROM campaigns WHERE id = ?`, [campaignId]);
}

async function createPendingPayment(userId, plan, code) {
    await dbRun(`INSERT INTO pending_payments (user_id, plan, amount, code, created_at) VALUES (?, ?, ?, ?, datetime('now'))`, [userId, plan, PLANS[plan].price, code]);
}

// ==========================================
// تشغيل حملة (تخمين)
// ==========================================
async function runCampaign(chatId, campaignId, bin, total) {
    const lang = 'ar'; // للتبسيط، يمكن جلبها من userLang
    const dict = t.ar;
    let progressMsg = await bot.sendMessage(chatId, dict.generating.replace('{current}',0).replace('{total}',total).replace('{dots}','.').replace('{bin}',bin));
    let hit = 0;
    for (let i=1; i<=total; i++) {
        const state = guessState.get(chatId);
        if (state && state.cancelFlag) {
            await bot.sendMessage(chatId, dict.cancel_msg);
            await updateCampaign(campaignId, i-1, hit, 'cancelled');
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
            const buttons = getCopyButtons(fullVisa);
            await bot.sendMessage(chatId, liveText, { parse_mode: 'Markdown', ...buttons });
        }
        await updateCampaign(campaignId, i, hit, 'running');
    }
    try { await bot.deleteMessage(chatId, progressMsg.message_id); } catch(e) {}
    if (hit === 0) {
        const noLive = dict.no_live_found.replace('{total}',total);
        const keyboard = { reply_markup: { inline_keyboard: [[{ text: dict.new_campaign_btn, callback_data: 'menu_guess' }]] } };
        await bot.sendMessage(chatId, noLive, keyboard);
    } else {
        await bot.sendMessage(chatId, dict.summary.replace('{hit}',hit).replace('{total}',total));
    }
    await updateCampaign(campaignId, total, hit, 'completed');
    guessState.delete(chatId);
}

async function startNewCampaign(chatId, bin, total) {
    const planData = await getUserPlan(chatId);
    const campaignsLimit = PLANS[planData.plan].campaignsLimit;
    const active = await getUserActiveCampaigns(chatId);
    if (active.length >= campaignsLimit) {
        await bot.sendMessage(chatId, t.ar.campaigns_limit_reached.replace('{limit}', campaignsLimit));
        return;
    }
    const campaignId = await createCampaign(chatId, bin, total);
    await runCampaign(chatId, campaignId, bin, total);
}

// ==========================================
// معالجة الاشتراكات والدفع
// ==========================================
async function handleSubscription(chatId, plan) {
    const code = generateRandomCode();
    await createPendingPayment(chatId, plan, code);
    const text = t.ar.subscribe_confirm.replace('{plan}',plan.toUpperCase()).replace('{amount}',PLANS[plan].price).replace('{payId}',BINANCE_PAY_ID).replace('{code}',code);
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    // بعد 15 ثانية نرسل رسالة فشل إذا لم يرسل صورة
    setTimeout(async () => {
        const pending = await dbGet(`SELECT * FROM pending_payments WHERE user_id = ? AND plan = ? AND status = 'waiting_payment'`, [chatId, plan]);
        if (pending) {
            await bot.sendMessage(chatId, t.ar.api_error); // أو رسالة فشل
            await dbRun(`UPDATE pending_payments SET status = 'expired' WHERE id = ?`, [pending.id]);
        }
    }, 15000);
}

// ==========================================
// عرض القوائم
// ==========================================
async function showMainMenu(chatId) {
    const dict = t.ar;
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
    const dict = t.ar;
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
    const dict = t.ar;
    const campaigns = await getUserActiveCampaigns(chatId);
    if (campaigns.length === 0) {
        await bot.sendMessage(chatId, dict.no_active_campaigns);
        return;
    }
    let text = dict.active_campaigns;
    const buttons = [];
    for (const c of campaigns) {
        text += `\n📌 BIN: ${c.bin} | تقدم: ${c.current}/${c.total} | صالحة: ${c.hit}`;
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
    await bot.sendMessage(chatId, t.ar.choose_lang, opts);
});

bot.onText(/\/menu/, async (msg) => { await showMainMenu(msg.chat.id); });
bot.onText(/\/cancel/, async (msg) => {
    const chatId = msg.chat.id;
    const state = guessState.get(chatId);
    if (state) { state.cancelFlag = true; await bot.sendMessage(chatId, t.ar.cancel_msg); }
    else await bot.sendMessage(chatId, '⚠️ لا توجد عملية نشطة.');
});

// أوامر الأدمن (بسيطة)
bot.onText(/\/addadmin (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (!adminSet.has(chatId)) { await bot.sendMessage(chatId, t.ar.not_admin); return; }
    const id = parseInt(match[1]);
    if (isNaN(id)) return;
    adminSet.add(id);
    await bot.sendMessage(chatId, `✅ تم إضافة أدمن ${id}`);
});
bot.onText(/\/removeadmin (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (!adminSet.has(chatId)) { await bot.sendMessage(chatId, t.ar.not_admin); return; }
    const id = parseInt(match[1]);
    if (id === 643309456) { await bot.sendMessage(chatId, '⚠️ لا يمكن إزالة الأدمن الأساسي'); return; }
    adminSet.delete(id);
    await bot.sendMessage(chatId, `✅ تم إزالة أدمن ${id}`);
});
bot.onText(/\/admins/, async (msg) => {
    const chatId = msg.chat.id;
    if (!adminSet.has(chatId)) { await bot.sendMessage(chatId, t.ar.not_admin); return; }
    await bot.sendMessage(chatId, `📋 الأدمن: ${Array.from(adminSet).join(', ')}`);
});

// ==========================================
// معالجة callback_query
// ==========================================
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    const dict = t.ar;
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
    if (data === 'lang_ar') { userLang.set(chatId, 'ar'); await showMainMenu(chatId); return; }
    if (data === 'lang_en') { userLang.set(chatId, 'en'); await showMainMenu(chatId); return; }

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
        const campId = parseInt(data.split('_')[2]);
        await updateCampaign(campId, null, null, 'stopped');
        await bot.sendMessage(chatId, dict.campaign_stopped.replace('{id}', campId));
        await showMyCampaigns(chatId);
        return;
    }

    // قبول/رفض الدفع من الأدمن (سنضيفها لاحقاً)
    if (data.startsWith('approve_payment_') || data.startsWith('reject_payment_')) {
        if (!adminSet.has(chatId)) { await bot.sendMessage(chatId, dict.not_admin); return; }
        const parts = data.split('_');
        const action = parts[0];
        const proofId = parseInt(parts[2]);
        const proof = await dbGet(`SELECT * FROM payment_proofs WHERE id = ?`, [proofId]);
        if (proof) {
            if (action === 'approve') {
                const end = new Date();
                end.setMonth(end.getMonth() + 1);
                await dbRun(`UPDATE subscribers SET plan = ?, start_date = datetime('now'), end_date = ?, campaigns_limit = ?, cards_limit = ? WHERE user_id = ?`, 
                    [proof.plan, end.toISOString(), PLANS[proof.plan].campaignsLimit, PLANS[proof.plan].cardsLimit, proof.user_id]);
                await dbRun(`UPDATE payment_proofs SET status = 'approved' WHERE id = ?`, [proofId]);
                await dbRun(`UPDATE pending_payments SET status = 'approved' WHERE user_id = ? AND plan = ?`, [proof.user_id, proof.plan]);
                await bot.sendMessage(proof.user_id, t.ar.payment_approved.replace('{plan}', proof.plan.toUpperCase()));
                await bot.sendMessage(chatId, `✅ تم تفعيل الاشتراك للمستخدم ${proof.user_id}`);
            } else {
                await dbRun(`UPDATE payment_proofs SET status = 'rejected' WHERE id = ?`, [proofId]);
                await dbRun(`UPDATE pending_payments SET status = 'rejected' WHERE user_id = ? AND plan = ?`, [proof.user_id, proof.plan]);
                await bot.sendMessage(proof.user_id, t.ar.payment_rejected);
                await bot.sendMessage(chatId, `❌ تم رفض الاشتراك للمستخدم ${proof.user_id}`);
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
    const dict = t.ar;

    // معالجة الصور (إثباتات الدفع)
    if (msg.photo) {
        const photo = msg.photo[msg.photo.length-1];
        const fileId = photo.file_id;
        const pending = await dbGet(`SELECT * FROM pending_payments WHERE user_id = ? AND status = 'waiting_payment' ORDER BY created_at DESC LIMIT 1`, [chatId]);
        if (pending) {
            const result = await dbRun(`INSERT INTO payment_proofs (user_id, plan, photo_file_id, message_id, created_at) VALUES (?, ?, ?, ?, datetime('now'))`, 
                [chatId, pending.plan, fileId, msg.message_id]);
            const proofId = result.lastID;
            const caption = `📸 إثبات دفع جديد\nالمستخدم: ${chatId}\nالخطة: ${pending.plan}\nالمبلغ: ${pending.amount} USDT\nالكود: ${pending.code}`;
            const adminKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '✅ موافقة', callback_data: `approve_payment_${proofId}` }],
                        [{ text: '❌ رفض', callback_data: `reject_payment_${proofId}` }]
                    ]
                }
            };
            for (const adminId of adminSet) {
                await bot.sendPhoto(adminId, fileId, { caption, ...adminKeyboard });
            }
            await bot.sendMessage(chatId, dict.payment_received);
            await dbRun(`UPDATE pending_payments SET status = 'proof_sent' WHERE id = ?`, [pending.id]);
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
            const planData = await getUserPlan(chatId);
            const maxCards = planData.plan === 'free' ? 10 : PLANS[planData.plan].cardsLimit;
            const countMsg = dict.enter_count.replace('{max}', maxCards) + (adminSet.has(chatId) ? dict.admin_unlimited : '');
            const cancelKeyboard = { reply_markup: { inline_keyboard: [[{ text: dict.cancel_btn, callback_data: 'cancel_guess' }]] } };
            await bot.sendMessage(chatId, countMsg, cancelKeyboard);
        }
        return;
    }

    if (state && state.step === 'awaiting_count') {
        const count = parseInt(text);
        if (isNaN(count)) return;
        const planData = await getUserPlan(chatId);
        const maxCards = planData.plan === 'free' ? 10 : PLANS[planData.plan].cardsLimit;
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
            const buttons = getCopyButtons(text);
            await bot.sendMessage(chatId, liveText, { parse_mode: 'Markdown', ...buttons });
        }
        return;
    }
});

console.log('✅ البوت يعمل الآن بشكل كامل مع قاعدة البيانات والاشتراكات.');
