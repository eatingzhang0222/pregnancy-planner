'use strict';
/* 每日用药打卡：S.meds 定义药物，S.medLog[date]['id:时段'] = true 表示已吃。
   在 app.js 之前加载，只定义函数；app.js 的 ACTIONS 合并 MED_ACTIONS。 */

const MED_SLOTS = [['', '每天 1 次'], ['早,晚', '早晚各 1 次'], ['早,中,晚', '早中晚各 1 次']];
const MED_EVERY = [[1, '每天'], [2, '隔天'], [3, '每 3 天']];

function medDue(m, date) {
  if (!(m.every > 1) || !m.anchor) return true;
  const k = diffDays(date, m.anchor) % m.every;
  return (k + m.every) % m.every === 0;
}
function medNext(m, date) {
  for (let i = 1; i <= m.every; i += 1) { const d = addDays(date, i); if (medDue(m, d)) return d; }
  return date;
}
const medKey = (m, slot) => `${m.id}:${slot}`;

function medsCard(date) {
  const meds = S.meds || [];
  const log = (S.medLog || {})[date] || {};
  let total = 0, done = 0;
  const rows = meds.map((m) => {
    if (!medDue(m, date)) {
      const n = medNext(m, date);
      return `<div class="med off"><span class="check"></span><span class="grow">${esc(m.name)}</span>
        <span class="slot">今天休息 · ${diffDays(n, date) === 1 ? '明天' : `${n.slice(5)}`}吃</span></div>`;
    }
    return m.slots.map((slot) => {
      const k = medKey(m, slot), on = !!log[k];
      total += 1; if (on) done += 1;
      return `<button class="med ${on ? 'on' : ''}" data-act="med-tick" data-k="${esc(k)}">
        <span class="check ${on ? 'on' : ''}">${on ? '✓' : ''}</span><span class="grow">${esc(m.name)}</span>
        ${slot ? `<span class="slot">${esc(slot)}</span>` : ''}</button>`;
    }).join('');
  }).join('');
  const allDone = total > 0 && done === total;
  return `<div class="card"><h3><span>今日用药 <em>${allDone ? '全部吃完 ✓' : `${done}/${total}`}</em></span>
      <button class="btn sm ghost" data-act="med-manage">管理</button></h3>
    ${rows || '<div class="empty">还没有设置，点「管理」添加</div>'}</div>`;
}

function medTick(t) {
  const d = today(), k = t.dataset.k;
  const day = { ...((S.medLog || {})[d] || {}) };
  if (day[k]) delete day[k]; else day[k] = true;
  S.medLog = { ...(S.medLog || {}), [d]: day };
  save(); render();
}

function medRow(m, i) {
  const slotVal = m.slots.join(',');
  return `<div class="med-edit" data-i="${i}">
    <div class="row"><input class="inp grow" style="margin:0" data-k="name" value="${esc(m.name)}" placeholder="药名，如：钙片">
      <button type="button" class="icon-btn" data-act="med-del" data-i="${i}" aria-label="删除">×</button></div>
    <div class="grid2" style="margin-top:8px">
      <select class="inp" style="margin:0" data-k="slots">${MED_SLOTS.map(([v, n]) => `<option value="${v}" ${v === slotVal ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <select class="inp" style="margin:0" data-k="every">${MED_EVERY.map(([v, n]) => `<option value="${v}" ${v === (m.every || 1) ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    ${m.every > 1 ? `<label class="f" style="margin:8px 0 0">下次吃<input type="date" data-k="next" value="${medDue(m, today()) ? today() : medNext(m, today())}"></label>` : ''}
  </div>`;
}
function readMedForm() {
  return [...document.querySelectorAll('#sheet .med-edit')].map((row) => {
    const m = (ui.medDraft || [])[Number(row.dataset.i)] || {};
    const get = (k) => row.querySelector(`[data-k="${k}"]`)?.value;
    const every = Number(get('every')) || 1;
    return {
      id: m.id || uid(), name: (get('name') || '').trim(),
      slots: (get('slots') || '').split(','),
      every, anchor: every > 1 ? (get('next') || m.anchor || today()) : '',
    };
  });
}
function openMedManage(draft) {
  ui.medDraft = draft || (S.meds || []).map((m) => ({ ...m }));
  openSheet(`<h2>管理用药</h2>
    <p class="muted" style="margin-top:-6px">隔天吃的药填「下次吃」的日期，之后会自动隔天提醒</p>
    ${ui.medDraft.map(medRow).join('') || '<div class="empty">还没有药物</div>'}
    <button class="btn sm ghost" data-act="med-add">＋ 添加药物</button>
    <div class="actions"><button class="btn" data-act="med-save">保存</button></div>`);
  // 切换频率时即时显示/隐藏「下次吃」
  document.querySelectorAll('#sheet [data-k="every"]').forEach((el) => {
    el.addEventListener('change', () => openMedManage(readMedForm()));
  });
}

const MED_ACTIONS = {
  'med-tick': medTick,
  'med-manage': () => openMedManage(),
  'med-add': () => openMedManage([...readMedForm(), { id: uid(), name: '', slots: [''], every: 1, anchor: '' }]),
  'med-del': (t) => openMedManage(readMedForm().filter((_, i) => i !== Number(t.dataset.i))),
  'med-save': () => {
    const meds = readMedForm().filter((m) => m.name);
    S.meds = meds; save(); closeSheet(); render(); toast('已保存');
  },
};
