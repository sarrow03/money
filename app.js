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

const CURS = ['EUR', 'UAH', 'USD'];
const SYM = { EUR: '€', UAH: '₴', USD: '$' };
const nf2 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
function fmt(v, cur, sign = false) {
  const n = Math.round(v * 100) / 100;
  const s = (Number.isInteger(n) ? nf0 : nf2).format(Math.abs(n));
  const pre = n < 0 ? '−' : (sign && n > 0 ? '+' : '');
  return cur === 'UAH' ? `${pre}${s} ₴` : `${pre}${SYM[cur]}${s}`;
}
function bigMoney(v, cur) {
  const n = Math.round(v * 100) / 100;
  const [i, d] = nf2.format(Math.abs(n)).split(',');
  const pre = n < 0 ? '−' : '';
  return cur === 'UAH' ? `${pre}${i}<span class="dec">,${d} ₴</span>` : `${pre}${SYM[cur]}${i}<span class="dec">,${d}</span>`;
}

const CAT_ICONS = {
  'Продукты': '🛒', 'Кафе и рестораны': '🍽️', 'Транспорт': '🚇', 'Машина': '🚗', 'Жильё': '🏠',
  'Покупки': '🛍️', 'Развлечения': '🎬', 'Путешествия': '✈️', 'Подписки': '🔁', 'Здоровье': '💊',
  'Другое': '•', 'Зарплата': '💼', 'Подработка': '🧾', 'Подарки': '🎁', 'Перевод': '⇄',
};
const catIcon = c => CAT_ICONS[c] || esc((c || '•').slice(0, 1).toUpperCase());

function defaultState() {
  const acc = (name, currency) => ({ id: uid(), name, currency, initial: 0 });
  return {
    v: 1,
    accounts: [acc('Revolut', 'EUR'), acc('Австрийский банк', 'EUR'), acc('Укр. банк', 'UAH'), acc('Укр. банк', 'USD'), acc('Наличные', 'EUR')],
    ops: [],
    recurring: [],
    categories: {
      expense: ['Продукты', 'Кафе и рестораны', 'Транспорт', 'Машина', 'Жильё', 'Покупки', 'Развлечения', 'Путешествия', 'Подписки', 'Здоровье', 'Другое'],
      income: ['Зарплата', 'Подработка', 'Подарки', 'Другое'],
    },
    rates: { EUR: 50.72, USD: 44.68, updated: null }, // гривен за 1 единицу
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
const accLabel = a => (a ? esc(a.name) + (bankAccs(a.name).length > 1 ? ' ' + SYM[a.currency] : '') : '?');
const rateOf = c => (c === 'UAH' ? 1 : +S.rates[c] || 1);
const convert = (v, from, to) => (from === to ? v : v * rateOf(from) / rateOf(to));

function balances() {
  const b = {};
  for (const a of S.accounts) b[a.id] = +a.initial || 0;
  const add = (id, v) => { if (id in b) b[id] += v; };
  for (const o of S.ops) {
    if (o.type === 'expense') add(o.accountId, -o.amount);
    else if (o.type === 'income') add(o.accountId, o.amount);
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

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200);
}

function render() {
  if (!S) return;
  $$('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  const m = $('#main');
  m.innerHTML = ({ home: viewHome, history: viewHistory, recurring: viewRecurring, settings: viewSettings })[tab]();
}

function viewHome() {
  const b = balances(), total = capitalEUR(b), up = upcoming();
  const reserved = up.filter(u => u.r.type === 'expense').reduce((s, u) => s + u.eur, 0);
  const incoming = up.filter(u => u.r.type === 'income').reduce((s, u) => s + u.eur, 0);
  const accs = activeAccounts();
  const needBackup = (S.ops.length || S.recurring.length) && (!S.lastBackup || addDays(S.lastBackup, 7) < todayStr());
  return `
  ${needBackup ? `<button class="card forecast" style="width:100%;border:0;text-align:left;margin:4px 0 0" data-action="backup-now">
    <div><div class="title">Сохраните резервную копию</div><div class="meta">${S.lastBackup ? 'Последняя: ' + fmtDay(S.lastBackup) : 'Ещё ни разу'} · в Файлы → iCloud Drive</div></div><div class="link">Сохранить</div></button>` : ''}
  <section class="hero">
    <div class="label">Общий капитал</div>
    <div class="big">${bigMoney(total, 'EUR')}</div>
    <div class="sub">${fmt(convert(total, 'EUR', 'UAH'), 'UAH')}</div>
  </section>
  <div class="stats">
    <div class="stat"><div class="label">Доступно</div><div class="val">${fmt(total - reserved, 'EUR')}</div></div>
    <div class="stat"><div class="label">Зарезервировано</div><div class="val">${fmt(reserved, 'EUR')}</div></div>
  </div>
  <div class="card forecast">
    <div><div class="label">Прогноз после платежей</div>${incoming ? `<div class="meta">с учётом доходов ${fmt(incoming, 'EUR', true)}</div>` : ''}</div>
    <div class="val">${fmt(total - reserved + incoming, 'EUR')}</div>
  </div>
  ${up.length ? `<h2>Ближайшие 30 дней</h2><div class="list">${up.map(u => `
    <div class="row">
      <div class="ico">${catIcon(u.r.category)}</div>
      <div class="main"><div class="title">${esc(u.r.name)}</div>
        <div class="meta ${u.late ? 'late' : ''}">${u.late ? 'просрочено · ' : ''}${fmtDay(u.due)} · ${accLabel(accById(u.r.accountId))}</div></div>
      <div class="amt ${u.r.type === 'income' ? 'pos' : ''}">${fmt(u.r.type === 'income' ? u.r.amount : -u.r.amount, u.cur, true)}</div>
      <button class="btn-ok" data-action="confirm-rec" data-id="${u.r.id}" data-k="${u.k}" data-due="${u.due}">✓</button>
    </div>`).join('')}</div>` : ''}
  <h2>Счета</h2>
  <div class="accounts">
    ${bankNames().map(n => {
      const list = accs.filter(a => a.name === n);
      if (list.length === 1) {
        const a = list[0];
        return `<button class="acc" data-action="edit-account" data-id="${a.id}">
          <div class="acc-name">${esc(a.name)}</div>
          <div><div class="acc-bal">${fmt(b[a.id], a.currency)}</div>
          <div class="acc-eur">${a.currency !== 'EUR' ? '≈ ' + fmt(convert(b[a.id], a.currency, 'EUR'), 'EUR') : ''}</div></div></button>`;
      }
      const sum = list.reduce((x, a) => x + convert(b[a.id], a.currency, 'EUR'), 0);
      return `<button class="acc" data-action="open-bank" data-name="${esc(n)}">
        <div class="acc-name">${esc(n)}</div>
        <div><div class="acc-bal">${fmt(sum, 'EUR')}</div>
        <div class="acc-eur">${list.map(a => fmt(b[a.id], a.currency)).join(' · ')}</div></div></button>`;
    }).join('')}
    <button class="acc acc-add" data-action="new-account">+ Счёт</button>
  </div>`;
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
  } else {
    title = esc(o.category);
    meta = accLabel(a);
    amt = fmt(o.type === 'income' ? o.amount : -o.amount, cur, true);
    if (o.type === 'income') cls = 'pos';
  }
  if (o.note) meta += ' · ' + esc(o.note);
  return `<button class="row" data-action="edit-op" data-id="${o.id}">
    <div class="ico">${catIcon(o.type === 'transfer' ? 'Перевод' : o.category)}</div>
    <div class="main"><div class="title">${title}</div><div class="meta">${meta}</div></div>
    <div class="amt ${cls}">${amt}</div></button>`;
}

function viewHistory() {
  const ops = S.ops.filter(o => o.date.slice(0, 7) === histMonth)
    .sort((x, y) => y.date.localeCompare(x.date) || (y.ts || 0) - (x.ts || 0));
  const eurOf = o => { const a = accById(o.accountId); return a ? convert(o.amount, a.currency, 'EUR') : 0; };
  const spent = ops.filter(o => o.type === 'expense').reduce((s, o) => s + eurOf(o), 0);
  const earned = ops.filter(o => o.type === 'income').reduce((s, o) => s + eurOf(o), 0);
  let html = `<div class="page-title">История</div>
    <div class="month"><button data-action="month" data-d="-1">‹</button><b>${fmtMonth(histMonth)}</b><button data-action="month" data-d="1">›</button></div>
    <div class="stats"><div class="stat"><div class="label">Расходы</div><div class="val">${fmt(spent, 'EUR')}</div></div>
    <div class="stat"><div class="label">Доходы</div><div class="val pos">${fmt(earned, 'EUR')}</div></div></div>`;
  if (!ops.length) return html + `<div class="empty">Операций нет</div>`;
  let day = null;
  for (const o of ops) {
    if (o.date !== day) { if (day) html += '</div>'; day = o.date; html += `<div class="day-head">${fmtDayLong(day)}</div><div class="list">`; }
    html += opRow(o);
  }
  return html + '</div>';
}

function viewRecurring() {
  const list = [...S.recurring].sort((x, y) => x.day - y.day);
  const sum = t => list.filter(r => r.type === t).reduce((s, r) => { const a = accById(r.accountId); return s + (a ? convert(r.amount, a.currency, 'EUR') : 0); }, 0);
  return `<div class="page-title">Регулярные</div>
    <div class="stats"><div class="stat"><div class="label">Платежи в месяц</div><div class="val">${fmt(sum('expense'), 'EUR')}</div></div>
    <div class="stat"><div class="label">Доходы в месяц</div><div class="val pos">${fmt(sum('income'), 'EUR')}</div></div></div>
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

    <h2>Категории расходов</h2>
    <div class="chips">${cats('expense')}</div>
    <div class="inline-add"><input id="new-cat-expense" placeholder="Новая категория"><button data-action="add-cat" data-type="expense">Добавить</button></div>
    <h2>Категории доходов</h2>
    <div class="chips">${cats('income')}</div>
    <div class="inline-add"><input id="new-cat-income" placeholder="Новая категория"><button data-action="add-cat" data-type="income">Добавить</button></div>
    <p class="note">Нажмите на категорию, чтобы переименовать, × — удалить.</p>

    ${hidden.length ? `<h2>Скрытые счета</h2><div class="list">${hidden.map(a => `<button class="row" data-action="unhide-account" data-id="${a.id}"><div class="main"><div class="title">${esc(a.name)}</div><div class="meta">нажмите, чтобы вернуть</div></div></button>`).join('')}</div>` : ''}

    <h2>Данные</h2>
    <p class="note">Данные хранятся только на этом устройстве, зашифрованы паролем. Резервная копия — зашифрованный файл: сохраняйте её в Файлы → iCloud Drive. Восстановить можно на любом устройстве, зная пароль.${S.lastBackup ? ' Последняя копия: ' + fmtDay(S.lastBackup) + '.' : ''}</p>
    <button class="secondary" data-action="export">Сохранить резервную копию</button>
    <button class="secondary" data-action="csv">Выгрузить в Excel (CSV)</button>
    <button class="secondary" data-action="import">Восстановить из копии</button>
    <button class="secondary" data-action="change-pw">Сменить пароль</button>
    <button class="danger" data-action="lock">Заблокировать</button>
    <input type="file" id="import-file" accept=".json,application/json" hidden>`;
}

/* ---------- sheets ---------- */
function openSheet(html, bind) {
  const root = $('#sheet-root');
  root.innerHTML = `<div class="overlay" data-close></div><div class="sheet">${html}</div>`;
  const sheet = $('.sheet', root);
  $$('[data-close]', root).forEach(el => el.addEventListener('click', closeSheet));
  bind && bind(sheet);
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
    const cur = accById(id), subs = bankAccs(cur.name);
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
function opSheet({ op = null, rec = null, k = null, due = null } = {}) {
  const b = balances(), accs = activeAccounts();
  if (!accs.length) return toast('Сначала добавьте счёт');
  let type = op ? op.type : rec ? rec.type : 'expense';
  let cat = op ? op.category : rec ? rec.category : null;
  let toTouched = !!op;
  const first = accs[0].id;
  const html = sheetHead(op ? 'Операция' : rec ? esc(rec.name) : 'Новая операция') + `
    <div class="seg" id="f-type">
      <button data-t="expense">Расход</button><button data-t="income">Доход</button>${rec ? '' : '<button data-t="transfer">Перевод</button>'}
    </div>
    <div class="amount-wrap"><input id="f-amount" inputmode="decimal" placeholder="0" autocomplete="off" value="${op ? op.amount : rec ? rec.amount : ''}"><span id="f-cur"></span></div>
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
    ${rec ? '<button class="secondary" id="f-skip">Пропустить в этот раз</button>' : ''}`;

  openSheet(html, s => {
    const amountEl = $('#f-amount', s), toAmEl = $('#f-toamount', s);
    const reset = () => { toTouched = false; update(); };
    const accEl = accPicker($('#f-acc', s), op ? op.accountId : rec ? rec.accountId : first, reset);
    const toEl = accPicker($('#f-to', s), op && op.toId ? op.toId : (accs.find(a => a.id !== accEl.value) || accs[0]).id, reset);
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
        const a = num(amountEl.value);
        if (!toTouched) toAmEl.value = isFinite(a) ? Math.round(convert(a, from.currency, to.currency) * 100) / 100 : '';
      }
      const list = tr ? [] : S.categories[type];
      if (!tr && !list.includes(cat)) cat = list[0];
      $('#f-cats', s).hidden = tr;
      $('#f-cats', s).innerHTML = list.map(c => `<button class="chip ${c === cat ? 'on' : ''}" data-c="${esc(c)}">${esc(c)}</button>`).join('');
    };
    $('#f-type', s).addEventListener('click', e => { const t = e.target.closest('[data-t]'); if (t) { type = t.dataset.t; update(); } });
    $('#f-cats', s).addEventListener('click', e => { const c = e.target.closest('[data-c]'); if (c) { cat = c.dataset.c; update(); } });
    amountEl.addEventListener('input', update);
    toAmEl.addEventListener('input', () => { toTouched = true; });
    update();
    if (!op && !rec) setTimeout(() => amountEl.focus(), 350);

    $('#f-save', s).addEventListener('click', () => {
      const amount = num(amountEl.value);
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
  });
}

function accountSheet(a = null, bank = null) {
  const b = balances();
  const html = sheetHead(a ? `${esc(a.name)} ${SYM[a.currency]}` : bank ? 'Новая валюта' : 'Новый счёт') + `
    <div class="form">
      <label class="field"><span>Банк</span><input id="a-name" list="bank-list" value="${esc(a ? a.name : bank || '')}" placeholder="Например, Monobank"></label>
      <datalist id="bank-list">${bankNames().map(n => `<option value="${esc(n)}">`).join('')}</datalist>
      <label class="field"><span>Валюта</span><select id="a-cur" ${a ? 'disabled' : ''}>${CURS.map(c => `<option ${a ? (a.currency === c ? 'selected' : '') : (bank && bankAccs(bank).some(x => x.currency === c) ? 'disabled' : '')}>${c}</option>`).join('')}</select></label>
      <label class="field"><span>Остаток сейчас</span><input id="a-bal" inputmode="decimal" value="${a ? Math.round(b[a.id] * 100) / 100 : ''}" placeholder="0"></label>
    </div>
    <p class="note">${a ? 'Изменение остатка — это корректировка, она не попадает в историю. Новое название банка применится ко всем его валютам.' : 'Несколько валют в одном банке: создайте счёт с тем же названием банка и другой валютой.'}</p>
    <button class="primary" id="a-save">Сохранить</button>
    ${a ? '<button class="danger" id="a-del">Удалить счёт</button>' : ''}`;
  openSheet(html, s => {
    $('#a-save', s).addEventListener('click', () => {
      const name = $('#a-name', s).value.trim();
      if (!name) return toast('Введите название');
      const bal = $('#a-bal', s).value.trim() === '' ? 0 : num($('#a-bal', s).value);
      if (!isFinite(bal)) return toast('Неверный остаток');
      const currency = a ? a.currency : $('#a-cur', s).value;
      if (activeAccounts().some(x => x !== a && x.name === name && x.currency === currency && !(a && x.name === a.name)))
        return toast(`В «${name}» уже есть ${currency}`);
      if (a) {
        if (name !== a.name) bankAccs(a.name).forEach(x => { if (x !== a) x.name = name; });
        a.name = name; a.initial = Math.round((a.initial + bal - b[a.id]) * 100) / 100;
      } else S.accounts.push({ id: uid(), name, currency, initial: bal });
      closeSheet(); commit();
    });
    a && $('#a-del', s).addEventListener('click', () => {
      const used = S.ops.some(o => o.accountId === a.id || o.toId === a.id) || S.recurring.some(r => r.accountId === a.id);
      if (used) {
        if (!confirm('По счёту есть операции. Скрыть счёт? Его остаток не будет учитываться в капитале. Вернуть можно в настройках.')) return;
        a.archived = true;
      } else {
        if (!confirm(`Удалить «${a.name}»?`)) return;
        S.accounts = S.accounts.filter(x => x.id !== a.id);
      }
      closeSheet(); commit();
    });
  });
}

function bankSheet(name) {
  const b = balances(), list = bankAccs(name);
  const sum = list.reduce((x, a) => x + convert(b[a.id], a.currency, 'EUR'), 0);
  const html = sheetHead(esc(name)) + `
    <div class="hero" style="padding-top:0"><div class="label">Всего</div><div class="big">${bigMoney(sum, 'EUR')}</div>
      <div class="sub">${fmt(convert(sum, 'EUR', 'UAH'), 'UAH')}</div></div>
    <div class="list">${list.map(a => `<button class="row" data-id="${a.id}">
      <div class="ico">${SYM[a.currency]}</div><div class="main"><div class="title">${a.currency}</div>
      ${a.currency !== 'EUR' ? `<div class="meta">≈ ${fmt(convert(b[a.id], a.currency, 'EUR'), 'EUR')}</div>` : ''}</div>
      <div class="amt">${fmt(b[a.id], a.currency)}</div></button>`).join('')}</div>
    ${list.length < CURS.length ? '<button class="secondary" id="b-add">+ Добавить валюту</button>' : ''}`;
  openSheet(html, s => {
    $$('.row[data-id]', s).forEach(el => el.addEventListener('click', () => { closeSheet(); setTimeout(() => accountSheet(accById(el.dataset.id)), 320); }));
    const add = $('#b-add', s);
    add && add.addEventListener('click', () => { closeSheet(); setTimeout(() => accountSheet(null, name), 320); });
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
  const T = { expense: 'Расход', income: 'Доход', transfer: 'Перевод' };
  const rows = [['Дата', 'Тип', 'Сумма', 'Валюта', 'Счёт', 'Категория', 'На счёт', 'Зачислено', 'Валюта зачисления', 'Комментарий']];
  [...S.ops].sort((a, b) => a.date.localeCompare(b.date)).forEach(o => rows.push([
    o.date, T[o.type], n(o.type === 'expense' ? -o.amount : o.amount), cur(o.accountId), name(o.accountId), o.category || '',
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
  toast('Пароль изменён');
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
    case 'tab': tab = d.tab; if (tab === 'history') histMonth = todayStr().slice(0, 7); render(); window.scrollTo(0, 0); break;
    case 'new-op': opSheet(); break;
    case 'edit-op': opSheet({ op: S.ops.find(o => o.id === d.id) }); break;
    case 'confirm-rec': opSheet({ rec: S.recurring.find(r => r.id === d.id), k: d.k, due: d.due }); break;
    case 'new-account': accountSheet(); break;
    case 'open-bank': bankSheet(d.name); break;
    case 'edit-account': accountSheet(accById(d.id)); break;
    case 'unhide-account': accById(d.id).archived = false; commit(); break;
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
    case 'lock': lock(); break;
  }
});
document.addEventListener('change', e => {
  if (e.target.dataset && e.target.dataset.rate && S) {
    const v = num(e.target.value);
    if (!(v > 0)) { toast('Неверный курс'); render(); return; }
    S.rates[e.target.dataset.rate] = v; S.rates.updated = null; commit();
  }
  if (e.target.id === 'import-file' && e.target.files[0]) importBackup(e.target.files[0]);
});

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
    if (hasVault) {
      const v = await kvGet('vault');
      const key = await deriveKey(pw, v.salt, v.iter);
      try { S = await decryptVault(key, v); } catch { err.textContent = 'Неверный пароль'; return; }
      KEY = key; SALT = v.salt; ITERS = v.iter;
    } else {
      SALT = crypto.getRandomValues(new Uint8Array(16)); ITERS = ITER;
      KEY = await deriveKey(pw, SALT, ITERS);
      S = defaultState();
      await save();
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    }
    $('#lock-pw').value = ''; $('#lock-pw2').value = '';
    $('#lock').hidden = true; $('#main').hidden = false; $('#tabbar').hidden = false;
    tab = 'home'; render();
  } finally { btn.disabled = false; }
});

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
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}
