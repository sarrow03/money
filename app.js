'use strict';
// Личный учёт денег. Все данные — только локально, зашифрованы (PBKDF2 + AES-GCM, Web Crypto).
// Никаких console.log с данными.

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : [...crypto.getRandomValues(new Uint32Array(4))].map(n => n.toString(16)).join(''));
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => ymd(new Date());
const parseDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return ymd(d); };
const shiftMonth = (k, n) => { const [y, m] = k.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const dueDate = (k, day) => { const [y, m] = k.split('-').map(Number); return `${k}-${pad(Math.min(day, new Date(y, m, 0).getDate()))}`; };
const fmtDay = s => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(parseDate(s));
const fmtDayLong = s => new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }).format(parseDate(s));
const fmtMonth = k => new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(parseDate(k + '-01'));
const num = v => { const n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? Math.round(n * 100) / 100 : NaN; };

// Сумма с калькулятором: 12+8,5 · 100/3 · (20-5)*2
function calc(str) {
  const x = String(str).replace(/\s/g, '').replace(/,/g, '.').replace(/[×x*]/g, '*').replace(/[÷:\/]/g, '/').replace(/[−–]/g, '-');
  if (!x) return NaN;
  let i = 0;
  const peek = () => x[i];
  const number = () => { const m = /^(\d+\.?\d*|\.\d+)/.exec(x.slice(i)); if (!m) throw 0; i += m[0].length; return parseFloat(m[0]); };
  const factor = () => {
    if (peek() === '-') { i++; return -factor(); }
    if (peek() === '(') { i++; const v = expr(); if (peek() !== ')') throw 0; i++; return v; }
    return number();
  };
  const term = () => { let v = factor(); while (peek() === '*' || peek() === '/') { const o = x[i++], r = factor(); v = o === '*' ? v * r : v / r; } return v; };
  const expr = () => { let v = term(); while (peek() === '+' || peek() === '-') { const o = x[i++], r = term(); v = o === '+' ? v + r : v - r; } return v; };
  try { const v = expr(); return i === x.length && isFinite(v) ? Math.round(v * 100) / 100 : NaN; } catch { return NaN; }
}

const CURS = ['EUR', 'UAH', 'USD'];
const SYM = { EUR: '€', UAH: '₴', USD: '$' };
const nf2 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const MAIN = () => (S && S.main) || 'EUR';
// Вторая сумма под капиталом = следующая по кругу € → ₴ → $ → €; нажатие делает её главной
const SUBC = () => ({ EUR: 'UAH', UAH: 'USD', USD: 'EUR' })[MAIN()];
function fmt(v, cur, sign = false) {
  if (S && S.hide) return cur === 'UAH' ? '••• ₴' : `${SYM[cur]}•••`;
  const n = Math.round(v * 100) / 100;
  const s = (Number.isInteger(n) ? nf0 : nf2).format(Math.abs(n));
  const pre = n < 0 ? '−' : (sign && n > 0 ? '+' : '');
  return cur === 'UAH' ? `${pre}${s} ₴` : `${pre}${SYM[cur]}${s}`;
}
const dm = (eur, sign) => fmt(convert(eur, 'EUR', MAIN()), MAIN(), sign); // в главной валюте
function bigMoney(v, cur) {
  if (S && S.hide) return cur === 'UAH' ? '•••<span class="dec"> ₴</span>' : `${SYM[cur]}•••`;
  const n = Math.round(v * 100) / 100;
  const [i, d] = nf2.format(Math.abs(n)).split(',');
  const pre = n < 0 ? '−' : '';
  return cur === 'UAH' ? `${pre}${i}<span class="dec">,${d} ₴</span>` : `${pre}${SYM[cur]}${i}<span class="dec">,${d}</span>`;
}

const CAT_ICONS = {
  'Продукты': '🛒', 'Кафе и рестораны': '🍽️', 'Транспорт': '🚇', 'Машина': '🚗', 'Жильё': '🏠',
  'Покупки': '🛍️', 'Развлечения': '🎬', 'Путешествия': '✈️', 'Подписки': '🔁', 'Здоровье': '💊',
  'Другое': '•', 'Неучтённое': '≈', 'Зарплата': '💼', 'Подработка': '🧾', 'Подарки': '🎁', 'Перевод': '⇄', 'Долг': '🤝',
};
const catIcon = c => CAT_ICONS[c] || esc((c || '•').slice(0, 1).toUpperCase());

function defaultState() {
  const acc = (name, currency) => ({ id: uid(), name, currency, initial: 0 });
  return {
    v: 1,
    accounts: [
      acc('Сенс Банк', 'UAH'), acc('Сенс Банк', 'USD'), acc('Сенс Банк', 'EUR'),
      acc('Монобанк', 'UAH'), acc('Монобанк', 'USD'), acc('Монобанк', 'EUR'),
      acc('ПУМБ', 'UAH'), acc('ПУМБ', 'USD'), acc('ПУМБ', 'EUR'),
      acc('Revolut', 'EUR'), acc('Revolut', 'USD'),
      acc('Erste', 'EUR'),
      acc('Наличные', 'EUR'), acc('Наличные', 'UAH'), acc('Наличные', 'USD'),
    ],
    ops: [],
    recurring: [],
    categories: {
      expense: ['Продукты', 'Кафе и рестораны', 'Транспорт', 'Машина', 'Жильё', 'Покупки', 'Развлечения', 'Путешествия', 'Подписки', 'Здоровье', 'Другое'],
      income: ['Зарплата', 'Подработка', 'Подарки', 'Другое'],
    },
    rates: { EUR: 50.72, USD: 44.68, updated: null }, // гривен за 1 единицу
    banksV2: true,
  };
}

/* ---------- IndexedDB ---------- */
let dbp;
function idb() {
  return dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open('money', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function kvGet(k) {
  const db = await idb();
  return new Promise((res, rej) => { const r = db.transaction('kv').objectStore('kv').get(k); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
async function kvSet(k, v) {
  const db = await idb();
  return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
}

async function kvDel(k) {
  const db = await idb();
  return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').delete(k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
}

/* ---------- crypto ---------- */
const ITER = 600000;
const enc = new TextEncoder(), dec = new TextDecoder();
async function deriveKey(pw, salt, iter) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function encryptState(key, salt, iter, state) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(state))));
  return { v: 1, salt, iter, iv, ct };
}
async function decryptVault(key, vault) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: vault.iv }, key, vault.ct);
  return JSON.parse(dec.decode(pt));
}

let KEY = null, SALT = null, ITERS = ITER, S = null;
let saving = Promise.resolve();
function save() {
  const snapshot = JSON.parse(JSON.stringify(S));
  const key = KEY, salt = SALT, iter = ITERS;
  saving = saving.then(async () => kvSet('vault', await encryptState(key, salt, iter, snapshot)))
    .catch(() => toast('Ошибка сохранения'));
  return saving;
}
function commit() { save(); render(); }

/* ---------- domain ---------- */
const accById = id => S.accounts.find(a => a.id === id);
const activeAccounts = () => S.accounts.filter(a => !a.archived);
// Банк = все активные счета с одинаковым названием (по одному на валюту)
const bankAccs = name => activeAccounts().filter(a => a.name === name);
const bankNames = () => [...new Set(activeAccounts().map(a => a.name))];
const isGoal = a => a.goal != null; // копилка
// Самая частая категория среди последних операций этого типа
function favCat(type) {
  const cnt = {};
  S.ops.filter(o => o.type === type).slice(-60).forEach(o => { cnt[o.category] = (cnt[o.category] || 0) + 1; });
  return Object.keys(cnt).filter(c => S.categories[type].includes(c)).sort((a, b) => cnt[b] - cnt[a])[0];
}
const accLabel = a => (a ? esc(a.name) : '?');
// Основная валюта банка: у украинских (есть ₴) — гривна, иначе евро. Меняется нажатием на вторую сумму.
const bankMain = n => (S.bankMain && S.bankMain[n]) || (bankAccs(n).some(a => a.currency === 'UAH') ? 'UAH' : 'EUR');
const bankSub = n => (bankMain(n) === 'UAH' ? 'EUR' : 'UAH');
const CUR_ORDER = { UAH: 0, USD: 1, EUR: 2 };
const rateOf = c => (c === 'UAH' ? 1 : +S.rates[c] || 1);
const convert = (v, from, to) => (from === to ? v : v * rateOf(from) / rateOf(to));

function balances() {
  const b = {};
  for (const a of S.accounts) b[a.id] = +a.initial || 0;
  const add = (id, v) => { if (id in b) b[id] += v; };
  for (const o of S.ops) {
    if (o.type === 'expense') add(o.accountId, -o.amount);
    else if (o.type === 'income') add(o.accountId, o.amount);
    else if (o.type === 'debt') add(o.accountId, o.dir === 'out' ? -o.amount : o.amount);
    else { add(o.accountId, -o.amount); add(o.toId, o.toAmount ?? o.amount); }
  }
  return b;
}
function capitalEUR(b) { return activeAccounts().reduce((s, a) => s + convert(b[a.id], a.currency, 'EUR'), 0); }

// Ближайшие регулярные: неподтверждённые в текущем месяце + следующие в пределах 30 дней.
function upcoming() {
  const today = todayStr(), cur = today.slice(0, 7), limit = addDays(today, 30), out = [];
  for (const r of S.recurring) {
    const a = accById(r.accountId);
    if (!a || a.archived) continue;
    for (const k of [cur, shiftMonth(cur, 1)]) {
      const due = dueDate(k, r.day);
      if (due < r.start || r.done[k]) continue;
      if (k !== cur && due > limit) continue;
      out.push({ r, k, due, cur: a.currency, eur: convert(r.amount, a.currency, 'EUR'), late: due < today });
    }
  }
  return out.sort((x, y) => x.due.localeCompare(y.due));
}

/* ---------- UI: shell ---------- */
let tab = 'home';
let histMonth = todayStr().slice(0, 7);

function toast(msg, undo) {
  const t = $('#toast');
  t.innerHTML = esc(msg) + (undo ? '<button class="toast-undo">Отменить</button>' : '');
  if (undo) t.querySelector('button').onclick = () => { t.classList.remove('show'); undo(); };
  t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), undo ? 4000 : 2200);
}
const EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18M10.6 5.1A10.7 10.7 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7c1.9 0 3.5-.5 4.9-1.3"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';

let bioOn = false;
function render() {
  if (!S) return;
  kvGet('bio').then(b => { if (!!b !== bioOn) { bioOn = !!b; if (tab === 'settings') render(); } });
  $$('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  const m = $('#main');
  m.innerHTML = ({ home: viewHome, history: viewHistory, recurring: viewRecurring, settings: viewSettings })[tab]();
}

function viewHome() {
  const b = balances(), total = capitalEUR(b), up = upcoming(), M = MAIN();
  const reserved = up.filter(u => u.r.type === 'expense').reduce((s, u) => s + u.eur, 0);
  const incoming = up.filter(u => u.r.type === 'income').reduce((s, u) => s + u.eur, 0);
  const after = { ...b };
  for (const u of up) after[u.r.accountId] += u.r.type === 'income' ? u.r.amount : -u.r.amount;
  const accs = activeAccounts();
  const goals = accs.filter(isGoal);
  const inGoals = goals.reduce((s, a) => s + convert(b[a.id], a.currency, 'EUR'), 0);
  const avail = total - reserved - inGoals;
  const debts = (S.debts || []).filter(d => !d.closed);
  const banks = bankNames().filter(n => !bankAccs(n).some(isGoal));
  const tpls = S.templates || [];
  const needBackup = (S.ops.length || S.recurring.length) && (!S.lastBackup || addDays(S.lastBackup, 7) < todayStr());
  const since = S.lastRecon || S.created || todayStr();
  const needRecon = !needBackup && addDays(since, 7) < todayStr();
  const afterLine = (now, later, cur) => (Math.abs(later - now) > 0.004 ? `<div class="acc-after">после платежей ${fmt(later, cur)}</div>` : '');
  return `
  ${needBackup ? `<button class="card forecast" style="width:100%;border:0;text-align:left;margin:4px 0 0" data-action="backup-now">
    <div><div class="title">Сохраните резервную копию</div><div class="meta">${S.lastBackup ? 'Последняя: ' + fmtDay(S.lastBackup) : 'Ещё ни разу'} · в Файлы → iCloud Drive</div></div><div class="link">Сохранить</div></button>` : ''}
  ${needRecon ? `<button class="card forecast" style="width:100%;border:0;text-align:left;margin:4px 0 0" data-action="reconcile">
    <div><div class="title">Пора сверить остатки</div><div class="meta">${S.lastRecon ? 'Последняя сверка: ' + fmtDay(S.lastRecon) : '5 минут — и капитал снова точный'}</div></div><div class="link">Сверить</div></button>` : ''}
  <section class="hero">
    <div class="label">Общий капитал <button class="eye" data-action="toggle-hide" aria-label="Скрыть суммы">${S.hide ? EYE_OFF : EYE}</button></div>
    <div class="big">${bigMoney(convert(total, 'EUR', M), M)}</div>
    <button class="sub swap" data-action="swap-main">${fmt(convert(total, 'EUR', SUBC()), SUBC())} <span>⇅</span></button>
  </section>
  <div class="stats">
    <div class="stat"><div class="label">Доступно</div><div class="val">${dm(avail)}</div>${inGoals ? '<div class="meta">без копилок</div>' : ''}</div>
    <div class="stat"><div class="label">Зарезервировано</div><div class="val">${dm(reserved)}</div></div>
  </div>
  <div class="card forecast">
    <div><div class="label">Прогноз после платежей</div>${incoming ? `<div class="meta">с учётом доходов ${dm(incoming, true)}</div>` : ''}</div>
    <div class="val">${dm(avail + incoming)}</div>
  </div>
  <div class="plabel" style="margin-top:18px">Быстрая запись</div><div class="chips tpl">
    <button class="chip" data-action="day-sheet">📋 Траты за день</button>
    <button class="chip" data-action="reconcile">⚖️ Сверка</button>${tpls.map(t => {
    const a = accById(t.accountId);
    return `<button class="chip" data-action="use-tpl" data-id="${t.id}">${catIcon(t.category)} ${esc(t.name)} · ${a ? fmt(t.amount, a.currency) : ''}</button>`;
  }).join('')}</div>
  ${up.length ? `<h2>Ближайшие 30 дней</h2><div class="list">${up.map(u => `
    <div class="row">
      <div class="ico">${catIcon(u.r.category)}</div>
      <div class="main"><div class="title">${esc(u.r.name)}</div>
        <div class="meta ${u.late ? 'late' : ''}">${u.late ? 'просрочено · ' : ''}${fmtDay(u.due)} · ${accLabel(accById(u.r.accountId))}</div></div>
      <div class="amt ${u.r.type === 'income' ? 'pos' : ''}">${fmt(u.r.type === 'income' ? u.r.amount : -u.r.amount, u.cur, true)}</div>
      <button class="btn-ok" data-action="confirm-rec" data-id="${u.r.id}" data-k="${u.k}" data-due="${u.due}">✓</button>
    </div>`).join('')}</div>` : ''}
  <h2>Счета <button class="link" data-action="reconcile">Сверка</button></h2>
  <div class="accounts">
    ${banks.map(n => {
      const list = accs.filter(a => a.name === n), P = bankMain(n), Q = bankSub(n);
      const sum = list.reduce((x, a) => x + convert(b[a.id], a.currency, 'EUR'), 0);
      const sumAfter = list.reduce((x, a) => x + convert(after[a.id], a.currency, 'EUR'), 0);
      return `<button class="acc" data-action="open-bank" data-name="${esc(n)}">
        <div class="acc-name">${esc(n)}</div>
        <div><div class="acc-bal">${fmt(convert(sum, 'EUR', P), P)}</div>
        <div class="acc-eur">${fmt(convert(sum, 'EUR', Q), Q)}</div>
        ${afterLine(sum, sumAfter, 'EUR').replace(fmt(sumAfter, 'EUR'), fmt(convert(sumAfter, 'EUR', P), P))}</div></button>`;
    }).join('')}
    <button class="acc acc-add" data-action="new-account">+ Банк</button>
  </div>
  <h2>Копилки <button class="link" data-action="new-goal">+ Новая</button></h2>
  ${goals.length ? `<div class="list">${goals.map(a => {
    const t = a.goal || 0, v = b[a.id], pct = t > 0 ? Math.max(0, Math.min(100, v / t * 100)) : 0;
    return `<button class="row" data-action="edit-goal" data-id="${a.id}"><div class="ico">🎯</div>
      <div class="main"><div class="title">${esc(a.name)}</div><div class="meta">${fmt(v, a.currency)}${t ? ' из ' + fmt(t, a.currency) : ''}</div>
      ${t ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}</div>
      <div class="amt">${t ? Math.round(pct) + '%' : ''}</div></button>`;
  }).join('')}</div>` : '<p class="note">Отложенные деньги с целью: «Отпуск», «Подушка». Не входят в «Доступно».</p>'}
  <h2>Долги <button class="link" data-action="new-debt">+ Добавить</button></h2>
  ${debts.length ? `<div class="list">${debts.map(d => `
    <button class="row" data-action="edit-debt" data-id="${d.id}"><div class="ico">🤝</div>
      <div class="main"><div class="title">${esc(d.person)}</div><div class="meta">${d.dir === 'lent' ? 'должен мне' : 'я должен'}${d.note ? ' · ' + esc(d.note) : ''}</div></div>
      <div class="amt ${d.dir === 'lent' ? 'pos' : ''}">${fmt(d.amount, d.currency)}</div></button>`).join('')}</div>` : '<p class="note">Кто должен вам и кому должны вы.</p>'}`;
}

function opRow(o) {
  const a = accById(o.accountId);
  const cur = a ? a.currency : 'EUR';
  let title, meta, amt, cls = '';
  if (o.type === 'transfer') {
    const t = accById(o.toId);
    title = 'Перевод';
    meta = `${accLabel(a)} → ${accLabel(t)}`;
    amt = fmt(o.amount, cur) + (t && t.currency !== cur ? `<div class="meta">${fmt(o.toAmount ?? o.amount, t.currency)}</div>` : '');
  } else if (o.type === 'debt') {
    title = o.repay ? (o.dir === 'in' ? 'Вернули долг' : 'Вернул долг') : (o.dir === 'out' ? 'Дал в долг' : 'Взял в долг');
    meta = accLabel(a);
    amt = fmt(o.dir === 'out' ? -o.amount : o.amount, cur, true);
    if (o.dir === 'in') cls = 'pos';
  } else {
    title = esc(o.category);
    meta = accLabel(a);
    amt = fmt(o.type === 'income' ? o.amount : -o.amount, cur, true);
    if (o.type === 'income') cls = 'pos';
  }
  if (o.note) meta += ' · ' + esc(o.note);
  return `<button class="row" data-action="edit-op" data-id="${o.id}">
    <div class="ico">${catIcon(o.type === 'transfer' ? 'Перевод' : o.type === 'debt' ? 'Долг' : o.category)}</div>
    <div class="main"><div class="title">${title}</div><div class="meta">${meta}</div></div>
    <div class="amt ${cls}">${amt}</div></button>`;
}

let histQ = '', histAcc = '', histCat = '';
const eurOf = o => { const a = accById(o.accountId); return a ? convert(o.amount, a.currency, 'EUR') : 0; };
function opMatches(o, q) {
  const a = accById(o.accountId), t = o.toId && accById(o.toId);
  if (histAcc && !((a && a.name === histAcc) || (t && t.name === histAcc))) return false;
  if (histCat && o.category !== histCat) return false;
  if (q) {
    const hay = [o.note, o.category, a && a.name, t && t.name, o.type === 'transfer' ? 'перевод' : '', o.type === 'debt' ? 'долг' : ''].join(' ').toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}
function viewHistory() {
  const cats = [...new Set([...S.categories.expense, ...S.categories.income])];
  return `<div class="page-title">История</div>
    <div class="month"><button data-action="month" data-d="-1">‹</button><b>${fmtMonth(histMonth)}</b><button data-action="month" data-d="1">›</button></div>
    <input id="h-q" class="search" type="search" placeholder="Поиск" value="${esc(histQ)}" autocomplete="off">
    <div class="filters">
      <select id="h-acc"><option value="">Все счета</option>${bankNames().map(n => `<option ${n === histAcc ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
      <select id="h-cat"><option value="">Все категории</option>${cats.map(c => `<option ${c === histCat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
    </div>
    <div id="h-body">${historyBody()}</div>`;
}
function historyBody() {
  const q = histQ.trim().toLowerCase();
  const ops = S.ops.filter(o => (q || o.date.slice(0, 7) === histMonth) && opMatches(o, q))
    .sort((x, y) => y.date.localeCompare(x.date) || (y.ts || 0) - (x.ts || 0));
  const spent = ops.filter(o => o.type === 'expense').reduce((s, o) => s + eurOf(o), 0);
  const earned = ops.filter(o => o.type === 'income').reduce((s, o) => s + eurOf(o), 0);
  // Сравнение с прошлым месяцем (для текущего месяца — за тот же период)
  let cmp = '';
  const prevCats = {};
  if (!q) {
    const pk = shiftMonth(histMonth, -1);
    const upto = todayStr().slice(0, 7) === histMonth ? +todayStr().slice(8) : 31;
    const prevOps = S.ops.filter(o => o.type === 'expense' && o.date.slice(0, 7) === pk && +o.date.slice(8) <= upto && opMatches(o, ''));
    const prev = prevOps.reduce((s, o) => s + eurOf(o), 0);
    prevOps.forEach(o => { prevCats[o.category] = (prevCats[o.category] || 0) + eurOf(o); });
    if (prev > 0) {
      const p = Math.round((spent - prev) / prev * 100);
      cmp = `<div class="meta ${p > 0 ? 'late' : 'pos'}">${p > 0 ? '▲' : '▼'} ${Math.abs(p)}% к прошлому мес.</div>`;
    }
  }
  let html = `${q ? '<p class="note">Поиск по всем месяцам</p>' : ''}
    ${histAcc || histCat || q ? '<button class="link" data-action="clear-filters">Сбросить фильтры</button>' : ''}
    <div class="stats"><div class="stat"><div class="label">Расходы</div><div class="val">${dm(spent)}</div>${cmp}</div>
    <div class="stat"><div class="label">Доходы</div><div class="val pos">${dm(earned)}</div></div></div>`;
  if (!q) {
    // Расходы за 6 месяцев (учитывают фильтры счёта и категории)
    const months = [-5, -4, -3, -2, -1, 0].map(n => shiftMonth(histMonth, n));
    const vals = months.map(k => S.ops.filter(o => o.type === 'expense' && o.date.slice(0, 7) === k && opMatches(o, '')).reduce((x, o) => x + eurOf(o), 0));
    const max = Math.max(...vals);
    if (max > 0) {
      const short = k => new Intl.DateTimeFormat('ru-RU', { month: 'short' }).format(parseDate(k + '-01')).replace('.', '');
      html += `<h2>Расходы по месяцам</h2><div class="card mchart" role="img" aria-label="Расходы за 6 месяцев">${months.map((k, i) => `
        <button class="mcol ${k === histMonth ? 'on' : ''}" data-action="set-month" data-k="${k}" title="${esc(fmtMonth(k))}: ${dm(vals[i])}">
          <span class="mval">${k === histMonth || vals[i] === max ? dm(Math.round(vals[i])) : ''}</span>
          <span class="mtrack"><span class="mbar" style="height:${vals[i] ? Math.max(3, Math.round(vals[i] / max * 100)) : 0}%"></span></span>
          <span class="mlab">${short(k)}</span></button>`).join('')}</div>`;
    }
  }
  if (!q && !histCat && spent > 0) {
    const byCat = {};
    ops.filter(o => o.type === 'expense').forEach(o => { byCat[o.category] = (byCat[o.category] || 0) + eurOf(o); });
    const rows = Object.entries(byCat).sort((x, y) => y[1] - x[1]);
    html += `<h2>По категориям</h2><div class="list">${rows.map(([c, v]) => `
      <button class="row" data-action="hist-cat" data-c="${esc(c)}"><div class="ico">${catIcon(c)}</div>
        <div class="main"><div class="title">${esc(c)}</div><div class="bar"><i style="width:${Math.round(v / rows[0][1] * 100)}%"></i></div></div>
        <div class="amt">${dm(v)}<div class="meta">${Math.round(v / spent * 100)}%${prevCats[c] ? ' · было ' + dm(prevCats[c]) : ''}</div></div></button>`).join('')}</div>
      <h2>Операции</h2>`;
  }
  if (!ops.length) return html + `<div class="empty">Операций нет</div>`;
  let day = null;
  for (const o of ops) {
    if (o.date !== day) { if (day) html += '</div>'; day = o.date; html += `<div class="day-head">${fmtDayLong(day)}${q ? ' ' + day.slice(0, 4) : ''}</div><div class="list">`; }
    html += opRow(o);
  }
  return html + '</div>';
}

function viewRecurring() {
  const list = [...S.recurring].sort((x, y) => x.day - y.day);
  const sum = t => list.filter(r => r.type === t).reduce((s, r) => { const a = accById(r.accountId); return s + (a ? convert(r.amount, a.currency, 'EUR') : 0); }, 0);
  return `<div class="page-title">Регулярные</div>
    <div class="stats"><div class="stat"><div class="label">Платежи в месяц</div><div class="val">${dm(sum('expense'))}</div></div>
    <div class="stat"><div class="label">Доходы в месяц</div><div class="val pos">${dm(sum('income'))}</div></div></div>
    <p class="note">Не меняют баланс, пока не подтвердите их на главной (✓).</p>
    ${list.length ? `<div class="list">${list.map(r => {
      const a = accById(r.accountId);
      return `<button class="row" data-action="edit-rec" data-id="${r.id}">
        <div class="ico">${catIcon(r.category)}</div>
        <div class="main"><div class="title">${esc(r.name)}</div><div class="meta">каждое ${r.day} число · ${a ? accLabel(a) : '—'}</div></div>
        <div class="amt ${r.type === 'income' ? 'pos' : ''}">${a ? fmt(r.type === 'income' ? r.amount : -r.amount, a.currency, true) : ''}</div></button>`;
    }).join('')}</div>` : '<div class="empty">Пока пусто</div>'}
    <button class="primary" style="margin-top:16px" data-action="new-rec">Добавить регулярный</button>`;
}

function viewSettings() {
  const r = S.rates;
  const cats = type => S.categories[type].map((c, i) =>
    `<button class="chip" data-action="rename-cat" data-type="${type}" data-i="${i}">${esc(c)}<span class="x" data-action="del-cat" data-type="${type}" data-i="${i}">×</span></button>`).join('');
  const hidden = S.accounts.filter(a => a.archived);
  return `<div class="page-title">Настройки</div>
    <h2>Курсы</h2>
    <div class="form">
      <label class="field"><span>1 € =</span><input inputmode="decimal" data-rate="EUR" value="${r.EUR}"><span>₴</span></label>
      <label class="field"><span>1 $ =</span><input inputmode="decimal" data-rate="USD" value="${r.USD}"><span>₴</span></label>
    </div>
    <p class="note">${r.updated ? 'Курс НБУ на ' + esc(r.updated) + '. ' : ''}Задайте вручную или загрузите официальный курс НБУ (запрос только за курсом, ваши данные не отправляются).</p>
    <button class="secondary" data-action="nbu">Загрузить курс НБУ</button>

    <h2>Главная валюта</h2>
    <div class="seg">${['EUR', 'UAH', 'USD'].map(c => `<button data-action="set-main" data-c="${c}" class="${MAIN() === c ? 'on' : ''}">${{ EUR: '€ Евро', UAH: '₴ Гривна', USD: '$ Доллар' }[c]}</button>`).join('')}</div>
    <p class="note">В ней показываются капитал и итоги. Быстро переключить — нажать на вторую сумму под капиталом (€ → ₴ → $).</p>

    ${(S.templates || []).length ? `<h2>Шаблоны</h2><div class="chips">${S.templates.map((t, i) =>
      `<button class="chip" data-action="rename-tpl" data-i="${i}">${esc(t.name)}<span class="x" data-action="del-tpl" data-i="${i}">×</span></button>`).join('')}</div>
      <p class="note">Новый шаблон — в форме операции: «☆ В шаблоны».</p>` : ''}

    <h2>Категории расходов</h2>
    <div class="chips">${cats('expense')}</div>
    <div class="inline-add"><input id="new-cat-expense" placeholder="Новая категория"><button data-action="add-cat" data-type="expense">Добавить</button></div>
    <h2>Категории доходов</h2>
    <div class="chips">${cats('income')}</div>
    <div class="inline-add"><input id="new-cat-income" placeholder="Новая категория"><button data-action="add-cat" data-type="income">Добавить</button></div>
    <p class="note">Нажмите на категорию, чтобы переименовать, × — удалить.</p>

    ${hidden.length ? `<h2>Скрытые счета</h2><div class="list">${hidden.map(a => `<button class="row" data-action="unhide-account" data-id="${a.id}"><div class="main"><div class="title">${esc(a.name)} ${SYM[a.currency]}</div><div class="meta">нажмите, чтобы вернуть</div></div></button>`).join('')}</div>` : ''}

    <h2>Данные</h2>
    <p class="note">Данные хранятся только на этом устройстве, зашифрованы паролем. Резервная копия — зашифрованный файл: сохраняйте её в Файлы → iCloud Drive. Восстановить можно на любом устройстве, зная пароль.${S.lastBackup ? ' Последняя копия: ' + fmtDay(S.lastBackup) + '.' : ''}</p>
    <button class="secondary" data-action="export">Сохранить резервную копию</button>
    <button class="secondary" data-action="csv">Выгрузить в Excel (CSV)</button>
    <button class="secondary" data-action="import">Восстановить из копии</button>
    <button class="secondary" data-action="bio">${bioOn ? 'Выключить вход по Face ID' : 'Включить вход по Face ID'}</button>
    <button class="secondary" data-action="change-pw">Сменить пароль</button>
    <button class="danger" data-action="lock">Заблокировать</button>
    <button class="danger" data-action="wipe">Удалить все данные</button>
    <input type="file" id="import-file" accept=".json,application/json" hidden>`;
}

/* ---------- sheets ---------- */
// Большая сумма: ширина поля по содержимому, чтобы число и валюта стояли ровно по центру
const measureCtx = document.createElement('canvas').getContext('2d');
function sizeAmount(el) {
  const t = el.value || el.placeholder || '0';
  el.style.fontSize = t.length > 12 ? '28px' : t.length > 8 ? '38px' : '';
  const cs = getComputedStyle(el);
  measureCtx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const ls = parseFloat(cs.letterSpacing) || 0;
  el.style.width = Math.ceil(measureCtx.measureText(t).width + ls * t.length + 6) + 'px';
}
document.addEventListener('input', e => { if (e.target.closest && e.target.closest('.amount-wrap')) sizeAmount(e.target); });
function openSheet(html, bind) {
  const root = $('#sheet-root');
  root.innerHTML = `<div class="overlay" data-close></div><div class="sheet">${html}</div>`;
  const sheet = $('.sheet', root);
  $$('[data-close]', root).forEach(el => el.addEventListener('click', closeSheet));
  bind && bind(sheet);
  $$('.amount-wrap input', sheet).forEach(sizeAmount);
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('open')));
}
function closeSheet() {
  const root = $('#sheet-root');
  root.classList.remove('open');
  setTimeout(() => { if (!root.classList.contains('open')) root.innerHTML = ''; }, 300);
}
const sheetHead = (title, right = '') => `<div class="sheet-head"><button class="link" data-close>Отмена</button><b>${title}</b><span style="justify-self:end">${right}</span></div>`;
// Выбор счёта: сначала банк (чипы), потом валюта — если у банка их несколько
function accPicker(el, selId, onChange) {
  const b = balances();
  let id = selId && accById(selId) && !accById(selId).archived ? selId : activeAccounts()[0].id;
  const draw = () => {
    const cur = accById(id), subs = bankAccs(cur.name).sort((x, y) => CUR_ORDER[x.currency] - CUR_ORDER[y.currency]);
    el.innerHTML = `<div class="chips pick">${bankNames().map(n => `<button class="chip ${n === cur.name ? 'on' : ''}" data-bank="${esc(n)}">${esc(n)}</button>`).join('')}</div>` +
      (subs.length > 1
        ? `<div class="seg">${subs.map(a => `<button class="${a.id === id ? 'on' : ''}" data-acc="${a.id}">${fmt(b[a.id], a.currency)}</button>`).join('')}</div>`
        : `<div class="note">Остаток ${fmt(b[id], cur.currency)}</div>`);
  };
  el.addEventListener('click', e => {
    const bk = e.target.closest('[data-bank]'), ac = e.target.closest('[data-acc]');
    if (bk) {
      if (bk.dataset.bank === accById(id).name) return;
      const subs = bankAccs(bk.dataset.bank);
      id = (subs.find(a => a.currency === accById(id).currency) || subs[0]).id;
    } else if (ac) id = ac.dataset.acc;
    else return;
    draw(); onChange && onChange();
  });
  draw();
  return { get value() { return id; } };
}

// Операция: новая, редактирование или подтверждение регулярного
function opSheet({ op = null, rec = null, k = null, due = null, preset = null } = {}) {
  const b = balances(), accs = activeAccounts();
  if (!accs.length) return toast('Сначала добавьте счёт');
  let type = op ? op.type : rec ? rec.type : (preset && preset.type) || 'expense';
  let cat = op ? op.category : rec ? rec.category : null;
  let toTouched = !!op;
  const last = S.last && accById(S.last.accountId);
  let first = last && !last.archived ? last.id : accs[0].id;
  if (preset && preset.toId === first) first = (accs.find(a => a.id !== preset.toId && !isGoal(a)) || accs[0]).id;
  const html = sheetHead(op ? 'Операция' : rec ? esc(rec.name) : 'Новая операция', !op && !rec ? '<button class="link" id="f-day">За день</button>' : '') + `
    <div class="seg" id="f-type">
      <button data-t="expense">Расход</button><button data-t="income">Доход</button>${rec ? '' : '<button data-t="transfer">Перевод</button>'}
    </div>
    <div class="amount-wrap"><input id="f-amount" inputmode="decimal" placeholder="0" autocomplete="off" value="${op ? op.amount : rec ? rec.amount : ''}"><span id="f-cur"></span></div>
    <div class="calc-eq" id="f-eq"></div>
    <div class="calc" id="f-calc">${['+', '−', '×', '÷'].map(c => `<button type="button" data-op="${c}">${c}</button>`).join('')}</div>
    <div class="plabel" id="f-acc-l">Счёт</div><div id="f-acc"></div>
    <div id="f-to-row"><div class="plabel">На счёт</div><div id="f-to"></div></div>
    <div class="form" id="f-toam-row">
      <label class="field"><span>Зачислено</span><input id="f-toamount" inputmode="decimal" value="${op && op.toAmount != null ? op.toAmount : ''}"></label>
    </div>
    <div class="chips" id="f-cats"></div>
    <div class="form">
      <label class="field"><span>Дата</span><input type="date" id="f-date" value="${op ? op.date : due && due <= todayStr() ? due : todayStr()}"></label>
      <label class="field"><span>Комментарий</span><input id="f-note" placeholder="необязательно" value="${esc(op ? op.note : rec ? rec.name : '')}"></label>
    </div>
    <button class="primary" id="f-save">${rec ? 'Подтвердить' : 'Сохранить'}</button>
    ${op ? '<button class="danger" id="f-del">Удалить операцию</button>' : ''}
    ${rec ? '<button class="secondary" id="f-skip">Пропустить в этот раз</button>' : ''}
    ${!op && !rec ? '<button class="secondary" id="f-tpl">☆ В шаблоны</button>' : ''}`;

  openSheet(html, s => {
    const amountEl = $('#f-amount', s), toAmEl = $('#f-toamount', s);
    const reset = () => { toTouched = false; update(); };
    const accEl = accPicker($('#f-acc', s), op ? op.accountId : rec ? rec.accountId : first, reset);
    const toEl = accPicker($('#f-to', s), op && op.toId ? op.toId : preset && preset.toId ? preset.toId : (accs.find(a => a.id !== accEl.value) || accs[0]).id, reset);
    const update = () => {
      $$('#f-type button', s).forEach(x => x.classList.toggle('on', x.dataset.t === type));
      const from = accById(accEl.value), to = accById(toEl.value);
      $('#f-cur', s).textContent = SYM[from.currency];
      const tr = type === 'transfer';
      $('#f-to-row', s).hidden = !tr;
      $('#f-acc-l', s).textContent = tr ? 'Со счёта' : 'Счёт';
      const cross = tr && from.currency !== to.currency;
      $('#f-toam-row', s).hidden = !cross;
      if (cross) {
        $('#f-toam-row .field span', s).textContent = `Зачислено, ${SYM[to.currency]}`;
        const a = calc(amountEl.value);
        if (!toTouched) toAmEl.value = isFinite(a) ? Math.round(convert(a, from.currency, to.currency) * 100) / 100 : '';
      }
      const list = tr ? [] : S.categories[type].concat(op && op.category === cat && cat && !S.categories[type].includes(cat) ? [cat] : []);
      if (!tr && !list.includes(cat)) cat = (!op && !rec && favCat(type)) || list[0];
      $('#f-cats', s).hidden = tr;
      const v = amountEl.value, r = calc(v);
      $('#f-eq', s).textContent = /[-+×÷*/−]/.test(v.replace(/^-/, '')) && isFinite(r) ? '= ' + String(r).replace('.', ',') : '';
      sizeAmount(amountEl);
      $('#f-cats', s).innerHTML = list.map(c => `<button class="chip ${c === cat ? 'on' : ''}" data-c="${esc(c)}">${esc(c)}</button>`).join('');
    };
    $('#f-type', s).addEventListener('click', e => { const t = e.target.closest('[data-t]'); if (t) { type = t.dataset.t; update(); } });
    $('#f-cats', s).addEventListener('click', e => { const c = e.target.closest('[data-c]'); if (c) { cat = c.dataset.c; update(); } });
    amountEl.addEventListener('input', update);
    $('#f-calc', s).addEventListener('pointerdown', e => {
      const b2 = e.target.closest('[data-op]'); if (!b2) return;
      e.preventDefault(); // клавиатура не закрывается
      amountEl.value = amountEl.value.replace(/[+−×÷]$/, '') + b2.dataset.op; update();
    });
    toAmEl.addEventListener('input', () => { toTouched = true; });
    update();
    if (!op && !rec) setTimeout(() => amountEl.focus(), 350);

    $('#f-save', s).addEventListener('click', () => {
      const amount = calc(amountEl.value);
      if (!(amount > 0)) return toast('Введите сумму');
      const date = $('#f-date', s).value || todayStr();
      const o = op || { id: uid(), ts: Date.now() };
      Object.assign(o, { type, amount, accountId: accEl.value, date, note: $('#f-note', s).value.trim() });
      if (type === 'transfer') {
        if (accEl.value === toEl.value) return toast('Выберите разные счета');
        o.toId = toEl.value;
        const cross = accById(accEl.value).currency !== accById(toEl.value).currency;
        if (cross) { const ta = num(toAmEl.value); if (!(ta > 0)) return toast('Введите сумму зачисления'); o.toAmount = ta; }
        else delete o.toAmount;
        delete o.category;
      } else { o.category = cat; delete o.toId; delete o.toAmount; }
      if (!op) S.ops.push(o);
      if (!op && !rec) S.last = { accountId: accEl.value };
      if (rec) { o.recId = rec.id; o.recK = k; rec.done[k] = o.id; }
      closeSheet(); commit(); toast(rec ? 'Подтверждено' : 'Сохранено');
    });
    op && $('#f-del', s).addEventListener('click', () => {
      if (!confirm('Удалить операцию?')) return;
      S.ops = S.ops.filter(x => x.id !== op.id);
      const r = op.recId && S.recurring.find(x => x.id === op.recId);
      if (r && r.done[op.recK] === op.id) delete r.done[op.recK];
      closeSheet(); commit();
    });
    rec && $('#f-skip', s).addEventListener('click', () => { rec.done[k] = 'skip'; closeSheet(); commit(); });
    !op && !rec && $('#f-day', s).addEventListener('click', () => { closeSheet(); setTimeout(daySheet, 320); });
    !op && !rec && $('#f-tpl', s).addEventListener('click', () => {
      if (type === 'transfer') return toast('Шаблон — для расхода или дохода');
      const amount = calc(amountEl.value);
      if (!(amount > 0)) return toast('Сначала введите сумму');
      const name = (prompt('Название шаблона', $('#f-note', s).value.trim() || cat) || '').trim();
      if (!name) return;
      (S.templates ||= []).push({ id: uid(), name, type, amount, accountId: accEl.value, category: cat });
      commit(); toast('Шаблон добавлен на главную');
    });
  });
}

// Банк: название + остатки сразу во всех валютах. Пустое поле — такой валюты в банке нет.
function accountSheet(a = null, bank = null) {
  const b = balances();
  const orig = a ? a.name : bank || '';
  const own = c => (orig ? bankAccs(orig).find(x => x.currency === c) : null);
  const curs = [...CURS].sort((x, y) => CUR_ORDER[x] - CUR_ORDER[y]);
  const html = sheetHead(orig ? esc(orig) : 'Новый банк') + `
    <div class="form">
      <label class="field"><span>Название</span><input id="a-name" value="${esc(orig)}" placeholder="Монобанк, Revolut, Наличные…"></label>
    </div>
    <div class="plabel">Остатки сейчас</div>
    <div class="form">${curs.map(c => { const x = own(c); return `
      <label class="field"><span>${SYM[c]} ${c}</span><input data-bal="${c}" inputmode="decimal" placeholder="нет" value="${x ? Math.round(b[x.id] * 100) / 100 : ''}"></label>`; }).join('')}
    </div>
    <p class="note">Впишите, сколько сейчас лежит в каждой валюте. Пустое поле — такой валюты в банке нет. Изменение остатка — корректировка, в историю не попадает.</p>
    <button class="primary" id="a-save">Сохранить</button>
    ${orig ? '<button class="danger" id="a-del">Удалить банк</button>' : ''}`;
  openSheet(html, s => {
    $('#a-save', s).addEventListener('click', () => {
      const name = $('#a-name', s).value.trim();
      if (!name) return toast('Введите название');
      const vals = {};
      for (const el of $$('[data-bal]', s)) {
        const v = el.value.trim();
        if (v !== '' && !isFinite(calc(v))) return toast(`Неверный остаток ${SYM[el.dataset.bal]}`);
        vals[el.dataset.bal] = v === '' ? null : calc(v);
      }
      if (name !== orig && bankNames().includes(name)) {
        // Объединение со существующим банком, если валюты не пересекаются
        const mine = orig ? bankAccs(orig).map(x => x.currency) : CURS.filter(c => vals[c] != null);
        if (bankAccs(name).some(x => mine.includes(x.currency) || isGoal(x))) return toast(`«${name}» уже есть`);
        if (!confirm(`Объединить с «${name}»?`)) return;
      }
      if (orig && name !== orig) bankAccs(orig).forEach(x => { x.name = name; });
      let any = bankAccs(name).length > 0;
      for (const c of CURS) {
        const x = bankAccs(name).find(y => y.currency === c), v = vals[c];
        if (x) { if (v != null) x.initial = Math.round((x.initial + v - b[x.id]) * 100) / 100; }
        else if (v != null) { S.accounts.push({ id: uid(), name, currency: c, initial: v }); any = true; }
      }
      if (!any) return toast('Впишите остаток хотя бы в одной валюте');
      closeSheet(); commit();
    });
    orig && $('#a-del', s).addEventListener('click', () => {
      const list = bankAccs(orig);
      const used = list.some(x => S.ops.some(o => o.accountId === x.id || o.toId === x.id) || S.recurring.some(r => r.accountId === x.id));
      if (used) {
        if (!confirm(`По «${orig}» есть операции. Скрыть банк? Его остаток не будет учитываться. Вернуть можно в настройках.`)) return;
        list.forEach(x => { x.archived = true; });
      } else {
        if (!confirm(`Удалить «${orig}»?`)) return;
        S.accounts = S.accounts.filter(x => !list.includes(x));
      }
      closeSheet(); commit();
    });
  });
}

function bankSheet(name) {
  const b = balances(), P = bankMain(name), Q = bankSub(name);
  const after = { ...b };
  for (const u of upcoming()) after[u.r.accountId] += u.r.type === 'income' ? u.r.amount : -u.r.amount;
  const list = bankAccs(name).sort((x, y) => convert(b[y.id], y.currency, 'EUR') - convert(b[x.id], x.currency, 'EUR'));
  const sum = list.reduce((x, a) => x + convert(b[a.id], a.currency, 'EUR'), 0);
  const html = sheetHead(esc(name)) + `
    <div class="hero" style="padding-top:0"><div class="label">Всего</div><div class="big">${bigMoney(convert(sum, 'EUR', P), P)}</div>
      <button class="sub swap" id="b-swap">${fmt(convert(sum, 'EUR', Q), Q)} <span>⇅</span></button></div>
    <div class="list">${list.map(a => `<div class="row">
      <div class="ico">${SYM[a.currency]}</div><div class="main"><div class="title">${a.currency}</div>
      ${a.currency !== P ? `<div class="meta">≈ ${fmt(convert(b[a.id], a.currency, P), P)}</div>` : ''}
      ${Math.abs(after[a.id] - b[a.id]) > 0.004 ? `<div class="meta">после платежей ${fmt(after[a.id], a.currency)}</div>` : ''}</div>
      <div class="amt">${fmt(b[a.id], a.currency)}</div></div>`).join('')}</div>
    <button class="primary" id="b-edit">Изменить остатки</button>
    <button class="secondary" id="b-hist">Операции банка</button>`;
  openSheet(html, s => {
    $('#b-swap', s).addEventListener('click', () => { (S.bankMain ||= {})[name] = Q; save(); render(); bankSheet(name); });
    $('#b-edit', s).addEventListener('click', () => { closeSheet(); setTimeout(() => accountSheet(null, name), 320); });
    $('#b-hist', s).addEventListener('click', () => {
      closeSheet(); tab = 'history'; histMonth = todayStr().slice(0, 7); histQ = histCat = ''; histAcc = name; render(); window.scrollTo(0, 0);
    });
  });
}

// Траты за день: один счёт, суммы сразу по нескольким категориям (калькулятор в каждом поле)
function daySheet() {
  if (!activeAccounts().length) return toast('Сначала добавьте счёт');
  const cats = S.categories.expense;
  const html = sheetHead('Траты за день') + `
    <div class="plabel">Счёт</div><div id="y-acc"></div>
    <div class="form"><label class="field"><span>Дата</span><input type="date" id="y-date" value="${todayStr()}"></label></div>
    <div class="plabel">Суммы по категориям</div>
    <div class="form" id="y-list">${cats.map(c => `
      <label class="field"><span>${catIcon(c)} ${esc(c)}<em class="y-eq"></em></span><input data-cat="${esc(c)}" inputmode="decimal" placeholder="0" autocomplete="off"></label>`).join('')}</div>
    <div class="calc sticky" id="y-calc">${['+', '−', '×', '÷'].map(c => `<button type="button" data-op="${c}">${c}</button>`).join('')}</div>
    <div class="card forecast"><div class="label">Итого за день</div><div class="val" id="y-total"></div></div>
    <button class="primary" id="y-save">Сохранить</button>`;
  openSheet(html, s => {
    let cur = 'EUR', lastInput = null;
    const inputs = $$('[data-cat]', s);
    const update = () => {
      cur = accById(accEl.value).currency;
      let total = 0;
      inputs.forEach(el => {
        const v = el.value.trim(), r = calc(v), eq = el.parentElement.querySelector('em');
        eq.textContent = v && /[-+×÷*/−]/.test(v.replace(/^-/, '')) && isFinite(r) ? '= ' + String(r).replace('.', ',') : '';
        if (v && r > 0) total += r;
      });
      $('#y-total', s).textContent = fmt(total, cur);
    };
    const accEl = accPicker($('#y-acc', s), S.last && S.last.accountId, update);
    inputs.forEach(el => { el.addEventListener('input', update); el.addEventListener('focus', () => { lastInput = el; }); });
    $('#y-calc', s).addEventListener('pointerdown', e => {
      const b2 = e.target.closest('[data-op]'); if (!b2 || !lastInput) return;
      e.preventDefault();
      lastInput.value = lastInput.value.replace(/[+−×÷]$/, '') + b2.dataset.op; update();
    });
    update();
    $('#y-save', s).addEventListener('click', () => {
      const date = $('#y-date', s).value || todayStr(), added = [];
      for (const el of inputs) {
        const v = el.value.trim(); if (!v) continue;
        const r = calc(v);
        if (!(r > 0)) return toast(`Проверьте: ${el.dataset.cat}`);
        added.push({ id: uid(), ts: Date.now() + added.length, type: 'expense', amount: r, accountId: accEl.value, category: el.dataset.cat, date, note: '' });
      }
      if (!added.length) return toast('Введите хотя бы одну сумму');
      S.ops.push(...added); S.last = { accountId: accEl.value };
      closeSheet(); commit();
      const total = added.reduce((x, o) => x + o.amount, 0);
      toast(`Записано ${added.length}: ${fmt(-total, cur, true)}`, () => { if (S) { S.ops = S.ops.filter(o => !added.includes(o)); commit(); } });
    });
  });
}

// Сверка: вписываешь реальные остатки, разница записывается как «Неучтённое»
function reconcileSheet() {
  const b = balances();
  const banks = bankNames().filter(n => !bankAccs(n).some(isGoal));
  const ph = v => (S.hide ? '' : nf2.format(Math.round(v * 100) / 100).replace(/,00$/, ''));
  const html = sheetHead('Сверка') + `
    <p class="note">Откройте приложения банков и впишите, сколько реально лежит сейчас. Пустое поле — без изменений. Разница запишется как «Неучтённое» — так капитал всегда точный, даже если что-то не записали.</p>
    ${banks.map(n => `<div class="plabel">${esc(n)}</div><div class="form">${bankAccs(n).sort((x, y) => CUR_ORDER[x.currency] - CUR_ORDER[y.currency]).map(a => `
      <label class="field"><span>${SYM[a.currency]} ${a.currency}<em class="r-diff"></em></span><input data-acc="${a.id}" inputmode="decimal" placeholder="${ph(b[a.id])}" autocomplete="off"></label>`).join('')}</div>`).join('')}
    <div class="card forecast"><div class="label">Разница</div><div class="val" id="r-total">—</div></div>
    <button class="primary" id="r-save">Сохранить сверку</button>`;
  openSheet(html, s => {
    const inputs = $$('[data-acc]', s);
    const diffs = () => inputs.map(el => {
      const v = el.value.trim(), a = accById(el.dataset.acc);
      if (!v) return null;
      const r = calc(v);
      return isFinite(r) ? { a, el, diff: Math.round((r - b[a.id]) * 100) / 100 } : { a, el, bad: true };
    }).filter(Boolean);
    const update = () => {
      const emOf = el => el.parentElement.querySelector('em');
      inputs.forEach(el => { emOf(el).textContent = ''; emOf(el).className = 'r-diff'; });
      let total = 0;
      for (const d of diffs()) {
        const em = emOf(d.el);
        if (d.bad) { em.textContent = '?'; continue; }
        if (!d.diff) { em.textContent = '✓'; continue; }
        em.textContent = fmt(d.diff, d.a.currency, true);
        em.classList.add(d.diff > 0 ? 'pos' : 'late');
        total += convert(d.diff, d.a.currency, 'EUR');
      }
      $('#r-total', s).textContent = diffs().length ? dm(total, true) : '—';
    };
    inputs.forEach(el => el.addEventListener('input', update));
    $('#r-save', s).addEventListener('click', () => {
      const list = diffs();
      if (list.some(d => d.bad)) return toast('Проверьте суммы');
      const today = todayStr();
      list.filter(d => d.diff).forEach((d, i) => S.ops.push({
        id: uid(), ts: Date.now() + i, type: d.diff < 0 ? 'expense' : 'income', amount: Math.abs(d.diff),
        accountId: d.a.id, category: 'Неучтённое', date: today, note: 'Сверка',
      }));
      S.lastRecon = today;
      closeSheet(); commit(); toast('Сверка сохранена');
    });
  });
}

// Копилка = отдельный счёт с целью. Входит в капитал, но не в «Доступно».
function goalSheet(a = null) {
  const b = balances();
  let cur = a ? a.currency : MAIN();
  const html = sheetHead(a ? esc(a.name) : 'Новая копилка') + `
    <div class="form">
      <label class="field"><span>Название</span><input id="g-name" value="${esc(a ? a.name : '')}" placeholder="Отпуск, подушка…"></label>
      <label class="field"><span>Цель</span><input id="g-target" inputmode="decimal" value="${a && a.goal ? a.goal : ''}" placeholder="0"></label>
      <label class="field"><span>Сейчас в копилке</span><input id="g-bal" inputmode="decimal" value="${a ? Math.round(b[a.id] * 100) / 100 : ''}" placeholder="0"></label>
    </div>
    ${a ? '' : `<div class="plabel">Валюта</div><div class="seg" id="g-cur">${CURS.map(c => `<button data-c="${c}">${SYM[c]} ${c}</button>`).join('')}</div>`}
    <p class="note">Деньги в копилке входят в капитал, но не в «Доступно». Пополняйте переводом со счёта.</p>
    ${a ? '<button class="secondary" id="g-add">Пополнить переводом</button>' : ''}
    <button class="primary" id="g-save">Сохранить</button>
    ${a ? '<button class="danger" id="g-del">Удалить копилку</button>' : ''}`;
  openSheet(html, s => {
    const upd = () => $$('#g-cur button', s).forEach(x => x.classList.toggle('on', x.dataset.c === cur));
    !a && $('#g-cur', s).addEventListener('click', e => { const t = e.target.closest('[data-c]'); if (t) { cur = t.dataset.c; upd(); } });
    upd();
    $('#g-save', s).addEventListener('click', () => {
      const name = $('#g-name', s).value.trim();
      if (!name) return toast('Введите название');
      if ((!a || name !== a.name) && bankNames().includes(name)) return toast('Такое название уже есть');
      const tv = $('#g-target', s).value.trim(), bv = $('#g-bal', s).value.trim();
      const target = tv ? calc(tv) : 0, bal = bv ? calc(bv) : 0;
      if (!isFinite(target) || !isFinite(bal)) return toast('Проверьте суммы');
      if (a) { a.name = name; a.goal = target; a.initial = Math.round((a.initial + bal - b[a.id]) * 100) / 100; }
      else S.accounts.push({ id: uid(), name, currency: cur, initial: bal, goal: target });
      closeSheet(); commit();
    });
    a && $('#g-add', s).addEventListener('click', () => { closeSheet(); setTimeout(() => opSheet({ preset: { type: 'transfer', toId: a.id } }), 320); });
    a && $('#g-del', s).addEventListener('click', () => {
      const used = S.ops.some(o => o.accountId === a.id || o.toId === a.id);
      if (used) {
        if (!confirm('По копилке есть операции. Скрыть её? Вернуть можно в настройках.')) return;
        a.archived = true;
      } else {
        if (!confirm(`Удалить «${a.name}»?`)) return;
        S.accounts = S.accounts.filter(x => x.id !== a.id);
      }
      closeSheet(); commit();
    });
  });
}

// Долг. «Через счёт» — деньги реально уходят/приходят, но не считаются расходом/доходом.
function debtSheet(d = null) {
  let dir = d ? d.dir : 'lent', via = true, cur = d ? d.currency : MAIN();
  const html = sheetHead(d ? 'Долг' : 'Новый долг') + `
    <div class="seg" id="d-dir"><button data-t="lent">Я дал в долг</button><button data-t="borrowed">Я взял в долг</button></div>
    <div class="amount-wrap"><input id="d-amount" inputmode="decimal" placeholder="0" value="${d ? d.amount : ''}"><span id="d-cur"></span></div>
    <div class="form">
      <label class="field"><span>Кто</span><input id="d-person" value="${esc(d ? d.person : '')}" placeholder="Имя"></label>
      <label class="field"><span>Комментарий</span><input id="d-note" value="${esc(d ? d.note : '')}" placeholder="необязательно"></label>
    </div>
    ${d ? (d.accountId ? `<p class="note">Проведён через ${accLabel(accById(d.accountId))}.</p>` : '<p class="note">Без счёта — баланс не меняется.</p>') : `
    <div class="seg" id="d-via"><button data-t="1">Через счёт</button><button data-t="0">Без счёта</button></div>
    <div id="d-acc-wrap"><div class="plabel" id="d-acc-l"></div><div id="d-acc"></div></div>
    <div class="seg" id="d-curseg">${CURS.map(c => `<button data-c="${c}">${SYM[c]} ${c}</button>`).join('')}</div>
    <p class="note" id="d-hint"></p>`}
    <button class="primary" id="d-save">Сохранить</button>
    ${d && !d.closed ? `<button class="secondary" id="d-close">${d.dir === 'lent' ? 'Мне вернули' : 'Я вернул'} — закрыть</button>` : ''}
    ${d ? '<button class="danger" id="d-del">Удалить долг</button>' : ''}`;
  openSheet(html, s => {
    let accEl = null;
    const update = () => {
      $$('#d-dir button', s).forEach(x => x.classList.toggle('on', x.dataset.t === dir));
      if (!d) {
        $$('#d-via button', s).forEach(x => x.classList.toggle('on', x.dataset.t === (via ? '1' : '0')));
        $('#d-acc-wrap', s).hidden = !via;
        $('#d-curseg', s).hidden = via;
        $('#d-acc-l', s).textContent = dir === 'lent' ? 'Со счёта' : 'На счёт';
        if (via) cur = accById(accEl.value).currency;
        $$('#d-curseg button', s).forEach(x => x.classList.toggle('on', x.dataset.c === cur));
        $('#d-hint', s).textContent = via
          ? (dir === 'lent' ? 'Спишется со счёта, но не попадёт в расходы.' : 'Зачислится на счёт, но не попадёт в доходы.')
          : 'Просто запись — баланс не меняется.';
      }
      $('#d-cur', s).textContent = SYM[cur];
    };
    if (!d) {
      accEl = accPicker($('#d-acc', s), S.last && S.last.accountId, update);
      $('#d-via', s).addEventListener('click', e => { const t = e.target.closest('[data-t]'); if (t) { via = t.dataset.t === '1'; update(); } });
      $('#d-curseg', s).addEventListener('click', e => { const t = e.target.closest('[data-c]'); if (t) { cur = t.dataset.c; update(); } });
    }
    $('#d-dir', s).addEventListener('click', e => { const t = e.target.closest('[data-t]'); if (t) { dir = t.dataset.t; update(); } });
    update();
    $('#d-save', s).addEventListener('click', () => {
      const amount = calc($('#d-amount', s).value), person = $('#d-person', s).value.trim();
      if (!(amount > 0)) return toast('Введите сумму');
      if (!person) return toast('Кто?');
      const x = d || { id: uid(), date: todayStr(), closed: false };
      Object.assign(x, { dir, amount, person, note: $('#d-note', s).value.trim() });
      if (!d) {
        x.currency = cur;
        if (via) {
          x.accountId = accEl.value;
          S.ops.push({ id: uid(), ts: Date.now(), type: 'debt', dir: dir === 'lent' ? 'out' : 'in', amount, accountId: x.accountId, date: x.date, note: person, debtId: x.id });
        }
        (S.debts ||= []).push(x);
      } else {
        const o = S.ops.find(y => y.debtId === x.id && !y.repay);
        if (o) { o.amount = amount; o.dir = dir === 'lent' ? 'out' : 'in'; o.note = person; }
      }
      closeSheet(); commit();
    });
    d && !d.closed && $('#d-close', s).addEventListener('click', () => {
      const a = d.accountId && accById(d.accountId);
      if (a) {
        if (!confirm(`${d.dir === 'lent' ? 'Зачислить на' : 'Списать с'} «${a.name}» ${fmt(d.amount, d.currency)}?`)) return;
        S.ops.push({ id: uid(), ts: Date.now(), type: 'debt', dir: d.dir === 'lent' ? 'in' : 'out', amount: d.amount, accountId: a.id, date: todayStr(), note: d.person, debtId: d.id, repay: true });
      }
      d.closed = true; closeSheet(); commit(); toast('Долг закрыт');
    });
    d && $('#d-del', s).addEventListener('click', () => {
      if (!confirm('Удалить долг? Его операции тоже удалятся.')) return;
      S.debts = S.debts.filter(y => y.id !== d.id);
      S.ops = S.ops.filter(o => o.debtId !== d.id);
      closeSheet(); commit();
    });
  });
}

function recSheet(r = null) {
  const b = balances(), accs = activeAccounts();
  if (!accs.length) return toast('Сначала добавьте счёт');
  let type = r ? r.type : 'expense', cat = r ? r.category : null;
  const html = sheetHead(r ? 'Регулярный' : 'Новый регулярный') + `
    <div class="seg" id="r-type"><button data-t="expense">Платёж</button><button data-t="income">Доход</button></div>
    <div class="amount-wrap"><input id="r-amount" inputmode="decimal" placeholder="0" value="${r ? r.amount : ''}"><span id="r-cur"></span></div>
    <div class="form">
      <label class="field"><span>Название</span><input id="r-name" value="${esc(r ? r.name : '')}" placeholder="Аренда, Spotify…"></label>
      <label class="field"><span>Число месяца</span><input id="r-day" type="number" inputmode="numeric" min="1" max="31" value="${r ? r.day : 1}"></label>
    </div>
    <div class="plabel">Счёт</div><div id="r-acc"></div>
    <div class="chips" id="r-cats"></div>
    <button class="primary" id="r-save">Сохранить</button>
    ${r ? '<button class="danger" id="r-del">Удалить</button>' : ''}`;
  openSheet(html, s => {
    let accEl;
    const update = () => {
      $$('#r-type button', s).forEach(x => x.classList.toggle('on', x.dataset.t === type));
      $('#r-cur', s).textContent = SYM[accById(accEl.value).currency];
      const list = S.categories[type];
      if (!list.includes(cat)) cat = list[0];
      $('#r-cats', s).innerHTML = list.map(c => `<button class="chip ${c === cat ? 'on' : ''}" data-c="${esc(c)}">${esc(c)}</button>`).join('');
    };
    $('#r-type', s).addEventListener('click', e => { const t = e.target.closest('[data-t]'); if (t) { type = t.dataset.t; update(); } });
    $('#r-cats', s).addEventListener('click', e => { const c = e.target.closest('[data-c]'); if (c) { cat = c.dataset.c; update(); } });
    accEl = accPicker($('#r-acc', s), r ? r.accountId : accs[0].id, update);
    update();
    $('#r-save', s).addEventListener('click', () => {
      const amount = num($('#r-amount', s).value), name = $('#r-name', s).value.trim(), day = parseInt($('#r-day', s).value, 10);
      if (!(amount > 0)) return toast('Введите сумму');
      if (!name) return toast('Введите название');
      if (!(day >= 1 && day <= 31)) return toast('Число от 1 до 31');
      const x = r || { id: uid(), start: todayStr(), done: {} };
      Object.assign(x, { type, amount, name, day, accountId: accEl.value, category: cat });
      if (!r) S.recurring.push(x);
      closeSheet(); commit();
    });
    r && $('#r-del', s).addEventListener('click', () => {
      if (!confirm(`Удалить «${r.name}»? Уже подтверждённые операции останутся.`)) return;
      S.recurring = S.recurring.filter(x => x.id !== r.id);
      closeSheet(); commit();
    });
  });
}

/* ---------- backup ---------- */
function b64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
function unb64(s) { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }

async function exportBackup() {
  await saving;
  const v = await kvGet('vault');
  const data = JSON.stringify({ app: 'money', v: 1, iter: v.iter, salt: b64(v.salt), iv: b64(v.iv), ct: b64(v.ct) });
  const name = `money-backup-${todayStr()}.json`;
  const file = new File([data], name, { type: 'application/json' });
  if (await shareFile(file)) { S.lastBackup = todayStr(); commit(); toast('Копия сохранена'); }
}
async function shareFile(file) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return true; } catch { return false; }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a'); a.href = url; a.download = file.name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
// Читаемая таблица для Excel/Numbers. НЕ зашифрована — только по явному действию.
async function exportCSV() {
  if (!confirm('Файл для Excel НЕ зашифрован: любой, у кого он окажется, увидит суммы. Продолжить?')) return;
  const q = v => { const t = String(v ?? ''); return /[";\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const n = v => String(Math.round(v * 100) / 100).replace('.', ',');
  const name = id => (accById(id) || {}).name || '';
  const cur = id => (accById(id) || {}).currency || '';
  const T = { expense: 'Расход', income: 'Доход', transfer: 'Перевод', debt: 'Долг' };
  const rows = [['Дата', 'Тип', 'Сумма', 'Валюта', 'Счёт', 'Категория', 'На счёт', 'Зачислено', 'Валюта зачисления', 'Комментарий']];
  [...S.ops].sort((a, b) => a.date.localeCompare(b.date)).forEach(o => rows.push([
    o.date, T[o.type], n(o.type === 'expense' || (o.type === 'debt' && o.dir === 'out') ? -o.amount : o.amount), cur(o.accountId), name(o.accountId), o.category || '',
    o.toId ? name(o.toId) : '', o.toId ? n(o.toAmount ?? o.amount) : '', o.toId ? cur(o.toId) : '', o.note || '']));
  const b = balances();
  rows.push([], ['Счёт', 'Валюта', 'Остаток']);
  S.accounts.forEach(a => rows.push([a.name + (a.archived ? ' (скрыт)' : ''), a.currency, n(b[a.id])]));
  const csv = '\ufeff' + rows.map(r => r.map(q).join(';')).join('\r\n');
  await shareFile(new File([csv], `money-${todayStr()}.csv`, { type: 'text/csv' }));
}
async function importBackup(file) {
  try {
    const d = JSON.parse(await file.text());
    if (d.app !== 'money' || !d.salt || !d.iv || !d.ct) throw 0;
    if (!confirm('Заменить все текущие данные данными из копии? Понадобится пароль той копии.')) return;
    await saving;
    await kvSet('vault', { v: 1, iter: d.iter || ITER, salt: unb64(d.salt), iv: unb64(d.iv), ct: unb64(d.ct) });
    await kvDel('bio');
    lock();
    toast('Копия восстановлена — введите её пароль');
  } catch { toast('Не удалось прочитать файл'); }
}

async function changePassword() {
  const pw = prompt('Новый пароль (минимум 6 символов)');
  if (pw == null) return;
  if (pw.length < 6) return toast('Слишком короткий пароль');
  if (prompt('Повторите новый пароль') !== pw) return toast('Пароли не совпадают');
  await saving;
  SALT = crypto.getRandomValues(new Uint8Array(16)); ITERS = ITER;
  KEY = await deriveKey(pw, SALT, ITERS);
  await save();
  await kvDel('bio');
  toast('Пароль изменён. Face ID включите заново');
}

async function loadNBU() {
  try {
    const r = await fetch('https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json', { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
    const list = await r.json();
    const get = cc => list.find(x => x.cc === cc);
    const e = get('EUR'), u = get('USD');
    if (!e || !u) throw 0;
    S.rates = { EUR: e.rate, USD: u.rate, updated: e.exchangedate };
    commit(); toast('Курс обновлён');
  } catch { toast('Нет связи с НБУ'); }
}

/* ---------- events ---------- */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || !S) return;
  const d = el.dataset;
  switch (d.action) {
    case 'tab': tab = d.tab; if (tab === 'history') { histMonth = todayStr().slice(0, 7); histQ = histAcc = histCat = ''; } render(); window.scrollTo(0, 0); break;
    case 'new-op': opSheet(); break;
    case 'edit-op': {
      const o = S.ops.find(x => x.id === d.id);
      if (o.type !== 'debt') { opSheet({ op: o }); break; }
      const dd = (S.debts || []).find(x => x.id === o.debtId);
      if (dd) debtSheet(dd);
      else if (confirm('Долг уже удалён. Удалить и эту операцию?')) { S.ops = S.ops.filter(x => x !== o); commit(); }
      break;
    }
    case 'toggle-hide': S.hide = !S.hide; commit(); break;
    case 'swap-main': S.main = SUBC(); commit(); break;
    case 'set-main': S.main = d.c; commit(); break;
    case 'use-tpl': {
      const t = S.templates.find(x => x.id === d.id), a = accById(t.accountId);
      if (!a || a.archived) return toast('Счёт шаблона удалён');
      const o = { id: uid(), ts: Date.now(), type: t.type, amount: t.amount, accountId: a.id, category: t.category, date: todayStr(), note: t.name };
      S.ops.push(o); commit();
      toast(`${t.name}: ${fmt(t.type === 'expense' ? -t.amount : t.amount, a.currency, true)}`, () => { if (S) { S.ops = S.ops.filter(x => x !== o); commit(); } });
      break;
    }
    case 'del-tpl': e.stopPropagation(); if (confirm(`Удалить шаблон «${S.templates[d.i].name}»?`)) { S.templates.splice(+d.i, 1); commit(); } break;
    case 'rename-tpl': { const v = (prompt('Название шаблона', S.templates[d.i].name) || '').trim(); if (v) { S.templates[d.i].name = v; commit(); } break; }
    case 'new-goal': goalSheet(); break;
    case 'edit-goal': goalSheet(accById(d.id)); break;
    case 'new-debt': debtSheet(); break;
    case 'edit-debt': debtSheet(S.debts.find(x => x.id === d.id)); break;
    case 'day-sheet': daySheet(); break;
    case 'reconcile': reconcileSheet(); break;
    case 'hist-cat': histCat = d.c; render(); break;
    case 'set-month': histMonth = d.k; render(); break;
    case 'clear-filters': histQ = histAcc = histCat = ''; render(); break;
    case 'confirm-rec': opSheet({ rec: S.recurring.find(r => r.id === d.id), k: d.k, due: d.due }); break;
    case 'new-account': accountSheet(); break;
    case 'open-bank': bankSheet(d.name); break;
    case 'edit-account': accountSheet(accById(d.id)); break;
    case 'unhide-account': {
      const x = accById(d.id);
      if (bankAccs(x.name).some(y => y.currency === x.currency)) return toast(`В «${x.name}» уже есть ${x.currency}`);
      x.archived = false; commit(); break;
    }
    case 'new-rec': recSheet(); break;
    case 'edit-rec': recSheet(S.recurring.find(r => r.id === d.id)); break;
    case 'month': histMonth = shiftMonth(histMonth, +d.d); render(); break;
    case 'nbu': loadNBU(); break;
    case 'add-cat': {
      const inp = $('#new-cat-' + d.type), v = inp.value.trim();
      if (!v) return;
      if (S.categories[d.type].includes(v)) return toast('Уже есть');
      S.categories[d.type].push(v); commit(); break;
    }
    case 'del-cat': {
      e.stopPropagation();
      const list = S.categories[d.type];
      if (list.length <= 1) return toast('Нужна хотя бы одна категория');
      if (!confirm(`Удалить категорию «${list[d.i]}»? Старые операции сохранят название.`)) return;
      list.splice(+d.i, 1); commit(); break;
    }
    case 'rename-cat': {
      const list = S.categories[d.type], old = list[d.i];
      const v = (prompt('Название категории', old) || '').trim();
      if (!v || v === old) return;
      if (list.includes(v)) return toast('Уже есть');
      list[d.i] = v;
      const kind = d.type;
      S.ops.forEach(o => { if (o.type === kind && o.category === old) o.category = v; });
      S.recurring.forEach(r => { if (r.type === kind && r.category === old) r.category = v; });
      commit(); break;
    }
    case 'export': exportBackup(); break;
    case 'csv': exportCSV(); break;
    case 'backup-now': exportBackup(); break;
    case 'import': $('#import-file').click(); break;
    case 'change-pw': changePassword(); break;
    case 'bio': bioOn ? disableBio() : enableBio(); break;
    case 'lock': lock(); break;
    case 'wipe':
      if (!confirm('Удалить ВСЕ данные на этом устройстве? Это нельзя отменить.')) return;
      if (prompt('Для подтверждения напишите: удалить') !== 'удалить') return toast('Отменено');
      saving.then(() => Promise.all([kvDel('vault'), kvDel('bio')])).then(() => { lock(); toast('Данные удалены'); });
      break;
  }
});
document.addEventListener('change', e => {
  if (e.target.dataset && e.target.dataset.rate && S) {
    const v = num(e.target.value);
    if (!(v > 0)) { toast('Неверный курс'); render(); return; }
    S.rates[e.target.dataset.rate] = v; S.rates.updated = null; commit();
  }
  if (e.target.id === 'import-file' && e.target.files[0]) importBackup(e.target.files[0]);
  if (e.target.id === 'h-acc') { histAcc = e.target.value; $('#h-body').innerHTML = historyBody(); }
  if (e.target.id === 'h-cat') { histCat = e.target.value; $('#h-body').innerHTML = historyBody(); }
});
document.addEventListener('input', e => {
  if (e.target.id === 'h-q' && S) { histQ = e.target.value; $('#h-body').innerHTML = historyBody(); }
});

/* ---------- Face ID (passkey + WebAuthn PRF) ----------
   Пароль шифруется ключом, который выдаёт passkey только после Face ID.
   Ни пароль, ни ключ в открытом виде не хранятся. Нужна iOS 18+. */
const rand = n => crypto.getRandomValues(new Uint8Array(n));
async function bioAvailable() {
  try { return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch { return false; }
}
// ВАЖНО: iOS разрешает Face ID только сразу после нажатия — никаких await до вызова credentials.*
const bioGetOpts = (credId, prfSalt) => ({ publicKey: {
  challenge: rand(32), rpId: location.hostname, userVerification: 'required', timeout: 60000,
  allowCredentials: [{ type: 'public-key', id: credId }],
  extensions: { prf: { eval: { first: prfSalt } } },
} });
const prfOut = cred => { const r = cred.getClientExtensionResults().prf; return r && r.results && r.results.first; };
const bioErr = e => ({
  NotAllowedError: 'Отменено или истекло время. Попробуйте ещё раз',
  InvalidStateError: 'Ключ уже есть — удалите «Деньги» в Настройки iPhone → Пароли и повторите',
  SecurityError: 'Face ID работает только на https-адресе приложения',
  NotSupportedError: 'Этот iPhone не поддерживает нужный режим (нужна iOS 18+)',
}[e && e.name] || `Ошибка: ${(e && (e.name || e.message)) || 'неизвестно'}`);
async function saveBio(credId, prfSalt, out, pw) {
  const key = await crypto.subtle.importKey('raw', out, 'AES-GCM', false, ['encrypt', 'decrypt']);
  const iv = rand(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(pw)));
  await kvSet('bio', { credId, prfSalt, iv, ct });
  BIO = await kvGet('bio');
}
// Включение по шагам: каждый запрос Face ID — от отдельного нажатия
function enableBio() {
  let pw = null, credId = null;
  const prfSalt = rand(32);
  const html = sheetHead('Вход по Face ID') + `
    <div class="form"><label class="field"><span>Пароль</span><input id="b-pw" type="password" autocomplete="current-password"></label></div>
    <p class="note" id="b-note">Шаг 1 из 2: введите пароль приложения.</p>
    <button class="primary" id="b-go">Проверить пароль</button>`;
  openSheet(html, s => {
    const go = $('#b-go', s), note = $('#b-note', s);
    const done = () => { closeSheet(); toast('Face ID включён'); render(); };
    go.addEventListener('click', async () => {
      if (!pw) {
        const v = await kvGet('vault'), val = $('#b-pw', s).value;
        go.disabled = true;
        try { await decryptVault(await deriveKey(val, v.salt, v.iter), v); pw = val; }
        catch { go.disabled = false; return toast('Неверный пароль'); }
        go.disabled = false;
        if (!(await bioAvailable())) { closeSheet(); return toast('Face ID недоступен на этом устройстве'); }
        $('#b-pw', s).closest('.form').hidden = true;
        note.textContent = 'Шаг 2 из 2: подтвердите Face ID. iPhone предложит сохранить ключ доступа — соглашайтесь.';
        go.textContent = 'Включить Face ID';
        return;
      }
      if (!credId) {
        try {
          const cred = await navigator.credentials.create({ publicKey: {
            challenge: rand(32), rp: { name: 'Деньги', id: location.hostname },
            user: { id: rand(16), name: 'Деньги', displayName: 'Деньги' },
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
            authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'required' },
            extensions: { prf: { eval: { first: prfSalt } } }, timeout: 60000,
          } });
          credId = new Uint8Array(cred.rawId);
          const ext = cred.getClientExtensionResults().prf;
          if (ext && ext.enabled === false) { closeSheet(); return toast('Нужна iOS 18 или новее'); }
          const out = prfOut(cred);
          if (out) { await saveBio(credId, prfSalt, out, pw); return done(); }
          note.textContent = 'Почти готово: подтвердите Face ID ещё раз.';
          go.textContent = 'Подтвердить Face ID';
        } catch (e) { toast(bioErr(e)); }
        return;
      }
      try {
        const a = await navigator.credentials.get(bioGetOpts(credId, prfSalt));
        const out = prfOut(a);
        if (!out) { closeSheet(); return toast('Нужна iOS 18 или новее'); }
        await saveBio(credId, prfSalt, out, pw); done();
      } catch (e) { toast(bioErr(e)); }
    });
  });
}
async function disableBio() { await kvDel('bio'); BIO = null; toast('Face ID выключен'); render(); }
let BIO = null; // загружается заранее, чтобы Face ID вызывался сразу по нажатию
async function unlockBio() {
  if (!BIO) return;
  const bio = BIO;
  try {
    const a = await navigator.credentials.get(bioGetOpts(bio.credId, bio.prfSalt));
    const out = prfOut(a);
    if (!out) throw new Error('Face ID не вернул ключ');
    const key = await crypto.subtle.importKey('raw', out, 'AES-GCM', false, ['decrypt']);
    const pw = dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bio.iv }, key, bio.ct));
    await unlock(pw);
  } catch (e) { $('#lock-err').textContent = e && e.name === 'NotAllowedError' ? '' : bioErr(e); }
}

/* ---------- lock / unlock ---------- */
let hasVault = false;
async function showLock() {
  $('#main').hidden = true; $('#tabbar').hidden = true; $('#lock').hidden = false;
  const v = await kvGet('vault');
  hasVault = !!v;
  $('#lock-title').textContent = hasVault ? 'Деньги' : 'Создайте пароль';
  $('#lock-hint').textContent = hasVault ? '' : 'Им шифруются все данные на устройстве. Восстановить забытый пароль невозможно.';
  $('#lock-pw2').hidden = hasVault;
  $('#lock-pw').autocomplete = hasVault ? 'current-password' : 'new-password';
  $('#lock-btn').textContent = hasVault ? 'Открыть' : 'Создать';
  $('#lock-pw').value = ''; $('#lock-pw2').value = ''; $('#lock-err').textContent = '';
  BIO = hasVault ? (await kvGet('bio')) || null : null;
  $('#lock-bio').hidden = !BIO;
}
function lock() {
  KEY = null; S = null; SALT = null;
  $('#sheet-root').innerHTML = ''; $('#sheet-root').classList.remove('open');
  $('#main').innerHTML = '';
  showLock();
}
$('#lock-form').addEventListener('submit', async e => {
  e.preventDefault();
  const pw = $('#lock-pw').value, err = $('#lock-err'), btn = $('#lock-btn');
  err.textContent = '';
  if (!hasVault) {
    if (pw.length < 6) { err.textContent = 'Минимум 6 символов'; return; }
    if (pw !== $('#lock-pw2').value) { err.textContent = 'Пароли не совпадают'; return; }
  }
  btn.disabled = true;
  try {
    if (hasVault) await unlock(pw);
    else {
      SALT = crypto.getRandomValues(new Uint8Array(16)); ITERS = ITER;
      KEY = await deriveKey(pw, SALT, ITERS);
      S = defaultState();
      await save();
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    }
    if (KEY) openApp();
  } finally { btn.disabled = false; }
});
$('#lock-bio').addEventListener('click', unlockBio);
async function unlock(pw) {
  const v = await kvGet('vault');
  const key = await deriveKey(pw, v.salt, v.iter);
  try { S = await decryptVault(key, v); } catch { $('#lock-err').textContent = 'Неверный пароль'; return; }
  KEY = key; SALT = v.salt; ITERS = v.iter;
  // Разовый переход на новый набор банков — только если ещё нет ни одной операции
  if (!S.created) { S.created = todayStr(); save(); }
  if (!S.banksV2) {
    if (!S.ops.length && !S.recurring.length) { const rates = S.rates; S = defaultState(); S.rates = rates; }
    S.banksV2 = true; save();
  }
  openApp();
}
function openApp() {
  $('#lock-pw').value = ''; $('#lock-pw2').value = '';
  $('#lock').hidden = true; $('#main').hidden = false; $('#tabbar').hidden = false;
  tab = 'home'; render();
}

// Автоблокировка, если приложение было в фоне дольше 5 минут
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (KEY && Date.now() - hiddenAt > 5 * 60 * 1000) lock();
});

/* ---------- start ---------- */
if (!window.isSecureContext || !crypto.subtle) {
  $('#lock-title').textContent = 'Нужен HTTPS';
  $('#lock-hint').textContent = 'Шифрование работает только через https:// или localhost.';
  $('#lock-pw').hidden = true; $('#lock-btn').hidden = true;
} else {
  showLock();
  if ('serviceWorker' in navigator) {
    // Новая версия пришла: на экране пароля перезагружаемся сразу, иначе — при следующей блокировке
    const hadController = !!navigator.serviceWorker.controller;
    let updateReady = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) return;
      if (!KEY) location.reload(); else updateReady = true;
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && updateReady && !KEY) location.reload(); });
    navigator.serviceWorker.register('sw.js').then(r => r.update()).catch(() => {});
  }
}
