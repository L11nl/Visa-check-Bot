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

const bot = new TelegramBot(TOKEN, { 
    polling: {
        interval: 300,
        autoStart: true,
        params: { timeout: 10 }
    } 
});

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
            free: { nameAr: 'مجاني', nameEn: 'Free', price: 0, cardsLimit: 40, campaignsLimit: 2, speed: 5, desc: "الخطة الأساسية لتجربة البوت." },
            plus: { nameAr: 'Plus', nameEn: 'Plus', price: 3, cardsLimit: 500, campaignsLimit: 4, speed: 30, desc: "خطة اقتصادية للمستخدم المتوسط مع سرعة جيدة." },
            pro: { nameAr: 'Pro', nameEn: 'Pro', price: 5, cardsLimit: 1500, campaignsLimit: 6, speed: 60, desc: "خطة المحترفين، سرعة عالية وحدود كبيرة." },
            vip: { nameAr: 'VIP', nameEn: 'VIP', price: 8, cardsLimit: 3000, campaignsLimit: 10, speed: 100, desc: "الخطة الأقوى، سرعة قصوى وأعلى حدود ممكنة." }
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
            timeout:20000, httpAgent: httpAgent, httpsAgent: httpsAgent
        }); 
        const d=r.data; 
        if(!d) return { isLive: false };
        const live=(d.code===1 || (d.status && d.status.toLowerCase().includes('live'))); 
        if(!live && !isSilent) return null; 
        return { isLive:live, status:d.status||'غير معروف', message:(d.message||'').replace(/احذفها/gi,'').trim(), type:(d.card&&d.card.type)||getCardType(cardString.split('|')[0]), country:(d.card&&d.card.country&&d.card.country.name)||'غير معروف' }; 
    } catch(e){ 
        if(retries>0){ await new Promise(res => setTimeout(res, 2000)); return checkSingleCard(cardString,chatId,isSilent,retries-1); } 
        return { isLive: false }; 
    } 
}

function getCopyButtons(fullCard, lang) { const [num,month,year,cvv]=fullCard.split('|'); const d=translations[lang]; return { reply_markup:{ inline_keyboard:[[{text:d.btn_copy_full,callback_data:`copy_full_${fullCard}`}],[{text:d.btn_copy_num,callback_data:`copy_num_${num}`}],[{text:d.btn_copy_exp,callback_data:`copy_exp_${month}|${year}`}],[{text:d.btn_copy_cvv,callback_data:`copy_cvv_${cvv}`}]] } }; }
function formatProgressBar(percent, width=10) { const filled=Math.round(percent/100*width); return '▰'.repeat(filled)+'▱'.repeat(width-filled); }
function buildProgressText(campaignsData, speedPercent) { let txt=`🔄 جاري إنشاء الفيزا\nالسرعة: ${speedPercent}%\n`; for(const d of campaignsData){ const pct=d.total>0?(d.current/d.total*100):0; const bar=formatProgressBar(pct); const rem=d.total-d.current; txt+=`\nالمنفذ: ${d.bin}\n${bar} ${pct.toFixed(1)}%\nالعد التنازلي: ${rem} متبقية\n`; } txt+='\n━━━━━━━━━━━━━━'; return txt; }

// ==========================================
// منطق الاشتراك الجديد
// ==========================================
async function showPlanDetails(chatId, planKey) {
    const lang = userLang.get(chatId) || 'ar';
    const dict = translations[lang];
    const plans = getPlans();
    const p = plans[planKey];
    if (!p) return;

    const text = `💎 *${p[`name${lang==='ar'?'Ar':'En'}`]}*\n\n` +
                 `📝 ${p.desc}\n\n` +
                 `💰 السعر: ${p.price} USDT\n` +
                 `💳 حد البطاقات: ${p.cardsLimit}\n` +
                 `🚀 السرعة: ${p.speed}%\n` +
                 `📊 حد الحملات: ${p.campaignsLimit}`;

    const kb = { inline_keyboard: [[
        { text: dict.cancel_btn, callback_data: 'menu_subscribe' },
        { text: '✅ اشتراك', callback_data: `confirm_sub_${planKey}` }
    ]] };

    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: kb });
}

async function handleConfirmSubscription(chatId, planKey) {
    const lang = userLang.get(chatId) || 'ar';
    const dict = translations[lang];
    const plans = getPlans();
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
    // محاكاة التحقق عبر API بايننس (في الواقع يتطلب API Key وطلب HTTP)
    const isSuccess = false; // نجعلها false دائماً لطلب الصورة كما في طلبك

    if (isSuccess) {
        const end = new Date(); end.setMonth(end.getMonth() + 1);
        updateSubscriber(chatId, { plan: planKey, startDate: new Date().toISOString(), endDate: end.toISOString() });
        await bot.sendMessage(chatId, `✅ تم التحقق بنجاح وتفعيل عضوية ${planKey}!`);
    } else {
        await bot.sendMessage(chatId, `❌ لم يتم العثور على الدفعة تلقائياً.\n\nتم الرفض، يرجى إرسال صورة التحويل ليتم تفعيلها يدوياً.`);
        userStates.set(chatId, { step: 'awaiting_payment_proof', plan: planKey, code: code });
    }
}

// ==========================================
// تشغيل الحملات
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
        await bot.sendMessage(chatId, '⚠️ هناك حملات جارية حالياً.');
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
        try { await bot.editMessageText(newText, { chat_id: chatId, message_id: progressMsg.message_id, reply_markup: { inline_keyboard: [[{ text: '❌ إلغاء الحملات', callback_data: 'cancel_all_campaigns' }]] } }); } catch(e) {}
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
                        const liveText = dict.live_result.replace('{card}', batch[j]).replace('{type}', getCardType(batch[j].split('|')[0])).replace('{country}', res.country).replace('{flag}', flag);
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
    try { await bot.deleteMessage(chatId, progressMsg.message_id); } catch(e) {}
    activeJobs.delete(chatId);
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

bot.on('callback_query', async (query) => {
    const cid=query.message.chat.id, data=query.data, lang=userLang.get(cid)||'ar', dict=translations[lang];
    await bot.answerCallbackQuery(query.id).catch(() => {});
    
    if(data.startsWith('view_plan_')) { await showPlanDetails(cid, data.replace('view_plan_', '')); return; }
    if(data.startsWith('confirm_sub_')) { await handleConfirmSubscription(cid, data.replace('confirm_sub_', '')); return; }
    if(data.startsWith('verify_pay_')) { const pts=data.split('_'); await verifyBinancePayment(cid, pts[2], pts[3]); return; }
    if(data==='main_menu'){ await showMainMenu(cid); return; }
    if(data==='menu_guess'){ userStates.set(cid,{step:'awaiting_bin',bins:[],defaultCount:null}); await bot.sendMessage(cid, dict.enter_bin, { parse_mode:'Markdown' }); return; }
    if(data==='menu_subscribe'){ await showSubscriptionMenu(cid); return; }
    if(data==='menu_my_campaigns'){ 
        const camps=getUserActiveCampaigns(cid);
        if(camps.length===0){ await bot.sendMessage(cid, dict.no_active_campaigns); return; }
        let txt=dict.active_campaigns; const btns=[];
        for(const c of camps){ txt+=`\n📌 BIN: ${c.bin} | ${c.current}/${c.total}`; btns.push([{text:`إيقاف ${c.id}`,callback_data:`stop_camp_${c.id}`}]); }
        await bot.sendMessage(cid, txt, { reply_markup: { inline_keyboard: btns } });
        return; 
    }
    if(data.startsWith('approve_payment_') || data.startsWith('reject_payment_')){
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
                await bot.sendMessage(proof.userId, translations[userLang.get(proof.userId)||'ar'].payment_approved);
                await bot.sendMessage(cid, `✅ تمت الموافقة لـ ${proof.userId}`);
            } else {
                updatePaymentProof(proofId,'rejected');
                await bot.sendMessage(proof.userId, translations[userLang.get(proof.userId)||'ar'].payment_rejected);
                await bot.sendMessage(cid, `❌ تم الرفض لـ ${proof.userId}`);
            }
        }
        return;
    }
    if(data==='start_with_default'){ const st=userStates.get(cid); if(st && st.bins.length>0) await runMultipleCampaignsParallel(cid, st.bins, st.defaultCount); return; }
    if(data==='add_another_bin'){ userStates.get(cid).step='awaiting_bin'; await bot.sendMessage(cid,'📌 أرسل BIN آخر:'); return; }
    if(data==='cancel_all_campaigns'){ if(activeJobs.has(cid)) activeJobs.get(cid).cancel=true; return; }
});

bot.on('message', async (msg) => {
    const cid=msg.chat.id, text=msg.text, state=userStates.get(cid);
    if(text === '/start') { await bot.sendMessage(cid, 'Choose language:', { reply_markup:{ inline_keyboard:[[{text:'العربية',callback_data:'lang_ar'},{text:'English',callback_data:'lang_en'}]] } }); return; }
    if(text === '/menu') { await showMainMenu(cid); return; }

    if(msg.photo && state && state.step === 'awaiting_payment_proof') {
        const adminMsg = await bot.sendPhoto(adminSet.values().next().value, msg.photo[msg.photo.length-1].file_id, {
            caption: `📸 إثبات دفع جديد\nالمستخدم: ${cid}\nالخطة: ${state.plan}\nالكود: ${state.code}`,
            reply_markup: { inline_keyboard: [[{text:'✅ موافقة',callback_data:`approve_payment_${cid}_${Date.now()}`},{text:'❌ رفض',callback_data:`reject_payment_${cid}_${Date.now()}`}]] }
        });
        const proof = createPaymentProof(cid, state.plan, msg.photo[msg.photo.length-1].file_id, msg.message_id, adminMsg.message_id);
        // تحديث callback_data بالـ proof.id الحقيقي
        await bot.editMessageReplyMarkup({ inline_keyboard: [[{text:'✅ موافقة',callback_data:`approve_payment_${proof.id}`},{text:'❌ رفض',callback_data:`reject_payment_${proof.id}`}]] }, { chat_id: adminMsg.chat.id, message_id: adminMsg.message_id });
        
        await bot.pinChatMessage(cid, msg.message_id);
        await bot.pinChatMessage(adminMsg.chat.id, adminMsg.message_id);
        await bot.sendMessage(cid, translations[userLang.get(cid)||'ar'].payment_received);
        userStates.delete(cid);
        return;
    }

    if(state && state.step==='awaiting_bin'){
        if(/^\d{5,16}/.test(text)){
            state.currentBin=text.slice(0,6);
            if(state.defaultCount){
                state.bins.push(state.currentBin);
                await bot.sendMessage(cid, `✅ أضيف BIN: ${state.currentBin}`, { reply_markup: { inline_keyboard: [[{text:'🚀 بدء',callback_data:'start_with_default'}],[{text:'➕ BIN آخر',callback_data:'add_another_bin'}]] } });
                state.step='awaiting_decision';
            } else {
                state.step='awaiting_count';
                await bot.sendMessage(cid, `🔢 كم عدد الفيزات لـ ${state.currentBin}؟`);
            }
        }
        return;
    }
    if(state && state.step==='awaiting_count'){
        const count=parseInt(text);
        if(!isNaN(count) && count >= 5){
            state.bins.push(state.currentBin); state.defaultCount=count; state.step='awaiting_decision';
            await bot.sendMessage(cid, `✅ تم الإعداد.`, { reply_markup: { inline_keyboard: [[{text:'🚀 بدء',callback_data:'start_with_default'}],[{text:'➕ BIN آخر',callback_data:'add_another_bin'}]] } });
        }
        return;
    }
    if(text && text.includes('|')){
        await bot.sendMessage(cid, translations[userLang.get(cid)||'ar'].single_checking);
        const res=await checkSingleCard(text,cid);
        if(res && res.isLive){
            const flag=getFlag(res.country);
            await bot.sendMessage(cid, translations[userLang.get(cid)||'ar'].live_result.replace('{card}',text).replace('{type}',getCardType(text)).replace('{country}',res.country).replace('{flag}',flag), { parse_mode:'Markdown', ...getCopyButtons(text,userLang.get(cid)||'ar') });
        } else await bot.sendMessage(cid, '❌ البطاقة DIE.');
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
        enter_bin: '📌 أرسل الـ BIN:',
        live_result: '✅ تعمل بنجاح ✅\n\n💳 {card}\n📊 الحالة: LIVE\n🏦 النوع: {type}\n🌍 البلد: {country} {flag}',
        single_checking: '⏳ جاري الفحص...',
        subscription_plans: '💎 *خطط الاشتراك*:',
        payment_received: '📸 تم استلام الإثبات وتثبيته، سيتم الرد قريباً.',
        payment_approved: '🎉 تم تفعيل العضوية بنجاح!',
        payment_rejected: '❌ تم رفض الإثبات.',
        no_active_campaigns: '⚠️ لا توجد حملات جارية.',
        active_campaigns: '📋 حملاتك الجارية:',
        count_out_of_range: '⚠️ الحد الأقصى هو {max}.',
        campaigns_limit_reached: '⚠️ وصلت للحد الأقصى.'
    },
    en: {
        main_menu: '✨ *Main Menu* ✨',
        btn_guess: '🎲 Guess Cards',
        btn_single: '🔍 Check Single',
        btn_subscribe: '💎 Subscription',
        btn_my_campaigns: '📋 Active Campaigns',
        cancel_btn: '❌ Cancel',
        btn_copy_full: '📋 Copy All',
        enter_bin: '📌 Send BIN:',
        live_result: '✅ LIVE ✅\n\n💳 {card}\n📊 Status: LIVE\n🏦 Type: {type}\n🌍 Country: {country} {flag}',
        single_checking: '⏳ Checking...',
        subscription_plans: '💎 *Subscription Plans*:',
        payment_received: '📸 Proof received and pinned, review pending.',
        payment_approved: '🎉 Membership activated!',
        payment_rejected: '❌ Proof rejected.',
        no_active_campaigns: '⚠️ No active campaigns.',
        active_campaigns: '📋 Your Campaigns:',
        count_out_of_range: '⚠️ Max limit is {max}.',
        campaigns_limit_reached: '⚠️ Limit reached.'
    }
};
