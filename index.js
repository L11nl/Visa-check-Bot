const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const TOKEN = process.env.TOKEN;
if (!TOKEN) {
    console.error('❌ TOKEN is required');
    process.exit(1);
}

// إعداد البوت مع الوكلاء لتخفيف الضغط ومنع التهنيج
const bot = new TelegramBot(TOKEN, { polling: { interval: 300, autoStart: true, params: { timeout: 10 } } });
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 2000, maxFreeSockets: 256, timeout: 60000 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 2000, maxFreeSockets: 256, timeout: 60000, rejectUnauthorized: false });

// ==========================================
// قاعدة بيانات JSON
// ==========================================
const DATA_FILE = path.join(__dirname, 'data.json');

function loadData() {
    if (!fs.existsSync(DATA_FILE)) return { subscribers: {}, campaigns: {}, pendingPayments: [], paymentProofs: [], plans: null };
    try { 
        const content = fs.readFileSync(DATA_FILE, 'utf8');
        return JSON.parse(content || '{}') || { subscribers: {}, campaigns: {}, pendingPayments: [], paymentProofs: [], plans: null }; 
    } catch(e) { 
        return { subscribers: {}, campaigns: {}, pendingPayments: [], paymentProofs: [], plans: null }; 
    }
}

function saveData(data) { 
    try { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); } catch(e) { console.error('Error saving data:', e); }
}

function getPlans() {
    const data = loadData();
    if (!data.plans) {
        data.plans = {
            free: { nameAr: 'مجاني', nameEn: 'Free', price: 0, cardsLimit: 40, campaignsLimit: 2, speed: 5, desc: "الخطة الأساسية والمجانية لتجربة خدمات البوت." },
            plus: { nameAr: 'Plus', nameEn: 'Plus', price: 3, cardsLimit: 500, campaignsLimit: 4, speed: 30, desc: "خطة ممتازة للمبتدئين، توفر سرعة متوسطة وحدود مناسبة." },
            pro: { nameAr: 'Pro', nameEn: 'Pro', price: 5, cardsLimit: 1500, campaignsLimit: 6, speed: 60, desc: "خطة المحترفين، تمنحك سرعة عالية جداً وحدود فحص كبيرة." },
            vip: { nameAr: 'VIP', nameEn: 'VIP', price: 8, cardsLimit: 3000, campaignsLimit: 10, speed: 100, desc: "أعلى باقة في البوت، سرعة خيالية وأعلى حدود ممكنة لجميع الميزات." }
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
function createPaymentProof(userId, plan, photoFileId, messageId, adminMsgId) { const d = loadData(); const proof = { id: Date.now() + Math.random(), userId, plan, photoFileId, messageId, adminMsgId, status: 'pending', createdAt: new Date().toISOString() }; d.paymentProofs.push(proof); saveData(d); return proof; }
function getPaymentProof(id) { return loadData().paymentProofs.find(p => p.id === id); }
function updatePaymentProof(id, status) { const d = loadData(); const idx = d.paymentProofs.findIndex(p => p.id === id); if (idx !== -1) d.paymentProofs[idx].status = status; saveData(d); }

// ==========================================
// المتغيرات العامة
// ==========================================
const userLang = new Map();
const adminSet = new Set([643309456]);
const userStates = new Map();          // { step, bins, defaultCount, progressMsgId, campaignsData, cancelFlag, plan, code }
const activeJobs = new Map();          // مفتاح chatId -> { cancel: false }
const BINANCE_PAY_ID = '842505320';

// ==========================================
// دوال مساعدة
// ==========================================
const countryFlags = { 'united states': '🇺🇸', 'usa': '🇺🇸', 'us': '🇺🇸', 'united kingdom': '🇬🇧', 'uk': '🇬🇧', 'britain': '🇬🇧', 'saudi arabia': '🇸🇦', 'ksa': '🇸🇦', 'saudi': '🇸🇦', 'egypt': '🇪🇬', 'uae': '🇦🇪', 'kuwait': '🇰🇼', 'qatar': '🇶🇦', 'bahrain': '🇧🇭', 'oman': '🇴🇲', 'jordan': '🇯🇴', 'lebanon': '🇱🇧', 'iraq': '🇮🇶', 'syria': '🇸🇾', 'palestine': '🇵🇸', 'turkey': '🇹🇷', 'germany': '🇩🇪', 'france': '🇫🇷', 'italy': '🇮🇹', 'spain': '🇪🇸', 'netherlands': '🇳🇱', 'belgium': '🇧🇪', 'switzerland': '🇨🇭', 'austria': '🇦🇹', 'russia': '🇷🇺', 'china': '🇨🇳', 'japan': '🇯🇵', 'south korea': '🇰🇷', 'india': '🇮🇳', 'brazil': '🇧🇷', 'canada': '🇨🇦', 'mexico': '🇲🇽', 'australia': '🇦🇺', 'indonesia': '🇮🇩', 'malaysia': '🇲🇾', 'singapore': '🇸🇬', 'thailand': '🇹🇭', 'vietnam': '🇻🇳', 'philippines': '🇵🇭', 'pakistan': '🇵🇰', 'bangladesh': '🇧🇩', 'south africa': '🇿🇦', 'nigeria': '🇳🇬', 'morocco': '🇲🇦', 'algeria': '🇩🇿', 'tunisia': '🇹🇳', 'libya': '🇱🇾', 'sudan': '🇸🇩', 'yemen': '🇾🇪' };
function getFlag(cn) { if (!cn) return '🌍'; const l = cn.toLowerCase(); for (const [k, f] of Object.entries(countryFlags)) if (l.includes(k)) return f; return '🌍'; }
function getCardType(cn) { if(!cn) return 'بطاقة ائتمانية'; const f=cn[0], t=cn.slice(0,2), fo=cn.slice(0,4); if(f==='4') return 'فيزا كارد'; if(t>='51'&&t<='55') return 'ماستر كارد'; if(t==='34'||t==='37') return 'امريكان اكسبريس'; if(fo==='6011'||t==='65'||(t>='64'&&t<='65')) return 'ديسكفر'; if(t==='35') return 'جيه سي بي'; if(t==='30'||t==='36'||t==='38'||t==='39') return 'دينرز كلوب'; if(t==='50') return 'ميركاتيل'; if(t==='56'||t==='57'||t==='58') return 'مايسترو'; return 'بطاقة ائتمانية'; }
function checkLuhn(card) { let sum=0, alt=false; for(let i=card.length-1;i>=0;i--){ let d=parseInt(card[i],10); if(isNaN(d)) continue; if(alt){ d*=2; if(d>9) d-=9; } sum+=d; alt=!alt; } return sum%10===0; }
function randMonth() { return String(Math.floor(Math.random()*12)+1).padStart(2,'0'); }
function randYear() { return String(new Date().getFullYear() + Math.floor(Math.random()*5)); }
function randCVV() { return String(Math.floor(Math.random()*900)+100); }
function genCardNumber(bin, len=16) { let card=bin; while(card.length<len-1) card+=Math.floor(Math.random()*10); for(let i=0;i<=9;i++){ const t=card+i; if(checkLuhn(t)) return t; } return card+'0'; }
function genFullVisa(bin) { return `${genCardNumber(bin)}|${randMonth()}|${randYear()}|${randCVV()}`; }
function genRandomCode() { return Math.random().toString(36).substring(2,10).toUpperCase(); }

async function checkSingleCard(cardString, chatId, isSilent=false, retries=2) { 
    try { 
        const r=await axios.post('https://api.chkr.cc/',{data:cardString},{
            headers:{'User-Agent':'Mozilla/5.0','Content-Type':'application/json'},
            timeout:20000, httpAgent: httpAgent, httpsAgent: httpsAgent
        }); 
        const d=r.data; 
        if(!d) return { isLive: false };
        const live=(d.code===1 || (d.status && d.status.toLowerCase().includes('live'))); 
        if(!live && !isSilent) return null; 
        return { isLive:live, status:d.status||'غير معروف', message:(d.message||'').replace(/احذفها/gi,'').trim(), type:(d.card&&d.card.type)||getCardType(cardString.split('|')[0]), country:(d.card&&d.card.country&&d.card.country.name)||'غير معروف' }; 
    } catch(e){ 
        if(retries>0){ await new Promise(res => setTimeout(res, 2000)); return checkSingleCard(cardString,chatId,isSilent,retries-1); } 
        if(!isSilent){ const l=userLang.get(chatId)||'ar'; await bot.sendMessage(chatId,translations[l].api_error).catch(()=>{}); }
        return { isLive: false }; 
    } 
}

function getCopyButtons(fullCard, lang) { const [num,month,year,cvv]=fullCard.split('|'); const d=translations[lang]; return { reply_markup:{ inline_keyboard:[[{text:d.btn_copy_full,callback_data:`copy_full_${fullCard}`}],[{text:d.btn_copy_num,callback_data:`copy_num_${num}`}],[{text:d.btn_copy_exp,callback_data:`copy_exp_${month}|${year}`}],[{text:d.btn_copy_cvv,callback_data:`copy_cvv_${cvv}`}]] } }; }
function formatProgressBar(percent, width=10) { const filled=Math.round(percent/100*width); return '▰'.repeat(filled)+'▱'.repeat(width-filled); }
function buildProgressText(campaignsData, speedPercent) { 
    let txt=`🔄 جاري إنشاء الفيزا\nالسرعة: ${speedPercent}%\n`; 
    for(const d of campaignsData){ 
        const pct=d.total>0?(d.current/d.total*100):0; 
        const bar=formatProgressBar(pct); 
        const rem=d.total-d.current; 
        txt+=`\nالمنفذ: ${d.bin}\n${bar} ${pct.toFixed(1)}%\nالعد التنازلي: ${rem} بطاقة متبقية\n`; 
    } 
    txt+='\n━━━━━━━━━━━━━━'; 
    return txt; 
}

// ==========================================
// منطق شروحات الاشتراك
// ==========================================
async function showPlanDetails(chatId, planKey) {
    const lang = userLang.get(chatId) || 'ar';
    const dict = translations[lang];
    const plans = getPlans();
    const p = plans[planKey];
    if (!p) return;

    const text = `💎 *خطة ${p[`name${lang==='ar'?'Ar':'En'}`]}*\n\n` +
                 `📝 ${p.desc}\n\n` +
                 `💰 السعر: ${p.price} USDT\n` +
                 `💳 حد البطاقات للحملة: ${p.cardsLimit}\n` +
                 `🚀 السرعة: ${p.speed}%\n` +
                 `📊 الحملات المتزامنة: ${p.campaignsLimit}`;

    const kb = { inline_keyboard: [[
        { text: dict.cancel_btn, callback_data: 'menu_subscribe' },
        { text: '✅ اشتراك', callback_data: `confirm_sub_${planKey}` }
    ]] };

    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: kb });
}

async function handleConfirmSubscription(chatId, planKey) {
    const lang = userLang.get(chatId) || 'ar';
    const dict = translations[lang];
    const subscriber = getSubscriber(chatId);
    const plans = getPlans();
    
    if (subscriber.plan === planKey) {
        await bot.sendMessage(chatId, dict.already_subscribed.replace('{plan}', plans[planKey][`name${lang==='ar'?'Ar':'En'}`]));
        return;
    }

    const p = plans[planKey];
    const code = genRandomCode();
    createPendingPayment(chatId, planKey, code);

    const text = `✅ خطة ${p[`name${lang==='ar'?'Ar':'En'}`]}\n` +
                 `بسعر ${p.price} USDT\n` +
                 `قم بتحويل المبلغ هنا كامل:\n` +
                 `\`${BINANCE_PAY_ID}\`\n\n` +
                 `كود وضع كود في الملاحظات في بايننس: \`${code}\``;

    const kb = { inline_keyboard: [[{ text: '💰 تم التحويل', callback_data: `verify_pay_${planKey}_${code}` }]] };
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: kb });
}

async function verifyBinancePayment(chatId, planKey, code) {
    // محاكاة التحقق من الدفعة (سنفترض الفشل للذهاب لخيار الصورة كما طلبت)
    const isSuccess = false; 

    if (isSuccess) {
        const end = new Date(); end.setMonth(end.getMonth() + 1);
        updateSubscriber(chatId, { plan: planKey, startDate: new Date().toISOString(), endDate: end.toISOString() });
        await bot.sendMessage(chatId, `✅ تم تفعيل العضوية بنجاح!`);
    } else {
        await bot.sendMessage(chatId, `❌ تم الرفض، يرجى إرسال صورة التحويل`);
        userStates.set(chatId, { step: 'awaiting_payment_proof', plan: planKey, code: code });
    }
}

// ==========================================
// تشغيل حملات متعددة بالتوازي
// ==========================================
async function runMultipleCampaignsParallel(chatId, binsList, totalCardsPerBin) {
    const subscriber = getSubscriber(chatId);
    const planName = subscriber.plan;
    const plans = getPlans();
    const allowedCampaigns = plans[planName].campaignsLimit;
    const speedPercent = plans[planName].speed;
    const dict = translations[userLang.get(chatId) || 'ar'];

    if (binsList.length > allowedCampaigns) {
        await bot.sendMessage(chatId, dict.campaigns_limit_reached.replace('{limit}', allowedCampaigns));
        return;
    }

    if (activeJobs.has(chatId)) {
        await bot.sendMessage(chatId, '⚠️ هناك حملات جارية حالياً. استخدم /cancel أولاً.');
        return;
    }
    activeJobs.set(chatId, { cancel: false });

    const campaignsData = [];
    for (const bin of binsList) {
        const cid = createCampaign(chatId, bin, totalCardsPerBin);
        campaignsData.push({ bin, cid, total: totalCardsPerBin, current: 0, hit: 0 });
    }

    let progressMsg = await bot.sendMessage(chatId, buildProgressText(campaignsData, speedPercent), {
        reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء الحملات', callback_data: 'cancel_all_campaigns' }]] }
    });

    // تثبيت الرسالة كما طلبت
    try {
        await bot.pinChatMessage(chatId, progressMsg.message_id, { disable_notification: true });
    } catch (e) {
        console.error('Error pinning progress message:', e);
    }

    let lastEdit = 0;
    const updateProgress = async (force = false) => {
        if (activeJobs.get(chatId)?.cancel && !force) return;
        const now = Date.now();
        if (!force && now - lastEdit < 3500) return; 
        lastEdit = now;
        const newText = buildProgressText(campaignsData, speedPercent);
        try { 
            await bot.editMessageText(newText, { 
                chat_id: chatId, 
                message_id: progressMsg.message_id, 
                reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء الحملات', callback_data: 'cancel_all_campaigns' }]] } 
            }); 
        } catch(e) {}
    };

    const runSingle = async (camp) => {
        const bin = camp.bin;
        const total = camp.total;
        const numPorts = Math.max(2, Math.min(15, Math.floor(speedPercent / 8) + 1));
        const allVisas = [];
        for (let i = 0; i < total; i++) allVisas.push(genFullVisa(bin));
        const portVisas = [];
        let start = 0;
        let cpp = Math.floor(total / numPorts);
        for (let p = 0; p < numPorts; p++) {
            let cnt = (p === numPorts-1) ? total - start : cpp;
            if (cnt <= 0) continue;
            portVisas.push(allVisas.slice(start, start+cnt));
            start += cnt;
        }

        const portResults = await Promise.all(portVisas.map(async (visas) => {
            let portHit = 0;
            const batchSize = speedPercent > 50 ? 8 : 4; 
            const delayMs = speedPercent <= 10 ? 2000 : (speedPercent <= 50 ? 800 : 200);
            for (let i = 0; i < visas.length; i += batchSize) {
                if (activeJobs.get(chatId)?.cancel) break;
                const batch = visas.slice(i, i+batchSize);
                const results = await Promise.all(batch.map(v => checkSingleCard(v, chatId, true)));
                for (let j=0; j<results.length; j++) {
                    const res = results[j];
                    if (res && res.isLive) {
                        portHit++; camp.hit++;
                        const flag = getFlag(res.country);
                        const cardType = getCardType(batch[j].split('|')[0]);
                        const liveText = dict.live_result.replace('{card}', batch[j]).replace('{type}', cardType).replace('{country}', res.country).replace('{flag}', flag);
                        await bot.sendMessage(chatId, liveText, { parse_mode: 'Markdown', ...getCopyButtons(batch[j], userLang.get(chatId)||'ar') }).catch(() => {});
                    }
                }
                camp.current = Math.min(camp.current + batch.length, camp.total);
                await updateProgress();
                if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
            }
            return portHit;
        }));
        updateCampaign(camp.cid, camp.total, portResults.reduce((a,b)=>a+b,0), 'completed');
    };

    await Promise.all(campaignsData.map(c => runSingle(c)));
    await updateProgress(true);
    
    // إزالة التثبيت وحذف الرسالة بعد الانتهاء
    try { await bot.unpinChatMessage(chatId, { message_id: progressMsg.message_id }); } catch(e) {}
    try { await bot.deleteMessage(chatId, progressMsg.message_id); } catch(e) {}
    
    activeJobs.delete(chatId);
    
    const totalHits = campaignsData.reduce((acc, curr) => acc + curr.hit, 0);
    const totalRequested = binsList.length * totalCardsPerBin;
    if (totalHits === 0) {
        const noLive = dict.no_live_found.replace('{total}', totalRequested);
        const keyboard = { reply_markup: { inline_keyboard: [[{ text: dict.new_campaign_btn, callback_data: 'menu_guess' }]] } };
        await bot.sendMessage(chatId, noLive, keyboard);
    } else {
        await bot.sendMessage(chatId, dict.summary.replace('{hit}', totalHits).replace('{total}', totalRequested));
    }

    userStates.delete(chatId);
}

// ==========================================
// القوائم والأزرار
// ==========================================
async function showMainMenu(chatId) {
    const lang = userLang.get(chatId)||'ar', dict=translations[lang];
    const kb = { inline_keyboard: [[{text:dict.btn_guess,callback_data:'menu_guess'}],[{text:dict.btn_single,callback_data:'menu_single'}],[{text:dict.btn_subscribe,callback_data:'menu_subscribe'}],[{text:dict.btn_my_campaigns,callback_data:'menu_my_campaigns'}]] };
    if(adminSet.has(chatId)) kb.inline_keyboard.push([{text:'⚙️ إدارة البوت',callback_data:'admin_panel'}]);
    await bot.sendMessage(chatId, dict.main_menu, { reply_markup: kb, parse_mode: 'Markdown' });
}

async function showSubscriptionMenu(chatId) {
    const lang=userLang.get(chatId)||'ar', dict=translations[lang], plans=getPlans();
    const btns=[]; for(const [k,p] of Object.entries(plans)) if(k!=='free') btns.push([{text:`${p[`name${lang==='ar'?'Ar':'En'}`]} - ${p.price} USDT`,callback_data:`view_plan_${k}`}]);
    btns.push([{text:dict.cancel_btn,callback_data:'main_menu'}]);
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
bot.onText(/\/start/, async (msg) => { const cid=msg.chat.id; await bot.sendMessage(cid, 'اختر لغتك / Choose your language:', { reply_markup:{ inline_keyboard:[[{text:'العربية',callback_data:'lang_ar'},{text:'English',callback_data:'lang_en'}]] } }); });
bot.onText(/\/menu/, async (msg) => { await showMainMenu(msg.chat.id); });
bot.onText(/\/cancel/, async (msg) => { const cid=msg.chat.id; if(activeJobs.has(cid)){ activeJobs.get(cid).cancel=true; activeJobs.delete(cid); await bot.sendMessage(cid, '❌ تم إلغاء جميع الحملات الجارية.'); } else await bot.sendMessage(cid, '⚠️ لا توجد حملات نشطة.'); });
bot.onText(/\/addadmin (.+)/, async (msg, match) => { const cid=msg.chat.id; if(!adminSet.has(cid)) return; const id=parseInt(match[1]); if(!isNaN(id)) adminSet.add(id); await bot.sendMessage(cid, `✅ تم إضافة أدمن ${id}`); });
bot.onText(/\/removeadmin (.+)/, async (msg, match) => { const cid=msg.chat.id; if(!adminSet.has(cid)) return; const id=parseInt(match[1]); if(id===643309456){ await bot.sendMessage(cid,'⚠️ لا يمكن إزالة الأدمن الأساسي'); return; } adminSet.delete(id); await bot.sendMessage(cid,`✅ تم إزالة أدمن ${id}`); });
bot.onText(/\/admins/, async (msg) => { const cid=msg.chat.id; if(!adminSet.has(cid)) return; await bot.sendMessage(cid, `📋 الأدمن: ${Array.from(adminSet).join(', ')}`); });

// ==========================================
// معالجة الأزرار (إرجاع كافة الأزرار المحذوفة)
// ==========================================
bot.on('callback_query', async (query) => {
    const cid=query.message.chat.id, data=query.data, lang=userLang.get(cid)||'ar', dict=translations[lang];
    await bot.answerCallbackQuery(query.id).catch(() => {});
    
    // أزرار النسخ
    if(data.startsWith('copy_full_')){ await bot.sendMessage(cid,`\`${data.replace('copy_full_','')}\``,{parse_mode:'Markdown'}); return; }
    if(data.startsWith('copy_num_')){ await bot.sendMessage(cid,`\`${data.replace('copy_num_','')}\``,{parse_mode:'Markdown'}); return; }
    if(data.startsWith('copy_exp_')){ await bot.sendMessage(cid,`\`${data.replace('copy_exp_','')}\``,{parse_mode:'Markdown'}); return; }
    if(data.startsWith('copy_cvv_')){ await bot.sendMessage(cid,`\`${data.replace('copy_cvv_','')}\``,{parse_mode:'Markdown'}); return; }
    
    // إعدادات اللغة
    if(data==='lang_ar'){ userLang.set(cid,'ar'); await bot.sendMessage(cid,'✅ تم تغيير اللغة إلى العربية'); await showMainMenu(cid); return; }
    if(data==='lang_en'){ userLang.set(cid,'en'); await bot.sendMessage(cid,'✅ Language changed to English'); await showMainMenu(cid); return; }
    
    // القوائم الرئيسية
    if(data==='main_menu'){ await showMainMenu(cid); return; }
    if(data==='menu_guess'){ userStates.set(cid,{step:'awaiting_bin',bins:[],defaultCount:null}); await bot.sendMessage(cid, dict.enter_bin, { parse_mode:'Markdown' }); return; }
    if(data==='menu_single'){ await bot.sendMessage(cid, dict.single_invalid, { parse_mode:'Markdown' }); return; }
    if(data==='menu_subscribe'){ await showSubscriptionMenu(cid); return; }
    if(data==='menu_my_campaigns'){ await showMyCampaigns(cid); return; }
    
    // التخمين والإعدادات
    if(data==='add_another_bin'){ const st=userStates.get(cid); if(st && st.step==='awaiting_decision'){ const sub=getSubscriber(cid), plans=getPlans(), maxC=plans[sub.plan].campaignsLimit; if(st.bins.length>=maxC){ await bot.sendMessage(cid, `⚠️ لقد وصلت إلى الحد الأقصى للحملات المتزامنة (${maxC}). قم بترقية خطتك.`, { reply_markup:{ inline_keyboard:[[{text:'🚀 تطوير اشتراكك',callback_data:'menu_subscribe'}]] } }); return; } st.step='awaiting_bin'; await bot.sendMessage(cid,'📌 أرسل الـ BIN التالي:'); } return; }
    if(data==='set_default_count'){ const st=userStates.get(cid); if(st && st.bins.length>0){ st.step='awaiting_default_count'; await bot.sendMessage(cid,'🔢 أدخل العدد الذي تريد تخمينه لكل حملة:'); } else await bot.sendMessage(cid,'⚠️ يرجى إدخال BIN أولاً.'); return; }
    if(data==='start_with_default' || data==='start_campaigns'){ const st=userStates.get(cid); if(st && st.bins.length>0 && st.defaultCount){ st.step='running'; await runMultipleCampaignsParallel(cid, st.bins, st.defaultCount); } else { await bot.sendMessage(cid,'⚠️ خطأ في الإدخال، يرجى البدء من جديد عبر القائمة.'); } return; }
    if(data==='cancel_all_campaigns'){ if(activeJobs.has(cid)){ activeJobs.get(cid).cancel=true; await bot.sendMessage(cid,'❌ تم إلغاء الحملات.'); } return; }
    if(data==='cancel_guess'){ userStates.delete(cid); await bot.sendMessage(cid, dict.cancel_msg); return; }
    if(data.startsWith('stop_camp_')){ const campId=parseFloat(data.split('_')[2]); updateCampaign(campId,null,null,'stopped'); await bot.sendMessage(cid, dict.campaign_stopped.replace('{id}',campId)); await showMyCampaigns(cid); return; }
    
    // الاشتراكات (النظام الجديد)
    if(data.startsWith('view_plan_')) { await showPlanDetails(cid, data.replace('view_plan_', '')); return; }
    if(data.startsWith('confirm_sub_')) { await handleConfirmSubscription(cid, data.replace('confirm_sub_', '')); return; }
    if(data.startsWith('verify_pay_')) { const pts=data.split('_'); await verifyBinancePayment(cid, pts[2], pts[3]); return; }
    if(data.startsWith('sub_')){ await showPlanDetails(cid, data.replace('sub_','')); return; } // لتوافق الإصدار القديم
    
    // لوحة الأدمن (النظام القديم المحذوف)
    if(data==='admin_panel'){ if(!adminSet.has(cid)) return; await showAdminPanel(cid); return; }
    if(data==='admin_edit_prices'){ if(!adminSet.has(cid)) return; userStates.set(cid,{step:'admin_edit_price'}); await bot.sendMessage(cid,'أرسل الخطة والسعر الجديد بالصيغة: plan=price\nمثال: plus=4'); return; }
    if(data==='admin_edit_speed'){ if(!adminSet.has(cid)) return; userStates.set(cid,{step:'admin_edit_speed'}); await bot.sendMessage(cid,'أرسل الخطة والسرعة الجديدة بالصيغة: plan=speed\nمثال: pro=80'); return; }
    if(data==='admin_add_plan'){ if(!adminSet.has(cid)) return; userStates.set(cid,{step:'admin_add_plan'}); await bot.sendMessage(cid,'أرسل تفاصيل الخطة: name_ar|name_en|price|cardsLimit|campaignsLimit|speed\nمثال: ماكس|MAX|10|500|10|100'); return; }
    if(data==='admin_grant'){ if(!adminSet.has(cid)) return; userStates.set(cid,{step:'admin_grant'}); await bot.sendMessage(cid,'أرسل: user_id plan\nمثال: 123456789 plus'); return; }
    if(data==='admin_remove'){ if(!adminSet.has(cid)) return; userStates.set(cid,{step:'admin_remove'}); await bot.sendMessage(cid,'أرسل معرف المستخدم'); return; }
    if(data==='admin_list'){ if(!adminSet.has(cid)) return; const subs=getAllSubscribers(); let msg='📋 قائمة الأعضاء:\n'; for(const [id,sub] of Object.entries(subs)) msg+=`🆔 ${id} | خطة: ${sub.plan} | ينتهي: ${sub.endDate}\n`; await bot.sendMessage(cid, msg); return; }
    
    // موافقة / رفض الدفع
    if(data.startsWith('approve_payment_') || data.startsWith('reject_payment_')){
        if(!adminSet.has(cid)) return;
        const parts=data.split('_'), action=parts[0], proofId=parseFloat(parts[2]), proof=getPaymentProof(proofId);
        if(proof){
            try { 
                await bot.unpinChatMessage(proof.userId, { message_id: proof.messageId });
                await bot.unpinChatMessage(cid, { message_id: proof.adminMsgId });
            } catch(e) {}
            if(action==='approve'){
                const end=new Date(); end.setMonth(end.getMonth()+1);
                updateSubscriber(proof.userId,{plan:proof.plan,startDate:new Date().toISOString(),endDate:end.toISOString()});
                updatePaymentProof(proofId,'approved');
                const ul = userLang.get(proof.userId)||'ar';
                await bot.sendMessage(proof.userId, translations[ul].payment_approved);
                await bot.sendMessage(cid, `✅ تمت الموافقة وتفعيل الاشتراك للمستخدم ${proof.userId}`);
            } else {
                updatePaymentProof(proofId,'rejected');
                const ul = userLang.get(proof.userId)||'ar';
                await bot.sendMessage(proof.userId, translations[ul].payment_rejected);
                await bot.sendMessage(cid, `❌ تم الرفض للمستخدم ${proof.userId}`);
            }
        }
        return;
    }
});

// ==========================================
// معالجة الرسائل النصية والصور (إرجاع كافة حالات الأدمن)
// ==========================================
bot.on('message', async (msg) => {
    const cid=msg.chat.id, text=msg.text, state=userStates.get(cid);
    if(text && text.startsWith('/')) return;
    const lang=userLang.get(cid)||'ar', dict=translations[lang];

    // استلام صورة التحويل بناءً على طلبك
    if(msg.photo && state && state.step === 'awaiting_payment_proof') {
        const adminId = adminSet.values().next().value; // إرسال لأول أدمن
        if(adminId) {
            const fileId = msg.photo[msg.photo.length-1].file_id;
            const adminMsg = await bot.sendPhoto(adminId, fileId, {
                caption: `📸 إثبات دفع جديد\nالمستخدم: ${cid}\nالخطة: ${state.plan}\nالكود: ${state.code}`,
                reply_markup: { inline_keyboard: [[{text:'✅ موافقة',callback_data:`dummy`}]] }
            });
            const proof = createPaymentProof(cid, state.plan, fileId, msg.message_id, adminMsg.message_id);
            await bot.editMessageReplyMarkup({ inline_keyboard: [[{text:'✅ موافقة',callback_data:`approve_payment_${proof.id}`},{text:'❌ رفض',callback_data:`reject_payment_${proof.id}`}]] }, { chat_id: adminId, message_id: adminMsg.message_id });
            
            // تثبيت الرسالة عند الطرفين كما طلبت
            try { await bot.pinChatMessage(cid, msg.message_id, { disable_notification: true }); } catch(e){}
            try { await bot.pinChatMessage(adminId, adminMsg.message_id, { disable_notification: true }); } catch(e){}
            
            await bot.sendMessage(cid, dict.payment_received);
            userStates.delete(cid);
        }
        return;
    }

    // انتظار BIN
    if(state && state.step==='awaiting_bin'){
        if(/^\d+$/.test(text)){
            let bin=text.slice(0,6); while(bin.length<6) bin+=Math.floor(Math.random()*10);
            state.currentBin=bin;
            if(state.defaultCount){
                state.bins.push(bin);
                await bot.sendMessage(cid, `✅ تم إضافة BIN: ${bin} بعدد فيزات ${state.defaultCount}\nالحملات الحالية: ${state.bins.length}`);
                const plans=getPlans(), subscriber=getSubscriber(cid), maxC=plans[subscriber.plan].campaignsLimit;
                let btns=[];
                if(state.bins.length>=maxC) btns=[[{text:'🚀 تطوير اشتراكك',callback_data:'menu_subscribe'}],[{text:'🎯 تعيين العدد الافتراضي',callback_data:'set_default_count'}],[{text:'🚀 بدء التخمين',callback_data:'start_with_default'}],[{text:'❌ إلغاء',callback_data:'cancel_guess'}]];
                else btns=[[{text:'➕ إرسال BIN آخر',callback_data:'add_another_bin'}],[{text:'🎯 تعيين العدد الافتراضي',callback_data:'set_default_count'}],[{text:'🚀 بدء التخمين',callback_data:'start_with_default'}],[{text:'❌ إلغاء',callback_data:'cancel_guess'}]];
                await bot.sendMessage(cid, 'ماذا تريد أن تفعل؟', { reply_markup:{ inline_keyboard:btns } });
                state.step='awaiting_decision';
            } else {
                state.step='awaiting_count';
                await bot.sendMessage(cid, `🔢 كم عدد الفيزات التي تريد تخمينها على BIN: ${bin}؟\n(الحد الأدنى 5، الحد الأقصى ${getSubscriber(cid).cardsLimit})`);
            }
        }
        return;
    }

    // انتظار العدد للحملة
    if(state && state.step==='awaiting_count'){
        const count=parseInt(text);
        if(isNaN(count)){ await bot.sendMessage(cid,'⚠️ يرجى إرسال رقم صحيح.'); return; }
        const subscriber=getSubscriber(cid), maxCards=subscriber.cardsLimit;
        if(!adminSet.has(cid) && (count<5 || count>maxCards)){
            await bot.sendMessage(cid, dict.count_out_of_range.replace('{max}',maxCards));
            await bot.sendMessage(cid, '⚠️ أنت في الخطة الحالية. قم بترقية خطتك.', { reply_markup:{ inline_keyboard:[[{text:'💎 عرض الاشتراكات',callback_data:'menu_subscribe'}]] } });
            state.step='awaiting_bin';
            return;
        }
        state.bins.push(state.currentBin);
        state.defaultCount=count;
        delete state.currentBin;
        await bot.sendMessage(cid, `✅ تم إضافة BIN: ${state.bins[state.bins.length-1]} بعدد فيزات ${count}\nالحملات الحالية: ${state.bins.length}\nالعدد الافتراضي أصبح ${count}.`);
        const plans=getPlans(), maxC=plans[subscriber.plan].campaignsLimit;
        let btns=[];
        if(state.bins.length>=maxC) btns=[[{text:'🚀 تطوير اشتراكك',callback_data:'menu_subscribe'}],[{text:'🚀 بدء التخمين',callback_data:'start_with_default'}],[{text:'❌ إلغاء',callback_data:'cancel_guess'}]];
        else btns=[[{text:'➕ إرسال BIN آخر',callback_data:'add_another_bin'}],[{text:'🎯 تعيين العدد الافتراضي',callback_data:'set_default_count'}],[{text:'🚀 بدء التخمين',callback_data:'start_with_default'}],[{text:'❌ إلغاء',callback_data:'cancel_guess'}]];
        await bot.sendMessage(cid, 'ماذا تريد أن تفعل؟', { reply_markup:{ inline_keyboard:btns } });
        state.step='awaiting_decision';
        return;
    }

    // انتظار تعيين العدد الافتراضي
    if(state && state.step==='awaiting_default_count'){
        const count=parseInt(text);
        if(isNaN(count)){ await bot.sendMessage(cid,'⚠️ يرجى إرسال رقم صحيح.'); return; }
        const subscriber=getSubscriber(cid), maxCards=subscriber.cardsLimit;
        if(!adminSet.has(cid) && (count<5 || count>maxCards)){
            await bot.sendMessage(cid, dict.count_out_of_range.replace('{max}',maxCards));
            return;
        }
        state.defaultCount=count;
        await bot.sendMessage(cid, `✅ تم تعيين العدد الافتراضي للحملات إلى ${count}.`);
        const plans=getPlans(), maxC=plans[subscriber.plan].campaignsLimit;
        let btns=[];
        if(state.bins.length>=maxC) btns=[[{text:'🚀 تطوير اشتراكك',callback_data:'menu_subscribe'}],[{text:'🚀 بدء التخمين',callback_data:'start_with_default'}],[{text:'❌ إلغاء',callback_data:'cancel_guess'}]];
        else btns=[[{text:'➕ إرسال BIN آخر',callback_data:'add_another_bin'}],[{text:'🎯 تعيين العدد الافتراضي',callback_data:'set_default_count'}],[{text:'🚀 بدء التخمين',callback_data:'start_with_default'}],[{text:'❌ إلغاء',callback_data:'cancel_guess'}]];
        await bot.sendMessage(cid, 'ماذا تريد أن تفعل؟', { reply_markup:{ inline_keyboard:btns } });
        state.step='awaiting_decision';
        return;
    }

    // إرجاع أوامر الأدمن المحذوفة
    if(state && state.step==='admin_edit_price'){
        const parts=text.split('=');
        if(parts.length!==2){ await bot.sendMessage(cid,'صيغة غير صحيحة'); return; }
        const planKey=parts[0].trim(), newPrice=parseFloat(parts[1]);
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
        const planKey=parts[0].trim(), newSpeed=parseInt(parts[1]);
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
        await bot.sendMessage(cid,`✅ تم إضافة خطة جديدة: ${nameAr}`);
        userStates.delete(cid); await showAdminPanel(cid);
        return;
    }
    if(state && state.step==='admin_grant'){
        const parts=text.split(' ');
        if(parts.length!==2){ await bot.sendMessage(cid,'صيغة غير صحيحة'); return; }
        const userId=parseInt(parts[0]), planKey=parts[1];
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
    if(text && text.includes('|')){
        await bot.sendMessage(cid, dict.single_checking);
        const result=await checkSingleCard(text,cid);
        if(result && result.isLive){
            const flag=getFlag(result.country);
            const cardType=getCardType(text.split('|')[0]);
            const liveText=dict.live_result.replace('{card}',text).replace('{type}',cardType).replace('{country}',result.country).replace('{flag}',flag);
            const btns=getCopyButtons(text,lang);
            await bot.sendMessage(cid, liveText, { parse_mode:'Markdown', ...btns });
        } else {
            await bot.sendMessage(cid, '❌ البطاقة ديك (DIE) أو خطأ في الفحص.');
        }
        return;
    }
});

// ==========================================
// الترجمات (تم إرجاع القاموس الكامل)
// ==========================================
const translations = {
    ar: {
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
        enter_bin: '📌 أرسل الـ BIN الخاص بك (أول 6 أرقام أو أكثر)\nمثال: `62581`\nيمكنك إرسال عدة BINs',
        count_out_of_range: '⚠️ العدد يجب أن يكون بين 5 و {max}.',
        cancel_msg: '❌ تم إلغاء العملية.',
        live_result: '✅ تعمل بنجاح ✅\n----------------------------------------\n\n💳    {card}\n\n📊 الحالة: تعمل ✅\n\n🏦 النوع: {type}\n\n🌍 البلد: {country} {flag}\n\n----------------------------------------\nبواسطة: @pe8bot',
        no_live_found: '😞 لم يتم العثور على أي بطاقة صالحة من أصل {total}.',
        new_campaign_btn: '🚀 بدأ حملة جديدة',
        summary: '📊 *الملخص النهائي*\n✅ الصالحة: {hit}\n🎯 المجموع: {total}',
        single_invalid: '📌 أرسل الفيزا كاملة بهذا التنسيق:\n`4111111111111111|01|2031|123`',
        single_checking: '⏳ جاري فحص البطاقة...',
        api_error: '⚠️ حدث خطأ أثناء الاتصال بالخدمة.',
        not_admin: '⛔ هذا الأمر للأدمن فقط.',
        subscription_plans: '💎 *خطط الاشتراك*\nاختر الخطة لمعرفة التفاصيل:',
        already_subscribed: '✅ أنت مشترك بالفعل في خطة {plan}.',
        upgrade_to_pro: '🚀 تطوير إلى Pro',
        upgrade_to_vip: '🚀 تطوير إلى VIP',
        upgrade_suggestion: 'يمكنك ترقية اشتراكك الآن:',
        payment_received: '📸 تم استلام الصورة وتثبيتها. سيتم مراجعتها قريباً من الإدارة.',
        payment_approved: '🎉 تم تفعيل اشتراكك بنجاح!',
        payment_rejected: '❌ تم رفض طلب الاشتراك، يرجى مراجعة الدعم.',
        campaigns_limit_reached: '⚠️ لقد وصلت للحد الأقصى للحملات المتزامنة ({limit}).',
        campaign_stopped: '🛑 تم إيقاف الحملة {id}.',
        no_active_campaigns: '⚠️ لا توجد حملات نشطة.',
        active_campaigns: '📋 *حملاي النشطة*\n'
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
        live_result: '✅ LIVE ✅\n----------------------------------------\n\n💳    {card}\n\n📊 Status: LIVE ✅\n\n🏦 Type: {type}\n\n🌍 Country: {country} {flag}\n\n----------------------------------------\nBy: @pe8bot',
        no_live_found: '😞 No live cards found out of {total}.',
        new_campaign_btn: '🚀 Start new campaign',
        summary: '📊 *Final Summary*\n✅ Live: {hit}\n🎯 Total: {total}',
        single_invalid: '📌 Send the full card in this format:\n`4111111111111111|01|2031|123`',
        single_checking: '⏳ Checking card...',
        api_error: '⚠️ API error. Please try again later.',
        not_admin: '⛔ This command is for admins only.',
        subscription_plans: '💎 *Subscription Plans*\nChoose your plan to see details:',
        already_subscribed: '✅ You are already subscribed to {plan} plan.',
        upgrade_to_pro: '🚀 Upgrade to Pro',
        upgrade_to_vip: '🚀 Upgrade to VIP',
        upgrade_suggestion: 'You can upgrade your subscription now:',
        payment_received: '📸 Payment proof received and pinned. It will be reviewed soon.',
        payment_approved: '🎉 Your subscription has been activated!',
        payment_rejected: '❌ Subscription request rejected, contact support.',
        campaigns_limit_reached: '⚠️ You have reached the maximum concurrent campaigns ({limit}).',
        campaign_stopped: '🛑 Campaign {id} stopped.',
        no_active_campaigns: '⚠️ No active campaigns.',
        active_campaigns: '📋 *Your active campaigns*\n'
    }
};
