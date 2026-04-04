const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');

// ==========================================
// التوكن من متغيرات البيئة (للأمان)
// ==========================================
const TOKEN = process.env.TOKEN;
if (!TOKEN) {
    console.error('❌ الرجاء تعيين متغير البيئة TOKEN');
    process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

// ==========================================
// تخزين لغة كل مستخدم
// ==========================================
const userLang = new Map(); // chatId -> 'ar' أو 'en'

// ==========================================
// الترجمات
// ==========================================
const translations = {
    ar: {
        welcome: '✨ مرحباً بك في بوت فحص البطاقات ✨\n\nأرسل البطاقة بهذه الصيغة:\n`رقم|شهر|سنة|cvv`\nمثال:\n`4111111111111111|01|2031|123`',
        invalid_format: '⚠️ الصيغة غير صحيحة.\nأرسل البطاقة بهذا الشكل:\n`4111111111111111|01|2031|123`',
        checking: '⏳ جاري فحص البطاقة...',
        luhn_fail: '❌ رقم البطاقة غير صالح (فشل Luhn).',
        api_error: '⚠️ حدث خطأ أثناء الاتصال بالخدمة. حاول لاحقاً.',
        live: '✅ **بطاقة صالحة**',
        declined: '❌ **بطاقة مرفوضة**',
        status: '📊 الحالة',
        message: '💬 الرسالة',
        type: '🏦 النوع',
        country: '🌍 البلد',
        unknown: 'غير معروف',
        lang_changed: '✅ تم تغيير اللغة إلى العربية',
        choose_lang: 'اختر لغتك / Choose your language:'
    },
    en: {
        welcome: '✨ Welcome to Card Checker Bot ✨\n\nSend the card in this format:\n`number|month|year|cvv`\nExample:\n`4111111111111111|01|2031|123`',
        invalid_format: '⚠️ Invalid format.\nSend the card like:\n`4111111111111111|01|2031|123`',
        checking: '⏳ Checking card...',
        luhn_fail: '❌ Invalid card number (Luhn check failed).',
        api_error: '⚠️ API error. Please try again later.',
        live: '✅ **Card is LIVE**',
        declined: '❌ **Card is DECLINED**',
        status: '📊 Status',
        message: '💬 Message',
        type: '🏦 Type',
        country: '🌍 Country',
        unknown: 'Unknown',
        lang_changed: '✅ Language changed to English',
        choose_lang: 'Choose your language / اختر لغتك:'
    }
};

// ==========================================
// دالة Luhn
// ==========================================
function checkLuhn(cardNumber) {
    let sum = 0;
    let alt = false;
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

// ==========================================
// دالة فحص البطاقة عبر API
// ==========================================
async function checkCard(cardString, chatId) {
    const lang = userLang.get(chatId) || 'ar';
    const t = translations[lang];

    // التحقق من Luhn
    const parts = cardString.split('|');
    if (parts.length >= 1) {
        const cardNum = parts[0];
        if (!checkLuhn(cardNum)) {
            await bot.sendMessage(chatId, t.luhn_fail);
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
        const status = data.status || t.unknown;
        const msg = data.message || t.unknown;
        const cardInfo = data.card || {};
        const cardType = cardInfo.type || t.unknown;
        const country = (cardInfo.country && cardInfo.country.name) || t.unknown;

        const isLive = (code === 1);
        return { isLive, status, message: msg, type: cardType, country };
    } catch (err) {
        console.error(err);
        await bot.sendMessage(chatId, t.api_error);
        return null;
    }
}

// ==========================================
// أمر /start مع اختيار اللغة
// ==========================================
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const opts = {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'العربية', callback_data: 'lang_ar' }, { text: 'English', callback_data: 'lang_en' }]
            ]
        }
    };
    bot.sendMessage(chatId, translations.ar.choose_lang, opts);
});

// ==========================================
// معالجة اختيار اللغة
// ==========================================
bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    let lang;
    let responseText;
    if (data === 'lang_ar') {
        lang = 'ar';
        responseText = translations.ar.lang_changed + '\n\n' + translations.ar.welcome;
    } else {
        lang = 'en';
        responseText = translations.en.lang_changed + '\n\n' + translations.en.welcome;
    }
    userLang.set(chatId, lang);
    bot.sendMessage(chatId, responseText, { parse_mode: 'Markdown' });
    bot.answerCallbackQuery(query.id);
});

// ==========================================
// معالجة الرسائل النصية (البطاقة)
// ==========================================
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!text || text.startsWith('/')) return;

    const lang = userLang.get(chatId) || 'ar';
    const t = translations[lang];

    // التحقق من الصيغة
    if (text.split('|').length < 4) {
        await bot.sendMessage(chatId, t.invalid_format, { parse_mode: 'Markdown' });
        return;
    }

    // رسالة "جاري الفحص"
    await bot.sendMessage(chatId, t.checking);

    // فحص البطاقة
    const result = await checkCard(text, chatId);
    if (!result) return;

    let resultText;
    if (result.isLive) {
        resultText = `${t.live}\n━━━━━━━━━━━━━━\n💳 \`${text}\`\n${t.status}: ${result.status}\n${t.message}: ${result.message}\n${t.type}: ${result.type}\n${t.country}: ${result.country}\n━━━━━━━━━━━━━━`;
    } else {
        resultText = `${t.declined}\n━━━━━━━━━━━━━━\n💳 \`${text}\`\n${t.status}: ${result.status}\n${t.message}: ${result.message}\n━━━━━━━━━━━━━━`;
    }
    await bot.sendMessage(chatId, resultText, { parse_mode: 'Markdown' });
});

console.log('✅ البوت يعمل الآن...');
