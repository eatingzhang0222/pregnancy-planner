'use strict';
/* 综合记录：一句话 → 识别成「饮食 / 日程」动作 → 确认后写入对应位置。
   配置了 AI 时优先用 AI 理解；没配置或失败时用本地规则。 */

/* ========== 本地规则：日期 / 时间 ========== */
const CN_DIGIT = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const DOW = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };
function cnToNum(s) {
  if (/^\d+$/.test(s)) return Number(s);
  if (s.length === 1) return CN_DIGIT[s] ?? NaN;
  if (s[0] === '十') return 10 + (CN_DIGIT[s[1]] || 0);          // 十二
  if (s[1] === '十') return CN_DIGIT[s[0]] * 10 + (CN_DIGIT[s[2]] || 0); // 二十
  return NaN;
}
function parseDateText(s) {
  const base = today();
  const rel = [['大后天', 3], ['前天', -2], ['昨天', -1], ['昨晚', -1], ['后天', 2], ['明天', 1], ['明早', 1], ['明晚', 1]];
  for (const [w, n] of rel) if (s.includes(w)) return addDays(base, n);
  const md = s.match(/(\d{1,2})\s*[月/.-]\s*(\d{1,2})\s*[日号]?/);
  if (md) {
    const now = parseYmd(base);
    let y = now.getFullYear();
    const m = Number(md[1]);
    if (m < now.getMonth() + 1 - 6) y += 1; // 跨年：比当前早半年以上视为明年
    return ymd(new Date(y, m - 1, Number(md[2])));
  }
  const wk = s.match(/(下+)?(?:周|星期|礼拜)([一二三四五六日天])/);
  if (wk) {
    const cur = parseYmd(base).getDay() || 7;
    const monday = addDays(base, 1 - cur);
    const target = DOW[wk[2]] || 7;
    return addDays(monday, target - 1 + 7 * (wk[1] ? wk[1].length : 0));
  }
  return base;
}
function parseTimeText(s) {
  const hhmm = s.match(/(\d{1,2})[:：](\d{2})/);
  let h, m = 0;
  if (hhmm) { h = Number(hhmm[1]); m = Number(hhmm[2]); }
  else {
    const t = s.match(/(\d{1,2}|[一二两三四五六七八九十]{1,3})\s*[点时](半|一刻|(\d{1,2}|[一二三四五]十?[一二三四五六七八九]?)\s*分?)?/);
    if (!t) return null;
    h = cnToNum(t[1]);
    if (t[2] === '半') m = 30; else if (t[2] === '一刻') m = 15; else if (t[3]) m = cnToNum(t[3]) || 0;
  }
  if (Number.isNaN(h)) return null;
  if (/下午|傍晚|晚上|今晚|明晚|昨晚|夜里/.test(s) && h < 12) h += 12;
  else if (/中午/.test(s) && h < 5) h += 12;
  return Math.min(23 * 60 + 45, h * 60 + m);
}

/* ========== 本地规则：分类 ========== */
const ACT_KEYWORDS = [
  [/产检|检查|B超|彩超|胎心|监护|医院|门诊|糖耐|抽血|复诊/, 'checkup'],
  [/会阴按摩|按摩/, 'massage'],
  [/月子|课|学习|讲座|上课/, 'class'],
];
// 餐次同义词 → 营养计划里第几餐（早餐、点心1、午餐、点心2、晚餐、点心3）
const MEAL_WORDS = [
  [/早餐|早饭|早上吃|早点/, 0], [/点心1|上午加餐|上午点心/, 1], [/午餐|午饭|中午/, 2],
  [/点心2|下午加餐|下午点心|下午茶/, 3], [/晚餐|晚饭/, 4], [/点心3|睡前|宵夜|夜宵/, 5],
];
function guessMealId(text) {
  const meals = S.settings.meals;
  const byName = meals.find((m) => text.includes(m.name));
  if (byName) return byName.id;
  const hit = MEAL_WORDS.find(([re]) => re.test(text));
  if (hit && meals[hit[1]]) return meals[hit[1]].id;
  if (/晚上/.test(text) && meals[4]) return meals[4].id;
  const nm = nowMin();
  const past = meals.filter((m) => toMin(m.time) <= nm + 30);
  return (past[past.length - 1] || meals[0]).id;
}
function localActivity(clause) {
  const kw = ACT_KEYWORDS.find(([re]) => re.test(clause));
  const typeId = kw ? kw[1] : (S.types.find((t) => clause.includes(t.name))?.id || '');
  const t = typeOf(typeId);
  const dm = clause.match(/(\d+(?:\.\d+)?)\s*(分钟|小时|h)/);
  const dur = dm ? Math.round(Number(dm[1]) * (dm[2] === '分钟' ? 1 : 60)) : (/提醒|记得|别忘/.test(clause) ? 15 : t.dur);
  const done = /做了|做完|完成|已经|搞定|打卡/.test(clause);
  const start = parseTimeText(clause);
  const title = S.types.some((x) => x.id === typeId) ? t.name
    : clause.replace(/(今天|明天|后天|昨天|下?周.|星期.|\d+月\d+[日号]?|[上下中]午|晚上|早上|\d+[点:：]\d*半?分?|要|去|有|提醒我?|记得|别忘了?)/g, '').trim().slice(0, 20) || '待办';
  return { kind: 'act', on: true, date: parseDateText(clause), start: start ?? (done ? nowMin() : 9 * 60), dur, type: typeId, title, note: clause, done, noTime: start == null };
}
function localFood(clause) {
  const body = clause
    .replace(/(今天|昨天|前天|今早|今晚|昨晚)/g, '')
    .replace(new RegExp(S.settings.meals.map((m) => m.name).join('|'), 'g'), '')
    .replace(/早餐|早饭|午餐|午饭|晚餐|晚饭|中午|晚上|早上|上午|下午|加餐|下午茶|睡前|宵夜|夜宵|点心\d?/g, '')
    .replace(/吃了|喝了|吃的|喝的|吃|喝|了|有|还/g, ' ');
  const items = body.split(/[,，、;；+＋\s]|和|跟|加/).map((x) => x.trim()).filter(Boolean).map(parsePiece).filter(Boolean);
  return { kind: 'food', on: true, date: parseDateText(clause), meal: guessMealId(clause), items };
}
function isFoodClause(c) {
  if (/吃|喝|餐|饭|点心|加餐|宵夜|\d+\s*(g|克|ml|毫升)/i.test(c)) return true;
  return c.split(/[,，、\s]/).some((p) => findFood(p.replace(/\d.*$/, '')));
}
function localMed(clause) {
  const m = (S.meds || []).find((x) => x.name && clause.includes(x.name));
  if (!m) return null;
  const date = parseDateText(clause);
  const log = (S.medLog || {})[date] || {};
  const slot = m.slots.find((x) => x && clause.includes(x)) ?? m.slots.find((x) => !log[medKey(m, x)]) ?? m.slots[0];
  return { kind: 'med', on: true, date, med: m.id, slot };
}
function localParse(text) {
  const clauses = text.split(/[。；;！!\n]+/).map((x) => x.trim()).filter(Boolean);
  return clauses.map((c) => {
    const med = /吃了|吃过|已吃|打卡|服了|吃完/.test(c) && localMed(c);
    if (med) return med;
    if (/提醒|记得|别忘/.test(c)) return localActivity(c);
    const actHit = ACT_KEYWORDS.some(([re]) => re.test(c)) || S.types.some((t) => c.includes(t.name));
    if (actHit && !/吃了|喝了/.test(c)) return localActivity(c);
    if (isFoodClause(c)) return localFood(c);
    return parseTimeText(c) != null ? localActivity(c) : localFood(c);
  });
}

/* ========== 动作格式（AI 输出 → 统一结构） ========== */
const ACTION_SCHEMA = '{"actions":['
  + '{"kind":"food","date":"YYYY-MM-DD","meal":"餐次id","items":[{"name":"食物","grams":数字,"per100":[热量kcal,蛋白质g,脂肪g,碳水g,钙mg,铁mg,纤维g]}]},'
  + '{"kind":"act","date":"YYYY-MM-DD","start":"HH:MM 或空","dur":分钟,"type":"类型id或空","title":"标题","note":"备注","done":是否已完成},'
  + '{"kind":"med","date":"YYYY-MM-DD","med":"药物id","slot":"时段，没有时段填空字符串"}]}'
  + '。饮食克数要估算，per100 按《中国食物成分表》每100g；混合菜拆成主要食材含油。';
function normalizeActions(arr, text) {
  const validDate = (x) => (/^\d{4}-\d{2}-\d{2}$/.test(x || '') ? x : today());
  return (Array.isArray(arr) ? arr : []).map((a) => {
    if (!a || typeof a !== 'object') return null;
    if (a.kind === 'med') {
      const m = (S.meds || []).find((x) => x.id === a.med || x.name === a.med);
      if (!m) return null;
      return { kind: 'med', on: true, date: validDate(a.date), med: m.id, slot: m.slots.includes(a.slot) ? a.slot : m.slots[0] };
    }
    if (a.kind === 'food') {
      const meal = S.settings.meals.some((x) => x.id === a.meal) ? a.meal : guessMealId(text);
      const items = (a.items || []).filter((x) => x && x.name).map((x) => {
        const name = String(x.name).slice(0, 30);
        const local = allFoods().find((f) => f.n === name || (f.a || []).includes(name)); // 库里有就用库里的数，保持一致
        const v = local ? local.v : (Array.isArray(x.per100) ? NK.map((_, i) => Math.max(0, Number(x.per100[i]) || 0)) : null);
        return { id: uid(), name: local ? local.n : name, g: Math.max(1, Math.round(Number(x.grams) || 100)), v };
      });
      return items.length ? { kind: 'food', on: true, date: validDate(a.date), meal, items } : null;
    }
    if (a.kind !== 'act') return null;
    const typeId = S.types.some((t) => t.id === a.type) ? a.type : '';
    const start = /^\d{1,2}:\d{2}$/.test(a.start || '') ? toMin(a.start) : null;
    return {
      kind: 'act', on: true, date: validDate(a.date), start: start ?? (a.done ? nowMin() : 9 * 60), noTime: start == null,
      dur: Math.max(5, Number(a.dur) || typeOf(typeId).dur), type: typeId,
      title: String(a.title || typeOf(typeId).name).slice(0, 30), note: String(a.note || ''), done: !!a.done,
    };
  }).filter(Boolean);
}

/* ========== 对话 ========== */
const CHAT_KEY = 'pp_chat';
const CHAT_SYS = '你是孕晚期准妈妈的贴心助手兼记录员，说中文，简洁、具体、像朋友。'
  + '症状、用药等医疗问题给常识建议并提醒以医生为准；遇到危险信号（阴道出血量多、破水、规律宫缩、胎动明显减少、剧烈头痛或视物模糊等）要明确建议立即就医。'
  + '用户提到吃了什么、要安排或完成了什么事、吃了药，或发来食物、预约单、化验单图片时：先正常简短回复，再在最后另起一行附加 ```json 代码块，内容为 '
  + ACTION_SCHEMA + '没有要记录的内容就不要附加代码块。';
function loadMsgs() {
  try { return JSON.parse(localStorage.getItem(CHAT_KEY) || '[]'); } catch (e) { return []; }
}
function saveMsgs() {
  try {
    const keep = ui.msgs.filter((m) => !m.pending).slice(-40).map(({ img, ...m }) => ({ ...m, hadImg: m.hadImg || !!img }));
    localStorage.setItem(CHAT_KEY, JSON.stringify(keep));
  } catch (e) { /* 存不下就只保留在本次打开期间 */ }
}
ui.msgs = loadMsgs();
ui.web = false;
ui.attach = null;

function chatContext() {
  const d = today(), g = gaInfo(d), T = S.settings.targets, tot = dayTotals(d), m = mealsOf(d);
  const log = (S.medLog || {})[d] || {};
  const upcoming = [];
  for (let i = 0; i < 7; i += 1) {
    const day = addDays(d, i);
    dayActs(day).forEach((a) => upcoming.push(`${day.slice(5)} ${hm(a.start)} ${a.title}${a.done ? '(已完成)' : ''}`));
  }
  return `今天 ${d} 周${WEEK[parseYmd(d).getDay()]}，现在 ${hm(nowMin())}。`
    + (g ? `孕 ${g.w} 周+${g.d} 天，预产期 ${S.settings.due}。` : '')
    + (S.settings.gdm ? '有妊娠期糖尿病(GDM)，饮食需控糖。' : '')
    + `\n餐次：${S.settings.meals.map((x) => `${x.id}=${x.name}(${x.time})`).join('，')}`
    + `\n活动类型：${S.types.map((t) => `${t.id}=${t.name}`).join('，')}`
    + `\n药物：${(S.meds || []).map((x) => `${x.id}=${x.name}[时段:${x.slots.join('/') || '无'}${medDue(x, d) ? '' : '，今天不用吃'}；今天已吃:${x.slots.filter((s) => log[medKey(x, s)]).join('/') || '无'}]`).join('；')}`
    + `\n今日已吃：${S.settings.meals.map((x) => `${x.name}:${(m[x.id] || []).map((i) => `${i.name}${i.g}g`).join('、') || '无'}`).join('；')}`
    + `\n今日摄入/目标：${NUTRIENTS.map((n) => `${n.label}${round(tot[n.k])}/${T[n.k]}${n.unit}`).join('，')}`
    + `\n未来 7 天日程：${upcoming.join('；') || '无'}`
    + (notesList().length ? `\n医嘱要点：${notesList().join('；')}` : '');
}
function summarizeAction(a) {
  if (a.kind === 'food') return `🍽 ${a.date.slice(5)} ${S.settings.meals.find((x) => x.id === a.meal)?.name || ''}：${a.items.map((i) => `${i.name}${i.g}g${i.v ? '' : '(无营养数据)'}`).join('、')}`;
  if (a.kind === 'med') { const m = (S.meds || []).find((x) => x.id === a.med); return `💊 ${a.date.slice(5)} ${m?.name || ''}${a.slot ? `（${a.slot}）` : ''} 已吃`; }
  return `📅 ${dateLabel(a.date)} ${hm(a.start)} ${a.title}${a.done ? ' · 已完成' : ''}`;
}
function mdLite(text) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>')
    .replace(/\n/g, '<br>');
}
function renderChatLog() {
  const log = $('#chat-log'); if (!log) return;
  const welcome = `<div class="bubble ai">${hasAI()
    ? '想记什么、问什么都可以直接说，也可以发食物或单据的照片。要记录的内容我会列出来，你点「记下」就会存到对应的地方。'
    : '我现在没连 AI，只能帮你记录：吃了什么（写克数或份数）、日程安排、吃药打卡。<br>到「设置 → AI 识别」配置接口后，就能自由聊天、看图片、联网查询。'}</div>`;
  log.innerHTML = welcome + ui.msgs.map((m, i) => {
    if (m.role === 'user') {
      return `<div class="bubble me">${m.img ? `<img src="${m.img}" alt="">` : m.hadImg ? '<div class="muted-in">[图片]</div>' : ''}${mdLite(m.text || '')}</div>`;
    }
    if (m.pending) return '<div class="bubble ai"><span class="typing"><i></i><i></i><i></i></span></div>';
    const acts = m.actions && m.actions.length ? `<div class="act-box">${m.actions.map((a) => `<div>${esc(summarizeAction(a))}</div>`).join('')}
      ${m.applied ? '<div class="applied">已记下 ✓</div>' : `<div class="row" style="margin-top:8px"><button class="btn sm" data-act="chat-apply-msg" data-i="${i}">记下</button>
        <button class="btn sm ghost" data-act="chat-edit-msg" data-i="${i}">修改</button></div>`}</div>` : '';
    return `<div class="bubble ai">${m.web ? '<span class="web-tag">🌐 联网</span>' : ''}${mdLite(m.text || '')}${acts}</div>`;
  }).join('');
  log.scrollTop = log.scrollHeight;
  $('#chat-web').classList.toggle('on', ui.web);
  $('#chat-attach').innerHTML = ui.attach ? `<div class="thumb"><img src="${ui.attach}" alt=""><button data-act="chat-unattach" aria-label="移除图片">×</button></div>` : '';
}
function openChat() {
  closeSheet();
  $('#chat').classList.add('on');
  document.body.classList.add('chat-open');
  renderChatLog();
}
function closeChat() {
  $('#chat').classList.remove('on');
  document.body.classList.remove('chat-open');
}
function buildMessages() {
  const hist = ui.msgs.filter((m) => !m.pending).slice(-13, -1).map((m) => ({
    role: m.role,
    content: m.role === 'user'
      ? `${m.img || m.hadImg ? '[附了一张图片] ' : ''}${m.text || ''}`
      : `${m.text || ''}${m.actions?.length ? `\n（列出的记录：${m.actions.map(summarizeAction).join('；')}${m.applied ? '，已记下' : '，未确认'}）` : ''}`,
  }));
  const cur = ui.msgs.filter((m) => m.role === 'user').slice(-1)[0];
  const curContent = cur.img
    ? [{ type: 'text', text: cur.text || '看看这张图，需要记录的帮我列出来' }, { type: 'image_url', image_url: { url: cur.img } }]
    : cur.text;
  return [{ role: 'system', content: `${CHAT_SYS}\n\n【用户当前情况】\n${chatContext()}` }, ...hist, { role: 'user', content: curContent }];
}
function splitReply(out) {
  const block = out.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  let actions = [];
  if (block) { try { actions = JSON.parse(block[1]).actions || []; } catch (e) { actions = []; } }
  return { text: (block ? out.replace(block[0], '') : out).trim(), actions };
}
async function chatSend() {
  const box = $('#chat-in');
  const text = box.value.trim(), img = ui.attach;
  if (!text && !img) return;
  ui.msgs = [...ui.msgs, { role: 'user', text, img }];
  box.value = ''; box.style.height = ''; ui.attach = null;
  if (!hasAI()) {
    const actions = img ? [] : localParse(text).filter((a) => a.kind !== 'food' || a.items.length);
    const reply = img ? '看图片需要先到「设置 → AI 识别」配置接口。'
      : actions.length ? '我识别到这些，确认没问题就点「记下」：' : '没太听懂。我现在只能帮你记吃的（写克数或份数）、日程和吃药；配置 AI 后可以自由聊天。';
    ui.msgs = [...ui.msgs, { role: 'assistant', text: reply, actions }];
    saveMsgs(); renderChatLog(); return;
  }
  const web = ui.web;
  ui.msgs = [...ui.msgs, { role: 'assistant', pending: true }];
  renderChatLog();
  let msg;
  try {
    let extra = {};
    if (web && S.settings.ai.searchExtra) { try { extra = JSON.parse(S.settings.ai.searchExtra); } catch (e) { throw new Error('联网附加参数不是合法 JSON'); } }
    const out = await callLLM(buildMessages(), web ? { model: S.settings.ai.searchModel || undefined, extra, noTemp: true } : {});
    const { text: t, actions } = splitReply(out);
    msg = { role: 'assistant', text: t || '好的', actions: normalizeActions(actions, text), web };
  } catch (e) {
    msg = { role: 'assistant', text: `出错了：${e.message}。检查一下设置里的接口、Key 和模型${web ? '（以及联网模型）' : ''}。` };
  }
  ui.msgs = [...ui.msgs.filter((m) => !m.pending), msg];
  saveMsgs(); renderChatLog();
}
function chatAttach(file) {
  if (!file) return;
  if (!hasAI()) { toast('看图片需要先在设置里配置 AI 接口'); return; }
  compressImage(file).then((url) => { ui.attach = url; renderChatLog(); }).catch((e) => toast(e.message));
}

/* ========== 确认 / 修改 / 写入 ========== */
function dateLabel(d) {
  const n = diffDays(d, today());
  const name = { '-2': '前天', '-1': '昨天', 0: '今天', 1: '明天', 2: '后天' }[n];
  const dt = parseYmd(d);
  return `${name ? name + ' ' : ''}${dt.getMonth() + 1}/${dt.getDate()} 周${WEEK[dt.getDay()]}`;
}
function renderChatReview() {
  const list = ui.chat || [];
  const cards = list.map((a, i) => {
    const head = `<label class="row" style="gap:8px"><input type="checkbox" data-ci="${i}" data-k="on" ${a.on ? 'checked' : ''}>`;
    if (a.kind === 'med') {
      const m = (S.meds || []).find((x) => x.id === a.med);
      return `<div class="card" style="padding:12px;background:var(--bg)">${head}<b>💊 吃药打卡</b></label>
        <div class="grid2" style="margin-top:8px"><input class="inp" type="date" data-ci="${i}" data-k="date" value="${a.date}">
        <select class="inp" data-ci="${i}" data-k="slot">${(m?.slots || ['']).map((s) => `<option value="${esc(s)}" ${s === a.slot ? 'selected' : ''}>${esc(m?.name || '')}${s ? ` · ${esc(s)}` : ''}</option>`).join('')}</select></div></div>`;
    }
    if (a.kind === 'food') {
      return `<div class="card" style="padding:12px;background:var(--bg)">${head}<b>🍽 饮食</b></label>
        <div class="grid2" style="margin-top:8px">
          <input class="inp" type="date" data-ci="${i}" data-k="date" value="${a.date}">
          <select class="inp" data-ci="${i}" data-k="meal">${S.settings.meals.map((m) => `<option value="${m.id}" ${m.id === a.meal ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div>
        ${a.items.map((it, j) => `<div class="food-row"><div class="grow">${esc(it.name)}${it.v ? '' : ' <span style="color:var(--rose);font-size:12px">没有营养数据，会跳过</span>'}</div>
          <input class="inp num-in" type="number" inputmode="decimal" data-ci="${i}" data-ii="${j}" value="${it.g}">g
          <span class="k" style="width:58px;text-align:right">${it.v ? Math.round((it.v[0] * it.g) / 100) : '?'} kcal</span></div>`).join('')}</div>`;
    }
    const found = a.done ? dayActs(a.date).find((x) => x.type === a.type && a.type && !x.done) : null;
    return `<div class="card" style="padding:12px;background:var(--bg)">${head}<b>📅 ${a.done ? '标记完成' : '日程'}</b>
        <span class="dot" style="background:${typeOf(a.type).color}"></span></label>
      <input class="inp" style="margin-top:8px" data-ci="${i}" data-k="title" value="${esc(a.title)}">
      <div class="grid2" style="margin-top:8px">
        <input class="inp" type="date" data-ci="${i}" data-k="date" value="${a.date}">
        <input class="inp" type="time" step="300" data-ci="${i}" data-k="start" value="${hm(a.start)}"></div>
      <p class="muted" style="margin:6px 0 0">${found ? `会把 ${hm(found.start)} 那条「${esc(found.title)}」标为已完成` : a.done ? '会新增一条已完成记录' : `${dateLabel(a.date)} · ${a.dur} 分钟${a.noTime ? ' · 没说时间，默认 9:00，可改' : ''}`}</p></div>`;
  }).join('');
  openSheet(`<h2>确认要记下的内容</h2>
    ${cards || '<div class="empty">没有要记的内容</div>'}
    <div class="actions"><button class="btn ghost" data-act="close-sheet">取消</button>
      ${cards ? '<button class="btn" data-act="chat-apply">记下</button>' : ''}</div>`);
  document.querySelectorAll('#sheet [data-ci]').forEach((el) => {
    el.addEventListener('change', () => {
      const i = Number(el.dataset.ci), k = el.dataset.k;
      ui.chat = ui.chat.map((a, idx) => {
        if (idx !== i) return a;
        if (el.dataset.ii !== undefined) {
          const j = Number(el.dataset.ii);
          return { ...a, items: a.items.map((it, jdx) => (jdx === j ? { ...it, g: Number(el.value) || 0 } : it)) };
        }
        if (k === 'on') return { ...a, on: el.checked };
        if (k === 'start') return { ...a, start: toMin(el.value), noTime: false };
        return { ...a, [k]: el.value };
      });
      if (k === 'date' || k === 'start') renderChatReview();
    });
  });
}
function applyActions(list) {
  const done = [];
  list.filter((a) => a.on).forEach((a) => {
    if (a.kind === 'med') {
      const m = (S.meds || []).find((x) => x.id === a.med); if (!m) return;
      S.medLog = { ...(S.medLog || {}), [a.date]: { ...((S.medLog || {})[a.date] || {}), [medKey(m, a.slot)]: true } };
      save(); done.push(`${m.name}${a.slot ? `(${a.slot})` : ''} ✓`);
      return;
    }
    if (a.kind === 'food') {
      const items = a.items.filter((x) => x.v && x.g > 0).map(({ id, name, g, v }) => ({ id, name, g, v }));
      if (!items.length) return;
      setMealItems(a.date, a.meal, [...(mealsOf(a.date)[a.meal] || []), ...items]);
      done.push(`${S.settings.meals.find((m) => m.id === a.meal)?.name} ${items.length} 项`);
      return;
    }
    const existing = a.done && a.type ? dayActs(a.date).find((x) => x.type === a.type && !x.done) : null;
    if (existing) { updateAct(a.date, existing.id, { done: true }); done.push(`${existing.title} ✓`); return; }
    const start = Math.max(DAY_S, a.start);
    const item = { id: uid(), type: a.type, title: a.title.trim() || '待办', start, dur: Math.min(a.dur, DAY_E - start) || SNAP, note: a.note || '', done: a.done };
    S.acts = { ...S.acts, [a.date]: [...dayActs(a.date), item] };
    save(); done.push(`${item.title} ${a.date.slice(5)}`);
  });
  return done;
}
function markApplied(i, done) {
  ui.msgs = ui.msgs.map((m, idx) => (idx === i ? { ...m, applied: true } : m));
  saveMsgs(); render(); renderChatLog();
  toast(done.length ? `已记下：${done.join('、')}` : '没有可记的内容');
}

Object.assign(ACTIONS, {
  'open-chat': openChat,
  'close-chat': closeChat,
  'chat-send': chatSend,
  'chat-unattach': () => { ui.attach = null; renderChatLog(); },
  'chat-web': () => {
    if (!hasAI()) return toast('联网需要先在设置里配置 AI 接口');
    if (!S.settings.ai.searchModel && !S.settings.ai.searchExtra) return toast('先在「设置 → AI 识别」填联网模型或附加参数');
    ui.web = !ui.web; renderChatLog(); toast(ui.web ? '已开启联网' : '已关闭联网');
  },
  'chat-clear': () => { if (confirm('清空聊天记录？已记下的数据不受影响')) { ui.msgs = []; saveMsgs(); renderChatLog(); } },
  'chat-apply-msg': (t) => { const i = Number(t.dataset.i); markApplied(i, applyActions(ui.msgs[i].actions || [])); },
  'chat-edit-msg': (t) => { ui.chatMsg = Number(t.dataset.i); ui.chat = ui.msgs[ui.chatMsg].actions || []; renderChatReview(); },
  'chat-apply': () => { const done = applyActions(ui.chat || []); closeSheet(); markApplied(ui.chatMsg, done); },
});
document.addEventListener('change', (e) => { if (e.target.id === 'chat-file') { chatAttach(e.target.files[0]); e.target.value = ''; } });
document.addEventListener('keydown', (e) => {
  if (e.target.id === 'chat-in' && e.key === 'Enter' && !e.shiftKey && !e.isComposing && !('ontouchstart' in window)) { e.preventDefault(); chatSend(); }
  if (e.key === 'Escape' && !$('#sheet').classList.contains('on')) closeChat();
}, true); // 捕获阶段：先于关闭弹层的监听，避免一次 Esc 同时关掉弹层和对话
document.addEventListener('input', (e) => {
  if (e.target.id === 'chat-in') { e.target.style.height = 'auto'; e.target.style.height = `${Math.min(120, e.target.scrollHeight)}px`; }
});
