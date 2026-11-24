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

let S = { tasks: [], projects: [], tab: 'today', filter: 'open', prio: 'any', proj: '', q: '', qs: { prio: 'mid', date: '', proj: '' }, confirm: '', day: todayStr(), month: todayStr().slice(0,7), calendarMode: 'week', events: [], prefs: {}, focus: null };
let toastT;
function toast(m) { const t = $('#toast'); t.replaceChildren(document.createTextNode(m)); if(undoState) t.append(el('button',{type:'button',text:'تراجع',onclick:undo})); t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 6000); }
async function persist() {
  try { await store.set('tasks', S.tasks); await store.set('projects', S.projects); await store.set('events', S.events); await store.set('prefs', S.prefs); }
  catch (e) { toast('تعذّر الحفظ على هذا الجهاز. جرّب تصدير نسخة احتياطية.'); }
}
const commit = () => { persist(); render(); };
let undoState = null;
function checkpoint() { undoState = JSON.stringify({tasks:S.tasks, projects:S.projects, events:S.events}); }
function undo() { if(!undoState) return; Object.assign(S,JSON.parse(undoState)); undoState=null; commit(); toast('تم التراجع'); }

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
  if (t.time) meta.append(el('span', {text:t.time+' · '+(t.duration||30)+' د'}));
  if(t.repeat) meta.append(el('span',{text:'↻ متكررة'}));
  if(t.subtasks?.length) meta.append(el('span',{text:t.subtasks.filter(x=>x.done).length+'/'+t.subtasks.length+' خطوات'}));
  if (t.note) meta.append(el('span', { text: '✎ ملاحظة' }));
  const chk = el('button', { class: 'check', type: 'button', role: 'checkbox', 'aria-checked': String(t.done), 'aria-label': (t.done ? 'إلغاء إنجاز: ' : 'إنجاز: ') + t.title, text: t.done ? '✓' : '', onclick: () => { toggleDone(t); } });
  const body = el('button', { class: 'tbody', type: 'button', 'aria-label': 'تعديل: ' + t.title, onclick: () => openEdit(t.id) }, el('span', { class: 'ttitle', text: t.title }), meta);
  return el('li', { class: `task p-${t.prio}${t.done ? ' done' : ''}`, draggable: true, ondragstart:e=>e.dataTransfer.setData('text/plain',t.id) }, chk, body, el('button',{class:'star',type:'button','aria-label':t.star?'إلغاء التمييز':'تمييز المهمة','aria-pressed':!!t.star,text:t.star?'★':'☆',onclick:()=>{t.star=!t.star;commit();}}));
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
  if (S.tasks.some(t => t.done)) out.push(el('div', { class: 'row' }, el('button', { class: 'btn', type: 'button', text: S.confirm === 'clear' ? 'تأكيد: حذف كل المنجزة' : 'حذف كل المنجزة', onclick: () => { if (S.confirm !== 'clear') { S.confirm = 'clear'; render(); return; } checkpoint(); S.tasks = S.tasks.filter(t => !t.done); S.confirm = ''; toast('تم حذف المهام المنجزة'); commit(); } })));
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
    const del = el('button', { class: 'btn' + (S.confirm === p.id ? ' danger' : ''), type: 'button', text: S.confirm === p.id ? 'تأكيد الحذف' : 'حذف', onclick: () => { if (S.confirm !== p.id) { S.confirm = p.id; render(); return; } checkpoint(); S.projects = S.projects.filter(x => x.id !== p.id); S.tasks.forEach(t => { if (t.proj === p.id) t.proj = ''; }); if (S.qs.proj === p.id) S.qs.proj = ''; S.confirm = ''; commit(); } });
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
  row.append(el('button', { class: 'btn danger', type: 'button', text: S.confirm === 'wipe' ? 'تأكيد: مسح كل البيانات' : 'مسح كل البيانات', onclick: () => { if (S.confirm !== 'wipe') { S.confirm = 'wipe'; render(); return; } checkpoint(); S.tasks = []; S.projects = []; S.events=[]; S.confirm = ''; toast('تم مسح البيانات'); commit(); } }));
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
const TITLES = { today: viewDashboard, all: viewAll, projects: viewProjects, settings: viewSettings, calendar: viewCalendar, board:viewBoard, focus:viewFocus };
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
  updateFocusClock();
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
  $('#e-time').value=t.time||''; $('#e-duration').value=t.duration||30; $('#e-repeat').value=t.repeat||''; $('#e-status').value=t.status||'todo'; $('#e-subtasks').value=(t.subtasks||[]).map(x=>x.title).join('\n');
  $('#subtask-checks').replaceChildren(...(t.subtasks||[]).map(x=>el('label',{class:'subcheck'},el('input',{type:'checkbox',checked:x.done,onchange:e=>{x.done=e.target.checked;persist();}}),document.createTextNode(x.title))));
  $('#e-calendar').onclick=()=>calendarHandoff(t); $('#e-focus').onclick=()=>{dlgClose();startFocus(t.id);};
  $('#e-del').textContent = 'حذف'; $('#editform').dataset.id = id; $('#dlg').showModal();
}
function initDialog() {
  const dlg = $('#dlg');
  $('#e-cancel').onclick = () => dlg.close();
  $('#e-del').onclick = e => { const b = e.target; if (b.textContent !== 'تأكيد الحذف') { b.textContent = 'تأكيد الحذف'; return; } checkpoint(); S.tasks = S.tasks.filter(t => t.id !== $('#editform').dataset.id); dlg.close(); toast('تم حذف المهمة'); commit(); };
  $('#editform').addEventListener('submit', e => {
    e.preventDefault();
    const t = S.tasks.find(x => x.id === $('#editform').dataset.id), title = $('#e-title').value.trim();
    if (!t || !title) return;
    checkpoint();
    const subtasks=$('#e-subtasks').value.split('\n').map(x=>x.trim()).filter(Boolean).slice(0,30).map(title=>({title,done:(t.subtasks||[]).find(x=>x.title===title)?.done||false}));
    Object.assign(t,{time:$('#e-time').value, duration:Math.max(5,Math.min(720,+$('#e-duration').value||30)),repeat:$('#e-repeat').value,status:$('#e-status').value,subtasks});
    if(t.time && !$('#e-date').value){toast('اختر تاريخاً لوقت البداية');return;}
    Object.assign(t, { title, note: $('#e-note').value.trim(), prio: $('#e-prio').value, due: $('#e-date').value, proj: $('#e-proj').value });
    dlg.close(); commit();
  });
}

async function init() {
  await store.open();
  S.tasks = (await store.get('tasks')) || []; S.projects = (await store.get('projects')) || []; S.events=(await store.get('events'))||[]; S.prefs=(await store.get('prefs'))||{}; S.focus=(await store.get('focus'))||null;
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  $('#quick').addEventListener('submit', quickAdd);
  $('#qtoday').onclick = () => { S.qs.date = S.qs.date === todayStr() ? '' : todayStr(); render(); };
  $('#qtomorrow').onclick = () => { const d = addDays(todayStr(), 1); S.qs.date = S.qs.date === d ? '' : d; render(); };
  $('#qdate').onchange = e => { S.qs.date = e.target.value; render(); };
  $('#qproj').onchange = e => { S.qs.proj = e.target.value; };
  document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => setTab(b.dataset.tab));
  initDialog(); applyTheme(); render(); setInterval(updateFocusClock,1000);
  document.addEventListener('keydown',e=>{if(/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))return;if(e.key==='n'){e.preventDefault();$('#q').focus();}if(e.key==='/' ){e.preventDefault();setTab('all');$('.search').focus();}if(e.key==='Escape')dlgClose();});
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; if (S.tab === 'settings') render(); });
  window.addEventListener('appinstalled', () => { deferredInstall = null; toast('تم تثبيت التطبيق'); });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Extra fields are additive. Original IDs, storage keys and database version are unchanged.
function dlgClose(){ $('#dlg').close(); }
function toggleDone(t){
  checkpoint(); t.done=!t.done; t.doneAt=t.done?Date.now():null;
  if(t.done && t.repeat && t.due && !t.nextCreated){
    let due=t.repeat==='daily'?addDays(t.due,1):t.repeat==='weekly'?addDays(t.due,7):nextMonth(t.due);
    const n={...t,id:uid(),due,done:false,doneAt:null,created:Date.now(),nextCreated:false,subtasks:(t.subtasks||[]).map(x=>({...x,done:false}))};
    t.nextCreated=true; S.tasks.push(n);
  }
  commit(); toast(t.done?'خطوة أقرب لهدفك ✓':'تمت إعادة فتح المهمة');
}
function nextMonth(s){const d=new Date(s+'T12:00:00'),day=d.getDate();d.setDate(1);d.setMonth(d.getMonth()+1);const last=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();d.setDate(Math.min(day,last));return iso(d);}
function heading(k,title,desc){return el('div',{class:'page-heading'},el('span',{class:'eyebrow',text:k}),el('h2',{text:title}),el('p',{text:desc}));}
function viewDashboard(){
 const now=todayStr(), open=S.tasks.filter(t=>!t.done), today=open.filter(t=>t.due===now), overdue=open.filter(t=>t.due&&t.due<now), done=S.tasks.filter(t=>t.done&&t.doneAt&&iso(new Date(t.doneAt))===now), minutes=today.reduce((n,t)=>n+(+t.duration||30),0);
 const selected=sortTasks(open.filter(t=>t.star||t.due===now)).slice(0,3);
 const main=el('div',{class:'workspace-main'},
  el('div',{class:'hero'},el('span',{class:'eyebrow',text:'مساحة اليوم'}),el('h2',{text:'يوم واضح. خطوة بخطوة.'}),el('p',{text:today.length?'لديك '+today.length+' مهام لليوم. ابدأ بالأهم واترك مساحة لنفسك.':'اختر ما يستحق وقتك اليوم، والباقي ينتظر.'}),el('button',{class:'btn primary',text:'خطّط ليومي',onclick:()=>{S.day=now;setTab('calendar');}})),
  el('div',{class:'stats'},...[[today.length,'مهام اليوم',''],[minutes+' د','وقت مخطّط',''],[done.length,'أُنجزت اليوم','ok'],[overdue.length,'متأخرة',overdue.length?'late':'']].map(([v,l,c])=>el('div',{class:'stat '+c},el('b',{text:v}),el('span',{text:l})))),
  el('div',{class:'section-head'},el('h2',{text:'مساحة للأهم'}),el('span',{class:'note',text:'ميّز المهمة بنجمة لتبقى أمامك'})),listOf(selected,'لم تختر أولويات بعد. أضف مهمة أو ميّز واحدة بنجمة.'),
  ...section('خطة اليوم',listOf(sortTasks(today),'يومك مفتوح. أضف مهمة وحدد لها اليوم.')));
 if(overdue.length)main.append(el('details',{class:'card'},el('summary',{text:'مهام تحتاج إعادة تخطيط · '+overdue.length}),listOf(sortTasks(overdue)),el('button',{class:'btn',text:'ترحيل المتأخرة إلى اليوم',onclick:()=>{checkpoint();overdue.forEach(t=>t.due=now);commit();toast('تم الترحيل');}})));
 const events=eventsForDay(now);
 const side=el('aside',{class:'workspace-side'},el('div',{class:'card daily-card'},el('span',{class:'eyebrow',text:'إيقاعك اليوم'}),el('h3',{text:'ابدأ بهدوء'}),el('p',{text:'١. اختر أهم مهمة\n٢. احجز لها وقتاً\n٣. ركّز لمدة ٢٥ دقيقة',class:'ritual'}),el('button',{class:'btn',text:'ابدأ جلسة تركيز',onclick:()=>setTab('focus')})),el('div',{class:'card'},el('h3',{text:'مواعيد اليوم'}),el('p',{class:'note',text:calendarStatus()}),events.length?el('div',{},events.map(eventCard)):el('p',{text:'لا مواعيد معروضة لهذا اليوم.'}),el('button',{class:'btn',text:'التقويم والاتصال',onclick:()=>setTab('calendar')})),el('div',{class:'card week-review'},el('h3',{text:'آخر ٧ أيام'}),weeklyBars()));
 return [el('div',{class:'workspace'},main,side)];
}
function weeklyBars(){ const days=Array.from({length:7},(_,i)=>addDays(todayStr(),i-6));const counts=days.map(d=>S.tasks.filter(t=>t.done&&t.doneAt&&iso(new Date(t.doneAt))===d).length),max=Math.max(1,...counts);return el('div',{class:'weekly-bars'},days.map((d,i)=>el('div',{'aria-label':fmt(d)+': '+counts[i]},el('b',{text:counts[i]}),el('i',{style:'height:'+Math.max(3,counts[i]/max*72)+'px'}),el('small',{text:new Date(d+'T12:00:00').toLocaleDateString('ar-EG',{weekday:'short'})}))));}
function viewBoard(){return [heading('رؤية المشروع','من الفكرة إلى الإنجاز','غيّر الحالة من تفاصيل المهمة، أو اسحبها إلى العمود المناسب.'),el('div',{class:'board'},[['todo','لم تبدأ'],['doing','قيد التنفيذ'],['done','أُنجزت']].map(([status,label])=>{const tasks=sortTasks(S.tasks.filter(t=>status==='done'?t.done:!t.done&&(t.status||'todo')===status));return el('section',{class:'board-col',ondragover:e=>e.preventDefault(),ondrop:e=>{e.preventDefault();const t=S.tasks.find(t=>t.id===e.dataTransfer.getData('text/plain'));if(!t)return;checkpoint();if(status==='done'&&!t.done){toggleDone(t);return;}t.done=status==='done';t.doneAt=t.done?Date.now():null;t.status=status==='doing'?'doing':'todo';commit();toast('تم تغيير الحالة');}},el('h3',{text:label+' · '+tasks.length}),listOf(tasks,'لا مهام في هذا العمود'));}))];}
let remoteEvents=[];
function calendarStatus(){return S.events.length?'تقويم مستورد · نسخة ثابتة':'لا يوجد ملف تقويم مستورد';}
function eventsForDay(day){const a=new Date(day+'T00:00:00').getTime(),b=new Date(addDays(day,1)+'T00:00:00').getTime();return [...S.events,...remoteEvents].filter(e=>e.start<b&&e.end>a).sort((a,b)=>a.start-b.start);}
function eventCard(e){return el('div',{class:'event-card'},el('b',{text:e.title}),el('small',{text:e.allDay?'طوال اليوم':new Date(e.start).toLocaleTimeString('ar-EG-u-nu-latn',{hour:'2-digit',minute:'2-digit'})+' – '+new Date(e.end).toLocaleTimeString('ar-EG-u-nu-latn',{hour:'2-digit',minute:'2-digit'})}),el('small',{text:e.source==='google'?'Google Calendar · للعرض فقط':'نسخة مستوردة'}));}
function viewCalendar(){
 const start=addDays(S.day,-((new Date(S.day+'T12:00:00').getDay()+6)%7));
 const controls=el('div',{class:'row calendar-toolbar'},el('button',{class:'btn',text:'‹ الأسبوع السابق',onclick:()=>{S.day=addDays(S.day,-7);render();}}),el('button',{class:'btn',text:'اليوم',onclick:()=>{S.day=todayStr();render();}}),el('button',{class:'btn',text:'الأسبوع التالي ›',onclick:()=>{S.day=addDays(S.day,7);render();}}));
 const days=el('div',{class:'week-strip'},Array.from({length:7},(_,i)=>{const d=addDays(start,i),count=S.tasks.filter(t=>!t.done&&t.due===d).length+eventsForDay(d).length;return el('button',{class:'day-pill'+(S.day===d?' selected':''),'aria-pressed':S.day===d,onclick:()=>{S.day=d;render();},ondragover:e=>e.preventDefault(),ondrop:e=>{e.preventDefault();const t=S.tasks.find(t=>t.id===e.dataTransfer.getData('text/plain'));if(t){checkpoint();t.due=d;S.day=d;commit();toast('تم تغيير التاريخ');}}},el('small',{text:new Date(d+'T12:00:00').toLocaleDateString('ar-EG',{weekday:'short'})}),el('b',{text:new Date(d+'T12:00:00').getDate()}),el('span',{text:count?'●':'·'}));}));
 const tasks=sortTasks(S.tasks.filter(t=>t.due===S.day&&!t.done)),timed=tasks.filter(t=>t.time).sort((a,b)=>a.time.localeCompare(b.time)),untimed=tasks.filter(t=>!t.time),events=eventsForDay(S.day);
 const schedule=el('div',{class:'schedule'},el('h3',{text:fmt(S.day)}),el('p',{class:'note',text:'الأوقات حسب جهازك: '+Intl.DateTimeFormat().resolvedOptions().timeZone}));
 const entries=[...timed.map(t=>({time:new Date(t.due+'T'+t.time).getTime(),task:t})),...events.map(e=>({time:e.allDay?0:e.start,event:e}))].sort((a,b)=>a.time-b.time);
 if(!entries.length)schedule.append(el('div',{class:'empty',text:'مساحة متاحة. افتح أي مهمة وحدد وقت بدايتها.'}));
 for(const item of entries){const t=item.task; if(t){const a=new Date(t.due+'T'+t.time).getTime(),b=a+(t.duration||30)*60000,overlap=events.some(e=>!e.allDay&&e.start<b&&e.end>a)||timed.some(x=>x!==t&&new Date(x.due+'T'+x.time).getTime()<b&&new Date(x.due+'T'+x.time).getTime()+(x.duration||30)*60000>a);schedule.append(el('div',{class:'time-entry'},el('span',{class:'time-label',text:t.time}),el('div',{class:'time-task'},listOf([t]),overlap?el('p',{class:'conflict',text:'تداخل وقتي: راجع المهمة أو الموعد الآخر.'}):null)));}else schedule.append(el('div',{class:'time-entry'},el('span',{class:'time-label',text:item.event.allDay?'يوم كامل':new Date(item.time).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}),eventCard(item.event)));}
 schedule.append(...section('مهام بدون وقت',listOf(untimed,'لا مهام أخرى لهذا اليوم.')));
 const inbox=el('div',{class:'card'},el('h3',{text:'لم تُجدول بعد'}),el('p',{class:'note',text:'حدد مهمة لإضافتها إلى اليوم المختار. لا يغيّر ذلك تقويمك الخارجي.'}));
 const unscheduled=sortTasks(S.tasks.filter(t=>!t.done&&!t.due));if(!unscheduled.length)inbox.append(el('p',{text:'كل المهام لها تاريخ، أو لم تضف مهام بعد.'}));
 unscheduled.forEach(t=>inbox.append(el('button',{class:'schedule-pick',text:'+ '+t.title,onclick:()=>{checkpoint();t.due=S.day;commit();toast('تمت الجدولة');}})));
 return [heading('المخطط الأسبوعي','اجعل لوقتك مكاناً','المهام والمواعيد في خطة واحدة. انقر اليوم، ثم حدد أوقات مهامك.'),controls,days,el('div',{class:'calendar-layout'},schedule,el('aside',{},connectionPanel(),inbox))];
}
function connectionPanel(){const file=el('input',{type:'file',accept:'.ics,text/calendar',hidden:true,onchange:e=>importCalendar(e.target.files[0])});return el('div',{class:'card connection'},el('span',{class:'eyebrow',text:'نقل التقويم يدوياً'}),el('h3',{text:calendarStatus()}),el('p',{text:'استورد ملف ICS لعرض مواعيدك، أو صدّر المهام المؤرخة لتضيفها إلى تقويمك. نقل مرة واحدة، وليس اتصال حساب أو مزامنة.'}),el('div',{class:'row'},el('button',{class:'btn',text:'استيراد ICS',onclick:()=>file.click()}),el('button',{class:'btn',text:'تصدير المهام ICS',onclick:exportCalendar}),file),el('p',{class:'note',text:'الاستيراد يستبدل المواعيد المستوردة فقط، ولا يمس المهام. النطاق: الشهر الماضي إلى سنة قادمة. راجع المواعيد المتكررة بعد الاستيراد.'}),S.events.length?el('button',{class:'btn',text:'إزالة المواعيد المستوردة',onclick:()=>{checkpoint();S.events=[];commit();toast('أزيلت النسخة المحلية فقط');}}):null);}
async function importCalendar(f){if(!f)return;try{if(f.size>3e6)throw 0;const c=new ICAL.Component(ICAL.parse(await f.text())),a=[],min=new Date(addDays(todayStr(),-31)+'T00:00:00').getTime(),max=new Date(addDays(todayStr(),366)+'T00:00:00').getTime();for(const comp of c.getAllSubcomponents('vevent')){const e=new ICAL.Event(comp);if(e.isRecurrenceException())continue;const push=(start,end)=>{if(end>min&&start<max)a.push({id:(e.uid||uid())+'-'+start,title:String(e.summary||'موعد').slice(0,180),start,end,allDay:e.startDate.isDate,source:'ics'});};if(e.isRecurring()){const it=e.iterator();let n=0,d;while((d=it.next())&&n++<5000){if(d.toJSDate().getTime()>=max)break;const o=e.getOccurrenceDetails(d);push(o.startDate.toJSDate().getTime(),o.endDate.toJSDate().getTime());}}else push(e.startDate.toJSDate().getTime(),e.endDate.toJSDate().getTime());if(a.length>5000)throw 0;}if(!a.length){toast('لا مواعيد في النطاق: من الشهر الماضي إلى سنة قادمة');return;}checkpoint();S.events=[...new Map(a.map(e=>[e.id,e])).values()];commit();toast('استُوردت '+S.events.length+' مواعيد، نسخة ثابتة على الجهاز');}catch{toast('تعذر قراءة الملف. استخدم ICS صالحاً بحجم أقل من ٣ ميجابايت.');}}
function downloadFile(data,type,name){const url=URL.createObjectURL(new Blob([data],{type})),a=el('a',{href:url,download:name});a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);}
function exportCalendar(){const escape=s=>String(s||'').replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;'),stamp=d=>d.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Mahami//Planner//AR','CALSCALE:GREGORIAN'];for(const t of S.tasks.filter(t=>!t.done&&t.due)){lines.push('BEGIN:VEVENT','UID:'+t.id+'@mahami.local','DTSTAMP:'+stamp(new Date()),'SUMMARY:'+escape(t.title),'DESCRIPTION:'+escape(t.note));if(t.time){const start=new Date(t.due+'T'+t.time);lines.push('DTSTART:'+stamp(start),'DTEND:'+stamp(new Date(+start+(t.duration||30)*60000)));}else lines.push('DTSTART;VALUE=DATE:'+t.due.replace(/-/g,''),'DTEND;VALUE=DATE:'+addDays(t.due,1).replace(/-/g,''));lines.push('END:VEVENT');}lines.push('END:VCALENDAR');const encoder=new TextEncoder(),fold=line=>{let out='',part='',n=0;for(const ch of line){let len=encoder.encode(ch).length;if(n+len>73){out+=part+'\r\n ';part='';n=1;}part+=ch;n+=len;}return out+part;};downloadFile(lines.map(fold).join('\r\n')+'\r\n','text/calendar;charset=utf-8','mahami-'+todayStr()+'.ics');toast('تم تصدير المهام المؤرخة فقط، دون تكرار تلقائي');}
function calendarHandoff(t){if(!t.due){toast('حدد تاريخ المهمة أولاً');return;}const params=new URLSearchParams({action:'TEMPLATE',text:t.title,details:t.note||''});if(t.time){const start=new Date(t.due+'T'+t.time),fmt=d=>d.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');params.set('dates',fmt(start)+'/'+fmt(new Date(+start+(t.duration||30)*60000)));}else params.set('dates',t.due.replace(/-/g,'')+'/'+addDays(t.due,1).replace(/-/g,''));window.open('https://calendar.google.com/calendar/render?'+params,'_blank','noopener,noreferrer');toast('راجع الموعد واحفظه في Google. هذه ليست مزامنة.');}
let focusEnded=false;
function startFocus(id){S.focus={task:id||'',remaining:25*60,end:Date.now()+25*60000,running:true};store.set('focus',S.focus);focusEnded=false;setTab('focus');}
function focusRemaining(){return S.focus?.running?Math.max(0,Math.ceil((S.focus.end-Date.now())/1000)):S.focus?.remaining??25*60;}
function updateFocusClock(){const node=$('#focus-clock');if(node){const n=focusRemaining();node.textContent=pad(Math.floor(n/60))+':'+pad(n%60);if(n===0&&S.focus?.running&&!focusEnded){focusEnded=true;S.focus.running=false;S.focus.remaining=0;store.set('focus',S.focus);toast('انتهت الجلسة. خذ استراحة قصيرة.');render();}}}
function viewFocus(){const t=S.tasks.find(t=>t.id===S.focus?.task),select=el('select',{'aria-label':'مهمة جلسة التركيز'},el('option',{value:'',text:'جلسة حرة'}),...S.tasks.filter(t=>!t.done).map(t=>el('option',{value:t.id,text:t.title})));select.value=S.focus?.task||'';return [heading('شيء واحد في كل مرة','مساحة التركيز','جلسة قصيرة للأهم، ثم استراحة تستحقها.'),el('div',{class:'focus-card'},el('span',{class:'eyebrow',text:S.focus?.running?'جلسة جارية':'جاهز للبدء؟'}),el('h3',{text:t?.title||'وقت هادئ للإنجاز'}),el('div',{id:'focus-clock',class:'focus-clock',role:'timer','aria-label':'الوقت المتبقي',text:'25:00'}),select,el('div',{class:'row'},el('button',{class:'btn primary',text:S.focus?.running?'إيقاف مؤقت':S.focus&&focusRemaining()>0?'استئناف':'ابدأ ٢٥ دقيقة',onclick:()=>{if(!S.focus||!focusRemaining())return startFocus(select.value);S.focus.task=select.value;if(S.focus.running){S.focus.remaining=focusRemaining();S.focus.running=false;}else{S.focus.end=Date.now()+S.focus.remaining*1000;S.focus.running=true;focusEnded=false;}store.set('focus',S.focus);render();}}),el('button',{class:'btn',text:'جلسة جديدة',onclick:()=>{S.focus=null;store.set('focus',null);render();}}),el('button',{class:'btn',text:'استراحة ٥ دقائق',onclick:()=>{S.focus={task:'',running:true,remaining:300,end:Date.now()+300000};focusEnded=false;store.set('focus',S.focus);render();}})),el('p',{class:'note',text:'الوقت يستمر بالحساب عند العودة. لا يصدر تنبيه مضمون والتطبيق مغلق أو الجهاز مقفل.'}))];}
function applyTheme(){document.documentElement.dataset.theme=S.prefs.theme||'auto';}
const originalSettings=viewSettings;
viewSettings=function(){return [heading('مساحتك كما تحبها','الإعدادات والبيانات','تحكم بالمظهر واحتفظ دائماً بنسخة من عملك.'),el('div',{class:'card'},el('h3',{text:'المظهر'}),chipRow([['auto','حسب الجهاز'],['light','فاتح'],['dark','داكن']],S.prefs.theme||'auto',v=>{S.prefs.theme=v;applyTheme();commit();}),el('p',{class:'note',text:'اختصارات لوحة المفاتيح: N لإضافة مهمة، / للبحث.'})),...originalSettings(),connectionPanel(),el('div',{class:'card'},el('h3',{text:'حول مهامي · الإصدار ٢'}),el('p',{text:'تخطيط محلي، دون حساب مهامي أو مزامنة مهام بين الأجهزة. نقل التقويم بملفات ICS أو فتح مسودة موعد في Google هو نقل يدوي، وليس مزامنة أو ربط حساب.'}))];};
// Backups are merged on import, never silently replace the user's current work.
exportData=function(){downloadFile(JSON.stringify({app:'mahami',v:2,exported:new Date().toISOString(),tasks:S.tasks,projects:S.projects,events:S.events},null,2),'application/json','mahami-'+todayStr()+'.json');toast('تم تصدير النسخة الاحتياطية');};
importData=async function(f){if(!f)return;try{if(f.size>10e6)throw 0;const d=JSON.parse(await f.text());if(d.app!=='mahami'||!Array.isArray(d.tasks)||!Array.isArray(d.projects))throw 0;const safeTask=t=>({id:t.id,title:t.title.slice(0,120),note:String(t.note||'').slice(0,500),prio:RANK[t.prio]!=null?t.prio:'mid',due:/^\d{4}-\d\d-\d\d$/.test(t.due||'')?t.due:'',proj:typeof t.proj==='string'?t.proj:'',done:!!t.done,doneAt:Number(t.doneAt)||null,created:Number(t.created)||Date.now(),time:/^\d\d:\d\d$/.test(t.time||'')?t.time:'',duration:Math.min(720,Math.max(5,+t.duration||30)),repeat:['daily','weekly','monthly'].includes(t.repeat)?t.repeat:'',nextCreated:!!t.nextCreated,star:!!t.star,status:t.status==='doing'?'doing':'todo',subtasks:Array.isArray(t.subtasks)?t.subtasks.filter(x=>typeof x.title==='string').slice(0,30).map(x=>({title:x.title.slice(0,200),done:!!x.done})):[]});checkpoint();const map=new Map(S.tasks.map(t=>[t.id,t]));d.tasks.filter(t=>t&&typeof t.id==='string'&&typeof t.title==='string').forEach(t=>{if(!map.has(t.id))map.set(t.id,safeTask(t));});S.tasks=[...map.values()];const projects=new Map(S.projects.map(p=>[p.id,p]));d.projects.filter(p=>p&&typeof p.id==='string'&&typeof p.name==='string').forEach(p=>{if(!projects.has(p.id))projects.set(p.id,{id:p.id,name:p.name.slice(0,40)});});S.projects=[...projects.values()];const events=new Map(S.events.map(e=>[e.id,e]));(Array.isArray(d.events)?d.events:[]).filter(e=>e&&typeof e.id==='string'&&typeof e.title==='string'&&Number.isFinite(e.start)&&Number.isFinite(e.end)).slice(0,5000).forEach(e=>{if(!events.has(e.id))events.set(e.id,{id:e.id,title:e.title.slice(0,180),start:e.start,end:e.end,allDay:!!e.allDay,source:'ics'});});S.events=[...events.values()];commit();toast('دُمجت النسخة، مع الاحتفاظ بالمهام الحالية');}catch{toast('ملف نسخة احتياطية غير صالح');}};

TITLES.settings=viewSettings;
init();
