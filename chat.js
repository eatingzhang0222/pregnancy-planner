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
function localParse(text) {
  const clauses = text.split(/[。；;！!\n]+/).map((x) => x.trim()).filter(Boolean);
  return clauses.map((c) => {
    if (/提醒|记得|别忘/.test(c)) return localActivity(c);
    const actHit = ACT_KEYWORDS.some(([re]) => re.test(c)) || S.types.some((t) => c.includes(t.name));
    if (actHit && !/吃了|喝了/.test(c)) return localActivity(c);
    if (isFoodClause(c)) return localFood(c);
    return parseTimeText(c) != null ? localActivity(c) : localFood(c);
  });
}

/* ========== AI 理解 ========== */
async function aiParse(text) {
  const d = parseYmd(today());
  const sys = '你是孕晚期记录助手。把用户的一句话拆成要记录的动作，只输出 JSON，不要解释。格式：'
    + '{"actions":[{"kind":"food","date":"YYYY-MM-DD","meal":"餐次id","items":[{"name":"食物","grams":数字,"per100":[热量kcal,蛋白质g,脂肪g,碳水g,钙mg,铁mg,纤维g]}]},'
    + '{"kind":"act","date":"YYYY-MM-DD","start":"HH:MM","dur":分钟,"type":"类型id或空","title":"标题","note":"备注","done":是否已完成}]}。'
    + '饮食克数要估算，per100 按《中国食物成分表》每100g；混合菜拆成主要食材含油。没说时间的活动 start 留空字符串。';
  const ctx = `今天 ${today()} 周${WEEK[d.getDay()]}，现在 ${hm(nowMin())}。\n`
    + `餐次：${S.settings.meals.map((m) => `${m.id}=${m.name}(${m.time})`).join('，')}\n`
    + `活动类型：${S.types.map((t) => `${t.id}=${t.name}`).join('，')}\n用户说：${text}`;
  const out = await callLLM([{ role: 'system', content: sys }, { role: 'user', content: ctx }]);
  const m = out.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('没解析到结果');
  const arr = JSON.parse(m[0]).actions;
  if (!Array.isArray(arr)) throw new Error('格式不对');
  const validDate = (x) => (/^\d{4}-\d{2}-\d{2}$/.test(x) ? x : today());
  return arr.map((a) => {
    if (a.kind === 'food') {
      const meal = S.settings.meals.some((x) => x.id === a.meal) ? a.meal : guessMealId(text);
      const items = (a.items || []).filter((x) => x && x.name).map((x) => {
        const name = String(x.name).slice(0, 30);
        const local = allFoods().find((f) => f.n === name || (f.a || []).includes(name)); // 库里有就用库里的数，保持一致
        const v = local ? local.v : (Array.isArray(x.per100) ? NK.map((_, i) => Math.max(0, Number(x.per100[i]) || 0)) : null);
        return { id: uid(), name: local ? local.n : name, g: Math.max(1, Math.round(Number(x.grams) || 100)), v };
      });
      return { kind: 'food', on: true, date: validDate(a.date), meal, items };
    }
    const typeId = S.types.some((t) => t.id === a.type) ? a.type : '';
    const start = /^\d{1,2}:\d{2}$/.test(a.start || '') ? toMin(a.start) : null;
    return {
      kind: 'act', on: true, date: validDate(a.date), start: start ?? (a.done ? nowMin() : 9 * 60), noTime: start == null,
      dur: Math.max(5, Number(a.dur) || typeOf(typeId).dur), type: typeId,
      title: String(a.title || typeOf(typeId).name).slice(0, 30), note: String(a.note || ''), done: !!a.done,
    };
  });
}

/* ========== 界面 ========== */
const CHAT_EXAMPLES = ['午餐二米饭180g，鲈鱼150g，秋葵100g', '刚做完会阴按摩', '下周三下午2点产检，空腹', '点心2 蓝莓100g 酸奶酪20g'];
function openChat() {
  openSheet(`<h2>记一笔</h2>
    <p class="muted" style="margin-top:-6px">吃了什么、要做什么、做完了什么，直接说。${hasAI() ? '（AI 理解）' : '（本地识别；配置 AI 后能听懂更随意的说法）'}</p>
    <textarea class="inp" id="chat-in" rows="3" placeholder="比如：中午吃了二米饭一小碗、煮鱼150g；明天下午3点月子中心上课"></textarea>
    <div style="margin-top:8px">${CHAT_EXAMPLES.map((e) => `<button class="chip" data-act="chat-ex">${esc(e)}</button>`).join('')}</div>
    <div class="actions"><button class="btn" data-act="chat-go">识别</button></div>`);
  setTimeout(() => $('#chat-in')?.focus(), 300);
}
async function chatGo() {
  const text = $('#chat-in').value.trim();
  if (!text) return toast('先写点内容');
  const btn = $('[data-act="chat-go"]');
  let actions;
  if (hasAI()) {
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span> 理解中';
    try { actions = await aiParse(text); }
    catch (e) { toast(`AI 失败，改用本地识别：${e.message}`); actions = localParse(text); }
  } else actions = localParse(text);
  ui.chat = actions.filter((a) => a.kind === 'act' || a.items.length);
  renderChatReview();
}
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
    if (a.kind === 'food') {
      return `<div class="card" style="padding:12px;background:var(--bg)">${head}<b>🍽 饮食</b></label>
        <div class="grid2" style="margin-top:8px">
          <input class="inp" type="date" data-ci="${i}" data-k="date" value="${a.date}">
          <select class="inp" data-ci="${i}" data-k="meal">${S.settings.meals.map((m) => `<option value="${m.id}" ${m.id === a.meal ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div>
        ${a.items.map((it, j) => `<div class="food-row"><div class="grow">${esc(it.name)}${it.v ? '' : ' <span style="color:var(--rose);font-size:12px">库里没有，会跳过</span>'}</div>
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
    ${cards || '<div class="empty">没听懂，换个说法试试，或配置 AI 后再来</div>'}
    <div class="actions"><button class="btn ghost" data-act="open-chat">重新输入</button>
      ${cards ? '<button class="btn" data-act="chat-apply">全部记下</button>' : ''}</div>`);
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
function chatApply() {
  const done = [];
  (ui.chat || []).filter((a) => a.on).forEach((a) => {
    if (a.kind === 'food') {
      const items = a.items.filter((x) => x.v && x.g > 0).map(({ id, name, g, v }) => ({ id, name, g, v }));
      if (!items.length) return;
      setMealItems(a.date, a.meal, [...(mealsOf(a.date)[a.meal] || []), ...items]);
      done.push(`${S.settings.meals.find((m) => m.id === a.meal)?.name} ${items.length} 项`);
      return;
    }
    const existing = a.done && a.type ? dayActs(a.date).find((x) => x.type === a.type && !x.done) : null;
    if (existing) { updateAct(a.date, existing.id, { done: true }); done.push(`${existing.title} ✓`); return; }
    const dur = Math.min(a.dur, DAY_E - a.start) || SNAP;
    const item = { id: uid(), type: a.type, title: a.title.trim() || '待办', start: Math.max(DAY_S, a.start), dur, note: a.note || '', done: a.done };
    S.acts = { ...S.acts, [a.date]: [...dayActs(a.date), item] };
    save();
    done.push(`${item.title} ${a.date.slice(5)}`);
  });
  closeSheet(); render();
  toast(done.length ? `已记下：${done.join('、')}` : '没有可记的内容');
}

Object.assign(ACTIONS, {
  'open-chat': openChat,
  'chat-ex': (t) => { $('#chat-in').value = t.textContent; },
  'chat-go': chatGo,
  'chat-apply': chatApply,
});
