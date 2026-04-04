const axios = require("axios");
const UserAgent = require("user-agents");
const TelegramBot = require("node-telegram-bot-api");

// ==========================================
// التوكن من متغيرات البيئة (للأمان)
// ==========================================
const TOKEN = process.env.TOKEN;
if (!TOKEN) {
  console.error("❌ الرجاء تعيين متغير البيئة TOKEN");
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

// ==========================================
// دالة التحقق من Luhn (اختياري، يمكن الاحتفاظ بها)
// ==========================================
function checkLuhn(card) {
  let sum = 0;
  let alt = false;
  for (let i = card.length - 1; i >= 0; i--) {
    let num = parseInt(card[i]);
    if (alt) {
      num *= 2;
      if (num > 9) num -= 9;
    }
    sum += num;
    alt = !alt;
  }
  return sum % 10 === 0;
}

// ==========================================
// دالة فحص البطاقة عبر الـ API
// ==========================================
async function checkCard(cardString, chatId, bot) {
  // cardString مثال: "4111111111111111|01|2031|123"
  // يمكن إجراء التحقق من Luhn قبل الإرسال (اختياري)
  const cardNumber = cardString.split("|")[0];
  if (cardNumber && !checkLuhn(cardNumber)) {
    await bot.sendMessage(chatId, "❌ رقم البطاقة غير صالح (فشل Luhn).");
    return;
  }

  try {
    const res = await axios.post(
      "https://api.chkr.cc/",
      { data: cardString },
      {
        headers: {
          "User-Agent": new UserAgent().toString(),
          "Content-Type": "application/json"
        },
        timeout: 15000
      }
    );

    const data = res.data;
    const msg = data.message || "لا توجد رسالة";
    const status = data.status || "غير معروف";

    if (data.code === 1) {
      // بطاقة مقبولة (HIT)
      const successText = `
✅ **تم العثور على بطاقة صالحة**
━━━━━━━━━━━━━━
💳 \`${cardString}\`
📊 ${status}
💬 ${msg}
━━━━━━━━━━━━━━
`;
      await bot.sendMessage(chatId, successText, { parse_mode: "Markdown" });
    } else {
      // بطاقة مرفوضة (BAD)
      const failText = `
❌ **البطاقة مرفوضة**
━━━━━━━━━━━━━━
💳 \`${cardString}\`
📊 ${status}
💬 ${msg}
━━━━━━━━━━━━━━
`;
      await bot.sendMessage(chatId, failText, { parse_mode: "Markdown" });
    }
  } catch (err) {
    console.error(err);
    await bot.sendMessage(chatId, "⚠️ حدث خطأ أثناء الاتصال بـ API. حاول لاحقاً.");
  }
}

// ==========================================
// أوامر البوت
// ==========================================
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(
    chatId,
    `✨ مرحباً بك في بوت فحص البطاقات ✨

أرسل لي رقم البطاقة بالصيغة التالية:
\`رقم|شهر|سنة|cvv\`

مثال:
\`4111111111111111|01|2031|123\`

وسأقوم بالتحقق منها عبر الخدمة.`,
    { parse_mode: "Markdown" }
  );
});

// معالجة أي رسالة نصية (تعتبر بطاقة)
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  // تجاهل الأوامر التي تبدأ بـ /
  if (text.startsWith("/")) return;

  // التأكد من أن النص يحتوي على 4 أجزاء على الأقل (رقم|شهر|سنة|cvv)
  const parts = text.split("|");
  if (parts.length < 4) {
    await bot.sendMessage(
      chatId,
      "⚠️ الصيغة غير صحيحة.\nأرسل البطاقة بهذا الشكل:\n`4111111111111111|01|2031|123`",
      { parse_mode: "Markdown" }
    );
    return;
  }

  // إرسال رسالة "جاري التحقق..."
  await bot.sendMessage(chatId, "⏳ جاري فحص البطاقة...");

  // تنفيذ الفحص
  await checkCard(text, chatId, bot);
});

console.log("✅ البوت يعمل الآن...");
