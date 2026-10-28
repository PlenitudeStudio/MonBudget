'use strict';

/* =========================================================
   Lot 2 : budgets par catégorie, objectifs d'épargne,
   opérations récurrentes. Chargé avant app.js : ce fichier ne
   contient que des déclarations (rien ne s'exécute au chargement).
   ========================================================= */

const FREQUENCIES = {
  weekly: 'Chaque semaine',
  monthly: 'Chaque mois',
  quarterly: 'Chaque trimestre',
  yearly: 'Chaque année',
};
const PER_YEAR = { weekly: 52, monthly: 12, quarterly: 4, yearly: 1 };
const PLAN_TABS = { budgets: 'Budgets', goals: 'Épargne', recurring: 'Récurrents' };

/* ---------- Dates des échéances ---------- */
function addPeriod(iso, freq, anchorDay) {
  const d = parseISO(iso);
  if (freq === 'weekly') {
    d.setDate(d.getDate() + 7);
    return toISO(d);
  }
  const months = freq === 'quarterly' ? 3 : freq === 'yearly' ? 12 : 1;
  const y = d.getFullYear();
  const m = d.getMonth() + months;
  const lastDay = new Date(y, m + 1, 0).getDate();
  return toISO(new Date(y, m, Math.min(anchorDay || d.getDate(), lastDay)));
}

const monthlyEquivalent = (r) => Math.round((r.amount * (PER_YEAR[r.frequency] || 12)) / 12);
const yearlyEquivalent = (r) => r.amount * (PER_YEAR[r.frequency] || 12);

/* ---------- Opérations récurrentes ---------- */
function recIsValid(r) {
  if (!accById(r.accountId)) return false;
  if (r.type === 'transfer') return !!accById(r.toAccountId) && r.toAccountId !== r.accountId;
  const c = catById(r.categoryId);
  return !!c && c.kind === r.type;
}

function recName(r) {
  if (r.name) return r.name;
  if (r.type === 'transfer') return 'Virement';
  return catById(r.categoryId)?.name || 'Opération';
}

/** Crée les opérations dont l'échéance est passée. Renvoie le nombre créé. */
function runRecurring() {
  const today = todayISO();
  let created = 0;
  for (const r of state.recurring) {
    if (!r.active) continue;
    let guard = 0;
    while (r.nextDate <= today && guard++ < 400) {
      if (recIsValid(r)) {
        state.transactions.push({
          id: uid(), type: r.type, amount: r.amount,
          categoryId: r.type === 'transfer' ? null : r.categoryId,
          accountId: r.accountId, toAccountId: r.type === 'transfer' ? r.toAccountId : null,
          date: r.nextDate, note: r.name || '', createdAt: Date.now(), recurringId: r.id,
        });
        created++;
      }
      r.nextDate = addPeriod(r.nextDate, r.frequency, r.day);
    }
  }
  if (created) save();
  return created;
}

function upcomingRecurring(days) {
  const limit = parseISO(todayISO());
  limit.setDate(limit.getDate() + days);
  const max = toISO(limit);
  return state.recurring
    .filter((r) => r.active && r.nextDate <= max && recIsValid(r))
    .sort((a, b) => (a.nextDate < b.nextDate ? -1 : 1));
}

/* ---------- Budgets ---------- */
/** Index des dépenses : clé "categorie|AAAA-MM" -> centimes */
function spendIndex() {
  const idx = new Map();
  for (const t of state.transactions) {
    if (t.type !== 'expense') continue;
    const k = t.categoryId + '|' + monthOf(t.date);
    idx.set(k, (idx.get(k) || 0) + t.amount);
  }
  return idx;
}

/* Les budgets sont propres à chaque mois : state.budgets = { "AAAA-MM": { categorie: { amount, rollover } } } */
const monthBudgets = (m) => state.budgets[m] || {};
const monthHasBudgets = (m) => Object.keys(monthBudgets(m)).length > 0;
const hasAnyBudget = () => Object.keys(state.budgets).some(monthHasBudgets);
function setBudget(m, catId, b) {
  if (!state.budgets[m]) state.budgets[m] = {};
  state.budgets[m][catId] = b;
}
function removeBudget(m, catId) {
  if (!state.budgets[m]) return;
  delete state.budgets[m][catId];
  if (!monthHasBudgets(m)) delete state.budgets[m];
}

function budgetInfo(catId, month, idx = spendIndex(), depth = 0) {
  const b = monthBudgets(month)[catId];
  if (!b) return null;
  const spentOf = (m) => idx.get(catId + '|' + m) || 0;
  // Report : on reprend le reste (ou le dépassement) du budget du mois précédent, s'il existe
  let carry = 0;
  if (b.rollover && depth < 36) {
    const prev = budgetInfo(catId, shiftMonth(month, -1), idx, depth + 1);
    if (prev) carry = prev.left;
  }
  const available = b.amount + carry;
  const spent = spentOf(month);
  const pct = available > 0 ? spent / available : spent > 0 ? Infinity : 0;
  return { amount: b.amount, rollover: !!b.rollover, carry, available, spent, left: available - spent, pct };
}

const budgetColor = (pct) => (pct > 1 ? 'var(--expense)' : pct >= 0.8 ? 'var(--warn)' : 'var(--income)');

function progressBar(pct, color) {
  const w = Math.max(0, Math.min(1, Number.isFinite(pct) ? pct : 1)) * 100;
  return `<div class="bar"><span style="width:${w.toFixed(1)}%;background:${color}"></span></div>`;
}

function averageSpend(catId, months = 3) {
  const idx = spendIndex();
  let total = 0;
  let m = currentMonth();
  for (let i = 0; i < months; i++) {
    m = shiftMonth(m, -1);
    total += idx.get(catId + '|' + m) || 0;
  }
  return Math.round(total / months);
}

/** Message d'alerte si l'ajout d'une dépense fait franchir 80 % ou 100 % du budget. */
function budgetAlert(catId, month, beforeIdx) {
  const before = budgetInfo(catId, month, beforeIdx);
  const after = budgetInfo(catId, month);
  if (!before || !after) return null;
  const name = catById(catId)?.name || '';
  if (after.pct > 1 && before.pct <= 1) return `Budget ${name} dépassé de ${money(-after.left)}`;
  if (after.pct >= 0.8 && before.pct < 0.8) return `${name} : ${Math.round(after.pct * 100)} % du budget utilisé`;
  return null;
}

/* ---------- Objectifs d'épargne ---------- */
const goalSaved = (g) => g.moves.reduce((s, m) => s + m.amount, 0);
const totalSaved = () => state.goals.reduce((s, g) => s + goalSaved(g), 0);

function monthsUntil(iso) {
  const now = parseISO(todayISO());
  const d = parseISO(iso);
  return (d.getFullYear() - now.getFullYear()) * 12 + (d.getMonth() - now.getMonth());
}

function goalPace(g) {
  const saved = goalSaved(g);
  const rest = g.target - saved;
  if (rest <= 0) return 'Objectif atteint 🎉';
  if (!g.deadline) return `Encore ${money(rest)}`;
  const months = monthsUntil(g.deadline);
  if (g.deadline < todayISO()) return `Échéance passée · encore ${money(rest)}`;
  if (months <= 0) return `Encore ${money(rest)} avant le ${shortDate(g.deadline)}`;
  return `${money(Math.ceil(rest / months))} / mois jusqu'en ${monthLabel(monthOf(g.deadline))}`;
}

function goalRow(g) {
  const saved = goalSaved(g);
  const pct = g.target > 0 ? saved / g.target : 0;
  return `<li class="goal">
    <button class="goal-main" data-action="edit-goal" data-id="${g.id}">
      ${catIcon(g)}
      <span class="grow">
        <span class="row-between"><strong class="ellipsis">${esc(g.name)}</strong><span class="muted small num">${Math.min(100, Math.round(pct * 100))} %</span></span>
        ${progressBar(pct, safeColor(g.color))}
        <span class="small num"><strong>${money(saved)}</strong> <span class="muted">sur ${money(g.target)}</span></span>
        <span class="muted small">${esc(goalPace(g))}</span>
      </span>
    </button>
    <button class="icon-btn small-btn" data-action="goal-move" data-id="${g.id}" aria-label="Mettre de l'argent de côté pour ${esc(g.name)}">＋</button>
  </li>`;
}

/* ---------- Écran Budget ---------- */
function renderPlan() {
  const tab = PLAN_TABS[ui.planTab] ? ui.planTab : 'budgets';
  const seg = Object.entries(PLAN_TABS)
    .map(([k, l]) => `<button data-action="plan-tab" data-value="${k}" aria-pressed="${tab === k}">${l}</button>`)
    .join('');
  const body = { budgets: renderBudgetsTab, goals: renderGoalsTab, recurring: renderRecurringTab }[tab]();
  return `<div class="seg" style="margin-bottom:14px">${seg}</div>${body}`;
}

function renderBudgetsTab() {
  const idx = spendIndex();
  const { income } = monthStats(ui.month);
  const expenseCats = state.categories.filter((c) => c.kind === 'expense');
  const withBudget = expenseCats
    .map((c) => ({ c, info: budgetInfo(c.id, ui.month, idx) }))
    .filter((x) => x.info)
    .sort((a, b) => b.info.pct - a.info.pct);
  const without = expenseCats.filter((c) => !monthBudgets(ui.month)[c.id]);
  const prevMonth = shiftMonth(ui.month, -1);
  const prevCount = Object.keys(monthBudgets(prevMonth)).length;
  const copied = !!state.budgetCopied[ui.month];

  let totalAvail = 0, totalSpent = 0, totalPlanned = 0;
  for (const { info } of withBudget) {
    totalAvail += info.available;
    totalSpent += info.spent;
    totalPlanned += info.amount;
  }
  const toAssign = income - totalPlanned;

  let html = monthSwitch();
  if (prevCount || copied) {
    html += `<label class="card toggle dup-toggle">
      <input type="checkbox" data-budget-copy ${copied ? 'checked' : ''}>
      <span><strong>Dupliquer le budget du mois précédent</strong><br>
      <span class="muted small">${prevCount
        ? `Reprend les ${prevCount} budget${prevCount > 1 ? 's' : ''} de ${esc(monthLabel(prevMonth))}. Tu pourras ensuite les ajuster.`
        : `Aucun budget en ${esc(monthLabel(prevMonth))}.`}</span></span>
    </label>`;
  }
  html += `<section class="card">
    <div class="stat-grid">
      <div><div class="k">Revenus du mois</div><div class="v num">${money(income)}</div></div>
      <div><div class="k">Budgété</div><div class="v num">${money(totalPlanned)}</div></div>
      <div><div class="k">${toAssign >= 0 ? 'Reste à répartir' : 'Budgété en trop'}</div><div class="v num" style="color:${toAssign >= 0 ? 'var(--income)' : 'var(--expense)'}">${money(Math.abs(toAssign))}</div></div>
    </div>
    ${withBudget.length ? `<div class="row-between small" style="margin-top:14px"><span class="muted">Dépensé sur les budgets</span><span class="num"><strong>${money(totalSpent)}</strong> / ${money(totalAvail)}</span></div>
    ${progressBar(totalAvail > 0 ? totalSpent / totalAvail : 0, budgetColor(totalAvail > 0 ? totalSpent / totalAvail : 0))}` : ''}
  </section>`;

  html += `<div class="section-title">Mes budgets <button class="link" data-action="budget-new-cat">+ Nouvelle catégorie</button></div>`;
  if (!withBudget.length) {
    html += `<section class="card empty"><span class="big">🎯</span>Aucun budget pour ${esc(monthLabel(ui.month))}.<br><span class="small">Choisis une catégorie ci-dessous ou crée la tienne.</span><br><button class="btn primary" style="margin-top:12px" data-action="budget-new-cat">+ Nouvelle catégorie</button></section>`;
  } else {
    html += `<section class="card" style="padding:4px 12px"><ul class="list">${withBudget
      .map(({ c, info }) => {
        const color = budgetColor(info.pct);
        const status = info.left >= 0 ? `Reste ${money(info.left)}` : `Dépassé de ${money(-info.left)}`;
        return `<li><button class="budget-row" data-action="edit-budget" data-id="${c.id}">
          ${catIcon(c)}
          <span class="grow">
            <span class="row-between"><strong class="ellipsis">${esc(c.name)}</strong><span class="num small"><strong>${money(info.spent)}</strong> <span class="muted">/ ${money(info.available)}</span></span></span>
            ${progressBar(info.pct, color)}
            <span class="row-between small"><span style="color:${color};font-weight:600">${status}</span>${info.carry ? `<span class="muted">${info.carry > 0 ? '+' : '−'}${money(Math.abs(info.carry))} reporté</span>` : ''}</span>
          </span>
        </button></li>`;
      })
      .join('')}</ul></section>`;
  }

  if (without.length) {
    html += `<div class="section-title">Sans budget</div>
    <section class="card" style="padding:4px 12px"><ul class="list">${without
      .map((c) => {
        const spent = idx.get(c.id + '|' + ui.month) || 0;
        return `<li><button class="list-item" data-action="edit-budget" data-id="${c.id}">
          <span class="left">${catIcon(c, 34)}<span><span class="ellipsis" style="display:block">${esc(c.name)}</span><span class="muted small">${spent ? money(spent) + ' ce mois-ci' : 'Aucune dépense ce mois-ci'}</span></span></span>
          <span class="link">Définir</span>
        </button></li>`;
      })
      .join('')}</ul></section>`;
  }
  return html;
}

function renderGoalsTab() {
  const saved = totalSaved();
  const target = state.goals.reduce((s, g) => s + g.target, 0);
  let html = `<section class="card hero">
    <div class="label">Argent mis de côté</div>
    <div class="amount num" style="margin-bottom:6px">${money(saved)}</div>
    <div class="small" style="opacity:.85">${state.goals.length ? `sur ${money(target)} d'objectifs` : 'Crée un objectif pour commencer'}</div>
  </section>`;
  html += `<div class="section-title">Mes objectifs <button class="link" data-action="add-goal">+ Nouvel objectif</button></div>`;
  if (!state.goals.length) {
    html += `<section class="card empty"><span class="big">🐷</span>Vacances, fonds d'urgence, nouvel ordi…<br><button class="btn primary" style="margin-top:12px" data-action="add-goal">Créer un objectif</button></section>`;
  } else {
    html += `<section class="card" style="padding:4px 12px"><ul class="list">${state.goals.map(goalRow).join('')}</ul></section>`;
  }
  html += `<p class="muted small" style="margin:14px 4px">L'argent mis de côté reste sur tes comptes : un objectif sert à le réserver pour un projet et à suivre ta progression.</p>`;
  return html;
}

function recRow(r) {
  const cat = r.type === 'transfer' ? null : catById(r.categoryId);
  const icon =
    r.type === 'transfer'
      ? `<span class="cat-ico" style="background:var(--surface-2);color:var(--transfer)">⇄</span>`
      : catIcon(cat);
  const sub = `${FREQUENCIES[r.frequency] || ''} · ${r.active ? 'prochaine le ' + shortDate(r.nextDate) : 'en pause'}`;
  return `<li><button class="tx ${r.active ? '' : 'paused'}" data-action="edit-rec" data-id="${r.id}">
    ${icon}
    <span class="main"><span class="t1">${esc(recName(r))}</span><span class="t2">${esc(sub)}</span></span>
    <span class="amt num ${r.type}" style="text-align:right">${signedMoney(r.amount, r.type)}${r.frequency !== 'monthly' ? `<span class="t2" style="font-weight:500">${money(monthlyEquivalent(r))}/mois</span>` : ''}</span>
  </button></li>`;
}

function renderRecurringTab() {
  const active = state.recurring.filter((r) => r.active);
  const fixedOut = active.filter((r) => r.type === 'expense').reduce((s, r) => s + monthlyEquivalent(r), 0);
  const fixedIn = active.filter((r) => r.type === 'income').reduce((s, r) => s + monthlyEquivalent(r), 0);
  const subsCat = state.categories.find((c) => norm(c.name) === 'abonnements');
  const subs = active.filter((r) => r.type === 'expense' && subsCat && r.categoryId === subsCat.id);
  const subsYear = subs.reduce((s, r) => s + yearlyEquivalent(r), 0);

  let html = `<section class="card"><div class="stat-grid">
    <div><div class="k">Charges fixes</div><div class="v num">${money(fixedOut)}<span class="muted small">/mois</span></div></div>
    <div><div class="k">Revenus fixes</div><div class="v num">${money(fixedIn)}<span class="muted small">/mois</span></div></div>
    <div><div class="k">Abonnements</div><div class="v num">${money(subsYear)}<span class="muted small">/an</span></div></div>
  </div></section>`;

  const upcoming = upcomingRecurring(30);
  if (upcoming.length) {
    html += `<div class="section-title">À venir (30 jours)</div>
    <section class="card" style="padding:6px 12px"><ul class="list">${upcoming
      .slice(0, 6)
      .map(
        (r) => `<li><div class="list-item" style="cursor:default"><span class="left"><span class="date-pill">${esc(shortDate(r.nextDate))}</span><span class="ellipsis">${esc(recName(r))}</span></span><span class="amt num ${r.type}">${signedMoney(r.amount, r.type)}</span></div></li>`
      )
      .join('')}</ul></section>`;
  }

  html += `<div class="section-title">Mes opérations récurrentes <button class="link" data-action="add-rec">+ Ajouter</button></div>`;
  if (!state.recurring.length) {
    html += `<section class="card empty"><span class="big">🔁</span>Loyer, salaire, abonnements, épargne automatique…<br><span class="small">Elles seront ajoutées toutes seules à chaque échéance.</span><br><button class="btn primary" style="margin-top:12px" data-action="add-rec">Ajouter une opération récurrente</button></section>`;
  } else {
    const groups = [
      ['expense', 'Dépenses'],
      ['income', 'Revenus'],
      ['transfer', 'Virements'],
    ];
    for (const [type, label] of groups) {
      const list = state.recurring.filter((r) => r.type === type).sort((a, b) => b.active - a.active || (a.nextDate < b.nextDate ? -1 : 1));
      if (!list.length) continue;
      html += `<div class="day-head"><span>${label}</span></div>
      <section class="card" style="padding:6px 12px;margin-bottom:6px"><ul class="tx-list">${list.map(recRow).join('')}</ul></section>`;
    }
  }
  return html;
}

/* ---------- Fenêtres de l'accueil ---------- */
/** Budgets du mois affiché : marge globale, dépassements, enveloppes par catégorie. */
function homeBudgetsCard() {
  const idx = spendIndex();
  const list = state.categories
    .filter((c) => c.kind === 'expense' && monthBudgets(ui.month)[c.id])
    .map((c) => ({ c, info: budgetInfo(c.id, ui.month, idx) }))
    .sort((a, b) => b.info.available - a.info.available);
  const base = { cls: 'home-budgets', color: 'yellow', icon: 'wallet', title: 'Budgets par catégorie' };
  if (!list.length) {
    return win({
      ...base,
      link: `<button class="win-link" data-action="goto-plan" data-value="budgets">Créer →</button>`,
      body: `<p class="note">Aucun budget pour ${esc(monthLabel(ui.month))}. Fixe un plafond par catégorie pour savoir combien il te reste à dépenser.</p>
        <button class="btn primary" data-action="goto-plan" data-value="budgets">Créer un budget</button>`,
    });
  }
  let avail = 0, spent = 0;
  for (const { info } of list) {
    avail += info.available;
    spent += info.spent;
  }
  const margin = avail - spent;
  const over = list.filter((x) => x.info.left < 0).length;
  const MAX = 6;
  const items = list
    .slice(0, MAX)
    .map(({ c, info }) => {
      const isOver = info.left < 0;
      const pct = Number.isFinite(info.pct) ? Math.round(info.pct * 100) + ' %' : '—';
      return `<li><button class="env" data-action="edit-budget" data-id="${c.id}">
        <span class="env-head"><span class="env-name"><i style="background:${safeColor(c.color)}"></i><strong class="ellipsis">${esc(c.name)}</strong></span><span class="note num">${money(info.spent)} / ${money(info.available)}</span></span>
        ${progressBar(info.pct, isOver ? 'var(--expense)' : safeColor(c.color))}
        <span class="env-foot${isOver ? ' over' : ''}"><span>${isOver ? '⚠ Dépassement de ' + money(-info.left) : money(info.left) + ' restants'}</span><span class="num">${pct}</span></span>
      </button></li>`;
    })
    .join('');
  return win({
    ...base,
    link: `<button class="win-link" data-action="goto-plan" data-value="budgets">Ajuster →</button>`,
    body: `<div class="budget-sum">
        <div><strong class="sum-v num">${margin >= 0 ? money(margin) + ' de marge' : money(-margin) + ' de dépassement'}</strong>
        <span class="note num">${money(spent)} dépensés sur ${money(avail)} prévus</span></div>
        ${over ? `<span class="pill-alert">⚠ ${over} dépassement${over > 1 ? 's' : ''}</span>` : ''}
      </div>
      <ul class="env-grid">${items}</ul>
      ${list.length > MAX ? `<button class="link small" data-action="goto-plan" data-value="budgets">+ ${list.length - MAX} autre${list.length - MAX > 1 ? 's' : ''} budget${list.length - MAX > 1 ? 's' : ''}</button>` : ''}`,
  });
}

/** Objectifs d'épargne (3 au plus) et épargne non affectée. */
function homeGoalsCard(g) {
  const base = { cls: 'home-goals', color: 'teal', icon: 'flag', title: "Objectifs d'épargne" };
  if (!state.goals.length) {
    return win({
      ...base,
      link: `<button class="win-link" data-action="goto-plan" data-value="goals">Gérer →</button>`,
      body: `<p class="note">Vacances, coussin de sécurité, nouvel ordi… Réserve de l'argent pour un projet et suis ta progression.</p>
        <button class="btn primary" data-action="add-goal">Créer un objectif</button>`,
    });
  }
  const top = [...state.goals]
    .sort((a, b) => (goalSaved(a) >= a.target) - (goalSaved(b) >= b.target) || (a.deadline || '9').localeCompare(b.deadline || '9'))
    .slice(0, 3);
  const rows = top
    .map((goal) => {
      const saved = goalSaved(goal);
      const pct = goal.target > 0 ? saved / goal.target : 0;
      return `<li><button class="goal-home" data-action="edit-goal" data-id="${goal.id}">
        <span class="goal-top"><span class="sym">${esc(goal.icon || '🐷')}</span>
          <span class="grow"><strong class="ellipsis">${esc(goal.name)}</strong><span class="note num">${money(saved)} / ${money(goal.target)}</span></span>
          <span class="chev">${ICON.right}</span></span>
        ${progressBar(pct, safeColor(goal.color))}
        <span class="note num">${pct >= 1 ? 'Objectif atteint 🎉' : `${Math.round(pct * 100)} % atteints · encore ${money(goal.target - saved)}`}</span>
      </button></li>`;
    })
    .join('');
  const free = g.savingsTotal - totalSaved();
  return win({
    ...base,
    link: `<button class="win-link" data-action="goto-plan" data-value="goals">Gérer →</button>`,
    body: `<p class="note">Petit à petit, tes projets prennent forme.</p>
      <ul class="goals-home">${rows}</ul>
      ${state.goals.length > 3 ? `<button class="link small" data-action="goto-plan" data-value="goals">Voir les ${state.goals.length} objectifs</button>` : ''}
      ${g.savings.length && free > 0 ? `<div class="free-line"><span class="note">Épargne non affectée</span><strong class="num pos">${money(free)}</strong></div>` : ''}`,
  });
}

/** Opérations récurrentes des 7 prochains jours. */
function homeUpcomingCard() {
  const upcoming = upcomingRecurring(7);
  if (!upcoming.length) return '';
  return win({
    cls: 'home-upcoming',
    color: 'terra',
    icon: 'clock',
    title: 'Prochains 7 jours',
    link: `<button class="win-link" data-action="goto-plan" data-value="recurring">Voir →</button>`,
    body: `<ul class="list">${upcoming
      .slice(0, 4)
      .map(
        (r) => `<li><div class="list-item" style="cursor:default"><span class="left"><span class="date-pill">${esc(shortDate(r.nextDate))}</span><span class="ellipsis">${esc(recName(r))}</span></span><span class="amt num ${r.type}">${signedMoney(r.amount, r.type)}</span></div></li>`
      )
      .join('')}</ul>`,
  });
}

/* ---------- Feuilles : budget ---------- */
function openBudget(catId) {
  const c = catById(catId);
  if (!c) return;
  const month = ui.month;
  const b = monthBudgets(month)[catId];
  openSheet('budget', {
    catId, month, name: c.name, icon: c.icon, color: c.color,
    amountStr: b ? centsToInput(b.amount) : '', rollover: b ? !!b.rollover : false, avg: averageSpend(catId),
  });
}

/** « + » de l'onglet Budgets : nouvelle catégorie de dépense avec son budget du mois. */
function openNewBudgetCategory() {
  const used = new Set(state.categories.map((c) => c.color));
  openSheet('budget', {
    catId: null, month: ui.month, name: '', icon: '📦', color: PALETTE.find((p) => !used.has(p)) || PALETTE[0],
    amountStr: '', rollover: false, avg: 0,
  });
}

function budgetSheet(d) {
  const info = d.catId ? budgetInfo(d.catId, d.month) : null;
  const exists = !!(d.catId && monthBudgets(d.month)[d.catId]);
  const title = !d.catId ? 'Nouvelle catégorie' : exists ? 'Modifier le budget' : 'Nouveau budget';
  return `${sheetHead(title)}
    <div class="row-center" style="margin-bottom:4px"><span id="cat-preview">${catIcon(d, 48)}</span></div>
    <p class="muted small" style="text-align:center;margin:0 0 14px">Budget de ${esc(monthLabel(d.month))}</p>
    <div class="row2">
      <label class="field"><span>Nom de la catégorie</span><input class="input" data-draft="name" maxlength="30" value="${esc(d.name)}" placeholder="Ex. Animaux"></label>
      <label class="field"><span>Plafond du mois (€)</span><input class="input" data-draft="amountStr" inputmode="decimal" placeholder="Ex. 300" value="${esc(d.amountStr)}"></label>
    </div>
    <details class="field cat-style" ${d.catId ? '' : 'open'}><summary><strong>Icône et couleur</strong></summary>
      <div class="emoji-grid" style="margin:8px 0 10px">${EMOJIS.map(
        (e) => `<button data-action="pick-emoji" data-emoji="${e}" aria-pressed="${d.icon === e}">${e}</button>`
      ).join('')}</div>
      <div class="swatches">${PALETTE.map(
        (c) => `<button class="swatch" style="background:${c}" data-action="pick-color" data-color="${c}" aria-label="Couleur ${c}" aria-pressed="${d.color === c}"></button>`
      ).join('')}</div>
    </details>
    ${d.avg > 0 ? `<button class="chip" style="margin-bottom:12px" data-action="budget-suggest">Moyenne des 3 derniers mois : ${money(d.avg)}</button>` : ''}
    <label class="toggle"><input type="checkbox" data-draft="rollover" ${d.rollover ? 'checked' : ''}><span><strong>Reprendre le reste du mois précédent</strong><br><span class="muted small">Ajoute ce qui n'a pas été dépensé le mois d'avant (ou retire le dépassement), si cette catégorie y avait un budget.</span></span></label>
    ${info ? `<p class="muted small">${money(info.spent)} dépensés sur ${money(info.available)}${info.carry ? ` (dont ${info.carry > 0 ? '+' : '−'}${money(Math.abs(info.carry))} reportés)` : ''}.</p>` : ''}
    <div class="btn-row">
      ${exists ? '<button class="btn danger" data-action="budget-delete">Retirer</button>' : ''}
      <button class="btn primary" data-action="budget-save">Enregistrer</button>
    </div>`;
}

function saveBudget() {
  const d = sheet.draft;
  const name = (d.name || '').trim();
  const amount = parseAmount(d.amountStr);
  if (!name) return toast('Donne un nom à la catégorie');
  const twin = state.categories.find((c) => c.kind === 'expense' && c.id !== d.catId && norm(c.name) === norm(name));
  if (twin) return toast(`La catégorie « ${twin.name} » existe déjà`);
  if (Number.isNaN(amount) || amount <= 0) return toast('Saisis un plafond supérieur à 0');
  const isNew = !d.catId;
  if (isNew) {
    d.catId = uid();
    state.categories.push({ id: d.catId, name, icon: d.icon, color: safeColor(d.color), kind: 'expense', fallback: false });
  } else {
    Object.assign(catById(d.catId), { name, icon: d.icon, color: safeColor(d.color) });
  }
  const prev = monthBudgets(d.month)[d.catId];
  setBudget(d.month, d.catId, { amount, rollover: !!d.rollover });
  save();
  closeSheet();
  render();
  toast(isNew ? `Catégorie « ${name} » créée avec son budget` : prev ? 'Budget modifié' : `Budget créé pour ${monthLabel(d.month)}`);
}

function deleteBudget() {
  const d = sheet.draft;
  const removed = monthBudgets(d.month)[d.catId];
  removeBudget(d.month, d.catId);
  save();
  closeSheet();
  render();
  toast('Budget retiré', { label: 'Annuler', run: () => { setBudget(d.month, d.catId, removed); save(); render(); } });
}

/** Case « Dupliquer le budget du mois précédent » de l'onglet Budgets. */
function toggleBudgetCopy(on) {
  const m = ui.month;
  const prev = shiftMonth(m, -1);
  if (on) {
    let n = 0;
    for (const [catId, b] of Object.entries(monthBudgets(prev))) {
      if (!catById(catId) || monthBudgets(m)[catId]) continue;
      setBudget(m, catId, { ...b });
      n++;
    }
    state.budgetCopied[m] = true;
    save();
    render();
    toast(n ? `${n} budget${n > 1 ? 's' : ''} repris de ${monthLabel(prev)}` : 'Budgets déjà en place');
    return;
  }
  if (monthHasBudgets(m) && !confirm(`Retirer tous les budgets de ${monthLabel(m)} ?`)) {
    render();
    return;
  }
  delete state.budgets[m];
  delete state.budgetCopied[m];
  save();
  render();
  toast(`Budgets de ${monthLabel(m)} retirés`);
}

/* ---------- Feuilles : objectifs ---------- */
function openGoal(id) {
  const g = id ? state.goals.find((x) => x.id === id) : null;
  openSheet('goal', g
    ? { id: g.id, name: g.name, icon: g.icon, color: g.color, targetStr: centsToInput(g.target), deadline: g.deadline || '', initialStr: '' }
    : { id: null, name: '', icon: '🏖️', color: PALETTE[0], targetStr: '', deadline: '', initialStr: '' });
}

function goalSheet(d) {
  const g = d.id ? state.goals.find((x) => x.id === d.id) : null;
  let progress = '';
  if (g) {
    const saved = goalSaved(g);
    progress = `<section class="card" style="box-shadow:none;background:var(--surface-2)">
      <div class="row-between"><strong class="num">${money(saved)}</strong><span class="muted num">${Math.round((saved / g.target) * 100)} %</span></div>
      ${progressBar(saved / g.target, safeColor(g.color))}
      <div class="muted small">${esc(goalPace(g))}</div>
      <div class="btn-row" style="position:static;margin:10px 0 0;padding:0;background:none"><button class="btn primary" data-action="goal-move" data-id="${g.id}">Mettre de côté / retirer</button></div>
      ${g.moves.length ? `<ul class="list small" style="margin-top:8px">${[...g.moves]
        .sort((a, b) => (a.date < b.date ? 1 : -1))
        .slice(0, 8)
        .map((m) => `<li class="row-between" style="padding:6px 0;border-top:1px solid var(--border)"><span class="muted">${esc(shortDate(m.date))}</span><span class="num amt ${m.amount >= 0 ? 'income' : 'expense'}">${m.amount >= 0 ? '+' : '−'}${money(Math.abs(m.amount))}</span></li>`)
        .join('')}</ul>` : ''}
    </section>`;
  }
  return `${sheetHead(g ? esc(g.name) : 'Nouvel objectif')}
    ${progress}
    <div style="display:flex;justify-content:center;margin-bottom:12px" id="cat-preview">${catIcon(d, 56)}</div>
    <label class="field"><span>Nom</span><input class="input" data-draft="name" maxlength="40" value="${esc(d.name)}" placeholder="Ex. Vacances d'été"></label>
    <div class="row2">
      <label class="field"><span>Montant visé (€)</span><input class="input" data-draft="targetStr" inputmode="decimal" value="${esc(d.targetStr)}" placeholder="1 200"></label>
      <label class="field"><span>Pour le (facultatif)</span><input class="input" type="date" data-draft="deadline" value="${esc(d.deadline)}"></label>
    </div>
    ${g ? '' : `<label class="field"><span>Déjà mis de côté (€)</span><input class="input" data-draft="initialStr" inputmode="decimal" value="${esc(d.initialStr)}" placeholder="0"></label>`}
    <div class="field"><span>Icône</span><div class="emoji-grid">${EMOJIS.map(
      (e) => `<button data-action="pick-emoji" data-emoji="${e}" aria-pressed="${d.icon === e}">${e}</button>`
    ).join('')}</div></div>
    <div class="field"><span>Couleur</span><div class="swatches">${PALETTE.map(
      (c) => `<button class="swatch" style="background:${c}" data-action="pick-color" data-color="${c}" aria-label="Couleur ${c}" aria-pressed="${d.color === c}"></button>`
    ).join('')}</div></div>
    <div class="btn-row">
      ${g ? '<button class="btn danger" data-action="goal-delete">Supprimer</button>' : ''}
      <button class="btn primary" data-action="goal-save">Enregistrer</button>
    </div>`;
}

function saveGoal() {
  const d = sheet.draft;
  const name = d.name.trim();
  const target = parseAmount(d.targetStr);
  const initial = d.initialStr.trim() === '' ? 0 : parseAmount(d.initialStr);
  if (!name) return toast("Donne un nom à l'objectif");
  if (Number.isNaN(target) || target <= 0) return toast('Saisis un montant visé supérieur à 0');
  if (Number.isNaN(initial) || initial < 0) return toast('Montant déjà mis de côté invalide');
  if (d.id) {
    Object.assign(state.goals.find((g) => g.id === d.id), { name, icon: d.icon, color: safeColor(d.color), target, deadline: d.deadline || null });
  } else {
    state.goals.push({
      id: uid(), name, icon: d.icon, color: safeColor(d.color), target, deadline: d.deadline || null,
      moves: initial > 0 ? [{ id: uid(), amount: initial, date: todayISO() }] : [], createdAt: Date.now(),
    });
  }
  save();
  closeSheet();
  render();
  toast(d.id ? 'Objectif modifié' : 'Objectif créé');
}

function deleteGoal() {
  const id = sheet.draft.id;
  const i = state.goals.findIndex((g) => g.id === id);
  if (i < 0) return;
  const [removed] = state.goals.splice(i, 1);
  save();
  closeSheet();
  render();
  toast('Objectif supprimé', { label: 'Annuler', run: () => { state.goals.splice(i, 0, removed); save(); render(); } });
}

function openGoalMove(goalId) {
  const g = state.goals.find((x) => x.id === goalId);
  if (!g) return;
  if (sheet) closeSheet();
  openSheet('goalMove', { goalId, dir: 'in', amountStr: '', date: todayISO() });
}

function goalMoveSheet(d) {
  const g = state.goals.find((x) => x.id === d.goalId);
  const saved = goalSaved(g);
  return `${sheetHead(esc(g.name))}
    <div class="seg" style="margin-bottom:12px">
      <button data-action="move-dir" data-type="in" aria-pressed="${d.dir === 'in'}">Mettre de côté</button>
      <button data-action="move-dir" data-type="out" aria-pressed="${d.dir === 'out'}">Retirer</button>
    </div>
    <p class="muted small" style="margin-top:0">Déjà mis de côté : <strong class="num">${money(saved)}</strong> sur ${money(g.target)}${g.target > saved ? ` · encore ${money(g.target - saved)}` : ''}</p>
    <div class="row2">
      <label class="field"><span>Montant (€)</span><input class="input" data-draft="amountStr" inputmode="decimal" value="${esc(d.amountStr)}" placeholder="50" autofocus></label>
      <label class="field"><span>Date</span><input class="input" type="date" data-draft="date" value="${esc(d.date)}"></label>
    </div>
    ${g.target > saved ? `<button class="chip" data-action="move-fill" style="margin-bottom:8px">Compléter : ${money(g.target - saved)}</button>` : ''}
    <div class="btn-row"><button class="btn primary" data-action="move-save">Valider</button></div>`;
}

function saveGoalMove() {
  const d = sheet.draft;
  const g = state.goals.find((x) => x.id === d.goalId);
  const amount = parseAmount(d.amountStr);
  if (Number.isNaN(amount) || amount <= 0) return toast('Saisis un montant');
  if (!d.date) return toast('Choisis une date');
  if (d.dir === 'out' && amount > goalSaved(g)) return toast(`Tu ne peux pas retirer plus que ${money(goalSaved(g))}`);
  const before = goalSaved(g);
  g.moves.push({ id: uid(), amount: d.dir === 'out' ? -amount : amount, date: d.date });
  save();
  closeSheet();
  render();
  const after = goalSaved(g);
  if (before < g.target && after >= g.target) toast(`🎉 Objectif « ${g.name} » atteint !`);
  else toast(d.dir === 'out' ? `${money(amount)} retirés` : `${money(amount)} mis de côté`);
}

/* ---------- Feuilles : opérations récurrentes ---------- */
function openRec(id) {
  const r = id ? state.recurring.find((x) => x.id === id) : null;
  if (sheet) closeSheet();
  if (r) {
    openSheet('rec', { ...r, amountStr: centsToInput(r.amount), name: r.name || '' });
  } else {
    const accId = accById(state.settings.lastAccountId) ? state.settings.lastAccountId : state.accounts[0].id;
    const other = state.accounts.find((a) => a.id !== accId);
    openSheet('rec', {
      id: null, type: 'expense', name: '', amountStr: '', categoryId: '', accountId: accId,
      toAccountId: other ? other.id : accId, frequency: 'monthly', nextDate: todayISO(), active: true,
    });
  }
}

function recSheet(d) {
  const seg = (v, l) => `<button data-action="rec-type" data-type="${v}" aria-pressed="${d.type === v}">${l}</button>`;
  const cats = state.categories.filter((c) => c.kind === d.type);
  const linked = d.id ? state.transactions.filter((t) => t.recurringId === d.id).length : 0;
  const middle =
    d.type === 'transfer'
      ? `<div class="row2">
          <label class="field"><span>Depuis</span><select class="input" data-draft="accountId">${accountOptions(d.accountId)}</select></label>
          <label class="field"><span>Vers</span><select class="input" data-draft="toAccountId">${accountOptions(d.toAccountId)}</select></label>
        </div>`
      : `<div class="row2">
          <label class="field"><span>Catégorie</span><select class="input" data-draft="categoryId"><option value="">Choisir…</option>${cats
            .map((c) => `<option value="${c.id}" ${d.categoryId === c.id ? 'selected' : ''}>${esc(c.icon + ' ' + c.name)}</option>`)
            .join('')}</select></label>
          <label class="field"><span>Compte</span><select class="input" data-draft="accountId">${accountOptions(d.accountId)}</select></label>
        </div>`;
  return `${sheetHead(d.id ? "Modifier l'opération récurrente" : 'Nouvelle opération récurrente')}
    <div class="seg" style="margin-bottom:12px">${seg('expense', 'Dépense')}${seg('income', 'Revenu')}${seg('transfer', 'Virement')}</div>
    <div class="row2">
      <label class="field"><span>Nom</span><input class="input" data-draft="name" maxlength="40" value="${esc(d.name)}" placeholder="Ex. Loyer, Netflix"></label>
      <label class="field"><span>Montant (€)</span><input class="input" data-draft="amountStr" inputmode="decimal" value="${esc(d.amountStr)}" placeholder="0,00"></label>
    </div>
    ${middle}
    <div class="row2">
      <label class="field"><span>Fréquence</span><select class="input" data-draft="frequency">${Object.entries(FREQUENCIES)
        .map(([k, l]) => `<option value="${k}" ${d.frequency === k ? 'selected' : ''}>${l}</option>`)
        .join('')}</select></label>
      <label class="field"><span>Prochaine échéance</span><input class="input" type="date" data-draft="nextDate" value="${esc(d.nextDate)}"></label>
    </div>
    <label class="toggle"><input type="checkbox" data-draft="active" ${d.active ? 'checked' : ''}><span><strong>Active</strong><br><span class="muted small">Ajoutée automatiquement à chaque échéance. Décoche pour la mettre en pause.</span></span></label>
    ${linked ? `<p class="muted small">${linked} opération${linked > 1 ? 's' : ''} déjà créée${linked > 1 ? 's' : ''} : elles restent dans l'historique si tu modifies ou supprimes celle-ci.</p>` : ''}
    <div class="btn-row">
      ${d.id ? '<button class="btn danger" data-action="rec-delete">Supprimer</button>' : ''}
      <button class="btn primary" data-action="rec-save">Enregistrer</button>
    </div>`;
}

function saveRec() {
  const d = sheet.draft;
  const amount = parseAmount(d.amountStr);
  if (Number.isNaN(amount) || amount <= 0) return toast('Saisis un montant');
  if (!d.nextDate) return toast('Choisis la prochaine échéance');
  if (d.type === 'transfer') {
    if (d.accountId === d.toAccountId) return toast('Choisis deux comptes différents');
  } else if (!catById(d.categoryId) || catById(d.categoryId).kind !== d.type) {
    return toast('Choisis une catégorie');
  }
  const prev = d.id ? state.recurring.find((r) => r.id === d.id) : null;
  const rec = {
    id: d.id || uid(),
    type: d.type,
    name: d.name.trim(),
    amount,
    categoryId: d.type === 'transfer' ? null : d.categoryId,
    accountId: d.accountId,
    toAccountId: d.type === 'transfer' ? d.toAccountId : null,
    frequency: FREQUENCIES[d.frequency] ? d.frequency : 'monthly',
    day: prev && prev.nextDate === d.nextDate ? prev.day : parseISO(d.nextDate).getDate(),
    nextDate: d.nextDate,
    active: !!d.active,
  };
  if (prev) Object.assign(prev, rec);
  else state.recurring.push(rec);
  save();
  const created = runRecurring();
  closeSheet();
  render();
  toast(created ? `Enregistrée · ${created} opération${created > 1 ? 's' : ''} ajoutée${created > 1 ? 's' : ''}` : prev ? 'Opération récurrente modifiée' : 'Opération récurrente créée');
}

function deleteRec() {
  const id = sheet.draft.id;
  const i = state.recurring.findIndex((r) => r.id === id);
  if (i < 0) return;
  const [removed] = state.recurring.splice(i, 1);
  save();
  closeSheet();
  render();
  toast('Opération récurrente supprimée', { label: 'Annuler', run: () => { state.recurring.splice(i, 0, removed); save(); render(); } });
}

/* ---------- Actions de ce module (appelées par app.js) ---------- */
function planAction(action, el, d) {
  switch (action) {
    case 'plan-tab': ui.planTab = el.dataset.value; render(); return true;
    case 'goto-plan': ui.planTab = el.dataset.value || 'budgets'; goto('plan'); return true;
    case 'edit-budget': if (sheet) closeSheet(); openBudget(el.dataset.id); return true;
    case 'budget-new-cat': if (sheet) closeSheet(); openNewBudgetCategory(); return true;
    case 'budget-suggest':
      d.amountStr = centsToInput(d.avg);
      sheetBody.querySelector('[data-draft="amountStr"]').value = d.amountStr;
      return true;
    case 'budget-save': saveBudget(); return true;
    case 'budget-delete': deleteBudget(); return true;
    case 'add-goal': openGoal(null); return true;
    case 'edit-goal': openGoal(el.dataset.id); return true;
    case 'goal-save': saveGoal(); return true;
    case 'goal-delete': deleteGoal(); return true;
    case 'goal-move': openGoalMove(el.dataset.id); return true;
    case 'move-dir':
      d.dir = el.dataset.type;
      sheetBody.querySelectorAll('[data-action="move-dir"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.type === d.dir)));
      return true;
    case 'move-fill': {
      const g = state.goals.find((x) => x.id === d.goalId);
      d.dir = 'in';
      d.amountStr = centsToInput(g.target - goalSaved(g));
      renderSheet();
      return true;
    }
    case 'move-save': saveGoalMove(); return true;
    case 'add-rec': openRec(null); return true;
    case 'edit-rec': openRec(el.dataset.id); return true;
    case 'rec-type':
      if (d.type === el.dataset.type) return true;
      if (el.dataset.type === 'transfer' && state.accounts.length < 2) { toast('Ajoute un deuxième compte pour faire un virement'); return true; }
      d.type = el.dataset.type;
      d.categoryId = '';
      if (d.type === 'transfer' && d.toAccountId === d.accountId) d.toAccountId = state.accounts.find((a) => a.id !== d.accountId).id;
      renderSheet();
      return true;
    case 'rec-save': saveRec(); return true;
    case 'rec-delete': deleteRec(); return true;
  }
  return false;
}
