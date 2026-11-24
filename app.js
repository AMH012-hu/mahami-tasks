'use strict';
const $ = s => document.querySelector(s);
const PR = [['high', 'عالية'], ['mid', 'متوسطة'], ['low', 'منخفضة']];
const RANK = { high: 0, mid: 1, low: 2 };
const plabel = p => (PR.find(x => x[0] === p) || PR[1])[1];
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => iso(new Date());
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); };
const fmt = s => new Date(s + 'T00:00:00').toLocaleDateString('ar-EG-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtShort = s => new Date(s + 'T00:00:00').toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'short' });
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const num = n => n.toLocaleString('ar-EG-u-nu-latn');

// ---------- storage: IndexedDB with localStorage fallback ----------
const store = {
  db: null, mode: 'idb',
  open() {
    return new Promise(res => {
      if (!window.indexedDB) { this.mode = 'ls'; return res(); }
      const r = indexedDB.open('mahami', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = r.onblocked = () => { this.mode = 'ls'; res(); };
    });
  },
  get(k) {
    if (this.mode === 'ls') return Promise.resolve(JSON.parse(localStorage.getItem('mahami.' + k) || 'null'));
    return new Promise(res => { const q = this.db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result ?? null); q.onerror = () => res(null); });
  },
  set(k, v) {
    if (this.mode === 'ls') { localStorage.setItem('mahami.' + k, JSON.stringify(v)); return Promise.resolve(); }
    return new Promise((res, rej) => { const t = this.db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = t.onabort = () => rej(t.error); });
  },
};

let S = { tasks: [], projects: [], tab: 'today', filter: 'open', prio: 'any', proj: '', q: '', qs: { prio: 'mid', date: '', proj: '' }, confirm: '' };
let toastT;
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2200); }
async function persist() {
  try { await store.set('tasks', S.tasks); await store.set('projects', S.projects); }
  catch (e) { toast('تعذّر الحفظ على هذا الجهاز. جرّب تصدير نسخة احتياطية.'); }
}
const commit = () => { persist(); render(); };

// ---------- helpers ----------
function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, ''); else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k);
  return e;
}
const projName = id => (S.projects.find(p => p.id === id) || {}).name;
const sortTasks = l => [...l].sort((a, b) => (a.done - b.done) || (a.due || '9999').localeCompare(b.due || '9999') || RANK[a.prio] - RANK[b.prio] || a.created - b.created);

function taskItem(t) {
  const t0 = todayStr(), late = !t.done && t.due && t.due < t0;
  const meta = el('span', { class: 'tmeta' });
  meta.append(el('span', { class: 'pr-' + t.prio, text: plabel(t.prio) }));
  if (t.due) meta.append(el('span', { class: late ? 'late' : '', text: (late ? 'متأخرة · ' : '') + (t.due === t0 ? 'اليوم' : t.due === addDays(t0, 1) ? 'غداً' : fmtShort(t.due)) }));
  if (projName(t.proj)) meta.append(el('span', { text: '▦ ' + projName(t.proj) }));
  if (t.note) meta.append(el('span', { text: '✎ ملاحظة' }));
  const chk = el('button', { class: 'check', type: 'button', role: 'checkbox', 'aria-checked': String(t.done), 'aria-label': (t.done ? 'إلغاء إنجاز: ' : 'إنجاز: ') + t.title, text: t.done ? '✓' : '', onclick: () => { t.done = !t.done; t.doneAt = t.done ? Date.now() : null; commit(); } });
  const body = el('button', { class: 'tbody', type: 'button', 'aria-label': 'تعديل: ' + t.title, onclick: () => openEdit(t.id) }, el('span', { class: 'ttitle', text: t.title }), meta);
  return el('li', { class: `task p-${t.prio}${t.done ? ' done' : ''}` }, chk, body);
}
const listOf = (items, empty) => items.length ? el('ul', { class: 'list' }, items.map(taskItem)) : el('div', { class: 'empty', text: empty });
const section = (title, node) => [el('h2', { text: title }), node];

// ---------- views ----------
function viewToday() {
  const t0 = todayStr(), open = S.tasks.filter(t => !t.done);
  const overdue = sortTasks(open.filter(t => t.due && t.due < t0));
  const dueToday = sortTasks(open.filter(t => t.due === t0));
  const week = sortTasks(open.filter(t => t.due > t0 && t.due <= addDays(t0, 7)));
  const noDate = sortTasks(open.filter(t => !t.due));
  const doneToday = S.tasks.filter(t => t.done && t.doneAt && iso(new Date(t.doneAt)) === t0).length;
  const total = dueToday.length + doneToday + overdue.length;
  const pct = total ? Math.round(doneToday / total * 100) : 0;
  const out = [];
  out.push(el('div', { class: 'stats' },
    el('div', { class: 'stat' }, el('b', { text: num(dueToday.length) }), el('span', { text: 'مستحقة اليوم' })),
    el('div', { class: 'stat late' }, el('b', { text: num(overdue.length) }), el('span', { text: 'متأخرة' })),
    el('div', { class: 'stat ok' }, el('b', { text: num(doneToday) }), el('span', { text: 'أُنجزت اليوم' })),
    el('div', { class: 'stat' }, el('b', { text: num(open.length) }), el('span', { text: 'كل المفتوحة' }))));
  if (total) out.push(el('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': 'تقدم اليوم' }, el('i', { style: `width:${pct}%` })));
  if (overdue.length) out.push(...section('متأخرة', listOf(overdue)));
  out.push(...section('اليوم', listOf(dueToday, S.tasks.length ? 'لا مهام مستحقة اليوم. أضف مهمة من الأعلى.' : 'ابدأ بإضافة أول مهمة من الحقل في الأعلى.')));
  if (week.length) out.push(...section('الأيام السبعة القادمة', listOf(week)));
  if (noDate.length) out.push(...section('بلا تاريخ', listOf(noDate)));
  return out;
}
function chipRow(items, cur, on) {
  return el('div', { class: 'filters', role: 'group' }, items.map(([v, l]) => el('button', { type: 'button', class: 'chip', 'aria-pressed': String(cur === v), text: l, onclick: () => on(v) })));
}
function viewAll() {
  const q = S.q.trim().toLowerCase();
  const items = sortTasks(S.tasks.filter(t => (S.filter === 'all' || (S.filter === 'done') === t.done) && (S.prio === 'any' || t.prio === S.prio) && (!S.proj || t.proj === S.proj) && (!q || (t.title + ' ' + (t.note || '')).toLowerCase().includes(q))));
  const search = el('input', { class: 'search', type: 'search', placeholder: 'بحث في المهام…', 'aria-label': 'بحث', value: S.q });
  search.addEventListener('input', () => { S.q = search.value; const pos = search.selectionStart; render(); const n = $('.search'); n.focus(); n.setSelectionRange(pos, pos); });
  const out = [search,
    chipRow([['open', 'المفتوحة'], ['done', 'المنجزة'], ['all', 'الكل']], S.filter, v => { S.filter = v; render(); }),
    chipRow([['any', 'كل الأولويات'], ...PR], S.prio, v => { S.prio = v; render(); })];
  if (S.projects.length) out.push(chipRow([['', 'كل المشاريع'], ...S.projects.map(p => [p.id, p.name])], S.proj, v => { S.proj = v; render(); }));
  out.push(el('div', { style: 'height:8px' }), listOf(items, 'لا توجد مهام مطابقة.'));
  if (S.tasks.some(t => t.done)) out.push(el('div', { class: 'row' }, el('button', { class: 'btn', type: 'button', text: S.confirm === 'clear' ? 'تأكيد: حذف كل المنجزة' : 'حذف كل المنجزة', onclick: () => { if (S.confirm !== 'clear') { S.confirm = 'clear'; render(); return; } S.tasks = S.tasks.filter(t => !t.done); S.confirm = ''; toast('تم حذف المهام المنجزة'); commit(); } })));
  return out;
}
function viewProjects() {
  const inp = el('input', { type: 'text', maxlength: 40, placeholder: 'اسم مشروع جديد (مثال: الدراسة)', 'aria-label': 'اسم المشروع' });
  const add = () => { const n = inp.value.trim(); if (!n) return; if (S.projects.some(p => p.name === n)) { toast('هذا المشروع موجود'); return; } S.projects.push({ id: uid(), name: n }); toast('تمت إضافة المشروع'); commit(); };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  const out = [el('div', { class: 'addproj' }, inp, el('button', { class: 'btn primary', type: 'button', text: 'إضافة', onclick: add }))];
  if (!S.projects.length) { out.push(el('div', { class: 'empty', style: 'margin-top:16px', text: 'لا توجد مشاريع بعد. المشاريع تجمع مهامك المتشابهة.' })); return out; }
  out.push(el('ul', { class: 'list', style: 'margin-top:16px' }, S.projects.map(p => {
    const ts = S.tasks.filter(t => t.proj === p.id), d = ts.filter(t => t.done).length;
    const btn = el('button', { class: 'tbody', type: 'button', onclick: () => { S.proj = p.id; S.filter = 'open'; S.prio = 'any'; S.q = ''; setTab('all'); } },
      el('span', { class: 'ttitle', text: p.name }), el('span', { class: 'tmeta' }, el('span', { text: `${num(ts.length - d)} مفتوحة من ${num(ts.length)}` })),
      el('div', { class: 'progress' }, el('i', { style: `width:${ts.length ? d / ts.length * 100 : 0}%` })));
    const del = el('button', { class: 'btn' + (S.confirm === p.id ? ' danger' : ''), type: 'button', text: S.confirm === p.id ? 'تأكيد الحذف' : 'حذف', onclick: () => { if (S.confirm !== p.id) { S.confirm = p.id; render(); return; } S.projects = S.projects.filter(x => x.id !== p.id); S.tasks.forEach(t => { if (t.proj === p.id) t.proj = ''; }); if (S.qs.proj === p.id) S.qs.proj = ''; S.confirm = ''; commit(); } });
    return el('li', { class: 'pcard' }, btn, del);
  })));
  return out;
}
let deferredInstall = null;
function viewSettings() {
  const out = [];
  const inst = el('div', { class: 'card' }, el('h3', { text: 'تثبيت التطبيق' }));
  if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) inst.append(el('p', { text: 'التطبيق مثبّت ويعمل الآن بدون متصفح.' }));
  else if (deferredInstall) inst.append(el('p', { text: 'ثبّته على شاشتك الرئيسية ليعمل كتطبيق ودون اتصال.' }), el('button', { class: 'btn primary', type: 'button', text: 'تثبيت', onclick: async () => { deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; render(); } }));
  else inst.append(el('p', { text: 'على آيفون: زر المشاركة ثم «إضافة إلى الشاشة الرئيسية». على أندرويد وسطح المكتب: قائمة المتصفح ثم «تثبيت التطبيق» إن ظهر الخيار.' }));
  out.push(inst);
  const status = el('div', { class: 'card' }, el('h3', { text: 'بياناتك' }),
    el('p', { text: `تُحفظ ${num(S.tasks.length)} مهمة و${num(S.projects.length)} مشروع على هذا الجهاز فقط (${store.mode === 'idb' ? 'IndexedDB' : 'localStorage'}). لا تُرسل إلى أي خادم ولا تُزامَن بين الأجهزة. مسح بيانات الموقع من المتصفح يحذفها، فصدّر نسخة احتياطية من وقت لآخر.` }));
  const row = el('div', { class: 'row' });
  row.append(el('button', { class: 'btn', type: 'button', text: 'تصدير نسخة احتياطية', onclick: exportData }));
  const file = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  file.addEventListener('change', () => importData(file.files[0]));
  row.append(el('button', { class: 'btn', type: 'button', text: 'استيراد نسخة', onclick: () => file.click() }), file);
  row.append(el('button', { class: 'btn danger', type: 'button', text: S.confirm === 'wipe' ? 'تأكيد: مسح كل البيانات' : 'مسح كل البيانات', onclick: () => { if (S.confirm !== 'wipe') { S.confirm = 'wipe'; render(); return; } S.tasks = []; S.projects = []; S.confirm = ''; toast('تم مسح البيانات'); commit(); } }));
  status.append(row); out.push(status);
  return out;
}
function exportData() {
  const blob = new Blob([JSON.stringify({ app: 'mahami', v: 1, exported: new Date().toISOString(), tasks: S.tasks, projects: S.projects }, null, 1)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `mahami-${todayStr()}.json` }); document.body.append(a); a.click(); a.remove(); toast('تم تصدير النسخة الاحتياطية');
}
function importData(f) {
  if (!f) return;
  f.text().then(txt => {
    const d = JSON.parse(txt);
    if (d.app !== 'mahami' || !Array.isArray(d.tasks) || !Array.isArray(d.projects)) throw 0;
    const okTask = t => t && typeof t.id === 'string' && typeof t.title === 'string';
    S.tasks = d.tasks.filter(okTask).map(t => ({ id: t.id, title: String(t.title).slice(0, 120), note: String(t.note || '').slice(0, 500), prio: RANK[t.prio] != null ? t.prio : 'mid', due: /^\d{4}-\d\d-\d\d$/.test(t.due || '') ? t.due : '', proj: t.proj || '', done: !!t.done, doneAt: t.doneAt || null, created: +t.created || Date.now() }));
    S.projects = d.projects.filter(p => p && typeof p.id === 'string' && typeof p.name === 'string').map(p => ({ id: p.id, name: String(p.name).slice(0, 40) }));
    toast('تم استيراد النسخة'); commit();
  }).catch(() => toast('ملف غير صالح'));
}

// ---------- shell ----------
const TITLES = { today: viewToday, all: viewAll, projects: viewProjects, settings: viewSettings };
function setTab(t) { S.tab = t; S.confirm = ''; render(); window.scrollTo(0, 0); }
function render() {
  const v = $('#view'); v.replaceChildren(...TITLES[S.tab]().flat());
  document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-current', b.dataset.tab === S.tab ? 'page' : 'false'));
  // quick-add controls
  const qp = $('#qprio'); qp.replaceChildren(...PR.map(([v2, l]) => el('button', { type: 'button', role: 'radio', 'aria-checked': String(S.qs.prio === v2), text: l, onclick: () => { S.qs.prio = v2; render(); } })));
  const t0 = todayStr();
  $('#qtoday').setAttribute('aria-pressed', String(S.qs.date === t0)); $('#qtomorrow').setAttribute('aria-pressed', String(S.qs.date === addDays(t0, 1)));
  $('#qdate').value = S.qs.date;
  $('#qdatelabel').textContent = S.qs.date && S.qs.date !== t0 && S.qs.date !== addDays(t0, 1) ? fmtShort(S.qs.date) : 'تاريخ';
  const sel = $('#qproj'); sel.replaceChildren(el('option', { value: '', text: 'بدون مشروع' }), ...S.projects.map(p => el('option', { value: p.id, text: p.name })));
  sel.value = S.projects.some(p => p.id === S.qs.proj) ? S.qs.proj : '';
  $('#date').textContent = fmt(t0);
}
function quickAdd(e) {
  e.preventDefault();
  const inp = $('#q'), title = inp.value.trim();
  if (!title) { toast('اكتب عنوان المهمة'); inp.focus(); return; }
  S.tasks.push({ id: uid(), title, note: '', prio: S.qs.prio, due: S.qs.date, proj: S.qs.proj, done: false, doneAt: null, created: Date.now() });
  inp.value = ''; S.qs.prio = 'mid'; S.qs.date = ''; toast('تمت إضافة المهمة'); commit(); inp.focus();
}
function openEdit(id) {
  const t = S.tasks.find(x => x.id === id); if (!t) return;
  $('#e-title').value = t.title; $('#e-note').value = t.note || ''; $('#e-date').value = t.due;
  $('#e-prio').replaceChildren(...PR.map(([v, l]) => el('option', { value: v, text: l }))); $('#e-prio').value = t.prio;
  $('#e-proj').replaceChildren(el('option', { value: '', text: 'بدون مشروع' }), ...S.projects.map(p => el('option', { value: p.id, text: p.name }))); $('#e-proj').value = t.proj;
  $('#e-del').textContent = 'حذف'; $('#editform').dataset.id = id; $('#dlg').showModal();
}
function initDialog() {
  const dlg = $('#dlg');
  $('#e-cancel').onclick = () => dlg.close();
  $('#e-del').onclick = e => { const b = e.target; if (b.textContent !== 'تأكيد الحذف') { b.textContent = 'تأكيد الحذف'; return; } S.tasks = S.tasks.filter(t => t.id !== $('#editform').dataset.id); dlg.close(); toast('تم حذف المهمة'); commit(); };
  $('#editform').addEventListener('submit', e => {
    e.preventDefault();
    const t = S.tasks.find(x => x.id === $('#editform').dataset.id), title = $('#e-title').value.trim();
    if (!t || !title) return;
    Object.assign(t, { title, note: $('#e-note').value.trim(), prio: $('#e-prio').value, due: $('#e-date').value, proj: $('#e-proj').value });
    dlg.close(); commit();
  });
}

async function init() {
  await store.open();
  S.tasks = (await store.get('tasks')) || []; S.projects = (await store.get('projects')) || [];
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  $('#quick').addEventListener('submit', quickAdd);
  $('#qtoday').onclick = () => { S.qs.date = S.qs.date === todayStr() ? '' : todayStr(); render(); };
  $('#qtomorrow').onclick = () => { const d = addDays(todayStr(), 1); S.qs.date = S.qs.date === d ? '' : d; render(); };
  $('#qdate').onchange = e => { S.qs.date = e.target.value; render(); };
  $('#qproj').onchange = e => { S.qs.proj = e.target.value; };
  document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => setTab(b.dataset.tab));
  initDialog(); render();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; if (S.tab === 'settings') render(); });
  window.addEventListener('appinstalled', () => { deferredInstall = null; toast('تم تثبيت التطبيق'); });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
init();
