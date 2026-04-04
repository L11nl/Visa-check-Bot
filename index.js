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
const userLang = new Map();
const adminSet = new Set([643309456]);
const guessState = new Map();

// ==========================================
// أعلام الدول (Emoji Flags)
// ==========================================
const countryFlags = {
    'united states': '🇺🇸', 'usa': '🇺🇸', 'us': '🇺🇸',
    'united kingdom': '🇬🇧', 'uk': '🇬🇧', 'britain': '🇬🇧',
    'saudi arabia': '🇸🇦', 'ksa': '🇸🇦', 'saudi': '🇸🇦',
    'egypt': '🇪🇬',
    'uae': '🇦🇪', 'united arab emirates': '🇦🇪',
    'kuwait': '🇰🇼',
    'qatar': '🇶🇦',
    'bahrain': '🇧🇭',
    'oman': '🇴🇲',
    'jordan': '🇯🇴',
    'lebanon': '🇱🇧',
    'iraq': '🇮🇶',
    'syria': '🇸🇾',
    'palestine': '🇵🇸',
    'turkey': '🇹🇷',
    'germany': '🇩🇪',
    'france': '🇫🇷',
    'italy': '🇮🇹',
    'spain': '🇪🇸',
    'netherlands': '🇳🇱',
    'belgium': '🇧🇪',
    'switzerland': '🇨🇭',
    'austria': '🇦🇹',
    'russia': '🇷🇺',
    'china': '🇨🇳',
    'japan': '🇯🇵',
    'south korea': '🇰🇷',
    'india': '🇮🇳',
    'brazil': '🇧🇷',
    'canada': '🇨🇦',
    'mexico': '🇲🇽',
    'australia': '🇦🇺',
    'indonesia': '🇮🇩',
    'malaysia': '🇲🇾',
    'singapore': '🇸🇬',
    'thailand': '🇹🇭',
    'vietnam': '🇻🇳',
    'philippines': '🇵🇭',
    'pakistan': '🇵🇰',
    'bangladesh': '🇧🇩',
    'south africa': '🇿🇦',
    'nigeria': '🇳🇬',
    'morocco': '🇲🇦',
    'algeria': '🇩🇿',
    'tunisia': '🇹🇳',
    'libya': '🇱🇾',
    'sudan': '🇸🇩',
    'yemen': '🇾🇪'
};

function getFlag(countryName) {
    if (!countryName) return '🌍';
    const lowerName = countryName.toLowerCase();
    for (const [key, flag] of Object.entries(countryFlags)) {
        if (lowerName.includes(key)) return flag;
    }
    return '🌍';
}

function getCardType(cardNumber) {
    const firstDigit = cardNumber[0];
    const firstTwo = cardNumber.slice(0, 2);
    const firstFour = cardNumber.slice(0, 4);
    
    if (firstDigit === '4') return 'فيزا كارد';
    if (firstTwo >= '51' && firstTwo <= '55') return 'ماستر كارد';
    if (firstTwo === '34' || firstTwo === '37') return 'امريكان اكسبريس';
    if (firstFour === '6011' || firstTwo === '65' || (firstTwo >= '64' && firstTwo <= '65')) return 'ديسكفر';
    if (firstTwo === '35') return 'جيه سي بي';
    if (firstTwo === '30' || firstTwo === '36' || firstTwo === '38' || firstTwo === '39') return 'دينرز كلوب';
    if (firstTwo === '50') return 'ميركاتيل';
    if (firstTwo === '56' || firstTwo === '57' || firstTwo === '58') return 'مايسترو';
    return 'بطاقة ائتمانية';
}

// ==========================================
// دوال مساعدة
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
    return String(Math.floor(Math.random() * 5) + currentYear);
}

function generateRandomCVV() {
    return String(Math.floor(Math.random() * 900) + 100);
}

function generateCardNumber(bin, length = 16) {
    let card = bin;
    while (card.length < length - 1) {
        card += Math.floor(Math.random() * 10);
    }
    for (let i = 0; i <= 9; i++) {
        const testCard = card + i;
        if (checkLuhn(testCard)) {
            return testCard;
        }
    }
    return card + '0';
}

function generateFullVisa(bin) {
    const cardNumber = generateCardNumber(bin);
    const month = generateRandomMonth();
    const year = generateRandomYear();
    const cvv = generateRandomCVV();
    return `${cardNumber}|${month}|${year}|${cvv}`;
}

// ==========================================
// دالة فحص بطاقة واحدة
// ==========================================
async function checkSingleCard(cardString, chatId, isSilent = false) {
    const parts = cardString.split('|');
    if (parts.length >= 1) {
        const cardNum = parts[0];
        if (!checkLuhn(cardNum)) {
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
        const status = data.status || 'غير معروف';
        let msg = data.message || 'غير معروف';
        const cardInfo = data.card || {};
        let cardType = cardInfo.type || getCardType(cardString.split('|')[0]);
        const country = (cardInfo.country && cardInfo.country.name) || 'غير معروف';
        
        // تنظيف الرسالة من النص "احذفها"
        msg = msg.replace(/احذفها/gi, '').trim();
        
        const isLive = (code === 1);
        return { isLive, status, message: msg, type: cardType, country, fullCard: cardString };
    } catch (err) {
        console.error(err);
        if (!isSilent) await bot.sendMessage(chatId, '⚠️ حدث خطأ أثناء الاتصال بالخدمة. حاول لاحقاً.');
        return null;
    }
}

// ==========================================
// تحديث رسالة التقدم (تعديل في نفس الرسالة)
// ==========================================
async function updateProgressMessage(chatId, messageId, current, total, bin) {
    const dots = ['.', '..', '...', '....', '.....', '....', '...', '..', '.'];
    const dot = dots[current % dots.length];
    const text = `🔄 جاري إنشاء الفيزا ${current}/${total} ${dot}\n━━━━━━━━━━━━━━\n📌 BIN: ${bin}`;
    try {
        await bot.editMessageText(text, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown'
        });
    } catch (e) {
        // تجاهل أخطاء التعديل
    }
}

// ==========================================
// دالة التخمين الجماعي (عرض الصالحة فقط)
// ==========================================
async function startGuessing(chatId, bin, requestedCount) {
    const isAdmin = adminSet.has(chatId);
    let total = requestedCount;

    if (!isAdmin && total > 50) {
        await bot.sendMessage(chatId, '⚠️ العدد المطلوب يتجاوز الحد المسموح (الأدمن فقط يمكنه تجاوز 50).');
        return false;
    }
    if (total < 5) total = 5;
    if (total > 50 && !isAdmin) total = 50;

    // تحديث الحالة
    const state = guessState.get(chatId);
    if (state) {
        state.step = 'guessing';
        state.cancelFlag = false;
    }

    // إرسال رسالة التقدم الأولية
    const progressMsg = await bot.sendMessage(chatId, `🔄 جاري إنشاء الفيزا 0/${total} .\n━━━━━━━━━━━━━━\n📌 BIN: ${bin}`);
    
    let hit = 0;
    let sentCount = 0;
    
    for (let i = 1; i <= total; i++) {
        const currentState = guessState.get(chatId);
        if (currentState && currentState.cancelFlag) {
            await bot.sendMessage(chatId, '❌ تم إلغاء العملية.');
            guessState.delete(chatId);
            return false;
        }

        // تحديث رسالة التقدم
        await updateProgressMessage(chatId, progressMsg.message_id, i, total, bin);

        const fullVisa = generateFullVisa(bin);
        const result = await checkSingleCard(fullVisa, chatId, true);
        
        if (result && result.isLive) {
            hit++;
            sentCount++;
            
            // تنظيف الرسالة من النص "احذفها"
            let cleanMessage = result.message;
            cleanMessage = cleanMessage.replace(/احذفها/gi, '').trim();
            
            const flag = getFlag(result.country);
            const cardNumber = fullVisa.split('|')[0];
            const cardTypeDisplay = getCardType(cardNumber);
            
            const liveText = `✅تعمل بنجاح ✅
━━━━━━━━━━━━━━
💳 \`${fullVisa}\`
📊 الحالة: تعمل ✅
💬 الرسالة: ${cleanMessage}
🏦 النوع: ${cardTypeDisplay}
🌍 البلد: ${result.country} ${flag}
━━━━━━━━━━━━━━
بواسطة: @pe8bot`;
            
            await bot.sendMessage(chatId, liveText, { parse_mode: 'Markdown' });
        }
    }
    
    // حذف رسالة التقدم بعد الانتهاء
    try {
        await bot.deleteMessage(chatId, progressMsg.message_id);
    } catch(e) {}
    
    // إرسال الملخص فقط إذا وجدت بطاقات صالحة
    if (hit > 0) {
        await bot.sendMessage(chatId, `📊 *الملخص النهائي*\n✅ البطاقات الصالحة: ${hit}\n🎯 المجموع الكلي: ${total}`, { parse_mode: 'Markdown' });
    } else if (hit === 0 && total > 0) {
        await bot.sendMessage(chatId, `😞 لم يتم العثور على أي بطاقة صالحة من أصل ${total}.`);
    }
    
    guessState.delete(chatId);
    return true;
}

// ==========================================
// أوامر الأدمن
// ==========================================
bot.onText(/\/addadmin (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (!adminSet.has(chatId)) {
        bot.sendMessage(chatId, '⛔ هذا الأمر مخصص للأدمن فقط.');
        return;
    }
    const newAdminId = parseInt(match[1].trim(), 10);
    if (isNaN(newAdminId)) {
        bot.sendMessage(chatId, '⚠️ ID غير صالح.');
        return;
    }
    adminSet.add(newAdminId);
    bot.sendMessage(chatId, `✅ تم إضافة أدمن جديد: \`${newAdminId}\``, { parse_mode: 'Markdown' });
});

bot.onText(/\/removeadmin (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (!adminSet.has(chatId)) {
        bot.sendMessage(chatId, '⛔ هذا الأمر مخصص للأدمن فقط.');
        return;
    }
    const adminId = parseInt(match[1].trim(), 10);
    if (adminId === 643309456) {
        bot.sendMessage(chatId, '⚠️ لا يمكن إزالة الأدمن الأساسي.');
        return;
    }
    adminSet.delete(adminId);
    bot.sendMessage(chatId, `✅ تم إزالة الأدمن: \`${adminId}\``, { parse_mode: 'Markdown' });
});

bot.onText(/\/admins/, (msg) => {
    const chatId = msg.chat.id;
    if (!adminSet.has(chatId)) {
        bot.sendMessage(chatId, '⛔ هذا الأمر مخصص للأدمن فقط.');
        return;
    }
    const list = Array.from(adminSet).join('\n');
    bot.sendMessage(chatId, `📋 قائمة الأدمن:\n${list}`);
});

bot.onText(/\/cancel/, (msg) => {
    const chatId = msg.chat.id;
    const state = guessState.get(chatId);
    if (state) {
        state.cancelFlag = true;
        bot.sendMessage(chatId, '❌ تم إلغاء العملية.');
        guessState.delete(chatId);
    } else {
        bot.sendMessage(chatId, '⚠️ لا توجد عملية نشطة حالياً.');
    }
});

// ==========================================
// عرض القائمة الرئيسية
// ==========================================
async function showMainMenu(chatId) {
    const opts = {
        reply_markup: {
            inline_keyboard: [
                [{ text: '🎲 تخمين مجموعة فيزات', callback_data: 'menu_guess' }],
                [{ text: '🔍 فحص فيزا واحدة', callback_data: 'menu_single' }]
            ]
        },
        parse_mode: 'Markdown'
    };
    await bot.sendMessage(chatId, '✨ *القائمة الرئيسية* ✨\nاختر أحد الخيارين:', opts);
}

// ==========================================
// أوامر /start و /menu
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
    bot.sendMessage(chatId, 'اختر لغتك / Choose your language:', opts);
});

bot.onText(/\/menu/, (msg) => {
    showMainMenu(msg.chat.id);
});

// ==========================================
// معالجة الأزرار
// ==========================================
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    bot.answerCallbackQuery(query.id);

    if (data === 'lang_ar') {
        userLang.set(chatId, 'ar');
        await bot.sendMessage(chatId, '✅ تم تغيير اللغة إلى العربية\n\n✨ *القائمة الرئيسية* ✨', { parse_mode: 'Markdown' });
        await showMainMenu(chatId);
    } else if (data === 'lang_en') {
        userLang.set(chatId, 'en');
        await bot.sendMessage(chatId, '✅ Language changed to English\n\n✨ *Main Menu* ✨', { parse_mode: 'Markdown' });
        await showMainMenu(chatId);
    } else if (data === 'menu_guess') {
        guessState.set(chatId, { step: 'awaiting_bin', cancelFlag: false });
        const cancelKeyboard = {
            reply_markup: {
                inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'cancel_guess' }]]
            }
        };
        await bot.sendMessage(chatId, '📌 أرسل الـ BIN الخاص بك (أول 6 أرقام أو أكثر من الفيزا)\nمثال: `515462`', { parse_mode: 'Markdown', ...cancelKeyboard });
    } else if (data === 'menu_single') {
        await bot.sendMessage(chatId, '⚠️ الصيغة غير صحيحة.\nأرسل البطاقة بهذا الشكل:\n`4111111111111111|01|2031|123`', { parse_mode: 'Markdown' });
    } else if (data === 'cancel_guess') {
        const state = guessState.get(chatId);
        if (state) {
            state.cancelFlag = true;
            guessState.delete(chatId);
            await bot.sendMessage(chatId, '❌ تم إلغاء العملية.');
        }
    }
});

// ==========================================
// معالجة الرسائل النصية
// ==========================================
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!text || text.startsWith('/')) return;

    const state = guessState.get(chatId);

    // حالة انتظار BIN
    if (state && state.step === 'awaiting_bin') {
        const cleaned = text.trim();
        if (/^\d{6,}$/.test(cleaned)) {
            const bin = cleaned.slice(0, 6);
            state.bin = bin;
            state.step = 'awaiting_count';
            const cancelKeyboard = {
                reply_markup: {
                    inline_keyboard: [[{ text: '❌ إلغاء', callback_data: 'cancel_guess' }]]
                }
            };
            await bot.sendMessage(chatId, '🔢 كم عدد الفيزات التي تريد تخمينها؟\n(الحد الأدنى 5، الحد الأقصى 50)\nللأدمن: لا يوجد حد أقصى.', cancelKeyboard);
        } else {
            await bot.sendMessage(chatId, '⚠️ يجب إرسال أرقام صالحة (على الأقل 6 أرقام).');
        }
        return;
    }

    // حالة انتظار العدد
    if (state && state.step === 'awaiting_count') {
        const count = parseInt(text.trim(), 10);
        if (isNaN(count)) {
            await bot.sendMessage(chatId, '🔢 كم عدد الفيزات التي تريد تخمينها؟\n(الحد الأدنى 5، الحد الأقصى 50)');
            return;
        }
        const isAdmin = adminSet.has(chatId);
        if (!isAdmin && (count < 5 || count > 50)) {
            await bot.sendMessage(chatId, '⚠️ العدد يجب أن يكون بين 5 و 50.');
            return;
        }
        if (!isAdmin && count > 50) {
            await bot.sendMessage(chatId, '⚠️ العدد المطلوب يتجاوز الحد المسموح (الأدمن فقط يمكنه تجاوز 50).');
            return;
        }
        state.count = count;
        await startGuessing(chatId, state.bin, count);
        return;
    }

    // فحص فيزا واحدة (للمستخدمين العاديين)
    if (text.split('|').length < 4) {
        await bot.sendMessage(chatId, '⚠️ الصيغة غير صحيحة.\nأرسل البطاقة بهذا الشكل:\n`4111111111111111|01|2031|123`', { parse_mode: 'Markdown' });
        return;
    }

    await bot.sendMessage(chatId, '⏳ جاري فحص البطاقة...');
    const result = await checkSingleCard(text, chatId);
    if (!result) return;

    if (result.isLive) {
        let cleanMessage = result.message;
        cleanMessage = cleanMessage.replace(/احذفها/gi, '').trim();
        const flag = getFlag(result.country);
        const cardNumber = text.split('|')[0];
        const cardTypeDisplay = getCardType(cardNumber);
        
        const liveText = `✅تعمل بنجاح ✅
━━━━━━━━━━━━━━
💳 \`${text}\`
📊 الحالة: تعمل ✅
💬 الرسالة: ${cleanMessage}
🏦 النوع: ${cardTypeDisplay}
🌍 البلد: ${result.country} ${flag}
━━━━━━━━━━━━━━
بواسطة: @pe8bot`;
        
        await bot.sendMessage(chatId, liveText, { parse_mode: 'Markdown' });
    }
    // إذا كانت البطاقة مرفوضة، لا نرسل أي شيء
});

console.log('✅ البوت يعمل الآن - يعرض فقط البطاقات الصالحة مع العلم والتنسيق المطلوب...');
