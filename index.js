const axios = require("axios");
const UserAgent = require("user-agents");
const TelegramBot = require("node-telegram-bot-api");
const express = require("express");

// ==========================================
// الإعدادات
// ==========================================
const TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;
const URL = process.env.RAILWAY_STATIC_URL; // مهم في Railway

if (!TOKEN) {
  console.error("❌ BOT_TOKEN غير موجود");
  process.exit(1);
}

if (!URL) {
  console.error("❌ RAILWAY_STATIC_URL غير موجود");
  process.exit(1);
}

// ==========================================
// إنشاء البوت + السيرفر
// ==========================================
const bot = new TelegramBot(TOKEN);
const app = express();

app.use(express.json());

// ==========================================
// Webhook
// ==========================================
const webhookPath = `/bot${TOKEN}`;

bot.setWebHook(`${URL}${webhookPath}`);

app.post(webhookPath, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// ==========================================
// Luhn check
// ==========================================
function checkLuhn(card) {
  if (!/^\d+$/.test(card)) return false;

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
// فحص البطاقة
// ==========================================
async function checkCard(cardString, chatId) {
  try {
    const cardNumber = cardString.split("|")[0];

    if (!cardNumber || !checkLuhn(cardNumber)) {
      return bot.sendMessage(chatId, "❌ رقم البطاقة غير صالح");
    }

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

    const data = res.data || {};

    const msg = data.message || "لا توجد رسالة";
    const status = data.status || "غير معروف";

    const text = `
💳 ${cardString}
📊 ${status}
💬 ${msg}
`;

    if (data.code === 1) {
      await bot.sendMessage(chatId, "✅ VALID\n" + text);
    } else {
      await bot.sendMessage(chatId, "❌ INVALID\n" + text);
    }

  } catch (err) {
    console.error("❌ API ERROR:", err.message);
    bot.sendMessage(chatId, "⚠️ فشل الاتصال بالسيرفر");
  }
}

// ==========================================
// أوامر البوت
// ==========================================
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `✨ مرحباً ✨

أرسل البطاقة بهذا الشكل:
4111111111111111|01|2031|123`
  );
});

// ==========================================
// استقبال الرسائل
// ==========================================
bot.on("message", async (msg) => {
  if (!msg.text) return;

  const chatId = msg.chat.id;
  const text = msg.text.trim();

  if (text.startsWith("/")) return;

  const parts = text.split("|");

  if (parts.length !== 4) {
    return bot.sendMessage(chatId, "❌ الصيغة غلط");
  }

  await bot.sendMessage(chatId, "⏳ جاري الفحص...");

  await checkCard(text, chatId);
});

// ==========================================
// تشغيل السيرفر
// ==========================================
app.get("/", (req, res) => {
  res.send("🤖 Bot is running");
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
