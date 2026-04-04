const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// ==========================================
// التوكن من متغيرات البيئة
// ==========================================
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
    // جدول المشتركين
    db.run(`CREATE TABLE IF NOT EXISTS subscribers (
        user_id INTEGER PRIMARY KEY,
        plan TEXT DEFAULT 'free',
        start_date TEXT,
        end_date TEXT,
        campaigns_limit INTEGER DEFAULT 1,
        cards_limit INTEGER DEFAULT 10,
        active INTEGER DEFAULT 1
    )`);
    
    // جدول الحملات النشطة
    db.run(`CREATE TABLE IF NOT EXISTS campaigns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        bin TEXT,
        total INTEGER,
        current INTEGER DEFAULT 0,
        hit INTEGER DEFAULT 0,
        status TEXT DEFAULT 'running',
        created_at TEXT,
        FOREIGN KEY(user_id) REFERENCES subscribers(user_id)
    )`);
    
    // جدول طلبات الاشتراك (انتظار الدفع)
    db.run(`CREATE TABLE IF NOT EXISTS pending_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        plan TEXT,
        amount REAL,
        code TEXT,
        status TEXT DEFAULT 'waiting_payment',
        created_at TEXT
    )`);
    
    // جدول إثباتات الدفع (صور)
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
const userLang = new Map(); // chatId -> 'ar'/'en'
const adminSet = new Set([643309456]); // الأدمن الأساسي
const guessState = new Map(); // chatId -> { step, bin, count, cancelFlag, progressMsgId, campaignId? }

// ثوابت الاشتراكات
const PLANS = {
    free: { name: 'مجاني', price: 0, cardsLimit: 10, campaignsLimit: 1, months: 0 },
    plus: { name: 'Plus', price: 3, cardsLimit: 70, campaignsLimit: 3, months: 1 },
    pro: { name: 'Pro', price: 5, cardsLimit: 150, campaignsLimit: 5, months: 1 },
    vip: { name: 'VIP', price: 8, cardsLimit: 350, campaignsLimit: 7, months: 1 }
};

const BINANCE_PAY_ID = '842505320'; // رقم البايننس للتحويلات

// ==========================================
// دوال قاعدة البيانات
// ==========================================
function getUserPlan(userId, callback) {
    db.get(`SELECT * FROM subscribers WHERE user_id = ?`, [userId], (err, row) => {
        if (err || !row) {
            // إنشاء مستخدم جديد مجاني
            db.run(`INSERT INTO subscribers (user_id, plan, start_date, end_date, campaigns_limit, cards_limit) VALUES (?, 'free', datetime('now'), datetime('now', '+1 year'), 1, 10)`, [userId]);
            callback({ plan: 'free', campaigns_limit: 1, cards_limit: 10 });
        } else {
            // التحقق من انتهاء الاشتراك
            if (row.plan !== 'free' && new Date(row.end_date) < new Date()) {
                db.run(`UPDATE subscribers SET plan = 'free', campaigns_limit = 1, cards_limit = 10, start_date = datetime('now'), end_date = datetime('now', '+1 year') WHERE user_id = ?`, [userId]);
                callback({ plan: 'free', campaigns_limit: 1, cards_limit: 10 });
            } else {
                callback(row);
            }
        }
    });
}

function getUserActiveCampaigns(userId, callback) {
    db.all(`SELECT * FROM campaigns WHERE user_id = ? AND status = 'running'`, [userId], (err, rows) => {
        callback(rows || []);
    });
}

function createCampaign(userId, bin, total, callback) {
    db.run(`INSERT INTO campaigns (user_id, bin, total, created_at) VALUES (?, ?, ?, datetime('now'))`, [userId, bin, total], function(err) {
        callback(err ? null : this.lastID);
    });
}

function updateCampaign(campaignId, current, hit, status) {
    db.run(`UPDATE campaigns SET current = ?, hit = ?, status = ? WHERE id = ?`, [current, hit, status, campaignId]);
}

function deleteCampaign(campaignId) {
    db.run(`DELETE FROM campaigns WHERE id = ?`, [campaignId]);
}

function createPendingPayment(userId, plan, code, callback) {
    const amount = PLANS[plan].price;
    db.run(`INSERT INTO pending_payments (user_id, plan, amount, code, created_at) VALUES (?, ?, ?, ?, datetime('now'))`, [userId, plan, amount, code], callback);
}

// ==========================================
// الترجمات الكاملة (عربي/إنجليزي)
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
        enter_bin: '📌 أرسل الـ BIN الخاص بك (أول 6 أرقام أو أكثر من الفيزا)\nمثال: `62581`',
        enter_count: '🔢 كم عدد الفيزات التي تريد تخمينها؟\n(الحد الأدنى {min}، الحد الأقصى {max})',
        admin_unlimited: 'للأدمن: لا يوجد حد أقصى.',
        count_out_of_range: '⚠️ العدد يجب أن يكون بين {min} و {max}.',
        count_exceed_admin: '⚠️ العدد المطلوب يتجاوز الحد المسموح (الأدمن فقط يمكنه تجاوز {max}).',
        cancel_msg: '❌ تم إلغاء العملية.',
        guessing_start: '🚀 بدء تخمين {count} فيزا... سيتم عرض النتائج فور ظهورها.',
        generating: '🔄 جاري إنشاء الفيزا {current}/{total} {dots}\n━━━━━━━━━━━━━━\n📌 BIN: {bin}',
        live_result: '✅ تعمل بنجاح ✅\n----------------------------------------\n\n💳    {card}\n\n📊 الحالة: تعمل ✅\n\n🏦 النوع: {type}\n\n🌍 البلد: {country} {flag}\n\n----------------------------------------\nبواسطة: @pe8bot',
        no_live_found: '😞 لم يتم العثور على أي بطاقة صالحة من أصل {total}.',
        new_campaign_btn: '🚀 بدأ حملة جديدة',
        summary: '📊 *الملخص النهائي*\n✅ البطاقات الصالحة: {hit}\n🎯 المجموع الكلي: {total}',
        single_invalid: '📌 أرسل الفيزا كاملة بهذا التنسيق:\n`4111111111111111|01|2031|123`',
        single_checking: '⏳ جاري فحص البطاقة...',
        single_luhn_fail: '❌ رقم البطاقة غير صالح (فشل Luhn).',
        api_error: '⚠️ حدث خطأ أثناء الاتصال بالخدمة. حاول لاحقاً.',
        unknown: 'غير معروف',
        not_admin: '⛔ هذا الأمر مخصص للأدمن فقط.',
        admin_added: '✅ تم إضافة أدمن جديد: `{id}`',
        admin_removed: '✅ تم إزالة الأدمن: `{id}`',
        admin_list: '📋 قائمة الأدمن:\n{list}',
        active_campaigns: '📋 *حملاي النشطة*\n',
        no_active_campaigns: '⚠️ لا توجد حملات نشطة.',
        subscription_plans: '💎 *خطط الاشتراك*\nاختر الخطة المناسبة:',
        plan_plus: '🥇 Plus',
        plan_pro: '🥈 Pro',
        plan_vip: '🥉 VIP',
        plus_desc: '✨ *Plus*\nالسعر: 3 USDT شهرياً\nالفيزات: 70 تخمين\nالحملات المتزامنة: 3',
        pro_desc: '✨ *Pro*\nالسعر: 5 USDT شهرياً\nالفيزات: 150 تخمين\nالحملات المتزامنة: 5',
        vip_desc: '✨ *VIP*\nالسعر: 8 USDT شهرياً\nالفيزات: 350 تخمين\nالحملات المتزامنة: 7',
        subscribe_confirm: '✅ اخترت خطة {plan}\nقم بتحويل {amount} USDT إلى معرف بايننس:\n`{payId}`\nواكتب الكود التالي في ملاحظات التحويل:\n`{code}`\nثم أرسل صورة إثبات التحويل هنا.',
        payment_waiting: '⏳ جار التحقق من الدفعة... (15 ثانية)',
        payment_failed: '❌ فشل التحقق. يرجى إرسال صورة التحويل هنا.',
        payment_received: '📸 تم استلام صورة التحويل. سيتم مراجعتها من قبل الأدمن قريباً.',
        payment_approved: '🎉 تم تفعيل اشتراك {plan} بنجاح! يمكنك الآن الاستفادة من المزايا.',
        payment_rejected: '❌ تم رفض طلب الاشتراك. يرجى التواصل مع الدعم.',
        payment_proof_sent_to_admin: '📸 تم إرسال إثبات الدفع إلى الأدمن للموافقة.',
        admin_approve_btn: '✅ موافقة',
        admin_reject_btn: '❌ رفض',
        subscription_expired: '⚠️ اشتراكك انتهى. يرجى تجديده من قائمة الاشتراكات.',
        campaigns_limit_reached: '⚠️ لقد وصلت إلى الحد الأقصى للحملات المتزامنة ({limit}). يرجى إنهاء بعض الحملات أولاً.',
        start_new_campaign: '🚀 بدأ حملة جديدة',
        switch_campaign: '🔄 تبديل الحملة',
        stop_campaign: '🛑 إيقاف الحملة',
        campaign_stopped: '🛑 تم إيقاف الحملة {id}.'
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
        enter_bin: '📌 Send your BIN (first 6 digits or more of the card)\nExample: `62581`',
        enter_count: '🔢 How many cards to guess?\n(Min {min}, Max {max})',
        admin_unlimited: 'For admin: no upper limit.',
        count_out_of_range: '⚠️ Count must be between {min} and {max}.',
        count_exceed_admin: '⚠️ Requested count exceeds limit (only admin can exceed {max}).',
        cancel_msg: '❌ Operation cancelled.',
        guessing_start: '🚀 Starting guess of {count} cards... Results will appear as they come.',
        generating: '🔄 Generating card {current}/{total} {dots}\n━━━━━━━━━━━━━━\n📌 BIN: {bin}',
        live_result: '✅ LIVE ✅\n----------------------------------------\n\n💳    {card}\n\n📊 Status: LIVE ✅\n\n🏦 Type: {type}\n\n🌍 Country: {country} {flag}\n\n----------------------------------------\nBy: @pe8bot',
        no_live_found: '😞 No live cards found out of {total}.',
        new_campaign_btn: '🚀 Start new campaign',
        summary: '📊 *Final Summary*\n✅ Live cards: {hit}\n🎯 Total cards: {total}',
        single_invalid: '📌 Send the full card in this format:\n`4111111111111111|01|2031|123`',
        single_checking: '⏳ Checking card...',
        single_luhn_fail: '❌ Invalid card number (Luhn check failed).',
        api_error: '⚠️ API error. Please try again later.',
        unknown: 'Unknown',
        not_admin: '⛔ This command is for admins only.',
        admin_added: '✅ New admin added: `{id}`',
        admin_removed: '✅ Admin removed: `{id}`',
        admin_list: '📋 Admin list:\n{list}',
        active_campaigns: '📋 *Your active campaigns*\n',
        no_active_campaigns: '⚠️ No active campaigns.',
        subscription_plans: '💎 *Subscription Plans*\nChoose your plan:',
        plan_plus: '🥇 Plus',
        plan_pro: '🥈 Pro',
        plan_vip: '🥉 VIP',
        plus_desc: '✨ *Plus*\nPrice: 3 USDT/month\nCards: 70 guesses\nConcurrent campaigns: 3',
        pro_desc: '✨ *Pro*\nPrice: 5 USDT/month\nCards: 150 guesses\nConcurrent campaigns: 5',
        vip_desc: '✨ *VIP*\nPrice: 8 USDT/month\nCards: 350 guesses\nConcurrent campaigns: 7',
        subscribe_confirm: '✅ You selected {plan} plan\nPlease send {amount} USDT to Binance ID:\n`{payId}`\nAnd write this code in the payment memo:\n`{code}`\nThen send the payment proof photo here.',
        payment_waiting: '⏳ Verifying payment... (15 seconds)',
        payment_failed: '❌ Verification failed. Please send the payment proof photo.',
        payment_received: '📸 Payment proof received. It will be reviewed by admin soon.',
        payment_approved: '🎉 Your {plan} subscription has been activated! Enjoy the benefits.',
        payment_rejected: '❌ Subscription request rejected. Please contact support.',
        payment_proof_sent_to_admin: '📸 Payment proof sent to admin for approval.',
        admin_approve_btn: '✅ Approve',
        admin_reject_btn: '❌ Reject',
        subscription_expired: '⚠️ Your subscription has expired. Please renew from subscriptions menu.',
        campaigns_limit_reached: '⚠️ You have reached the maximum concurrent campaigns ({limit}). Please stop some campaigns first.',
        start_new_campaign: '🚀 Start new campaign',
        switch_campaign: '🔄 Switch campaign',
        stop_campaign: '🛑 Stop campaign',
        campaign_stopped: '🛑 Campaign {id} stopped.'
    }
};

// ==========================================
// دوال مساعدة (Luhn, توليد، أعلام، إلخ)
// ==========================================
function getFlag(countryName) { /* كما هو سابق */ }
function getCardType(cardNumber) { /* كما هو سابق */ }
function checkLuhn(cardNumber) { /* كما هو سابق */ }
function generateRandomMonth() { /* كما هو سابق */ }
function generateRandomYear() { /* كما هو سابق */ }
function generateRandomCVV() { /* كما هو سابق */ }
function generateCardNumber(bin, length = 16) { /* كما هو سابق */ }
function generateFullVisa(bin) { /* كما هو سابق */ }

// توليد كود عشوائي للاشتراك
function generateRandomCode() {
    return Math.random().toString(36).substring(2, 10).toUpperCase();
}

// ==========================================
// دوال فحص البطاقة (API)
// ==========================================
async function checkSingleCard(cardString, chatId, isSilent = false) { /* كما هو سابق */ }

// ==========================================
// دوال إدارة الحملات المتعددة
// ==========================================
async function startNewCampaign(chatId, bin, total) {
    getUserPlan(chatId, async (planData) => {
        const userPlan = planData.plan;
        const campaignsLimit = PLANS[userPlan].campaignsLimit;
        getUserActiveCampaigns(chatId, async (campaigns) => {
            if (campaigns.length >= campaignsLimit) {
                const dict = translations[userLang.get(chatId) || 'ar'];
                await bot.sendMessage(chatId, dict.campaigns_limit_replaced.replace('{limit}', campaignsLimit));
                return;
            }
            createCampaign(chatId, bin, total, async (campaignId) => {
                if (!campaignId) return;
                // بدء تشغيل الحملة (ستكون دالة منفصلة)
                await runCampaign(chatId, campaignId, bin, total);
            });
        });
    });
}

async function runCampaign(chatId, campaignId, bin, total) {
    const lang = userLang.get(chatId) || 'ar';
    const dict = translations[lang];
    const state = guessState.get(chatId);
    
    // إرسال رسالة التقدم
    const progressMsg = await bot.sendMessage(chatId, dict.generating.replace('{current}',0).replace('{total}',total).replace('{dots}','.').replace('{bin}',bin));
    
    let hit = 0;
    for (let i = 1; i <= total; i++) {
        // التحقق من الإلغاء
        if (state && state.cancelFlag) {
            await bot.sendMessage(chatId, dict.cancel_msg);
            updateCampaign(campaignId, i-1, hit, 'cancelled');
            try { await bot.deleteMessage(chatId, progressMsg.message_id); } catch(e) {}
            return;
        }
        
        // تحديث رسالة التقدم (تحريكها: حذف وإنشاء جديدة أسفل)
        try { await bot.deleteMessage(chatId, progressMsg.message_id); } catch(e) {}
        const newProgressMsg = await bot.sendMessage(chatId, dict.generating.replace('{current}',i).replace('{total}',total).replace('{dots}', '.'.repeat(i%5+1)).replace('{bin}',bin));
        // تخزين معرف الرسالة الجديدة في الحالة (لحذفها لاحقاً)
        if (state) state.progressMsgId = newProgressMsg.message_id;
        
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
        updateCampaign(campaignId, i, hit, 'running');
    }
    // حذف رسالة التقدم بعد الانتهاء
    try { await bot.deleteMessage(chatId, progressMsg.message_id); } catch(e) {}
    if (state && state.progressMsgId) try { await bot.deleteMessage(chatId, state.progressMsgId); } catch(e) {}
    
    if (hit === 0) {
        const noLiveText = dict.no_live_found.replace('{total}',total);
        const keyboard = {
            reply_markup: {
                inline_keyboard: [[{ text: dict.new_campaign_btn, callback_data: 'menu_guess' }]]
            }
        };
        await bot.sendMessage(chatId, noLiveText, keyboard);
    } else {
        await bot.sendMessage(chatId, dict.summary.replace('{hit}',hit).replace('{total}',total));
    }
    updateCampaign(campaignId, total, hit, 'completed');
}

// ==========================================
// دوال الاشتراكات ومعالجة الدفع
// ==========================================
async function handleSubscription(chatId, plan) {
    const lang = userLang.get(chatId) || 'ar';
    const dict = translations[lang];
    const code = generateRandomCode();
    createPendingPayment(chatId, plan, code, (err) => {
        if (err) return;
        const text = dict.subscribe_confirm.replace('{plan}',plan.toUpperCase()).replace('{amount}',PLANS[plan].price).replace('{payId}',BINANCE_PAY_ID).replace('{code}',code);
        bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        // بدء مؤقت 15 ثانية لانتظار صورة التحويل
        setTimeout(async () => {
            // التحقق من وجود طلب معلق
            db.get(`SELECT * FROM pending_payments WHERE user_id = ? AND plan = ? AND status = 'waiting_payment'`, [chatId, plan], async (err, row) => {
                if (row) {
                    await bot.sendMessage(chatId, dict.payment_failed);
                    db.run(`UPDATE pending_payments SET status = 'expired' WHERE id = ?`, [row.id]);
                }
            });
        }, 15000);
    });
}

// ==========================================
// دوال أزرار النسخ (ترسل النص)
// ==========================================
function getCopyButtons(fullCard) { /* كما هو سابق */ }

// ==========================================
// واجهة القوائم والأزرار
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
    getUserActiveCampaigns(chatId, async (campaigns) => {
        if (campaigns.length === 0) {
            await bot.sendMessage(chatId, dict.no_active_campaigns);
            return;
        }
        let text = dict.active_campaigns;
        const buttons = [];
        campaigns.forEach(c => {
            text += `\n📌 BIN: ${c.bin} | تقدم: ${c.current}/${c.total} | صالحة: ${c.hit}`;
            buttons.push([{ text: `${dict.stop_campaign} ${c.id}`, callback_data: `stop_camp_${c.id}` }]);
        });
        buttons.push([{ text: dict.start_new_campaign, callback_data: 'menu_guess' }]);
        await bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: buttons } });
    });
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
    bot.sendMessage(chatId, translations.ar.choose_lang, opts);
});

bot.onText(/\/menu/, async (msg) => { showMainMenu(msg.chat.id); });
bot.onText(/\/cancel/, (msg) => { /* إلغاء الحملة الحالية */ });

// أوامر الأدمن
bot.onText(/\/addadmin (.+)/, (msg, match) => { /* كما هو سابق */ });
bot.onText(/\/removeadmin (.+)/, (msg, match) => { /* كما هو سابق */ });
bot.onText(/\/admins/, (msg) => { /* كما هو سابق */ });

// ==========================================
// معالجة الأزرار (callback_query)
// ==========================================
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    const lang = userLang.get(chatId) || 'ar';
    const dict = translations[lang];
    bot.answerCallbackQuery(query.id);

    // أزرار النسخ
    if (data.startsWith('copy_')) { /* كما هو سابق */ }
    
    // اللغة
    if (data === 'lang_ar') { userLang.set(chatId, 'ar'); await showMainMenu(chatId); return; }
    if (data === 'lang_en') { userLang.set(chatId, 'en'); await showMainMenu(chatId); return; }
    
    // القائمة الرئيسية
    if (data === 'menu_guess') {
        // بدء حملة جديدة (طلب BIN)
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
    
    // إيقاف حملة محددة
    if (data.startsWith('stop_camp_')) {
        const campId = parseInt(data.split('_')[2]);
        updateCampaign(campId, null, null, 'stopped');
        await bot.sendMessage(chatId, dict.campaign_stopped.replace('{id}', campId));
        await showMyCampaigns(chatId);
        return;
    }
    
    // قبول أو رفض الاشتراك من الأدمن
    if (data.startsWith('approve_payment_')) {
        if (!adminSet.has(chatId)) { await bot.sendMessage(chatId, dict.not_admin); return; }
        const proofId = parseInt(data.split('_')[2]);
        db.get(`SELECT * FROM payment_proofs WHERE id = ?`, [proofId], async (err, proof) => {
            if (proof) {
                const endDate = new Date();
                endDate.setMonth(endDate.getMonth() + 1);
                db.run(`UPDATE subscribers SET plan = ?, start_date = datetime('now'), end_date = ?, campaigns_limit = ?, cards_limit = ? WHERE user_id = ?`, 
                    [proof.plan, endDate.toISOString(), PLANS[proof.plan].campaignsLimit, PLANS[proof.plan].cardsLimit, proof.user_id]);
                db.run(`UPDATE payment_proofs SET status = 'approved' WHERE id = ?`, [proofId]);
                db.run(`UPDATE pending_payments SET status = 'approved' WHERE user_id = ? AND plan = ?`, [proof.user_id, proof.plan]);
                await bot.sendMessage(proof.user_id, dict.payment_approved.replace('{plan}', proof.plan.toUpperCase()));
                await bot.sendMessage(chatId, `✅ تم تفعيل الاشتراك للمستخدم ${proof.user_id}`);
            }
        });
        return;
    }
    if (data.startsWith('reject_payment_')) {
        if (!adminSet.has(chatId)) { await bot.sendMessage(chatId, dict.not_admin); return; }
        const proofId = parseInt(data.split('_')[2]);
        db.get(`SELECT * FROM payment_proofs WHERE id = ?`, [proofId], async (err, proof) => {
            if (proof) {
                db.run(`UPDATE payment_proofs SET status = 'rejected' WHERE id = ?`, [proofId]);
                db.run(`UPDATE pending_payments SET status = 'rejected' WHERE user_id = ? AND plan = ?`, [proof.user_id, proof.plan]);
                await bot.sendMessage(proof.user_id, dict.payment_rejected);
                await bot.sendMessage(chatId, `❌ تم رفض الاشتراك للمستخدم ${proof.user_id}`);
            }
        });
        return;
    }
});

// ==========================================
// معالجة الرسائل النصية (BIN، العدد، صور الدفع)
// ==========================================
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    const lang = userLang.get(chatId) || 'ar';
    const dict = translations[lang];
    
    // معالجة الصور (إثباتات الدفع)
    if (msg.photo) {
        const photo = msg.photo[msg.photo.length - 1];
        const fileId = photo.file_id;
        // البحث عن طلب دفع معلق للمستخدم
        db.get(`SELECT * FROM pending_payments WHERE user_id = ? AND status = 'waiting_payment' ORDER BY created_at DESC LIMIT 1`, [chatId], async (err, payment) => {
            if (payment) {
                // حفظ الصورة في قاعدة البيانات
                db.run(`INSERT INTO payment_proofs (user_id, plan, photo_file_id, message_id, created_at) VALUES (?, ?, ?, ?, datetime('now'))`, 
                    [chatId, payment.plan, fileId, msg.message_id], function(err) {
                        if (!err) {
                            const proofId = this.lastID;
                            // إرسال الصورة إلى الأدمن مع أزرار
                            const caption = `📸 إثبات دفع جديد\nالمستخدم: ${chatId}\nالخطة: ${payment.plan}\nالمبلغ: ${payment.amount} USDT\nالكود: ${payment.code}`;
                            const adminKeyboard = {
                                reply_markup: {
                                    inline_keyboard: [
                                        [{ text: dict.admin_approve_btn, callback_data: `approve_payment_${proofId}` }],
                                        [{ text: dict.admin_reject_btn, callback_data: `reject_payment_${proofId}` }]
                                    ]
                                }
                            };
                            for (const adminId of adminSet) {
                                await bot.sendPhoto(adminId, fileId, { caption, ...adminKeyboard });
                            }
                            await bot.sendMessage(chatId, dict.payment_received);
                            db.run(`UPDATE pending_payments SET status = 'proof_sent' WHERE id = ?`, [payment.id]);
                        }
                    });
            } else {
                await bot.sendMessage(chatId, dict.payment_failed);
            }
        });
        return;
    }
    
    // معالجة النصوص (BIN أو العدد أو فيزا واحدة)
    const state = guessState.get(chatId);
    if (state && state.step === 'awaiting_bin') {
        if (/^\d+$/.test(text)) {
            let bin = text.slice(0,6);
            while (bin.length < 6) bin += Math.floor(Math.random()*10);
            state.bin = bin;
            state.step = 'awaiting_count';
            // جلب خطة المستخدم لمعرفة الحدود
            getUserPlan(chatId, (planData) => {
                const maxCards = planData.plan === 'free' ? 10 : PLANS[planData.plan].cardsLimit;
                const minCards = 5;
                const cancelKeyboard = { reply_markup: { inline_keyboard: [[{ text: dict.cancel_btn, callback_data: 'cancel_guess' }]] } };
                const countMsg = dict.enter_count.replace('{min}',minCards).replace('{max}',maxCards);
                if (adminSet.has(chatId)) countMsg += '\n' + dict.admin_unlimited;
                bot.sendMessage(chatId, countMsg, cancelKeyboard);
            });
        }
        return;
    }
    
    if (state && state.step === 'awaiting_count') {
        const count = parseInt(text);
        if (isNaN(count)) return;
        getUserPlan(chatId, async (planData) => {
            const maxCards = planData.plan === 'free' ? 10 : PLANS[planData.plan].cardsLimit;
            const minCards = 5;
            if (!adminSet.has(chatId) && (count < minCards || count > maxCards)) {
                await bot.sendMessage(chatId, dict.count_out_of_range.replace('{min}',minCards).replace('{max}',maxCards));
                return;
            }
            state.count = count;
            // بدء حملة جديدة (تسجيل في قاعدة البيانات وتشغيل)
            await startNewCampaign(chatId, state.bin, count);
            guessState.delete(chatId);
        });
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

console.log('✅ البوت يعمل الآن مع دعم كامل للغتين، اشتراكات، حملات متعددة، وقاعدة بيانات.');
