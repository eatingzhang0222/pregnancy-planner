'use strict';

/* ========== 工具 ========== */
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const diffDays = (a, b) => Math.round((parseYmd(a) - parseYmd(b)) / 864e5);
const today = () => ymd(new Date());
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const hm = (m) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
const toMin = (s) => { const [h, m] = String(s || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
const uid = () => Math.random().toString(36).slice(2, 9);
const round = (n, d = 0) => { const p = 10 ** d; return Math.round((n || 0) * p) / p; };
const WEEK = '日一二三四五六';
const NK = NUTRIENTS.map((n) => n.k);

/* ========== 存储 ========== */
const KEY = 'pp_v1';
const APP_VERSION = '2026.11.26-10';
function defaultState() {
  return {
    settings: {
      due: '',
      targets: { ...DEFAULT_TARGETS },
      meals: DEFAULT_MEALS.map((m) => ({ ...m })),
      ai: { base: '', key: '', model: 'gpt-4o-mini' },
      gdm: false,   // 妊娠期糖尿病模式：水果上限提醒、餐后运动提醒
      notes: '',    // 医嘱要点，一行一条
    },
    types: DEFAULT_ACTIVITY_TYPES.map((t) => ({ ...t })),
    acts: {},   // { 'YYYY-MM-DD': [{id,type,title,start,dur,note,done,series}] }
    food: {},   // { 'YYYY-MM-DD': { mealId: [{id,name,g,v}] } }
    myFoods: [],
    meds: DEFAULT_MEDS.map((m) => ({ ...m, slots: [...m.slots] })),
    medLog: {}, // { 'YYYY-MM-DD': { 'medId:时段': true } }
  };
}
function load() {
  const d = defaultState();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const s = JSON.parse(raw);
    return {
      ...d, ...s,
      settings: {
        ...d.settings, ...s.settings,
        targets: { ...d.settings.targets, ...(s.settings?.targets || {}) },
        ai: { ...d.settings.ai, ...(s.settings?.ai || {}) },
      },
    };
  } catch (e) {
    toast('读取本地数据失败，已用默认设置');
    return d;
  }
}
let S = load();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch (e) { toast('保存失败：浏览器存储不可用'); }
}

const ui = { tab: 'today', date: today(), view: 'month', meal: 'all', review: null, picked: null, cat: '全部', q: '' };

/* ========== 通用 UI ========== */
let toastTimer;
function toast(msg) {
  const t = $('#toast'); if (!t) return;
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2000);
}
function openSheet(html) {
  $('#sheet').innerHTML = `<button class="sheet-x" data-act="close-sheet" aria-label="关闭">×</button>${html}`;
  $('#sheet').scrollTop = 0;
  $('#mask').classList.add('on'); $('#sheet').classList.add('on');
}
function closeSheet() { $('#mask').classList.remove('on'); $('#sheet').classList.remove('on'); }

/* ========== 孕周 ========== */
function gaInfo(date) {
  if (!S.settings.due) return null;
  const left = diffDays(S.settings.due, date);
  const passed = 280 - left;
  return { w: Math.floor(passed / 7), d: ((passed % 7) + 7) % 7, left, passed };
}
function renderTop() {
  $('#top').hidden = ui.tab !== 'today';
  if (ui.tab !== 'today') { $('#top').innerHTML = ''; return; }
  const g = gaInfo(ui.date);
  const isToday = ui.date === today();
  if (!g) {
    $('#top').innerHTML = `<div class="ga"><b>你好呀</b></div>
      <p class="muted">先去 <button class="btn sm ghost" data-act="tab" data-tab="set">设置预产期</button> 吧</p>`;
    return;
  }
  const pct = Math.max(0, Math.min(100, (g.passed / 280) * 100));
  const due = parseYmd(S.settings.due);
  const left = g.left === 0 ? '<span>今天是</span><b class="txt">预产期</b>'
    : `<span>${g.left > 0 ? '距预产期' : '已过预产期'}</span><b>${Math.abs(g.left)}</b><small>天</small>`;
  $('#top').innerHTML = `<div class="top-row">
      <div class="ga"><b>${g.w}<small>w</small>+${g.d}<small>d</small></b>
        <span>${isToday ? '今天' : ui.date.slice(5)} · 预产期 ${due.getMonth() + 1}/${due.getDate()} 周${WEEK[due.getDay()]}</span></div>
      <div class="left-days">${left}</div></div>
    <div class="bar"><i style="width:${pct}%"></i></div>`;
}

/* ========== 今天 ========== */
function renderToday() {
  ui.date = today();
  const g = gaInfo(ui.date);
  const acts = dayActs(ui.date).slice().sort((a, b) => a.start - b.start);
  const tot = dayTotals(ui.date);
  const T = S.settings.targets;
  let html = '';
  if (g) {
    const tips = MILESTONES.filter(([w]) => w >= g.w - 1 && w <= g.w + 2);
    const next = MILESTONES.find(([w]) => w > g.w);
    const nm = nowMin();
    const postMeal = S.settings.gdm && S.settings.meals.filter((m) => !/点心|加餐/.test(m.name)).find((m) => nm >= toMin(m.time) && nm <= toMin(m.time) + 120);
    if (postMeal) html += `<div class="card"><div class="tip" style="background:var(--sage-soft)"><b>${esc(postMeal.name)}后 2 小时内</b>：抬腿 + 举水瓶 10 分钟，再散步 10–20 分钟</div></div>`;
    if (tips.length || next) {
      html += `<div class="card"><h3>这几周要留意</h3>${(tips.length ? tips : [next]).map(([w, t]) => `<div class="tip"><b>${w}w</b> ${esc(t)}</div>`).join('')}</div>`;
    }
  }
  html += medsCard(ui.date);
  html += `<div class="card"><h3>今日安排 <button class="btn sm ghost" data-act="new-act">+ 添加</button></h3>
    ${acts.length ? acts.map((a) => {
      const t = typeOf(a.type);
      return `<div class="list-item"><button class="check ${a.done ? 'on' : ''}" data-act="toggle-done" data-id="${a.id}" aria-label="完成">${a.done ? '✓' : ''}</button>
        <span class="dot" style="background:${t.color}"></span>
        <div class="grow" data-act="edit-act" data-id="${a.id}"><div style="${a.done ? 'text-decoration:line-through;color:var(--mute)' : ''}">${esc(a.title)}</div>
        <div class="muted">${hm(a.start)}–${hm(a.start + a.dur)}${a.note ? ' · ' + esc(a.note) : ''}</div></div></div>`;
    }).join('') : '<div class="empty">今天还没有安排</div>'}
  </div>`;
  html += `<div class="card"><h3>今日营养 <button class="btn sm ghost" data-act="tab" data-tab="food">去记录</button></h3>
    ${kcalRing(tot.kcal, T.kcal)}
    ${['p', 'c', 'f'].map((k) => nutBar(k, tot[k], T[k])).join('')}
  </div>`;
  $('#view').innerHTML = html;
}

/* ========== 日程 ========== */
const DAY_S = 6 * 60, DAY_E = 24 * 60, PX = 1.1, SNAP = 15;
const typeOf = (id) => S.types.find((t) => t.id === id) || { name: '其他', color: '#9A8C82', dur: 60 };
const dayActs = (date) => S.acts[date] || [];
function findAct(id) {
  for (const [date, list] of Object.entries(S.acts)) {
    const a = list.find((x) => x.id === id);
    if (a) return { a, date };
  }
  return null;
}
function dateNav() {
  const d = parseYmd(ui.date);
  const g = gaInfo(ui.date);
  return `<div class="datenav">
    <button class="icon-btn" data-act="day" data-n="-1" aria-label="前一天">‹</button>
    <div class="d" data-act="day" data-n="0"><b>${d.getMonth() + 1}月${d.getDate()}日 周${WEEK[d.getDay()]}</b>
      <span class="muted">${g ? `${g.w}w+${g.d}` : ''}${ui.date === today() ? ' · 今天' : ' · 点此回到今天'}</span></div>
    <button class="icon-btn" data-act="day" data-n="1" aria-label="后一天">›</button></div>`;
}
const VIEWS = [['day', '日'], ['week', '周'], ['month', '月']];
const viewSeg = () => `<div class="seg" style="justify-content:center">${VIEWS.map(([k, n]) => `<button class="${ui.view === k ? 'on' : ''}" data-act="view" data-v="${k}" style="min-width:64px">${n}</button>`).join('')}</div>`;
const weekStart = (d) => addDays(d, 1 - (parseYmd(d).getDay() || 7));
function rangeNav(title, sub) {
  return `<div class="datenav">
    <button class="icon-btn" data-act="shift" data-n="-1" aria-label="上一段">‹</button>
    <div class="d" data-act="shift" data-n="0"><b>${title}</b><span class="muted">${sub}</span></div>
    <button class="icon-btn" data-act="shift" data-n="1" aria-label="下一段">›</button></div>`;
}
function dayBadges(d) {
  return `${d === today() ? '<span class="badge">今天</span>' : ''}${d === S.settings.due ? '<span class="badge due">预产期</span>' : ''}`;
}
function renderWeek() {
  const ws = weekStart(ui.date), we = addDays(ws, 6);
  const a = parseYmd(ws), b = parseYmd(we), g = gaInfo(ws), g2 = gaInfo(we);
  const rows = [0, 1, 2, 3, 4, 5, 6].map((i) => {
    const d = addDays(ws, i), dt = parseYmd(d), gi = gaInfo(d);
    const acts = dayActs(d).slice().sort((x, y) => x.start - y.start);
    return `<div class="week-row ${d === today() ? 'is-today' : ''}" data-act="goto-day" data-date="${d}">
      <div class="wd"><b>${dt.getDate()}</b><span>周${WEEK[dt.getDay()]}</span>${gi ? `<small>${gi.w}+${gi.d}</small>` : ''}</div>
      <div class="grow">${dayBadges(d)}${acts.map((x) => `<div class="pill ${x.done ? 'done' : ''}" data-act="edit-act" data-id="${x.id}" style="--c:${typeOf(x.type).color}">
        <span>${hm(x.start)}</span>${esc(x.title)}</div>`).join('') || '<span class="muted">—</span>'}</div></div>`;
  }).join('');
  $('#view').innerHTML = viewSeg() + rangeNav(`${a.getMonth() + 1}/${a.getDate()} – ${b.getMonth() + 1}/${b.getDate()}`, `${g ? `${g.w}+${g.d} – ${g2.w}+${g2.d} · ` : ''}${weekStart(today()) === ws ? '本周' : '点此回到本周'}`)
    + `<div class="card" style="padding:4px 12px">${rows}</div><p class="muted" style="text-align:center">点某一天进入日视图，点事项编辑，长按事项可拖到别的日子；左右滑切换日/周/月</p>`;
}
// 有预产期时：只看「本周一（或最早一条日程所在周）→ 预产期」这一段
function renderCountdownCal() {
  const due = S.settings.due;
  const firstAct = Object.keys(S.acts).filter((d) => dayActs(d).length).sort()[0];
  let from = firstAct && firstAct < today() ? firstAct : today();
  if (diffDays(due, from) > 42) from = addDays(due, -42);
  const start = weekStart(from);
  const end = due > today() ? due : today();
  const cells = [];
  for (let d = start; diffDays(addDays(weekStart(end), 6), d) >= 0; d = addDays(d, 1)) {
    if (d > end) { cells.push('<div class="mc blank"></div>'); continue; }
    const dt = parseYmd(d), acts = dayActs(d).slice().sort((x, y) => x.start - y.start);
    const gi = dt.getDay() === 1 || d === start ? gaInfo(d) : null;
    const showMonth = dt.getDate() === 1;
    cells.push(`<div class="mc ${d < today() ? 'past' : ''} ${d === today() ? 'is-today' : ''} ${d === due ? 'is-due' : ''}" data-act="goto-day" data-date="${d}">
      <div class="mn"><b>${showMonth ? `${dt.getMonth() + 1}/` : ''}${dt.getDate()}</b>${gi ? `<small>${gi.w}w</small>` : ''}</div>
      ${d === due ? '<div class="ml due">预产期</div>' : ''}
      ${acts.slice(0, 3).map((x) => `<div class="ml ${x.done ? 'done' : ''}" style="--c:${typeOf(x.type).color}">${esc(x.title)}</div>`).join('')}
      ${acts.length > 3 ? `<div class="more">+${acts.length - 3}</div>` : ''}</div>`);
  }
  const a = parseYmd(start), b = parseYmd(due), left = diffDays(due, today());
  $('#view').innerHTML = viewSeg()
    + `<div class="datenav" style="justify-content:center"><div class="d"><b>${a.getMonth() + 1}/${a.getDate()} – ${b.getMonth() + 1}/${b.getDate()}</b>
      <span class="muted">${left > 0 ? `距预产期 ${left} 天` : left === 0 ? '今天是预产期' : `已过预产期 ${-left} 天`}</span></div></div>`
    + `<div class="month"><div class="mh">${['一', '二', '三', '四', '五', '六', '日'].map((w) => `<span>${w}</span>`).join('')}</div>
      <div class="mg">${cells.join('')}</div></div>
      <div class="legend">${S.types.map((t) => `<span><i style="background:${t.color}"></i>${esc(t.name)}</span>`).join('')}</div>`;
}
// 日程页左右滑：左滑 日→周→月，右滑反过来；拖动事项时不触发
function bindPlanSwipe() {
  const v = $('#view');
  let s0 = null;
  v.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || e.target.closest('.grip, .rz, input, select, textarea')) { s0 = null; return; }
    s0 = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
  }, { passive: true });
  v.addEventListener('touchend', (e) => {
    if (!s0 || Date.now() < dragGuardUntil) { s0 = null; return; }
    const dx = e.changedTouches[0].clientX - s0.x, dy = e.changedTouches[0].clientY - s0.y;
    const quick = Date.now() - s0.t < 700;
    s0 = null;
    if (!quick || Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
    const order = VIEWS.map(([k]) => k);
    const next = order[order.indexOf(ui.view) + (dx < 0 ? 1 : -1)];
    if (!next) return;
    ui.view = next; dragGuardUntil = Date.now() + 300;
    render();
    $('#view').classList.add(dx < 0 ? 'slide-l' : 'slide-r');
  }, { passive: true });
}
// 周视图：长按事项后拖到另一天（保持原时间）
function bindWeekDrag() {
  const v = $('#view');
  let st = null;
  const blockScroll = (e) => { if (st && st.on) e.preventDefault(); };
  document.addEventListener('touchmove', blockScroll, { passive: false });
  const rowAt = (x, y) => document.elementFromPoint(x, y)?.closest('.week-row');
  const end = () => {
    if (!st) return;
    clearTimeout(st.timer);
    if (st.on) {
      st.ghost.remove(); st.el.classList.remove('lifting');
      v.querySelectorAll('.week-row.drop').forEach((r) => r.classList.remove('drop'));
      const row = st.target;
      dragGuardUntil = Date.now() + 400;
      if (row && row.dataset.date !== st.from) {
        const f = findAct(st.el.dataset.id);
        if (f) {
          S.acts = { ...S.acts, [f.date]: dayActs(f.date).filter((x) => x.id !== f.a.id), [row.dataset.date]: [...dayActs(row.dataset.date), f.a] };
          save(); toast(`已挪到 ${row.dataset.date.slice(5)}`); st = null; render(); return;
        }
      }
    }
    st = null;
  };
  v.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.pill'); if (!el) return;
    const from = el.closest('.week-row').dataset.date;
    st = { el, from, x0: e.clientX, y0: e.clientY, on: false, target: null };
    st.timer = setTimeout(() => {
      if (!st) return;
      st.on = true;
      const r = el.getBoundingClientRect();
      st.ghost = el.cloneNode(true); st.ghost.classList.add('ghost');
      Object.assign(st.ghost.style, { width: `${r.width}px`, left: `${r.left}px`, top: `${r.top}px` });
      st.dx = st.x0 - r.left; st.dy = st.y0 - r.top;
      document.body.appendChild(st.ghost); el.classList.add('lifting');
      if (navigator.vibrate) navigator.vibrate(15);
    }, 280);
  });
  v.addEventListener('pointermove', (e) => {
    if (!st) return;
    if (!st.on) { if (Math.hypot(e.clientX - st.x0, e.clientY - st.y0) > 8) { clearTimeout(st.timer); st = null; } return; }
    st.ghost.style.left = `${e.clientX - st.dx}px`; st.ghost.style.top = `${e.clientY - st.dy}px`;
    const row = rowAt(e.clientX, e.clientY);
    if (row !== st.target) { st.target?.classList.remove('drop'); row?.classList.add('drop'); st.target = row; }
  });
  v.addEventListener('pointerup', end);
  v.addEventListener('pointercancel', end);
  v.addEventListener('contextmenu', (e) => { if (e.target.closest('.pill')) e.preventDefault(); });
  // 重新绑定时卸掉上一次的全局监听
  const off = () => { document.removeEventListener('touchmove', blockScroll); };
  bindWeekDrag.off?.(); bindWeekDrag.off = off;
}
function renderMonth() {
  if (S.settings.due) return renderCountdownCal();
  const d0 = parseYmd(ui.date), first = ymd(new Date(d0.getFullYear(), d0.getMonth(), 1));
  const start = weekStart(first);
  const cells = [];
  for (let i = 0; i < 42; i += 1) {
    const d = addDays(start, i), dt = parseYmd(d);
    if (i % 7 === 0 && i > 0 && dt.getMonth() !== d0.getMonth()) break;
    const acts = dayActs(d).slice().sort((x, y) => x.start - y.start);
    const gi = i % 7 === 0 ? gaInfo(d) : null;
    cells.push(`<div class="mc ${dt.getMonth() !== d0.getMonth() ? 'out' : ''} ${d === today() ? 'is-today' : ''} ${d === S.settings.due ? 'is-due' : ''}" data-act="goto-day" data-date="${d}">
      <div class="mn"><b>${dt.getDate()}</b>${gi ? `<small>${gi.w}w</small>` : ''}</div>
      ${d === S.settings.due ? '<div class="ml due">预产期</div>' : ''}
      ${acts.slice(0, 3).map((x) => `<div class="ml ${x.done ? 'done' : ''}" style="--c:${typeOf(x.type).color}">${esc(x.title)}</div>`).join('')}
      ${acts.length > 3 ? `<div class="more">+${acts.length - 3}</div>` : ''}</div>`);
  }
  const thisMonth = today().slice(0, 7) === ui.date.slice(0, 7);
  $('#view').innerHTML = viewSeg() + rangeNav(`${d0.getFullYear()}年${d0.getMonth() + 1}月`, thisMonth ? '本月' : '点此回到本月')
    + `<div class="month"><div class="mh">${['一', '二', '三', '四', '五', '六', '日'].map((w) => `<span>${w}</span>`).join('')}</div>
      <div class="mg">${cells.join('')}</div></div>
      <div class="legend">${S.types.map((t) => `<span><i style="background:${t.color}"></i>${esc(t.name)}</span>`).join('')}</div>`;
}
function renderPlan() {
  if (ui.view === 'week') return renderWeek();
  if (ui.view === 'month') return renderMonth();
  const acts = dayActs(ui.date).slice().sort((a, b) => a.start - b.start);
  const laneEnd = [], lane = {};
  acts.forEach((a) => {
    let i = laneEnd.findIndex((end) => end <= a.start);
    if (i < 0) { i = laneEnd.length; laneEnd.push(0); }
    laneEnd[i] = a.start + a.dur; lane[a.id] = i;
  });
  const n = Math.max(1, laneEnd.length);
  let hours = '';
  for (let m = DAY_S; m <= DAY_E; m += 60) hours += `<div class="hour" style="top:${(m - DAY_S) * PX}px"><span>${hm(m)}</span></div>`;
  const nm = nowMin();
  const nowLine = ui.date === today() && nm >= DAY_S ? `<div class="now-line" style="top:${(nm - DAY_S) * PX}px"></div>` : '';
  const evs = acts.map((a) => {
    const t = typeOf(a.type);
    return `<div class="ev ${a.done ? 'done' : ''}" data-act="edit-act" data-id="${a.id}" style="background:${t.color};top:${(a.start - DAY_S) * PX}px;height:${Math.max(a.dur * PX, 22)}px;
      left:calc(48px + (100% - 54px) * ${lane[a.id]} / ${n});width:calc((100% - 54px) / ${n} - 4px)">
      <span class="grip" aria-label="拖动调整时间">⋮⋮</span>
      <b>${esc(a.title)}</b><small class="tm">${hm(a.start)}–${hm(a.start + a.dur)}</small>
      <span class="rz" aria-label="拖动调整时长"></span></div>`;
  }).join('');
  $('#view').innerHTML = `${viewSeg()}${dateNav()}
    <div style="margin-bottom:8px">${S.types.map((t) => `<button class="chip" data-act="quick-act" data-type="${t.id}"><span class="dot" style="background:${t.color}"></span>${esc(t.name)}</button>`).join('')}
      <button class="chip" data-act="new-act">+ 自定义</button></div>
    <p class="muted" style="margin:0 0 8px">点事项编辑，按住 ⋮⋮ 拖动改时间，拖底边改时长，点空白处新建；左右滑切换日/周/月</p>
    <div class="timeline" id="tl" style="height:${(DAY_E - DAY_S) * PX + 10}px">${hours}${nowLine}${evs}</div>`;
}
function bindTimelineDrag() {
  const tl = $('#tl'); if (!tl) return;
  let justDragged = false;
  tl.addEventListener('click', (e) => {
    if (justDragged) { justDragged = false; return; }
    if (e.target !== tl && !e.target.classList.contains('hour')) return;
    const m = DAY_S + (e.clientY - tl.getBoundingClientRect().top) / PX;
    openActSheet(null, { start: Math.max(DAY_S, Math.floor(m / 30) * 30) });
  });
  tl.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.grip, .rz'); if (!handle) return;
    const el = handle.closest('.ev'); const found = findAct(el.dataset.id); if (!found) return;
    e.preventDefault();
    const mode = handle.classList.contains('rz') ? 'resize' : 'move';
    const y0 = e.clientY, s0 = found.a.start, d0 = found.a.dur;
    let ns = s0, nd = d0;
    try { handle.setPointerCapture(e.pointerId); } catch (_) { /* 部分浏览器不支持 */ }
    el.classList.add('dragging');
    const move = (ev) => {
      const dm = Math.round((ev.clientY - y0) / PX / SNAP) * SNAP;
      if (mode === 'move') ns = Math.max(DAY_S, Math.min(DAY_E - d0, s0 + dm));
      else nd = Math.max(SNAP, Math.min(DAY_E - s0, d0 + dm));
      el.style.top = `${(ns - DAY_S) * PX}px`;
      el.style.height = `${Math.max(nd * PX, 22)}px`;
      el.querySelector('.tm').textContent = `${hm(ns)}–${hm(ns + nd)}`;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (ns !== s0 || nd !== d0) {
        justDragged = true; setTimeout(() => { justDragged = false; }, 300);
        dragGuardUntil = Date.now() + 400;
        updateAct(found.date, found.a.id, { start: ns, dur: nd });
        toast(`已调整为 ${hm(ns)}–${hm(ns + nd)}`);
      }
      render();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
}
let dragGuardUntil = 0; // 拖动结束后短时间内忽略点击，避免误开编辑框
function updateAct(date, id, patch) {
  S.acts = { ...S.acts, [date]: dayActs(date).map((a) => (a.id === id ? { ...a, ...patch } : a)) };
  save();
}
function openActSheet(id, preset = {}) {
  const found = id ? findAct(id) : null;
  const t0 = typeOf(preset.type || S.types[0]?.id);
  const a = found ? found.a : { type: preset.type || S.types[0]?.id, title: preset.type ? t0.name : '', start: preset.start ?? 9 * 60, dur: t0.dur, note: '', done: false };
  const date = found ? found.date : ui.date;
  const durs = [15, 30, 45, 60, 90, 120, 180, 240];
  if (!durs.includes(a.dur)) durs.push(a.dur);
  openSheet(`<h2>${found ? '编辑活动' : '新建活动'}</h2>
    <form id="act-form">
      <div style="margin-bottom:10px">${S.types.map((t) => `<button type="button" class="chip ${t.id === a.type ? 'on' : ''}" data-act="pick-type" data-type="${t.id}"><span class="dot" style="background:${t.color}"></span>${esc(t.name)}</button>`).join('')}</div>
      <input type="hidden" name="type" value="${esc(a.type)}">
      <label class="f">名称<input name="title" required value="${esc(a.title)}" placeholder="如：36 周产检 / 胎心监护"></label>
      <div class="grid2">
        <label class="f">日期<input type="date" name="date" value="${date}"></label>
        <label class="f">开始<input type="time" name="start" step="300" value="${hm(a.start)}"></label>
      </div>
      <div class="grid2">
        <label class="f">时长<select name="dur">${durs.sort((x, y) => x - y).map((d) => `<option value="${d}" ${d === a.dur ? 'selected' : ''}>${d >= 60 ? `${d / 60} 小时` : `${d} 分钟`}</option>`).join('')}</select></label>
        ${found ? `<label class="f">状态<select name="done"><option value="0">未完成</option><option value="1" ${a.done ? 'selected' : ''}>已完成</option></select></label>`
          : `<label class="f">重复<select name="repeat"><option value="">不重复</option><option value="1">每天（至预产期）</option><option value="2">隔天（至预产期）</option><option value="mwf">每周一三五（至预产期）</option><option value="7">每周（至预产期）</option></select></label>`}
      </div>
      <label class="f">备注<textarea name="note" placeholder="医院/科室、要带的资料、空腹等">${esc(a.note)}</textarea></label>
      <div class="actions">
        ${found ? `<button type="button" class="btn ghost" data-act="del-act" data-id="${found.a.id}">删除</button>` : ''}
        <button class="btn" type="submit">保存</button>
      </div>
    </form>`);
  $('#act-form').onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const item = { type: f.type, title: f.title.trim(), start: toMin(f.start), dur: Number(f.dur), note: f.note.trim() };
    if (!item.title) return toast('请填写名称');
    if (item.start + item.dur > DAY_E) item.dur = Math.max(SNAP, DAY_E - item.start);
    if (found) {
      const next = { ...found.a, ...item, done: f.done === '1' };
      const acts = { ...S.acts, [found.date]: dayActs(found.date).filter((x) => x.id !== found.a.id) };
      acts[f.date] = [...(acts[f.date] || []), next];
      S.acts = acts;
    } else {
      const rp = f.repeat || '';
      const end = rp ? (S.settings.due || addDays(f.date, 30)) : f.date;
      const series = rp ? uid() : undefined;
      const acts = { ...S.acts };
      for (let d = f.date; diffDays(end, d) >= 0; d = addDays(d, 1)) {
        const k = diffDays(d, f.date), dow = parseYmd(d).getDay();
        const hit = !rp || rp === '1' || (rp === '2' && k % 2 === 0) || (rp === '7' && k % 7 === 0) || (rp === 'mwf' && [1, 3, 5].includes(dow));
        if (hit) acts[d] = [...(acts[d] || []), { ...item, id: uid(), done: false, series }];
      }
      S.acts = acts;
    }
    save(); closeSheet(); render(); toast('已保存');
  };
}
function deleteAct(id) {
  const found = findAct(id); if (!found) return;
  let all = false;
  if (found.a.series) all = confirm('这是重复活动。\n确定 = 删除这次及之后所有\n取消 = 只删这一次');
  else if (!confirm(`删除「${found.a.title}」？`)) return;
  const acts = {};
  for (const [d, list] of Object.entries(S.acts)) {
    acts[d] = list.filter((a) => !(a.id === id || (all && a.series === found.a.series && diffDays(d, found.date) >= 0)));
  }
  S.acts = acts; save(); closeSheet(); render(); toast('已删除');
}

/* ========== 营养计算 ========== */
// 食物来源优先级：我的食物 > 常用食物 > 家常菜 > 中国食物成分表
const DB_FOODS = (typeof FOODS_DB_RAW === 'undefined' ? [] : FOODS_DB_RAW)
  .filter((r) => !FOODS.some((f) => f.n === r[0]))
  .map(([n, cat, ...x]) => ({ n, cat, v: x.slice(0, 7), a: x[7] ? x[7].split('、') : undefined, db: true, rep: !!x[8] }));
const normName = (n) => String(n).replace(/\(/g, '（').replace(/\)/g, '）').trim();
const baseName = (n) => normName(n).replace(/（[^）]*）/g, '').trim();
const keysOf = (f) => [baseName(f.n), ...(f.a || [])].filter(Boolean);
function fuzzyFind(list, name) {
  const q = baseName(name); if (!q) return null;
  const same = list.filter((f) => baseName(f.n) === q);
  if (same.length) return same.find((f) => f.rep) || same[0];
  let best = null, len = 0;
  list.forEach((f) => keysOf(f).forEach((k) => { if (k.length > len && q.includes(k)) { best = f; len = k.length; } }));
  if (best || q.length < 2) return best;
  len = Infinity;
  list.forEach((f) => keysOf(f).forEach((k) => { if (k.length < len && k.includes(q)) { best = f; len = k.length; } }));
  return best;
}
const exactFind = (list, name) => { const q = normName(name); return list.find((f) => normName(f.n) === q || (f.a || []).includes(name)); };
// 家常菜：按配方把食材营养加权成每 100g
let dishCache = null;
function dishFoods() {
  if (dishCache) return dishCache;
  const pool = [...FOODS, ...DB_FOODS];
  dishCache = (typeof DISHES === 'undefined' ? [] : DISHES).map((d) => {
    let w = 0; const sum = NK.map(() => 0); const miss = [];
    d.r.forEach(([n, g]) => {
      w += g;
      if (n === '水') return;
      const f = exactFind(pool, n) || fuzzyFind(pool, n);
      if (!f) { miss.push(n); return; }
      f.v.forEach((x, i) => { sum[i] += (x * g) / 100; });
    });
    return { n: d.n, cat: '家常菜', dish: true, a: d.a, recipe: d.r, miss,
      v: sum.map((x) => round((x / w) * 100, 1)), u: [['一份', d.s || Math.round(w / 2)]] };
  });
  return dishCache;
}
const coreFoods = () => [...S.myFoods, ...FOODS, ...dishFoods()];
const allFoods = () => [...coreFoods(), ...DB_FOODS];
// 血糖生成指数
function findGI(name) {
  if (typeof GI_DB === 'undefined' || !name) return null;
  const b = baseName(name);
  const hit = GI_DB.find(([n]) => n === name || baseName(n) === b);
  if (hit) return hit[1];
  let best = null, len = 1;
  GI_DB.forEach(([n, gi]) => { const k = baseName(n); if (k.length > len && (b.includes(k) || k.includes(b))) { best = gi; len = k.length; } });
  return best;
}
function giTag(name) {
  const gi = findGI(name); if (gi == null) return '';
  const [lv, c] = gi >= 70 ? ['高', 'var(--rose)'] : gi >= 56 ? ['中', 'var(--amber)'] : ['低', 'var(--sage)'];
  return `<span style="color:${c}">GI ${gi}${lv}</span>`;
}
// 同名食物合并克数
function mergeItems(items) {
  const out = [];
  items.forEach((it) => {
    const j = it.v ? out.findIndex((x) => x.v && x.name === it.name) : -1;
    if (j < 0) out.push({ ...it });
    else out[j] = { ...out[j], g: out[j].g + it.g, unsure: out[j].unsure || it.unsure, seen: out[j].seen || it.seen };
  });
  return out;
}
const mealsOf = (date) => S.food[date] || {};
function itemNut(it) {
  return Object.fromEntries(NK.map((k, i) => [k, ((it.v?.[i] || 0) * it.g) / 100]));
}
function sumItems(items) {
  const t = Object.fromEntries(NK.map((k) => [k, 0]));
  items.forEach((it) => { const n = itemNut(it); NK.forEach((k) => { t[k] += n[k]; }); });
  return t;
}
const notesList = () => String(S.settings.notes || '').split('\n').map((x) => x.trim()).filter(Boolean);
const catGrams = (date, cat) => Object.values(mealsOf(date)).flat()
  .reduce((s, it) => {
    const f = allFoods().find((x) => x.n === it.name);
    if (!f?.dish) return s + (f?.cat === cat ? it.g : 0);
    const w = f.recipe.reduce((t, [, g]) => t + g, 0);
    return s + f.recipe.reduce((t, [n, g]) => t + (findFood(n)?.cat === cat ? (it.g * g) / w : 0), 0);
  }, 0);
const dayTotals = (date) => sumItems(Object.values(mealsOf(date)).flat());
function setMealItems(date, mealId, items) {
  S.food = { ...S.food, [date]: { ...mealsOf(date), [mealId]: items } };
  save();
}
function kcalRing(v, t) {
  const r = 34, c = 2 * Math.PI * r, p = Math.min(1, t ? v / t : 0);
  const color = v > t * 1.1 ? 'var(--rose)' : 'var(--sage)';
  return `<div class="kcal-ring"><svg width="84" height="84" viewBox="0 0 84 84" aria-hidden="true">
    <circle cx="42" cy="42" r="${r}" fill="none" stroke="var(--line)" stroke-width="9"/>
    <circle cx="42" cy="42" r="${r}" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round"
      stroke-dasharray="${c * p} ${c}" opacity="${p > 0 ? 1 : 0}" transform="rotate(-90 42 42)"/>
    <text x="42" y="47" text-anchor="middle" font-size="15" font-weight="600" fill="currentColor">${Math.round(p * 100)}%</text></svg>
    <div><div style="font:600 26px var(--serif)">${Math.round(v)} <span class="muted">/ ${t} kcal</span></div>
    <div class="muted">${v < t ? `还可摄入约 ${Math.round(t - v)} kcal` : `已超出 ${Math.round(v - t)} kcal`}</div></div></div>`;
}
const CAP_KEYS = ['kcal', 'c', 'f']; // 这几项超标要提醒
function nutBar(k, v, t) {
  const n = NUTRIENTS.find((x) => x.k === k);
  const r = t ? v / t : 0;
  const cls = r > 1.15 ? 'over' : r < 0.8 ? 'low' : '';
  const gap = t - v;
  const gapTxt = gap > 0 ? `<span class="gap" style="color:var(--amber)">差 ${round(gap, k === 'fe' ? 1 : 0)}${n.unit}</span>`
    : r > 1.15 && CAP_KEYS.includes(k) ? `<span class="gap" style="color:var(--rose)">超 ${Math.round(-gap)}${n.unit}</span>`
    : `<span class="gap" style="color:var(--sage)">达标</span>`;
  return `<div class="nut"><div class="row"><span class="grow">${n.label}</span>
    <span class="val">${round(v, k === 'fe' ? 1 : 0)} / ${t}${n.unit}</span>${gapTxt}</div>
    <div class="pbar"><i class="${cls}" style="width:${Math.min(100, r * 100)}%"></i></div></div>`;
}
function remainingMeals(date) {
  if (date !== today()) return [];
  const nm = nowMin();
  return S.settings.meals.filter((m) => toMin(m.time) > nm);
}
function suggestions(date) {
  const tot = dayTotals(date), T = S.settings.targets;
  const out = [];
  const rest = remainingMeals(date).filter((m) => !(mealsOf(date)[m.id] || []).length);
  const restShare = rest.reduce((x, m) => x + Number(m.share || 0), 0) / 100;
  const where = rest.map((m) => m.name).slice(0, 2).join(' / ');
  const whereTxt = where ? `，可放在 ${where}` : '';
  const lead = restShare > 0 ? '按计划吃完剩余餐次后，预计' : '';
  ['p', 'c', 'kcal'].forEach((k) => {
    const gap = T[k] * (1 - restShare) - tot[k];
    if (gap <= T[k] * 0.1) return;
    const n = NUTRIENTS.find((x) => x.k === k);
    const idx = NK.indexOf(k);
    const need = BOOSTERS[k].map(([name, portion]) => {
      const f = FOODS.find((x) => x.n === name);
      return { name, portion, g: Math.ceil(gap / (f.v[idx] / 100) / 5) * 5 };
    });
    const fit = need.filter((x) => x.g <= x.portion * 2.5).slice(0, 3);
    const opts = fit.length ? fit.map((x) => `${x.name} ${x.g}g`).join(' 或 ')
      : `${need[0].name} ${need[0].portion * 2}g 等（一次补不完，分到几餐）`;
    out.push(`<div class="sugg"><b>${lead}${n.label}还差 ${round(gap, k === 'fe' ? 1 : 0)}${n.unit}</b>：可补 ${opts}${whereTxt}${k === 'c' && S.settings.gdm ? '（选低 GI 主食，注意餐后血糖）' : ''}</div>`);
  });
  const fruit = catGrams(date, '水果'), veg = catGrams(date, '蔬菜');
  if (S.settings.gdm && fruit > 200) out.push(`<div class="sugg" style="border-color:var(--rose)"><b>水果已 ${Math.round(fruit)}g</b>：超过每日 200g 上限，今天后面别再吃水果了</div>`);
  if (veg < 300) out.push(`<div class="sugg"><b>蔬菜 ${Math.round(veg)}g</b>：目标每天 300–500g，还差 ${Math.round(300 - veg)}g，可补 秋葵/茼蒿/芦笋/西蓝花${whereTxt}</div>`);
  if (tot.kcal > T.kcal * 1.1) out.push(`<div class="sugg"><b>热量超出 ${Math.round(tot.kcal - T.kcal)} kcal</b>：后面餐次减少主食和油，饭后散步 20 分钟</div>`);
  if (tot.f > T.f * 1.15) out.push('<div class="sugg"><b>脂肪偏高</b>：换成蒸/煮/凉拌，坚果控制在一小把</div>');
  if (tot.c > T.c * 1.15) out.push('<div class="sugg"><b>碳水偏多</b>：主食换一半杂粮，少喝含糖饮品，注意控糖</div>');
  return out.join('') || '<div class="sugg" style="border-color:var(--sage)"><b>各项基本达标</b>，保持就好 👍</div>';
}

/* ========== 营养页 ========== */
function renderFood() {
  const meals = S.settings.meals;
  const seg = `<div class="seg">${[{ id: 'all', name: '当日总览' }, ...meals].map((m) => `<button class="${ui.meal === m.id ? 'on' : ''}" data-act="meal" data-id="${m.id}">${esc(m.name)}</button>`).join('')}</div>`;
  $('#view').innerHTML = dateNav() + seg + (ui.meal === 'all' ? foodOverview() : foodMeal(ui.meal));
}
function foodOverview() {
  const tot = dayTotals(ui.date), T = S.settings.targets, m = mealsOf(ui.date);
  const hasAny = Object.values(m).some((x) => x.length);
  return `<div class="card"><h3>当日总览 <em>${hasAny ? '' : '还没有记录'}</em></h3>
      ${kcalRing(tot.kcal, T.kcal)}
      ${['p', 'c', 'f'].map((k) => nutBar(k, tot[k], T[k])).join('')}</div>
    <div class="card"><h3>各餐情况</h3>
      ${S.settings.meals.map((meal) => {
        const items = m[meal.id] || [];
        const k = sumItems(items).kcal, tk = Math.round(T.kcal * meal.share / 100);
        return `<div class="list-item" data-act="meal" data-id="${meal.id}"><div class="grow"><div>${esc(meal.name)} <span class="muted">${meal.time}</span></div>
          <div class="muted">${items.length ? esc(items.map((i) => i.name).join('、')) : '未记录'}</div></div>
          <div class="val" style="text-align:right;font-variant-numeric:tabular-nums">${Math.round(k)}<div class="muted">/ ${tk}</div></div></div>`;
      }).join('')}</div>
    <div class="card"><h3>调整建议 ${S.settings.ai.key ? '<button class="btn sm ghost" data-act="ai-advice">AI 建议</button>' : ''}</h3>
      ${suggestions(ui.date)}<div id="ai-advice"></div></div>
    ${notesList().length ? `<div class="card"><h3>医嘱要点</h3>${notesList().map((t) => `<div class="tip">${esc(t)}</div>`).join('')}</div>` : ''}
`;
}
function foodMeal(id) {
  const meal = S.settings.meals.find((m) => m.id === id);
  if (!meal) { ui.meal = 'all'; return foodOverview(); }
  const items = mealsOf(ui.date)[id] || [];
  const tot = sumItems(items), T = S.settings.targets;
  const share = meal.share / 100;
  return `<div class="card"><h3>${esc(meal.name)} <em>${meal.time} · 建议约 ${Math.round(T.kcal * share)} kcal</em></h3>
      <div class="plan-box">📋 ${esc(meal.plan || '（在设置里填写这一餐的计划）')}</div>
      <div class="grid3">
        <button class="btn sm ghost" data-act="pick-food">＋ 选食物</button>
        <button class="btn sm ghost" data-act="text-food">✎ 文字录入</button>
        <label class="btn sm ghost" style="text-align:center">◉ 拍照识别<input type="file" accept="image/*" hidden id="photo-in"></label>
      </div></div>
    <div class="card"><h3>已吃 <em>${Math.round(tot.kcal)} kcal</em></h3>
      ${items.length ? items.map((it) => {
        const n = itemNut(it);
        return `<div class="food-row" data-act="edit-item" data-id="${it.id}"><div class="grow">${esc(it.name)} <span class="muted">${it.g}g</span>
          <div class="k">蛋白 ${round(n.p, 1)}g · 碳水 ${round(n.c, 1)}g · 脂肪 ${round(n.f, 1)}g</div></div>
          <div class="val">${Math.round(n.kcal)} kcal</div></div>`;
      }).join('') : '<div class="empty">还没有记录，点上面的按钮添加</div>'}
      ${items.length ? `<div style="margin-top:10px">${['kcal', 'p', 'c', 'f'].map((k) => nutBar(k, tot[k], round(T[k] * share, k === 'fe' ? 1 : 0))).join('')}</div>` : ''}
    </div>`;
}

/* 选食物 */
function openFoodPicker() {
  ui.picked = null; ui.q = ''; ui.cat = '全部';
  openSheet(`<h2>选择食物</h2>
    <input class="inp" id="food-q" placeholder="搜索：鸡蛋、牛奶、米饭…" autocomplete="off">
    <div id="food-cats" style="margin-top:10px"></div>
    <div id="food-list" style="max-height:44vh;overflow-y:auto"></div>
    <button class="btn sm ghost" style="margin-top:10px" data-act="new-food">＋ 新建自定义食物</button>`);
  $('#food-q').oninput = (e) => { ui.q = e.target.value.trim(); renderFoodList(); };
  renderFoodList();
}
function renderFoodList() {
  const cats = ['全部', '我的', '家常菜', ...new Set(FOODS.map((f) => f.cat))];
  $('#food-cats').innerHTML = cats.map((c) => `<button class="chip ${ui.cat === c ? 'on' : ''}" data-act="food-cat" data-cat="${c}">${c}</button>`).join('');
  const inCat = (f) => ui.cat === '全部' || (ui.cat === '我的' ? f.mine : f.cat === ui.cat);
  const hit = (f) => !ui.q || f.n.includes(ui.q) || (f.a || []).some((a) => a.includes(ui.q));
  // 不搜索时只列常用食物和家常菜；搜索或选了分类时再带上食物成分表
  const pool = ui.q || !['全部', '我的', '家常菜'].includes(ui.cat) ? allFoods() : coreFoods();
  const list = pool.filter((f) => inCat(f) && hit(f)).slice(0, 80);
  $('#food-list').innerHTML = list.map((f) => {
    const gi = giTag(f.n);
    return `<div class="food-row" data-act="pick-one" data-name="${esc(f.n)}"><div class="grow">${esc(f.n)}${f.db ? ' <span class="muted" style="font-size:11px">成分表</span>' : ''}
      <div class="k">每100g ${f.v[0]}kcal · 蛋白 ${f.v[1]}g${f.u ? ` · ${f.u[0][0]}≈${f.u[0][1]}g` : ''}${gi ? ` · ${gi}` : ''}</div></div><span class="muted">›</span></div>`;
  }).join('') || '<div class="empty">没找到，可以新建自定义食物</div>';
}
function openGramSheet(food, item) {
  const g0 = item ? item.g : (food.u?.[0]?.[1] || 100);
  openSheet(`<h2>${esc(food.n || food.name)}</h2>
    <div>${(food.u || []).map(([n, g]) => `<button class="chip" data-act="set-g" data-g="${g}">${n} ${g}g</button>`).join('')}
      ${[50, 100, 150, 200].map((g) => `<button class="chip" data-act="set-g" data-g="${g}">${g}g</button>`).join('')}</div>
    ${food.recipe ? `<p class="muted" style="margin:8px 0 0">参考做法（整盘生重）：${food.recipe.map(([n, g]) => `${esc(n)} ${g}g`).join(' + ')}</p>` : ''}
    ${giTag(food.n || food.name) ? `<p class="muted" style="margin:6px 0 0">血糖生成指数 ${giTag(food.n || food.name)}</p>` : ''}
    <label class="f">实际食用克数<input type="number" inputmode="decimal" id="gram-in" value="${g0}" min="1"></label>
    <div id="gram-calc" class="plan-box"></div>
    <div class="actions">${item ? `<button class="btn ghost" data-act="del-item" data-id="${item.id}">删除</button>` : ''}
      <button class="btn" data-act="save-gram">${item ? '保存' : '加入' + esc(S.settings.meals.find((m) => m.id === ui.meal)?.name || '')}</button></div>`);
  ui.picked = { food, item };
  const calc = () => {
    const g = Number($('#gram-in').value) || 0;
    const n = itemNut({ g, v: food.v });
    $('#gram-calc').textContent = NUTRIENTS.filter((x) => ['kcal', 'p', 'c', 'f'].includes(x.k)).map((x) => `${x.label} ${round(n[x.k], x.k === 'kcal' ? 0 : 1)}${x.unit}`).join(' · ');
  };
  $('#gram-in').oninput = calc; calc();
}
function saveGram() {
  const { food, item } = ui.picked || {}; if (!food) return;
  const g = Number($('#gram-in').value);
  if (!(g > 0)) return toast('请输入克数');
  const items = mealsOf(ui.date)[ui.meal] || [];
  const next = item ? items.map((x) => (x.id === item.id ? { ...x, g } : x))
    : mergeItems([...items, { id: uid(), name: food.n, g, v: food.v }]);
  setMealItems(ui.date, ui.meal, next); closeSheet(); render(); toast(item ? '已更新' : '已加入');
}
// 新建 / 编辑自定义食物；idx 有值时是编辑「我的食物」里的第 idx 个
function openNewFood(idx, fromSettings) {
  const old = idx != null ? S.myFoods[idx] : null;
  const val = (k) => (old ? old.v[NK.indexOf(k)] : 0);
  openSheet(`<h2>${old ? '编辑自定义食物' : '新建自定义食物'}</h2><form id="nf-form">
    <label class="btn sm ghost block" style="text-align:center;margin-bottom:12px">📷 拍营养成分表 / 食物照片，自动填写<input type="file" accept="image/*" hidden id="nf-photo"></label>
    <div id="nf-status" class="muted" style="margin:-4px 0 10px"></div>
    <label class="f">名称<input name="n" required value="${esc(old?.n || '')}" placeholder="如：妈妈做的红烧肉"></label>
    <p class="muted">以下填每 100g 含量（包装营养成分表上能找到；不确定可只填热量和蛋白质）</p>
    <div class="grid2">${NUTRIENTS.map((x) => `<label class="f">${x.label}(${x.unit})<input name="${x.k}" type="number" step="any" inputmode="decimal" value="${round(val(x.k), 1)}"></label>`).join('')}
      <label class="f">一份约(g)<input name="unit" type="number" inputmode="decimal" value="${old?.u?.[0]?.[1] || ''}" placeholder="可不填"></label></div>
    ${old ? '<p class="muted">修改后只影响之后的记录，已经记下的不变</p>' : ''}
    <div class="actions">${old ? `<button type="button" class="btn ghost" data-act="del-myfood" data-i="${idx}">删除</button>` : ''}
      <button class="btn">${old ? '保存' : '保存到我的食物'}</button></div></form>`);
  $('#nf-photo').onchange = (e) => { if (e.target.files[0]) recognizeFoodLabel(e.target.files[0]); e.target.value = ''; };
  $('#nf-form').onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const n = f.n.trim(); if (!n) return toast('请填写名称');
    const food = { n, cat: '我的', mine: true, v: NK.map((k) => Math.max(0, Number(f[k]) || 0)), u: f.unit ? [['一份', Number(f.unit)]] : undefined };
    const rest = S.myFoods.filter((x, i) => i !== idx && x.n !== n);
    S.myFoods = old ? [...rest.slice(0, idx), food, ...rest.slice(idx)] : [food, ...rest];
    save(); toast('已保存');
    if (fromSettings) { closeSheet(); render(); } else openGramSheet(food);
  };
}
const LABEL_PROMPT = '你是注册营养师。用户发来包装食品的营养成分表，或一份食物/菜的照片。'
  + '有营养成分表就按表读取（能量是 kJ 时换算成 kcal：kJ÷4.184；表是"每份"时按份量换算成每100g）；没有表就按《中国食物成分表》估算。'
  + '只输出 JSON：{"name":"食物名","per100":[热量kcal,蛋白质g,脂肪g,碳水g,钙mg,铁mg,膳食纤维g],"serving":每份克数或null,"from":"label 或 estimate"}，表里没有的项填 0。';
async function recognizeFoodLabel(file) {
  if (!hasAI()) return toast('识别需要先在设置里配置 AI 接口');
  const st = $('#nf-status');
  st.innerHTML = '<span class="spin"></span> 识别中…';
  try {
    const img = await compressImage(file, 1400);
    const out = await callLLM([{ role: 'system', content: LABEL_PROMPT },
      { role: 'user', content: [{ type: 'text', text: '识别这张图的营养成分' }, { type: 'image_url', image_url: { url: img } }] }]);
    const m = out.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('没读到结果');
    const r = JSON.parse(m[0]);
    if (!Array.isArray(r.per100)) throw new Error('格式不对');
    const form = $('#nf-form'); if (!form) return;
    if (r.name && !form.n.value.trim()) form.n.value = String(r.name).slice(0, 30);
    NK.forEach((k, i) => { form[k].value = round(Math.max(0, Number(r.per100[i]) || 0), 1); });
    if (r.serving && !form.unit.value) form.unit.value = Math.round(Number(r.serving)) || '';
    st.textContent = r.from === 'label' ? '✓ 已按营养成分表填好，请核对一下' : '✓ 没看到营养成分表，已按常见做法估算，请核对';
  } catch (e) {
    st.textContent = `识别失败：${e.message}`;
  }
}

/* 文字录入 / 本地解析 */
const CN_NUM = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 半: 0.5 };
function findFood(name) {
  if (!name) return null;
  const core = coreFoods();
  return exactFind(core, name) || exactFind(DB_FOODS, name) || fuzzyFind(core, name) || fuzzyFind(DB_FOODS, name);
}
// 每"1 个单位"的克数：份量名里自带数量（如"3勺"30g、"半个"70g）时折算回单个
function unitGrams(food, measure) {
  const u = (measure && food.u?.find(([n]) => n.includes(measure))) || food.u?.[0]; if (!u) return 100;
  const m = u[0].match(/^(\d+(?:\.\d+)?|[一两二三四五六半])/);
  const n = m ? (CN_NUM[m[1]] ?? Number(m[1])) : 1;
  return u[1] / (n || 1);
}
function parsePiece(raw) {
  let s = raw.trim(); if (!s) return null;
  let g = null, count = null, measure = null;
  const mg = s.match(/(\d+(?:\.\d+)?)\s*(g|克|ml|毫升)/i);
  if (mg) { g = Number(mg[1]); s = s.replace(mg[0], ''); }
  else {
    const mc = s.match(/(\d+(?:\.\d+)?|[一两二三四五六半])\s*(个|碗|杯|片|根|盒|份|块|勺|颗|把|小把)/);
    if (mc) { count = CN_NUM[mc[1]] ?? Number(mc[1]); measure = mc[2]; s = s.replace(mc[0], ''); }
  }
  const name = s.replace(/[\s。.]/g, '');
  const food = findFood(name);
  if (!food) return { id: uid(), name: name || raw, g: g || 100, v: null, raw };
  if (g == null) g = Math.round(unitGrams(food, measure) * (count ?? 1));
  return { id: uid(), name: food.n, g, v: food.v };
}
function openTextFood() {
  openSheet(`<h2>文字录入</h2>
    <p class="muted">用逗号或换行分隔，可写克数或份数，例如：<br>米饭150g，鸡蛋2个，清炒西兰花200g，牛奶一盒</p>
    <textarea class="inp" id="food-text" rows="4" placeholder="今天${esc(S.settings.meals.find((m) => m.id === ui.meal)?.name || '')}吃了…"></textarea>
    <div class="actions"><button class="btn" data-act="parse-text">识别</button></div>`);
  setTimeout(() => $('#food-text')?.focus(), 300);
}
async function parseText() {
  const text = $('#food-text').value.trim(); if (!text) return toast('先写点内容');
  const pieces = text.split(/[,，、;；\n+＋]|和/).map(parsePiece).filter(Boolean);
  const unmatched = pieces.filter((p) => !p.v);
  let items = pieces.filter((p) => p.v);
  if (unmatched.length && hasAI()) {
    const btn = $('[data-act="parse-text"]'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span> AI 估算中';
    try {
      const ai = await aiRecognize({ text: unmatched.map((u) => u.raw).join('，') });
      items = [...items, ...ai];
    } catch (e) {
      toast(`AI 失败：${e.message}`); items = [...items, ...unmatched];
    }
  } else items = [...items, ...unmatched];
  openReview(mergeItems(items), text);
}

/* 识别结果确认 */
function openReview(items, source) {
  ui.review = items; ui.reviewSrc = source;
  const rows = items.map((it) => {
    const k = it.v ? Math.round((it.v[0] * it.g) / 100) : '?';
    const hint = [it.unsure ? '<span style="color:var(--amber)">⚠ 拿不准，请核对</span>' : '', it.seen ? `看到：${esc(it.seen)}` : '', giTag(it.name),
      it.v ? '' : '<span style="color:var(--rose)">未匹配，改成库内名称或用「选食物」</span>'].filter(Boolean).join(' · ');
    return `<div class="food-row"><div class="grow"><input class="inp" style="margin:0;padding:6px 8px;font-size:15px" value="${esc(it.name)}" data-rname="${it.id}">
      ${hint ? `<div class="k" style="margin-top:2px">${hint}</div>` : ''}</div>
      <input class="inp num-in" type="number" inputmode="decimal" value="${it.g}" data-rid="${it.id}">g
      <span class="k" style="width:58px;text-align:right">${k} kcal</span>
      <button class="icon-btn" data-act="rm-review" data-id="${it.id}" aria-label="移除">×</button></div>`;
  }).join('');
  openSheet(`<h2>确认识别结果</h2>
    ${source && source.startsWith('data:') ? `<img class="preview-img" src="${source}" alt="">` : ''}
    <p class="muted">认错了就直接改菜名（会按食物库重新算营养），克数也可改；未匹配的项会被跳过</p>
    ${rows || '<div class="empty">没识别到食物</div>'}
    <div class="actions"><button class="btn ghost" data-act="pick-food">选食物</button><button class="btn" data-act="confirm-review">全部加入</button></div>`);
  document.querySelectorAll('[data-rname]').forEach((inp) => {
    inp.onchange = () => {
      const food = findFood(inp.value.trim());
      ui.review = ui.review.map((x) => (x.id === inp.dataset.rname
        ? { ...x, name: food ? food.n : inp.value.trim(), v: food ? food.v : x.v, unsure: false } : x));
      openReview(mergeItems(ui.review), source);
      if (!food) toast('食物库里没找到这个名称，营养沿用 AI 估算');
    };
  });
  document.querySelectorAll('[data-rid]').forEach((inp) => {
    inp.oninput = () => { ui.review = ui.review.map((x) => (x.id === inp.dataset.rid ? { ...x, g: Number(inp.value) || 0 } : x)); };
  });
}
function confirmReview() {
  const ok = (ui.review || []).filter((x) => x.v && x.g > 0).map(({ id, name, g, v }) => ({ id, name, g, v }));
  if (!ok.length) return toast('没有可加入的项');
  const before = mealsOf(ui.date)[ui.meal] || [];
  const merged = mergeItems([...before, ...ok]).map(({ id, name, g, v }) => ({ id, name, g, v }));
  const combined = before.length + ok.length - merged.length;
  setMealItems(ui.date, ui.meal, merged);
  closeSheet(); render(); toast(`已加入 ${ok.length} 项${combined ? `（${combined} 项与已有同名食物合并了克数）` : ''}`);
}

/* ========== AI（OpenAI 兼容接口，key 只存在本机） ========== */
const hasAI = () => !!(S.settings.ai.base && S.settings.ai.key);
async function callLLM(messages, opts = {}) {
  const { base, key, model } = S.settings.ai;
  const body = { model: opts.model || model, messages, ...(opts.noTemp ? {} : { temperature: 0.2 }), ...(opts.extra || {}) };
  const res = await fetch(`${base.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  const content = j.choices?.[0]?.message?.content;
  if (!content) throw new Error('返回为空');
  return content;
}
const RECOG_PROMPT = '你是注册营养师，擅长从照片识别中式家常菜。步骤：先仔细看每样食物的颜色、形状、切法、质地和所在餐具，再判断是什么；'
  + '用户提供了这一餐的饮食计划和常用食物清单，实际吃的大概率在其中，外观吻合时优先用清单里的名称，外观明显不符时如实写出别的名称，不要硬套。'
  + '按碗/盘/勺大小估算实际重量(克)。混合菜拆成主要食材（含烹调油）分别列出。'
  + '只输出 JSON 数组，不要任何解释。每项格式：{"seen":"外观描述(15字内)","name":"食物名","grams":数字,"sure":true或false,'
  + '"per100":[热量kcal,蛋白质g,脂肪g,碳水g,钙mg,铁mg,膳食纤维g]}。看不清或拿不准时 sure 写 false。';
function recogContext() {
  const meal = S.settings.meals.find((m) => m.id === ui.meal);
  const names = coreFoods().map((f) => f.n).join('、');
  return `${meal ? `这一餐是「${meal.name}」，计划：\n${meal.plan}\n` : ''}常用食物清单：${names}`;
}
async function aiRecognize({ text, image }) {
  const ctx = recogContext();
  const content = image
    ? [{ type: 'text', text: `${ctx}\n\n识别照片里这顿饭吃了什么。` }, { type: 'image_url', image_url: { url: image } }]
    : `${ctx}\n\n识别：${text}`;
  const out = await callLLM([{ role: 'system', content: RECOG_PROMPT }, { role: 'user', content }]);
  const m = out.match(/\[[\s\S]*\]/);
  if (!m) throw new Error('没解析到结果');
  const arr = JSON.parse(m[0]);
  if (!Array.isArray(arr)) throw new Error('格式不对');
  return mergeItems(arr.filter((x) => x && x.name).map((x) => {
    const name = String(x.name).slice(0, 30);
    const food = findFood(name);
    // 库里有的食物用库内营养数据，模型只负责认菜和估克数
    const v = food ? food.v : Array.isArray(x.per100) ? NK.map((_, i) => Math.max(0, Number(x.per100[i]) || 0)) : null;
    return { id: uid(), name: food ? food.n : name, g: Math.max(1, Math.round(Number(x.grams) || 100)), v,
      seen: String(x.seen || '').slice(0, 30), unsure: x.sure === false };
  }));
}
function compressImage(file, max = 1536) {
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读取失败')); };
    img.src = url;
  });
}
async function handlePhoto(file) {
  if (!hasAI()) { toast('拍照识别需要先在设置里配置 AI 接口'); return; }
  openSheet('<h2>识别中…</h2><div class="empty"><span class="spin"></span> 正在分析这顿饭</div>');
  try {
    const img = await compressImage(file);
    const items = await aiRecognize({ image: img });
    openReview(items, img);
  } catch (e) {
    closeSheet(); toast(`识别失败：${e.message}`);
  }
}
async function aiAdvice() {
  const box = $('#ai-advice'); if (!box) return;
  box.innerHTML = '<div class="ai-box"><span class="spin"></span> 思考中…</div>';
  const g = gaInfo(ui.date), T = S.settings.targets, tot = dayTotals(ui.date), m = mealsOf(ui.date);
  const eaten = S.settings.meals.map((meal) => `${meal.name}：${(m[meal.id] || []).map((i) => `${i.name}${i.g}g`).join('、') || '未记录'}`).join('\n');
  const prompt = `孕周：${g ? `${g.w}周+${g.d}天` : '孕晚期'}；当前时间 ${hm(nowMin())}。\n每日目标：${NUTRIENTS.map((x) => `${x.label}${T[x.k]}${x.unit}`).join('，')}\n`
    + `已摄入：${NUTRIENTS.map((x) => `${x.label}${round(tot[x.k], 1)}${x.unit}`).join('，')}\n各餐：\n${eaten}\n`
    + `营养计划：\n${S.settings.meals.map((x) => `${x.name}(${x.time})：${x.plan}`).join('\n')}\n`
    + '请用中文给出 3 条以内、具体到食物和克数的调整建议（剩余餐次怎么吃），150 字以内，不要寒暄。';
  try {
    const out = await callLLM([{ role: 'system', content: '你是专业孕期营养师，建议务实、安全。' }, { role: 'user', content: prompt }]);
    box.innerHTML = `<div class="ai-box">${esc(out)}</div>`;
  } catch (e) {
    box.innerHTML = `<div class="ai-box">AI 调用失败：${esc(e.message)}（检查接口地址/Key，或接口不允许浏览器跨域调用）</div>`;
  }
}

/* ========== 设置 ========== */
function renderSettings() {
  const st = S.settings;
  $('#view').innerHTML = `
    <div class="card"><h3>预产期</h3>
      <label class="f">预产期（EDD）<input type="date" data-set="due" value="${st.due}"></label>
      <p class="muted">孕周按 预产期 − 280 天 推算</p></div>
    <div class="card"><h3>每日营养目标 <button class="btn sm ghost" data-act="reset-targets">恢复默认</button></h3>
      <div class="grid2">${NUTRIENTS.map((x) => `<label class="f">${x.label}(${x.unit})<input type="number" inputmode="decimal" data-target="${x.k}" value="${st.targets[x.k]}"></label>`).join('')}</div>
      <p class="muted">默认值参考中国营养学会孕晚期推荐量，请以医生/营养师给你的为准</p>
      <label class="row" style="margin-top:6px"><input type="checkbox" data-flag="gdm" ${st.gdm ? 'checked' : ''}> <span>妊娠期糖尿病（GDM）模式：水果≤200g 提醒、正餐后运动提醒</span></label>
      <label class="f" style="margin-top:12px">医嘱要点（一行一条，显示在营养页）<textarea data-set="notes" rows="4">${esc(st.notes)}</textarea></label></div>
    <div class="card"><h3>营养计划（按餐）</h3>
      ${st.meals.map((m, i) => `<div style="border-bottom:1px solid var(--line);padding-bottom:8px;margin-bottom:10px">
        <div class="grid3 meal-row"><label class="f">餐次<input data-meal="${i}" data-k="name" value="${esc(m.name)}"></label>
        <label class="f">时间<input type="time" data-meal="${i}" data-k="time" value="${m.time}"></label>
        <label class="f">热量占比%<input type="number" data-meal="${i}" data-k="share" value="${m.share}"></label></div>
        <label class="f">建议吃什么<textarea data-meal="${i}" data-k="plan" rows="2">${esc(m.plan)}</textarea></label></div>`).join('')}
      <p class="muted">占比合计：${st.meals.reduce((s, m) => s + Number(m.share || 0), 0)}%（建议 100%）</p></div>
    <div class="card"><h3>活动类型 <button class="btn sm ghost" data-act="add-type">+ 新增</button></h3>
      ${S.types.map((t, i) => `<div class="row" style="margin-bottom:8px">
        <input type="color" data-type-i="${i}" data-k="color" value="${t.color}" style="width:36px;height:36px;border:0;background:none;padding:0">
        <input class="inp grow" style="margin:0" data-type-i="${i}" data-k="name" value="${esc(t.name)}">
        <input class="inp num-in" type="number" data-type-i="${i}" data-k="dur" value="${t.dur}"><span class="muted">分</span>
        <button class="icon-btn" data-act="del-type" data-i="${i}" aria-label="删除">×</button></div>`).join('')}</div>
    <div class="card"><h3>AI 识别（可选）</h3>
      <p class="muted" style="margin-top:0">拍照识别和 AI 建议需要一个支持图片的 OpenAI 兼容接口。Key 只保存在这台手机本地。</p>
      <label class="f">接口地址 base_url<input data-ai="base" value="${esc(st.ai.base)}" placeholder="https://api.openai.com/v1"></label>
      <label class="f">API Key<input type="password" data-ai="key" value="${esc(st.ai.key)}" placeholder="sk-..."></label>
      <label class="f">模型（需支持图片）<input data-ai="model" value="${esc(st.ai.model)}" placeholder="gpt-4o-mini"></label>
      <label class="f">联网时用的模型（可选）<input data-ai="searchModel" value="${esc(st.ai.searchModel || '')}" placeholder="如 openai/gpt-4o-mini:online"></label>
      <label class="f">联网附加参数 JSON（可选）<input data-ai="searchExtra" value="${esc(st.ai.searchExtra || '')}" placeholder='如 {"web_search_options":{}}'></label>
      <p class="muted">联网示例：OpenRouter 接口 https://openrouter.ai/api/v1，联网模型填「模型名:online」；OpenAI 接口填 gpt-4o-mini-search-preview，附加参数填 {"web_search_options":{}}</p>
      <button class="btn sm ghost" data-act="test-ai">测试连接</button> <span id="ai-test" class="muted"></span></div>
    <div class="card"><h3>我的食物</h3>
      ${S.myFoods.map((f, i) => `<div class="list-item" data-act="edit-myfood" data-i="${i}"><div class="grow">${esc(f.n)}
          <div class="muted">每100g ${round(f.v[0])}kcal · 蛋白 ${round(f.v[1], 1)}g · 碳水 ${round(f.v[3], 1)}g · 脂肪 ${round(f.v[2], 1)}g</div></div>
        <span class="muted">编辑 ›</span></div>`).join('') || '<div class="empty">还没有自定义食物</div>'}
      <button class="btn sm ghost" style="margin-top:8px" data-act="add-myfood">＋ 新建（可拍营养成分表）</button></div>
    <div class="card"><h3>数据备份</h3>
      <p class="muted" style="margin-top:0">数据只存在本机浏览器里。换手机或清理 Safari 前记得导出。</p>
      <div class="grid3"><button class="btn sm ghost" data-act="export">导出</button>
        <label class="btn sm ghost" style="text-align:center">导入<input type="file" accept="application/json,.json" hidden id="import-in"></label>
        <button class="btn sm ghost" data-act="wipe">清空</button></div></div>
    <div class="card"><h3>版本 <em>${APP_VERSION}</em></h3>
      <p class="muted" style="margin-top:0">看不到新功能时点这里，只清网页缓存，不会删你的记录。</p>
      <button class="btn sm ghost" data-act="force-update">强制更新</button></div>`;
}
function bindSettings() {
  const v = $('#view');
  v.addEventListener('change', (e) => {
    const el = e.target, d = el.dataset;
    if (d.set) { S.settings = { ...S.settings, [d.set]: el.value }; }
    else if (d.flag) { S.settings = { ...S.settings, [d.flag]: el.checked }; }
    else if (d.target) { S.settings = { ...S.settings, targets: { ...S.settings.targets, [d.target]: Number(el.value) || 0 } }; }
    else if (d.meal !== undefined) {
      const val = d.k === 'share' ? Number(el.value) || 0 : el.value;
      S.settings = { ...S.settings, meals: S.settings.meals.map((m, i) => (i === Number(d.meal) ? { ...m, [d.k]: val } : m)) };
    } else if (d.typeI !== undefined) {
      const val = d.k === 'dur' ? Math.max(5, Number(el.value) || 30) : el.value;
      S.types = S.types.map((t, i) => (i === Number(d.typeI) ? { ...t, [d.k]: val } : t));
    } else if (d.ai) { S.settings = { ...S.settings, ai: { ...S.settings.ai, [d.ai]: el.value.trim() } }; }
    else if (el.id === 'import-in') { importData(el.files[0]); return; }
    else return;
    save(); renderTop();
    if (d.meal !== undefined && d.k === 'share') renderSettings();
    toast('已保存');
  });
}
function exportData() {
  // 备份里不带 API Key，避免文件外传时泄露
  const safe = { ...S, settings: { ...S.settings, ai: { ...S.settings.ai, key: '' } } };
  const blob = new Blob([JSON.stringify(safe, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `孕晚期手帐备份_${today()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function importData(file) {
  if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const s = JSON.parse(r.result);
      if (!s.settings || !s.types) throw new Error('不是本工具的备份文件');
      if (!confirm('导入会覆盖当前所有数据，继续？')) return;
      // 备份里没有 Key 时保留本机已填的 Key
      const ai = { ...(s.settings.ai || {}), key: s.settings.ai?.key || S.settings.ai.key };
      localStorage.setItem(KEY, JSON.stringify({ ...s, settings: { ...s.settings, ai } })); S = load(); render(); toast('导入成功');
    } catch (e) { toast(`导入失败：${e.message}`); }
  };
  r.readAsText(file);
}

/* ========== 动作分发 ========== */
const ACTIONS = {
  ...MED_ACTIONS,
  tab: (t) => switchTab(t.dataset.tab),
  'close-sheet': closeSheet,
  view: (t) => { ui.view = t.dataset.v; render(); },
  'goto-day': (t) => { ui.date = t.dataset.date; ui.view = 'day'; render(); window.scrollTo(0, 0); },
  shift: (t) => {
    const n = Number(t.dataset.n);
    if (!n) ui.date = today();
    else if (ui.view === 'week') ui.date = addDays(ui.date, 7 * n);
    else { const d = parseYmd(ui.date); ui.date = ymd(new Date(d.getFullYear(), d.getMonth() + n, 1)); }
    render();
  },
  day: (t) => { const n = Number(t.dataset.n); ui.date = n ? addDays(ui.date, n) : today(); render(); },
  'new-act': () => openActSheet(null),
  'quick-act': (t) => openActSheet(null, { type: t.dataset.type, start: ui.date === today() ? Math.ceil(nowMin() / 30) * 30 : 9 * 60 }),
  'edit-act': (t) => { if (Date.now() > dragGuardUntil) openActSheet(t.dataset.id); },
  'del-act': (t) => deleteAct(t.dataset.id),
  'pick-type': (t) => {
    document.querySelectorAll('[data-act="pick-type"]').forEach((b) => b.classList.toggle('on', b === t));
    const f = $('#act-form'); const ty = typeOf(t.dataset.type);
    const prevType = typeOf(f.type.value);
    if (!f.title.value || f.title.value === prevType.name) f.title.value = ty.name;
    f.type.value = ty.id;
    if (f.dur && [...f.dur.options].some((o) => Number(o.value) === ty.dur)) f.dur.value = ty.dur;
  },
  'toggle-done': (t) => { const f = findAct(t.dataset.id); if (f) { updateAct(f.date, f.a.id, { done: !f.a.done }); render(); } },
  meal: (t) => { ui.meal = t.dataset.id; render(); },
  'pick-food': () => openFoodPicker(),
  'food-cat': (t) => { ui.cat = t.dataset.cat; renderFoodList(); },
  'pick-one': (t) => openGramSheet(allFoods().find((f) => f.n === t.dataset.name)),
  'set-g': (t) => { $('#gram-in').value = t.dataset.g; $('#gram-in').dispatchEvent(new Event('input')); },
  'save-gram': saveGram,
  'edit-item': (t) => {
    const it = (mealsOf(ui.date)[ui.meal] || []).find((x) => x.id === t.dataset.id); if (!it) return;
    const base = allFoods().find((f) => f.n === it.name);
    openGramSheet({ n: it.name, v: it.v, u: base?.u }, it);
  },
  'del-item': (t) => { setMealItems(ui.date, ui.meal, (mealsOf(ui.date)[ui.meal] || []).filter((x) => x.id !== t.dataset.id)); closeSheet(); render(); toast('已删除'); },
  'new-food': () => openNewFood(),
  'text-food': openTextFood,
  'parse-text': parseText,
  'rm-review': (t) => { openReview(ui.review.filter((x) => x.id !== t.dataset.id), ui.reviewSrc); },
  'confirm-review': confirmReview,
  'ai-advice': aiAdvice,
  'reset-targets': () => { S.settings = { ...S.settings, targets: { ...DEFAULT_TARGETS } }; save(); render(); toast('已恢复默认'); },
  'add-type': () => { S.types = [...S.types, { id: uid(), name: '新活动', color: '#6E9BC5', dur: 60 }]; save(); render(); },
  'del-type': (t) => { if (confirm('删除这个活动类型？已排的活动会保留（显示为"其他"颜色）')) { S.types = S.types.filter((_, i) => i !== Number(t.dataset.i)); save(); render(); } },
  'del-myfood': (t) => {
    const f = S.myFoods[Number(t.dataset.i)];
    if (!f || !confirm(`删除「${f.n}」？已经记下的不受影响`)) return;
    S.myFoods = S.myFoods.filter((_, i) => i !== Number(t.dataset.i)); save(); closeSheet(); render();
  },
  'edit-myfood': (t) => openNewFood(Number(t.dataset.i), true),
  'add-myfood': () => openNewFood(null, true),
  'test-ai': async () => {
    const out = $('#ai-test'); out.textContent = '测试中…';
    try { await callLLM([{ role: 'user', content: '回复"ok"' }]); out.textContent = '✓ 连接正常'; }
    catch (e) { out.textContent = `✗ ${e.message}（可能是 Key 错误或接口不允许浏览器跨域）`; }
  },
  export: exportData,
  'force-update': async () => {
    toast('正在更新…');
    try {
      if ('serviceWorker' in navigator) (await navigator.serviceWorker.getRegistrations()).forEach((r) => r.unregister());
      if (window.caches) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
    } catch (e) { toast(`清缓存失败：${e.message}`); }
    location.replace(`${location.pathname}?v=${Date.now()}`);
  },
  wipe: () => { if (confirm('清空所有数据？此操作无法撤销，建议先导出')) { S = defaultState(); save(); render(); toast('已清空'); } },
};
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const fn = ACTIONS[t.dataset.act];
  if (fn) { e.preventDefault(); fn(t, e); }
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'photo-in' && e.target.files[0]) handlePhoto(e.target.files[0]);
});
$('#mask').addEventListener('click', closeSheet);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
// 从弹层顶部下拉关闭
(() => {
  const sh = $('#sheet'); let y0 = null;
  sh.addEventListener('touchstart', (e) => { y0 = sh.scrollTop <= 0 && e.touches[0].clientY - sh.getBoundingClientRect().top < 60 ? e.touches[0].clientY : null; }, { passive: true });
  sh.addEventListener('touchend', (e) => { if (y0 != null && e.changedTouches[0].clientY - y0 > 80) closeSheet(); y0 = null; });
})();

/* ========== 路由 ========== */
function switchTab(tab) {
  ui.tab = tab;
  document.querySelectorAll('.tabs button[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  closeSheet(); render(); window.scrollTo(0, 0);
}
document.querySelectorAll('.tabs button[data-tab]').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
function render() {
  const fresh = $('#view').cloneNode(false); // 换节点以清掉上一页绑定的监听
  $('#view').replaceWith(fresh);
  ({ today: renderToday, plan: renderPlan, food: renderFood, set: renderSettings })[ui.tab]();
  if (ui.tab === 'plan' && ui.view === 'day') bindTimelineDrag();
  if (ui.tab === 'plan' && ui.view === 'week') bindWeekDrag();
  if (ui.tab === 'plan') bindPlanSwipe();
  if (ui.tab === 'set') bindSettings();
  renderTop();
}
render();
if (!S.settings.due) switchTab('set');
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
