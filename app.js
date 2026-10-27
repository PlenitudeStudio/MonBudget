'use strict';

/* =========================================================
   Mon Budget — application de gestion de budget (lot 1)
   Données stockées uniquement dans le navigateur (localStorage).
   ========================================================= */

// ?profil=test utilise un stockage séparé (tests automatiques), sans toucher aux vraies données
const PROFILE = new URLSearchParams(location.search).get('profil');
const STORAGE_KEY = 'monbudget.v1' + (PROFILE && /^[a-z0-9_-]{1,20}$/i.test(PROFILE) ? '.' + PROFILE : '');
const DATA_VERSION = 1;

/* ---------- Utilitaires ---------- */
const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const money = (cents) => eur.format(cents / 100);
const signedMoney = (cents, type) =>
  type === 'income' ? '+' + money(cents) : type === 'expense' ? '−' + money(cents) : money(cents);

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad = (n) => String(n).padStart(2, '0');
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayISO = () => toISO(new Date());
const monthOf = (iso) => iso.slice(0, 7);
const currentMonth = () => monthOf(todayISO());
const parseISO = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d || 1);
};
const shiftMonth = (key, delta) => {
  const d = parseISO(key + '-01');
  d.setMonth(d.getMonth() + delta);
  return monthOf(toISO(d));
};
const monthLabel = (key) => parseISO(key + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
function dayLabel(iso) {
  const today = todayISO();
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (iso === today) return "Aujourd'hui";
  if (iso === toISO(y)) return 'Hier';
  const d = parseISO(iso);
  const opts = { weekday: 'long', day: 'numeric', month: 'long' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  const s = d.toLocaleDateString('fr-FR', opts);
  return s.charAt(0).toUpperCase() + s.slice(1);
}
const shortDate = (iso) => parseISO(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const safeColor = (c) => (/^#[0-9a-f]{6}$/i.test(c) ? c : '#868e96');

/** "12,50" / "1 200.5 €" -> centimes (NaN si vide ou invalide) */
function parseAmount(str) {
  const s = String(str ?? '').replace(/[\s  €]/g, '').replace(',', '.');
  if (s === '' || s === '-' || !/^-?\d*\.?\d*$/.test(s)) return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}
const centsToInput = (c) => (c / 100).toFixed(2).replace('.', ',');

const ICON = {
  left: '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1zM17 9l-6 6M11 9l6 6"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
};

/* ---------- Données par défaut ---------- */
const PALETTE = ['#0f766e', '#22a06b', '#2f9e44', '#4c6ef5', '#1c7ed6', '#1098ad', '#7048e8', '#ae3ec9', '#d6336c', '#e03131', '#e8590c', '#f08c00', '#fab005', '#868e96'];
const EMOJIS = ['🛒', '🏠', '🚗', '⛽', '🚆', '🍽️', '☕', '🍔', '🎮', '🎬', '🎵', '📚', '💊', '🏥', '📱', '💻', '💡', '💧', '🛍️', '👕', '💇', '🎁', '🐶', '👶', '🎓', '✈️', '🏖️', '🏋️', '⚽', '🧾', '🏦', '💳', '💼', '⭐', '↩️', '🏷️', '💶', '📈', '🐷', '📦', '🔧', '🚬', '🍷', '❤️', '🎉', '🧸'];
const ACCOUNT_TYPES = {
  checking: { label: 'Compte courant', icon: '🏦' },
  savings: { label: 'Épargne', icon: '🐷' },
  cash: { label: 'Espèces', icon: '💵' },
  card: { label: 'Carte / crédit', icon: '💳' },
  other: { label: 'Autre', icon: '💼' },
};

function defaultState() {
  const cats = [
    ['Courses', '🛒', '#22a06b', 'expense'],
    ['Logement', '🏠', '#4c6ef5', 'expense'],
    ['Transport', '🚗', '#f08c00', 'expense'],
    ['Restaurants', '🍽️', '#e8590c', 'expense'],
    ['Loisirs', '🎮', '#ae3ec9', 'expense'],
    ['Santé', '💊', '#e03131', 'expense'],
    ['Abonnements', '📱', '#1098ad', 'expense'],
    ['Factures', '💡', '#fab005', 'expense'],
    ['Shopping', '🛍️', '#d6336c', 'expense'],
    ['Cadeaux', '🎁', '#7048e8', 'expense'],
    ['Autre', '📦', '#868e96', 'expense', true],
    ['Salaire', '💼', '#2f9e44', 'income'],
    ['Primes', '⭐', '#fab005', 'income'],
    ['Remboursements', '↩️', '#1098ad', 'income'],
    ['Ventes', '🏷️', '#1c7ed6', 'income'],
    ['Autre revenu', '💶', '#868e96', 'income', true],
  ].map(([name, icon, color, kind, fallback]) => ({ id: uid(), name, icon, color, kind, fallback: !!fallback }));
  const accounts = [
    { id: uid(), name: 'Compte courant', type: 'checking', initial: 0, color: '#0f766e' },
    { id: uid(), name: 'Livret A', type: 'savings', initial: 0, color: '#2f9e44' },
    { id: uid(), name: 'Espèces', type: 'cash', initial: 0, color: '#f08c00' },
  ];
  return {
    version: DATA_VERSION,
    accounts,
    categories: cats,
    transactions: [],
    budgets: {},
    budgetCopied: {},
    goals: [],
    recurring: [],
    settings: { theme: 'auto', lastAccountId: accounts[0].id },
  };
}

function isValidState(s) {
  return (
    s && typeof s === 'object' &&
    Array.isArray(s.accounts) && s.accounts.length > 0 &&
    Array.isArray(s.categories) && Array.isArray(s.transactions)
  );
}

function normalizeState(s) {
  s.version = DATA_VERSION;
  s.settings = Object.assign({ theme: 'auto', lastAccountId: s.accounts[0].id }, s.settings || {});
  if (!s.budgets || typeof s.budgets !== 'object' || Array.isArray(s.budgets)) s.budgets = {};
  // Ancien format (un budget unique par catégorie) : il devient le budget du mois en cours
  const legacy = Object.entries(s.budgets).filter(([, v]) => v && typeof v.amount === 'number');
  if (legacy.length) {
    const m = currentMonth();
    const migrated = {};
    for (const [catId, b] of legacy) migrated[catId] = { amount: b.amount, rollover: false };
    s.budgets = { [m]: migrated };
  }
  if (!s.budgetCopied || typeof s.budgetCopied !== 'object') s.budgetCopied = {};
  if (!Array.isArray(s.goals)) s.goals = [];
  s.goals.forEach((g) => { if (!Array.isArray(g.moves)) g.moves = []; });
  if (!Array.isArray(s.recurring)) s.recurring = [];
  // Garantir une catégorie de secours par type
  for (const kind of ['expense', 'income']) {
    if (!s.categories.some((c) => c.kind === kind && c.fallback)) {
      s.categories.push({
        id: uid(), name: kind === 'expense' ? 'Autre' : 'Autre revenu', icon: kind === 'expense' ? '📦' : '💶',
        color: '#868e96', kind, fallback: true,
      });
    }
  }
  return s;
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (isValidState(s)) return normalizeState(s);
    }
  } catch (e) {
    console.warn('Lecture des données impossible', e);
  }
  return defaultState();
}

let state = load();

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    toast("Impossible d'enregistrer : stockage du navigateur indisponible");
  }
}

/* ---------- Accès aux données ---------- */
const catById = (id) => state.categories.find((c) => c.id === id);
const accById = (id) => state.accounts.find((a) => a.id === id);
const fallbackCat = (kind) => state.categories.find((c) => c.kind === kind && c.fallback);

function sortedTx(list = state.transactions) {
  return [...list].sort((a, b) => (a.date === b.date ? (b.createdAt || 0) - (a.createdAt || 0) : a.date < b.date ? 1 : -1));
}

function balances() {
  const map = new Map(state.accounts.map((a) => [a.id, a.initial || 0]));
  for (const t of state.transactions) {
    if (t.type === 'income') map.set(t.accountId, (map.get(t.accountId) || 0) + t.amount);
    else if (t.type === 'expense') map.set(t.accountId, (map.get(t.accountId) || 0) - t.amount);
    else if (t.type === 'transfer') {
      map.set(t.accountId, (map.get(t.accountId) || 0) - t.amount);
      map.set(t.toAccountId, (map.get(t.toAccountId) || 0) + t.amount);
    }
  }
  return map;
}
const totalBalance = () => [...balances().values()].reduce((s, v) => s + v, 0);

// Comptes d'épargne (livrets…) d'un côté, argent disponible (courant, espèces, carte…) de l'autre
const isSavingsAcc = (a) => a.type === 'savings';
function balanceGroups() {
  const bal = balances();
  const avail = [], savings = [];
  for (const a of state.accounts) (isSavingsAcc(a) ? savings : avail).push({ a, b: bal.get(a.id) || 0 });
  const sum = (list) => list.reduce((s, x) => s + x.b, 0);
  return { avail, savings, availTotal: sum(avail), savingsTotal: sum(savings) };
}
const availableBalance = () => balanceGroups().availTotal;

function accountLines(list) {
  return `<ul class="acc-lines">${list
    .map(({ a, b }) => `<li><span class="ellipsis">${esc(a.name)}</span><span class="num">${money(b)}</span></li>`)
    .join('')}</ul>`;
}

function monthStats(key) {
  let income = 0, expense = 0;
  const byCat = new Map();
  for (const t of state.transactions) {
    if (monthOf(t.date) !== key) continue;
    if (t.type === 'income') income += t.amount;
    else if (t.type === 'expense') {
      expense += t.amount;
      byCat.set(t.categoryId, (byCat.get(t.categoryId) || 0) + t.amount);
    }
  }
  return { income, expense, byCat };
}

function categoryUsage(kind) {
  const count = new Map();
  for (const t of state.transactions) if (t.type === kind) count.set(t.categoryId, (count.get(t.categoryId) || 0) + 1);
  return count;
}

/* ---------- État de l'interface ---------- */
const VIEWS = { home: 'Accueil', history: 'Opérations', plan: 'Budget', stats: 'Statistiques', accounts: 'Comptes', settings: 'Réglages' };
const defaultHistFilters = () => ({ q: '', period: 'month', type: '', categoryId: '', accountId: '', min: '', max: '', open: false });
const ui = {
  view: VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : 'home',
  month: currentMonth(),
  hist: defaultHistFilters(),
  planTab: 'budgets',
  statsRange: 6,
};
let sheet = null; // { kind: 'tx' | 'acc' | 'cat', draft }
let installPrompt = null;

const $ = (sel, root = document) => root.querySelector(sel);
const viewEl = $('#view');

/* ---------- Thème ---------- */
function applyTheme() {
  const t = state.settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

/* ---------- Composants ---------- */
function catIcon(cat, size) {
  const color = safeColor(cat?.color);
  const style = `background:${color}22;color:${color}` + (size ? `;width:${size}px;height:${size}px` : '');
  return `<span class="cat-ico" style="${style}">${esc(cat?.icon || '❔')}</span>`;
}

function txRow(t) {
  let icon, title, sub;
  const acc = accById(t.accountId);
  if (t.type === 'transfer') {
    const to = accById(t.toAccountId);
    icon = `<span class="cat-ico" style="background:var(--surface-2);color:var(--transfer)">⇄</span>`;
    title = t.note || 'Virement';
    sub = `${esc(acc?.name || '?')} → ${esc(to?.name || '?')}`;
  } else {
    const cat = catById(t.categoryId);
    icon = catIcon(cat);
    title = t.note || cat?.name || 'Sans catégorie';
    sub = (t.note ? esc(cat?.name || 'Sans catégorie') + ' · ' : '') + esc(acc?.name || '?');
  }
  if (t.recurringId) sub = '🔁 ' + sub;
  return `<li><button class="tx" data-action="edit-tx" data-id="${t.id}">
    ${icon}
    <span class="main"><span class="t1">${esc(title)}</span><span class="t2">${sub}</span></span>
    <span class="amt num ${t.type}">${signedMoney(t.amount, t.type)}</span>
  </button></li>`;
}

function monthSwitch() {
  return `<div class="month-switch">
    <button class="icon-btn" data-action="month-prev" aria-label="Mois précédent">${ICON.left}</button>
    <span class="label">${esc(monthLabel(ui.month))}</span>
    <button class="icon-btn" data-action="month-next" aria-label="Mois suivant">${ICON.right}</button>
  </div>`;
}

function donut(slices, total, centerValue, centerLabel) {
  let offset = 0;
  const arcs = slices
    .map((s) => {
      const pct = (s.value / total) * 100;
      const c = `<circle r="15.9155" cx="18" cy="18" stroke="${safeColor(s.color)}" stroke-dasharray="${pct.toFixed(3)} ${(100 - pct).toFixed(3)}" stroke-dashoffset="${(-offset).toFixed(3)}"/>`;
      offset += pct;
      return c;
    })
    .join('');
  return `<div class="donut" role="img" aria-label="Répartition des dépenses">
    <svg viewBox="0 0 36 36"><circle r="15.9155" cx="18" cy="18" stroke="var(--surface-2)"/>${arcs}</svg>
    <div class="center"><span class="v num">${centerValue}</span><span class="k">${centerLabel}</span></div>
  </div>`;
}

/* ---------- Écran : Accueil ---------- */
function renderHome() {
  const { income, expense, byCat } = monthStats(ui.month);
  const rest = income - expense;
  let html = monthSwitch() + '<div class="dash"><div class="col">';

  const g = balanceGroups();
  html += `<section class="card hero">
    <div class="label">Disponible sur ${g.avail.length > 1 ? 'tes comptes' : 'ton compte'}</div>
    <div class="amount num">${money(g.availTotal)}</div>
    ${g.avail.length > 1 ? accountLines(g.avail) : ''}
    ${ui.month === currentMonth() ? heroForecast() : ''}
  </section>`;

  if (g.savings.length) {
    const reserved = state.goals.length ? totalSaved() : 0;
    html += `<section class="card savings-card">
      <button class="savings-head" data-action="goto" data-view="accounts">
        <span><span class="k">Épargne totale</span><span class="v num">${money(g.savingsTotal)}</span></span>
        <span class="muted">›</span>
      </button>
      ${accountLines(g.savings)}
      ${reserved ? `<p class="muted small" style="margin:6px 0 0">dont ${money(reserved)} réservés pour tes objectifs</p>` : ''}
    </section>`;
  }

  // Récap du mois : seulement quand des montants sont saisis pour ce mois
  if (income || expense) {
    html += `<section class="card recap">
      <div class="chart-head"><h3>Récap de ${esc(monthLong(ui.month))}</h3>${ui.month !== currentMonth() ? `<span class="muted small">${parseISO(ui.month + '-01').getFullYear()}</span>` : ''}</div>
      <div class="stat-grid">
        <div><div class="k">Revenus</div><div class="v num">${money(income)}</div></div>
        <div><div class="k">Dépenses</div><div class="v num">${money(expense)}</div></div>
        <div><div class="k">Solde du mois</div><div class="v num" style="color:${rest >= 0 ? 'var(--income)' : 'var(--expense)'}">${rest > 0 ? '+' : rest < 0 ? '−' : ''}${money(Math.abs(rest))}</div></div>
      </div>
      ${homeBudgetRecap()}
    </section>`;
  }

  if (state.transactions.length === 0) {
    html += `<section class="card tip">
      <strong>Bienvenue 👋</strong>
      <p class="muted small">Commence par indiquer le solde actuel de tes comptes, puis ajoute tes dépenses et revenus avec le bouton <strong>+</strong>.</p>
      <button class="btn primary" data-action="goto" data-view="accounts">Régler mes comptes</button>
    </section>`;
  }

  html += homePlanCards();
  html += '</div><div class="col">';

  // Dépenses par catégorie
  html += `<div class="section-title first">Dépenses par catégorie</div>`;
  if (expense === 0) {
    html += `<section class="card empty"><span class="big">🍃</span>Aucune dépense ce mois-ci.</section>`;
  } else {
    const entries = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
    const MAX = 6;
    const slices = entries.slice(0, MAX).map(([id, value]) => {
      const c = catById(id);
      return { id, value, color: c?.color, name: c?.name || 'Sans catégorie', icon: c?.icon };
    });
    if (entries.length > MAX) {
      const rest = entries.slice(MAX).reduce((s, [, v]) => s + v, 0);
      slices.push({ id: '', value: rest, color: '#adb5bd', name: 'Autres catégories' });
    }
    html += `<section class="card"><div class="donut-wrap">
      ${donut(slices, expense, money(expense), 'dépensés')}
      <ul class="legend">${slices
        .map(
          (s) => `<li><button ${s.id ? `data-action="cat-filter" data-id="${s.id}"` : 'data-action="goto" data-view="history"'}>
            <span class="dot" style="background:${safeColor(s.color)}"></span>
            <span class="name">${esc(s.icon ? s.icon + ' ' : '')}${esc(s.name)}</span>
            <span class="num small"><strong>${money(s.value)}</strong> <span class="pct">${Math.round((s.value / expense) * 100)}%</span></span>
          </button></li>`
        )
        .join('')}</ul>
    </div></section>`;
  }

  // Dernières opérations
  const recent = sortedTx().slice(0, 6);
  html += `<div class="section-title">Dernières opérations ${recent.length ? '<button class="link" data-action="goto" data-view="history">Tout voir</button>' : ''}</div>`;
  if (recent.length === 0) {
    html += `<section class="card empty"><span class="big">🧾</span>Aucune opération pour l'instant.<br><button class="btn primary" style="margin-top:12px" data-action="open-add">Ajouter une opération</button></section>`;
  } else {
    html += `<section class="card" style="padding:6px 12px"><ul class="tx-list">${recent.map(txRow).join('')}</ul></section>`;
  }
  return html + '</div></div>';
}

/* ---------- Écran : Opérations ---------- */
function filteredTx() {
  const f = ui.hist;
  const q = norm(f.q.trim());
  const min = parseAmount(f.min);
  const max = parseAmount(f.max);
  return sortedTx().filter((t) => {
    if (f.period === 'month' && monthOf(t.date) !== ui.month) return false;
    if (f.type && t.type !== f.type) return false;
    if (f.categoryId && t.categoryId !== f.categoryId) return false;
    if (f.accountId && t.accountId !== f.accountId && t.toAccountId !== f.accountId) return false;
    if (!Number.isNaN(min) && t.amount < min) return false;
    if (!Number.isNaN(max) && t.amount > max) return false;
    if (q) {
      const hay = norm(
        [t.note, catById(t.categoryId)?.name, accById(t.accountId)?.name, accById(t.toAccountId)?.name,
          centsToInput(t.amount), money(t.amount), t.type === 'transfer' ? 'virement' : ''].join(' ')
      );
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderHistory() {
  const f = ui.hist;
  const chip = (action, value, label, pressed) =>
    `<button class="chip" data-action="${action}" data-value="${value}" aria-pressed="${pressed}">${label}</button>`;
  const activeFilters = [f.categoryId, f.accountId, f.min, f.max].filter(Boolean).length;
  const catOptions = ['expense', 'income']
    .map(
      (kind) => `<optgroup label="${kind === 'expense' ? 'Dépenses' : 'Revenus'}">${state.categories
        .filter((c) => c.kind === kind)
        .map((c) => `<option value="${c.id}" ${f.categoryId === c.id ? 'selected' : ''}>${esc(c.icon + ' ' + c.name)}</option>`)
        .join('')}</optgroup>`
    )
    .join('');

  let html = `<label class="search">${ICON.search}<input id="hist-q" type="search" placeholder="Rechercher (note, catégorie, montant…)" value="${esc(f.q)}" autocomplete="off"></label>
  <div class="chips">
    ${chip('toggle-filters', '', `Filtres${activeFilters ? ' (' + activeFilters + ')' : ''}`, f.open)}
    ${chip('hist-period', 'month', 'Par mois', f.period === 'month')}
    ${chip('hist-period', 'all', 'Tout', f.period === 'all')}
    <span style="width:1px;background:var(--border);flex:none"></span>
    ${chip('hist-type', '', 'Tous types', f.type === '')}
    ${chip('hist-type', 'expense', 'Dépenses', f.type === 'expense')}
    ${chip('hist-type', 'income', 'Revenus', f.type === 'income')}
    ${chip('hist-type', 'transfer', 'Virements', f.type === 'transfer')}
  </div>`;

  if (f.open) {
    html += `<section class="card"><div class="filters">
      <label class="field full"><span>Catégorie</span><select class="input" data-hist="categoryId"><option value="">Toutes</option>${catOptions}</select></label>
      <label class="field full"><span>Compte</span><select class="input" data-hist="accountId"><option value="">Tous</option>${state.accounts
        .map((a) => `<option value="${a.id}" ${f.accountId === a.id ? 'selected' : ''}>${esc(a.name)}</option>`)
        .join('')}</select></label>
      <label class="field"><span>Montant min (€)</span><input class="input" data-hist="min" inputmode="decimal" placeholder="0" value="${esc(f.min)}"></label>
      <label class="field"><span>Montant max (€)</span><input class="input" data-hist="max" inputmode="decimal" placeholder="∞" value="${esc(f.max)}"></label>
      <button class="btn full" data-action="reset-filters">Réinitialiser les filtres</button>
    </div></section>`;
  }
  if (f.period === 'month') html += monthSwitch();
  html += `<div id="hist-results">${renderHistoryResults()}</div>`;
  return html;
}

function renderHistoryResults() {
  const list = filteredTx();
  if (list.length === 0) {
    const hasAny = state.transactions.length > 0;
    return `<section class="card empty"><span class="big">🔍</span>${hasAny ? 'Aucune opération ne correspond.' : "Aucune opération pour l'instant."}</section>`;
  }
  let inc = 0, exp = 0;
  for (const t of list) {
    if (t.type === 'income') inc += t.amount;
    else if (t.type === 'expense') exp += t.amount;
  }
  const totals = [inc ? '+' + money(inc) : '', exp ? '−' + money(exp) : ''].filter(Boolean).join(' · ');
  let html = `<div class="summary-row"><span>${list.length} opération${list.length > 1 ? 's' : ''}</span><span class="num">${totals}</span></div>`;

  const groups = new Map();
  for (const t of list) {
    if (!groups.has(t.date)) groups.set(t.date, []);
    groups.get(t.date).push(t);
  }
  for (const [date, items] of groups) {
    const net = items.reduce((s, t) => s + (t.type === 'income' ? t.amount : t.type === 'expense' ? -t.amount : 0), 0);
    html += `<div class="day-head"><span>${esc(dayLabel(date))}</span><span class="num">${net === 0 ? '' : (net > 0 ? '+' : '−') + money(Math.abs(net))}</span></div>
      <section class="card" style="padding:6px 12px;margin-bottom:6px"><ul class="tx-list">${items.map(txRow).join('')}</ul></section>`;
  }
  return html;
}

/* ---------- Écran : Comptes ---------- */
function renderAccounts() {
  const bal = balances();
  const total = [...bal.values()].reduce((s, v) => s + v, 0);
  let html = `<section class="card hero">
    <div class="label">Total de tous les comptes</div>
    <div class="amount num" style="margin-bottom:0">${money(total)}</div>
  </section>
  <div class="section-title">Mes comptes <button class="link" data-action="add-transfer">⇄ Virement</button></div>
  <section class="card" style="padding:6px 12px"><ul class="list">`;
  for (const a of state.accounts) {
    const b = bal.get(a.id) || 0;
    const type = ACCOUNT_TYPES[a.type] || ACCOUNT_TYPES.other;
    html += `<li><button class="acc" data-action="edit-account" data-id="${a.id}">
      ${catIcon({ icon: type.icon, color: a.color })}
      <span><strong>${esc(a.name)}</strong><br><span class="muted small">${type.label}</span></span>
      <span class="bal num ${b < 0 ? 'neg' : ''}">${money(b)}</span>
    </button></li>`;
  }
  html += `</ul></section>
  <button class="btn block" data-action="add-account">+ Ajouter un compte</button>
  <p class="muted small" style="margin:14px 4px">Touche un compte pour modifier son nom ou son solde de départ. Le solde affiché tient compte de toutes les opérations enregistrées.</p>`;
  return html;
}

/* ---------- Écran : Réglages ---------- */
function renderSettings() {
  const t = state.settings.theme;
  const seg = (v, l) => `<button data-action="theme" data-value="${v}" aria-pressed="${t === v}">${l}</button>`;
  const catList = (kind) =>
    state.categories
      .filter((c) => c.kind === kind)
      .map(
        (c) => `<li><button class="list-item" data-action="edit-cat" data-id="${c.id}">
          <span class="left">${catIcon(c, 34)}<span>${esc(c.name)}</span></span>
          <span class="muted">${ICON.right.replace('<svg', '<svg width="18" height="18"')}</span>
        </button></li>`
      )
      .join('');
  return `<div class="section-title">Apparence</div>
  <section class="card"><div class="seg">${seg('auto', 'Auto')}${seg('light', 'Clair')}${seg('dark', 'Sombre')}</div></section>

  <div class="section-title">Catégories de dépenses <button class="link" data-action="add-cat" data-kind="expense">+ Ajouter</button></div>
  <section class="card" style="padding:4px 12px"><ul class="list">${catList('expense')}</ul></section>

  <div class="section-title">Catégories de revenus <button class="link" data-action="add-cat" data-kind="income">+ Ajouter</button></div>
  <section class="card" style="padding:4px 12px"><ul class="list">${catList('income')}</ul></section>

  <div class="section-title">Mes données</div>
  <section class="card">
    <p class="muted small" style="margin-top:0">Tes données restent uniquement sur cet appareil, dans ce navigateur. Exporte régulièrement une sauvegarde.</p>
    <div class="settings-btns">
      <button class="btn" data-action="export">💾 Exporter la sauvegarde</button>
      <button class="btn" data-action="import">📂 Restaurer une sauvegarde</button>
      <button class="btn" data-action="csv-open">🏦 Importer un relevé CSV</button>
      <button class="btn" data-action="csv-export">📊 Exporter en CSV (Excel)</button>
    </div>
    <button class="btn danger block" style="margin-top:8px" data-action="reset-all">Effacer toutes les données</button>
  </section>

  <div class="section-title">Sécurité</div>
  <section class="card">${settingsSecurity()}</section>
  ${installPrompt ? `<section class="card"><button class="btn primary block" data-action="install">Installer l'application</button></section>` : ''}
  <p class="muted small" style="text-align:center">Mon Budget · ${state.transactions.length} opération${state.transactions.length > 1 ? 's' : ''} enregistrée${state.transactions.length > 1 ? 's' : ''}</p>`;
}

/* ---------- Rendu principal ---------- */
function render() {
  $('#title').textContent = VIEWS[ui.view];
  document.title = `${VIEWS[ui.view]} · Mon Budget`;
  document.querySelectorAll('.tab').forEach((b) => {
    if (b.dataset.view === ui.view) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  const renderers = { home: renderHome, history: renderHistory, plan: renderPlan, stats: renderStats, accounts: renderAccounts, settings: renderSettings };
  viewEl.innerHTML = renderers[ui.view]();
  if (ui.view === 'stats') hydrateCharts();
}

function goto(view) {
  if (!VIEWS[view]) return;
  const changed = ui.view !== view;
  ui.view = view;
  if (location.hash.slice(1) !== view) history.replaceState(null, '', '#' + view);
  render();
  if (changed) window.scrollTo(0, 0);
}

/* ---------- Feuilles (fenêtres du bas) ---------- */
const sheetRoot = $('#sheet-root');
const sheetBody = $('#sheet-body');
let lastFocus = null;

function openSheet(kind, draft) {
  lastFocus = document.activeElement;
  sheet = { kind, draft };
  renderSheet();
  sheetRoot.hidden = false;
  document.body.style.overflow = 'hidden';
  sheetBody.querySelector('h2')?.focus?.();
}

function closeSheet() {
  sheet = null;
  sheetRoot.hidden = true;
  sheetBody.innerHTML = '';
  document.body.style.overflow = '';
  lastFocus?.focus?.();
}

function renderSheet() {
  if (!sheet) return;
  const r = { tx: txSheet, acc: accSheet, cat: catSheet, budget: budgetSheet, goal: goalSheet, goalMove: goalMoveSheet, rec: recSheet, csv: csvSheet, pin: pinSheet }[sheet.kind];
  sheetRoot.querySelector('.sheet').classList.toggle('wide', sheet.kind === 'csv');
  sheetBody.innerHTML = r(sheet.draft);
}

const sheetHead = (title) => `<div class="sheet-head"><h2 id="sheet-title" tabindex="-1">${title}</h2>
  <button class="icon-btn" data-action="close-sheet" aria-label="Fermer">${ICON.close}</button></div>`;

/* --- Ajout / modification d'opération --- */
function newTxDraft(type = 'expense') {
  const accId = accById(state.settings.lastAccountId) ? state.settings.lastAccountId : state.accounts[0].id;
  const other = state.accounts.find((a) => a.id !== accId);
  return {
    id: null, type, amountStr: '', categoryId: null, accountId: accId,
    toAccountId: other ? other.id : accId, date: todayISO(), note: '', repeat: '',
  };
}

function openAdd(type) {
  openSheet('tx', newTxDraft(type));
}

function openEditTx(id) {
  const t = state.transactions.find((x) => x.id === id);
  if (!t) return;
  openSheet('tx', {
    id: t.id, type: t.type, amountStr: centsToInput(t.amount).replace(/,00$/, ''), categoryId: t.categoryId,
    accountId: t.accountId, toAccountId: t.toAccountId || state.accounts[0].id, date: t.date, note: t.note || '',
    createdAt: t.createdAt, recurringId: t.recurringId || null,
  });
}

function amountText(s) {
  if (!s) return '0 €';
  const [int, dec] = s.split(',');
  const intFmt = Number(int || '0').toLocaleString('fr-FR');
  return intFmt + (dec !== undefined ? ',' + dec : '') + ' €';
}
const draftCents = (s) => (s ? Math.round(parseFloat(s.replace(',', '.')) * 100) || 0 : 0);

function catGrid(d) {
  const usage = categoryUsage(d.type);
  const cats = state.categories
    .filter((c) => c.kind === d.type)
    .sort((a, b) => (usage.get(b.id) || 0) - (usage.get(a.id) || 0) || (a.fallback ? 1 : 0) - (b.fallback ? 1 : 0));
  return cats
    .map(
      (c) => `<button class="cat-btn" data-action="pick-cat" data-id="${c.id}" aria-pressed="${d.categoryId === c.id}">
        ${catIcon(c)}<span>${esc(c.name)}</span></button>`
    )
    .join('');
}

function accountOptions(selected) {
  return state.accounts.map((a) => `<option value="${a.id}" ${a.id === selected ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
}

function txSheet(d) {
  const seg = (v, l) => `<button data-action="tx-type" data-type="${v}" aria-pressed="${d.type === v}">${l}</button>`;
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', 'back']
    .map((k) => `<button class="key" data-action="key" data-key="${k}" aria-label="${k === 'back' ? 'Effacer' : k}">${k === 'back' ? ICON.back : k}</button>`)
    .join('');
  // Répétition : seulement à la création. En modification, lien vers l'opération récurrente d'origine.
  const rec = d.recurringId ? state.recurring.find((r) => r.id === d.recurringId) : null;
  const repeatField = d.id
    ? ''
    : `<label class="field"><span>Répéter</span><select class="input" data-draft="repeat"><option value="">Jamais</option>${Object.entries(FREQUENCIES)
        .map(([k, l]) => `<option value="${k}" ${d.repeat === k ? 'selected' : ''}>${l}</option>`)
        .join('')}</select></label>`;
  const middle =
    d.type === 'transfer'
      ? `<div class="row2" style="margin-top:10px">
          <label class="field"><span>Depuis</span><select class="input" data-draft="accountId">${accountOptions(d.accountId)}</select></label>
          <label class="field"><span>Vers</span><select class="input" data-draft="toAccountId">${accountOptions(d.toAccountId)}</select></label>
        </div>${repeatField}`
      : `<div class="cat-grid" id="cat-grid">${catGrid(d)}</div>
         <div class="${repeatField ? 'row2' : ''}">
           <label class="field"><span>Compte</span><select class="input" data-draft="accountId">${accountOptions(d.accountId)}</select></label>
           ${repeatField}
         </div>`;
  const recNote = rec
    ? `<p class="muted small" style="margin:8px 0 0">🔁 Créée par « ${esc(recName(rec))} » (${esc(FREQUENCIES[rec.frequency] || '').toLowerCase()}). <button class="link" data-action="edit-rec" data-id="${rec.id}">Modifier la récurrence</button></p>`
    : '';
  return `${sheetHead(d.id ? "Modifier l'opération" : 'Nouvelle opération')}
    <div class="seg">${seg('expense', 'Dépense')}${seg('income', 'Revenu')}${seg('transfer', 'Virement')}</div>
    <div class="amount-display num ${d.type}" id="amount-display" aria-live="polite">${amountText(d.amountStr)}</div>
    ${middle}
    <div class="meta-row">
      <input class="input" type="date" data-draft="date" value="${esc(d.date)}" aria-label="Date" required>
      <input class="input" type="text" data-draft="note" value="${esc(d.note)}" placeholder="Note (facultatif)" maxlength="80" aria-label="Note">
    </div>
    ${recNote}
    <div class="keypad">${keys}</div>
    <div class="btn-row">
      ${d.id ? '<button class="btn danger" data-action="delete-tx">Supprimer</button>' : ''}
      <button class="btn primary" data-action="save-tx">${d.id ? 'Enregistrer' : 'Ajouter'}</button>
    </div>`;
}

function keyInput(k) {
  const d = sheet.draft;
  let s = d.amountStr;
  if (k === 'back') s = s.slice(0, -1);
  else if (k === ',') {
    if (!s.includes(',')) s = (s || '0') + ',';
  } else if (/^\d$/.test(k)) {
    if (s.includes(',')) {
      if (s.split(',')[1].length >= 2) return;
    } else if (s.length >= 8) return;
    if (s === '0') s = '';
    s += k;
  }
  d.amountStr = s;
  $('#amount-display').textContent = amountText(s);
}

function saveTx() {
  const d = sheet.draft;
  const amount = draftCents(d.amountStr);
  if (amount <= 0) return toast('Saisis un montant');
  if (!d.date) return toast('Choisis une date');
  if (d.type === 'transfer') {
    if (d.accountId === d.toAccountId) return toast('Choisis deux comptes différents');
  } else if (!catById(d.categoryId) || catById(d.categoryId).kind !== d.type) {
    return toast('Choisis une catégorie');
  }
  const tx = {
    id: d.id || uid(),
    type: d.type,
    amount,
    categoryId: d.type === 'transfer' ? null : d.categoryId,
    accountId: d.accountId,
    toAccountId: d.type === 'transfer' ? d.toAccountId : null,
    date: d.date,
    note: d.note.trim(),
    createdAt: d.createdAt || Date.now(),
  };
  if (d.recurringId) tx.recurringId = d.recurringId;
  const beforeIdx = tx.type === 'expense' ? spendIndex() : null;
  if (d.id) {
    const i = state.transactions.findIndex((t) => t.id === d.id);
    if (i >= 0) state.transactions[i] = tx;
  } else {
    state.transactions.push(tx);
  }
  // Nouvelle opération répétée : crée l'opération récurrente, dont la prochaine échéance suit celle-ci.
  let created = 0;
  if (!d.id && FREQUENCIES[d.repeat]) {
    const day = parseISO(tx.date).getDate();
    const rec = {
      id: uid(), type: tx.type, name: tx.note, amount, categoryId: tx.categoryId, accountId: tx.accountId,
      toAccountId: tx.toAccountId, frequency: d.repeat, day, nextDate: addPeriod(tx.date, d.repeat, day), active: true,
    };
    state.recurring.push(rec);
    tx.recurringId = rec.id;
    created = runRecurring();
  }
  state.settings.lastAccountId = d.accountId;
  save();
  closeSheet();
  render();
  const alert = beforeIdx ? budgetAlert(tx.categoryId, monthOf(tx.date), beforeIdx) : null;
  const label = { expense: 'Dépense', income: 'Revenu', transfer: 'Virement' }[tx.type];
  let msg = d.id ? 'Opération modifiée' : `${label} ajouté${tx.type === 'expense' ? 'e' : ''} : ${money(amount)}`;
  if (!d.id && d.repeat) msg += ` · ${FREQUENCIES[d.repeat].toLowerCase()}`;
  if (created) msg += ` (+${created} échéance${created > 1 ? 's' : ''} passée${created > 1 ? 's' : ''})`;
  toast(alert ? '⚠️ ' + alert : msg);
}

function deleteTx() {
  const id = sheet.draft.id;
  const i = state.transactions.findIndex((t) => t.id === id);
  if (i < 0) return;
  const [removed] = state.transactions.splice(i, 1);
  save();
  closeSheet();
  render();
  toast('Opération supprimée', {
    label: 'Annuler',
    run: () => {
      state.transactions.push(removed);
      save();
      render();
    },
  });
}

/* --- Comptes --- */
function accSheet(d) {
  const used = d.id && accountInUse(d.id);
  const neg = d.initialStr.trim().startsWith('-');
  return `${sheetHead(d.id ? 'Modifier le compte' : 'Nouveau compte')}
    <label class="field"><span>Nom</span><input class="input" id="acc-name" maxlength="40" value="${esc(d.name)}" placeholder="Ex. Compte joint"></label>
    <label class="field"><span>Type</span><select class="input" id="acc-type">${Object.entries(ACCOUNT_TYPES)
      .map(([k, v]) => `<option value="${k}" ${d.type === k ? 'selected' : ''}>${v.icon} ${v.label}</option>`)
      .join('')}</select></label>
    <div class="field"><span>Solde de départ (€)</span>
      <div class="input-sign">
        <button type="button" class="sign-btn ${neg ? 'neg' : ''}" data-action="acc-sign" aria-pressed="${neg}" aria-label="Solde négatif (découvert)" title="Solde négatif (découvert)">${neg ? '−' : '+'}</button>
        <input class="input" id="acc-initial" inputmode="decimal" value="${esc(d.initialStr.replace(/^-/, ''))}" placeholder="0,00" aria-label="Solde de départ">
      </div>
      <span class="muted small" style="font-weight:400">Touche <strong>+</strong> pour passer en <strong>−</strong> si le compte est à découvert.</span>
    </div>
    <div class="field"><span>Couleur</span><div class="swatches">${PALETTE.map(
      (c) => `<button class="swatch" style="background:${c}" data-action="pick-color" data-color="${c}" aria-label="Couleur ${c}" aria-pressed="${d.color === c}"></button>`
    ).join('')}</div></div>
    <div class="btn-row">
      ${d.id ? `<button class="btn danger" data-action="acc-delete" ${used || state.accounts.length <= 1 ? 'disabled' : ''}>Supprimer</button>` : ''}
      <button class="btn primary" data-action="acc-save">Enregistrer</button>
    </div>
    ${used ? '<p class="muted small">Ce compte est utilisé par des opérations ou des opérations récurrentes : supprime-les ou déplace-les avant de supprimer le compte.</p>' : ''}`;
}

const accountInUse = (id) =>
  state.transactions.some((t) => t.accountId === id || t.toAccountId === id) ||
  state.recurring.some((r) => r.accountId === id || r.toAccountId === id);

function openAccount(id) {
  const a = id ? accById(id) : null;
  openSheet('acc', a
    ? { id: a.id, name: a.name, type: a.type, initialStr: centsToInput(a.initial || 0), color: a.color }
    : { id: null, name: '', type: 'checking', initialStr: '', color: PALETTE[3] });
}

function saveAccount() {
  const d = sheet.draft;
  const name = $('#acc-name').value.trim();
  // Négatif si le bouton ± est sur « − » ou si un « - » a été tapé au clavier
  const initialRaw = $('#acc-initial').value.trim();
  const negative = $('[data-action="acc-sign"]').getAttribute('aria-pressed') === 'true' || initialRaw.startsWith('-');
  const abs = initialRaw.replace(/^[-+]/, '');
  const initial = abs === '' ? 0 : (negative ? -1 : 1) * Math.abs(parseAmount(abs));
  if (!name) return toast('Donne un nom au compte');
  if (Number.isNaN(initial)) return toast('Solde de départ invalide');
  const acc = { id: d.id || uid(), name, type: $('#acc-type').value, initial, color: safeColor(d.color) };
  if (d.id) Object.assign(accById(d.id), acc);
  else state.accounts.push(acc);
  save();
  closeSheet();
  render();
  toast(d.id ? 'Compte modifié' : 'Compte ajouté');
}

function deleteAccount() {
  const id = sheet.draft.id;
  if (accountInUse(id) || state.accounts.length <= 1) return;
  if (!confirm('Supprimer ce compte ?')) return;
  state.accounts = state.accounts.filter((a) => a.id !== id);
  if (state.settings.lastAccountId === id) state.settings.lastAccountId = state.accounts[0].id;
  save();
  closeSheet();
  render();
  toast('Compte supprimé');
}

/* --- Catégories --- */
function catSheet(d) {
  const used = d.id ? state.transactions.filter((t) => t.categoryId === d.id).length : 0;
  const kindSeg = d.id
    ? ''
    : `<div class="field"><span>Type</span><div class="seg">
        <button data-action="cat-kind" data-type="expense" aria-pressed="${d.kind === 'expense'}">Dépense</button>
        <button data-action="cat-kind" data-type="income" aria-pressed="${d.kind === 'income'}">Revenu</button></div></div>`;
  return `${sheetHead(d.id ? 'Modifier la catégorie' : 'Nouvelle catégorie')}
    <div style="display:flex;justify-content:center;margin-bottom:12px" id="cat-preview">${catIcon(d, 56)}</div>
    ${kindSeg}
    <label class="field"><span>Nom</span><input class="input" id="cat-name" maxlength="30" value="${esc(d.name)}" placeholder="Ex. Animaux"></label>
    <div class="field"><span>Icône</span><div class="emoji-grid">${EMOJIS.map(
      (e) => `<button data-action="pick-emoji" data-emoji="${e}" aria-pressed="${d.icon === e}">${e}</button>`
    ).join('')}</div></div>
    <div class="field"><span>Couleur</span><div class="swatches">${PALETTE.map(
      (c) => `<button class="swatch" style="background:${c}" data-action="pick-color" data-color="${c}" aria-label="Couleur ${c}" aria-pressed="${d.color === c}"></button>`
    ).join('')}</div></div>
    <div class="btn-row">
      ${d.id && !d.fallback ? '<button class="btn danger" data-action="cat-delete">Supprimer</button>' : ''}
      <button class="btn primary" data-action="cat-save">Enregistrer</button>
    </div>
    ${d.id && d.fallback ? '<p class="muted small">Catégorie de secours : elle ne peut pas être supprimée.</p>' : ''}
    ${used ? `<p class="muted small">${used} opération${used > 1 ? 's' : ''} dans cette catégorie.</p>` : ''}`;
}

function openCategory(id, kind) {
  const c = id ? catById(id) : null;
  openSheet('cat', c ? { ...c } : { id: null, name: '', icon: '📦', color: PALETTE[3], kind: kind || 'expense', fallback: false });
}

function saveCategory() {
  const d = sheet.draft;
  const name = $('#cat-name').value.trim();
  if (!name) return toast('Donne un nom à la catégorie');
  if (d.id) Object.assign(catById(d.id), { name, icon: d.icon, color: safeColor(d.color) });
  else state.categories.push({ id: uid(), name, icon: d.icon, color: safeColor(d.color), kind: d.kind, fallback: false });
  save();
  closeSheet();
  render();
  toast(d.id ? 'Catégorie modifiée' : 'Catégorie ajoutée');
}

function deleteCategory() {
  const d = sheet.draft;
  const cat = catById(d.id);
  if (!cat || cat.fallback) return;
  const fb = fallbackCat(cat.kind);
  const used = state.transactions.filter((t) => t.categoryId === cat.id);
  const msg = used.length
    ? `Supprimer « ${cat.name} » ? Ses ${used.length} opération(s) passeront dans « ${fb.name} ».`
    : `Supprimer « ${cat.name} » ?`;
  if (!confirm(msg)) return;
  used.forEach((t) => (t.categoryId = fb.id));
  state.recurring.forEach((r) => { if (r.categoryId === cat.id) r.categoryId = fb.id; });
  for (const m of Object.keys(state.budgets)) removeBudget(m, cat.id);
  state.categories = state.categories.filter((c) => c.id !== cat.id);
  if (ui.hist.categoryId === cat.id) ui.hist.categoryId = '';
  save();
  closeSheet();
  render();
  toast('Catégorie supprimée');
}

/* ---------- Données : export / import / reset ---------- */
function downloadFile(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportData() {
  downloadFile(`mon-budget-${todayISO()}.json`, JSON.stringify(state, null, 2), 'application/json');
  toast('Sauvegarde exportée');
}

$('#csv-file').addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  loadCsvFile(file);
});

$('#import-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!isValidState(data)) throw new Error('format');
    if (!confirm(`Remplacer tes données actuelles par cette sauvegarde (${data.transactions.length} opérations) ?`)) return;
    state = normalizeState(data);
    save();
    applyTheme();
    render();
    toast('Sauvegarde importée');
  } catch {
    toast("Ce fichier n'est pas une sauvegarde valide");
  }
});

function resetAll() {
  if (!confirm('Effacer toutes tes données (comptes, catégories, opérations) ? Pense à exporter une sauvegarde avant.')) return;
  state = defaultState();
  ui.hist = defaultHistFilters();
  save();
  applyTheme();
  render();
  toast('Données effacées');
}

/* ---------- Toast ---------- */
const toastEl = $('#toast');
let toastTimer = null;
function toast(message, action) {
  clearTimeout(toastTimer);
  toastEl.innerHTML = `<span>${esc(message)}</span>${action ? `<button>${esc(action.label)}</button>` : ''}`;
  toastEl.hidden = false;
  if (action) {
    toastEl.querySelector('button').onclick = () => {
      action.run();
      toastEl.hidden = true;
    };
  }
  toastTimer = setTimeout(() => (toastEl.hidden = true), action ? 5000 : 2200);
}

/* ---------- Événements ---------- */
document.addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (tab) return goto(tab.dataset.view);
  if (e.target.closest('#fab')) return openAdd('expense');
  if (e.target.closest('[data-close]')) return closeSheet();

  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const { action, id, value } = el.dataset;
  const d = sheet?.draft;

  switch (action) {
    case 'goto': return goto(el.dataset.view);
    case 'open-add': return openAdd('expense');
    case 'month-prev': ui.month = shiftMonth(ui.month, -1); return render();
    case 'month-next': ui.month = shiftMonth(ui.month, 1); return render();
    case 'edit-tx': return openEditTx(id);
    case 'cat-filter':
      ui.hist = { ...defaultHistFilters(), categoryId: id, open: true };
      return goto('history');
    case 'hist-period': ui.hist.period = value; return render();
    case 'hist-type': ui.hist.type = value; return render();
    case 'toggle-filters': ui.hist.open = !ui.hist.open; return render();
    case 'reset-filters': ui.hist = { ...defaultHistFilters(), q: ui.hist.q, open: true }; return render();
    case 'edit-account': return openAccount(id);
    case 'add-account': return openAccount(null);
    case 'add-transfer':
      if (state.accounts.length < 2) return toast('Ajoute un deuxième compte pour faire un virement');
      return openAdd('transfer');
    case 'theme':
      state.settings.theme = value;
      save();
      applyTheme();
      return render();
    case 'edit-cat': return openCategory(id);
    case 'add-cat': return openCategory(null, el.dataset.kind);
    case 'export': return exportData();
    case 'import': return $('#import-file').click();
    case 'reset-all': return resetAll();
    case 'install':
      installPrompt?.prompt();
      installPrompt = null;
      return render();

    // Feuilles
    case 'close-sheet': return closeSheet();
    case 'tx-type':
      if (d.type === el.dataset.type) return;
      if (el.dataset.type === 'transfer' && state.accounts.length < 2) return toast('Ajoute un deuxième compte pour faire un virement');
      d.type = el.dataset.type;
      d.categoryId = null;
      if (d.type === 'transfer' && d.toAccountId === d.accountId) d.toAccountId = state.accounts.find((a) => a.id !== d.accountId).id;
      return renderSheet();
    case 'pick-cat':
      d.categoryId = id;
      sheetBody.querySelectorAll('.cat-btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === id)));
      return;
    case 'key': return keyInput(el.dataset.key);
    case 'save-tx': return saveTx();
    case 'delete-tx': return deleteTx();
    case 'pick-color':
      d.color = el.dataset.color;
      sheetBody.querySelectorAll('.swatch').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.color === d.color)));
      if ($('#cat-preview')) $('#cat-preview').innerHTML = catIcon(d, 56);
      return;
    case 'pick-emoji':
      d.icon = el.dataset.emoji;
      sheetBody.querySelectorAll('.emoji-grid button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.emoji === d.icon)));
      $('#cat-preview').innerHTML = catIcon(d, 56);
      return;
    case 'cat-kind':
      d.kind = el.dataset.type;
      sheetBody.querySelectorAll('[data-action="cat-kind"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.type === d.kind)));
      return;
    case 'acc-sign': {
      const neg = el.getAttribute('aria-pressed') !== 'true';
      el.setAttribute('aria-pressed', String(neg));
      el.classList.toggle('neg', neg);
      el.textContent = neg ? '−' : '+';
      const input = $('#acc-initial');
      input.value = input.value.replace(/^[-+]\s*/, '');
      return;
    }
    case 'acc-save': return saveAccount();
    case 'acc-delete': return deleteAccount();
    case 'cat-save': return saveCategory();
    case 'cat-delete': return deleteCategory();
    case 'stats-range': ui.statsRange = Number(value); return render();
    case 'csv-export': return exportCsv();
    default: planAction(action, el, d) || csvAction(action, el, d) || lockAction(action, el);
  }
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'hist-q') {
    ui.hist.q = t.value;
    $('#hist-results').innerHTML = renderHistoryResults();
  } else if (t.dataset.hist && (t.dataset.hist === 'min' || t.dataset.hist === 'max')) {
    ui.hist[t.dataset.hist] = t.value;
    $('#hist-results').innerHTML = renderHistoryResults();
  } else if (t.dataset.draft && sheet) {
    sheet.draft[t.dataset.draft] = t.type === 'checkbox' ? t.checked : t.value;
  }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (csvChange(t)) return;
  if (t.hasAttribute('data-budget-copy')) return toggleBudgetCopy(t.checked);
  if (t.dataset.hist && t.tagName === 'SELECT') {
    ui.hist[t.dataset.hist] = t.value;
    render();
  } else if (t.dataset.draft && sheet) {
    sheet.draft[t.dataset.draft] = t.type === 'checkbox' ? t.checked : t.value;
  }
});

document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
  // Écran verrouillé ou saisie du code : seul le pavé du code répond
  const pinTarget = lockState.locked ? lockKey : sheet?.kind === 'pin' ? pinKey : null;
  if (pinTarget && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (/^\d$/.test(e.key)) { e.preventDefault(); pinTarget(e.key); return; }
    if (e.key === 'Backspace') { e.preventDefault(); pinTarget('back'); return; }
  }
  if (lockState.locked) return;
  if (e.key === 'Escape' && sheet) {
    e.preventDefault();
    return closeSheet();
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (sheet?.kind === 'tx' && !typing) {
    if (/^\d$/.test(e.key)) { e.preventDefault(); return keyInput(e.key); }
    if (e.key === ',' || e.key === '.') { e.preventDefault(); return keyInput(','); }
    if (e.key === 'Backspace') { e.preventDefault(); return keyInput('back'); }
    if (e.key === 'Enter' && !e.target.closest('button')) { e.preventDefault(); return saveTx(); }
  }
  if (!sheet && !typing && (e.key === 'n' || e.key === 'N' || e.key === '+')) {
    e.preventDefault();
    openAdd('expense');
  }
});

window.addEventListener('hashchange', () => {
  const v = location.hash.slice(1);
  if (VIEWS[v] && v !== ui.view) goto(v);
});

// Synchronisation entre onglets ouverts
window.addEventListener('storage', (e) => {
  if (e.key !== STORAGE_KEY) return;
  state = load();
  applyTheme();
  render();
});

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  if (ui.view === 'settings') render();
});

// Appli laissée ouverte : ajoute les échéances arrivées quand on y revient
// et reverrouille si l'appli est restée plus d'une minute en arrière-plan
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    hiddenAt = Date.now();
    return;
  }
  if (state.settings.pin && !lockState.locked && hiddenAt && Date.now() - hiddenAt > RELOCK_AFTER_MS) showLock();
  if (runRecurring()) render();
});

// Les graphiques sont dessinés à la largeur réelle : on redessine au redimensionnement
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (ui.view === 'stats') hydrateCharts(); }, 120);
});

/* ---------- Démarrage ---------- */
applyTheme();
setupChartTooltip();
const startCreated = runRecurring();
render();
if (state.settings.pin) showLock();
if (startCreated) toast(`${startCreated} opération${startCreated > 1 ? 's' : ''} récurrente${startCreated > 1 ? 's' : ''} ajoutée${startCreated > 1 ? 's' : ''}`);
if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !PROFILE) {
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker non enregistré', err));
}
