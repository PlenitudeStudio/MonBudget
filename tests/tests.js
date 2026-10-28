'use strict';

/* Suite de tests de bout en bout de Mon Budget.
   L'appli est chargée dans une iframe avec ?profil=test (stockage séparé). */

const TEST_KEY = 'monbudget.v1.test';
const REAL_KEY = 'monbudget.v1';
const frame = document.getElementById('app');
const list = document.getElementById('results');
const summary = document.getElementById('summary');
let W, D, errors = [], passed = 0, failed = 0;

/* ---------- Outils ---------- */
const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const app = (expr) => W.eval(expr);
const q = (sel) => D.querySelector(sel);
const qa = (sel) => [...D.querySelectorAll(sel)];
const txt = (s) => String(s ?? '').replace(/[\s  ]+/g, ' ').trim();

class AssertError extends Error {}
function assert(cond, msg) { if (!cond) throw new AssertError(msg); }
function eq(actual, expected, msg) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new AssertError(`${msg} — attendu ${JSON.stringify(expected)}, obtenu ${JSON.stringify(actual)}`);
}

function click(target) {
  const el = typeof target === 'string' ? q(target) : target;
  if (!el) throw new AssertError('Élément introuvable : ' + target);
  el.click();
}
function setVal(sel, value, evt = 'input') {
  const el = typeof sel === 'string' ? q(sel) : sel;
  if (!el) throw new AssertError('Champ introuvable : ' + sel);
  if (el.type === 'checkbox') el.checked = value;
  else el.value = value;
  el.dispatchEvent(new W.Event(evt, { bubbles: true }));
}
function enterAmount(s) { for (const ch of s) click(`[data-action="key"][data-key="${ch}"]`); }
const toastText = () => txt(q('#toast').textContent);
const catId = (name) => app(`state.categories.find(c => c.name === ${JSON.stringify(name)}).id`);
const accIds = () => app('state.accounts.map(a => a.id)');
const goto = (view) => click(`.tab[data-view="${view}"]`);
const S = () => JSON.parse(W.localStorage.getItem(TEST_KEY) || 'null');
const isoShift = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return app(`toISO(new Date(${d.getTime()}))`); };

async function loadApp(width = 375, height = 760, reset = false) {
  if (reset) {
    localStorage.removeItem(TEST_KEY);
    localStorage.removeItem(TEST_KEY + '.backups');
  }
  frame.style.width = width + 'px';
  frame.width = width;
  frame.height = height;
  await new Promise((res) => { frame.onload = res; frame.src = `../index.html?profil=test&t=${Date.now()}`; });
  W = frame.contentWindow;
  D = W.document;
  W.confirm = () => true;
  W.alert = () => {};
  W.addEventListener('error', (e) => errors.push(e.message));
  const origErr = W.console.error;
  W.console.error = (...a) => { errors.push(a.join(' ')); origErr.apply(W.console, a); };
  await wait(50);
}

/** Ajoute une opération par l'interface (bouton +, pavé, catégorie, enregistrer). */
function addTx({ type = 'expense', amount, cat, note = '', date, repeat }) {
  click('#fab');
  if (type !== 'expense') click(`[data-action="tx-type"][data-type="${type}"]`);
  enterAmount(amount);
  if (cat) click(`[data-action="pick-cat"][data-id="${catId(cat)}"]`);
  if (note) setVal('[data-draft="note"]', note);
  if (date) setVal('[data-draft="date"]', date);
  if (repeat) setVal('[data-draft="repeat"]', repeat, 'change');
  click('[data-action="save-tx"]');
}

/* ---------- Mini-framework ---------- */
const tests = [];
const group = (name) => tests.push({ group: name });
const test = (name, fn) => tests.push({ name, fn });

function report(name, ok, err) {
  const li = document.createElement('li');
  li.className = ok ? 'ok' : 'ko';
  li.textContent = (ok ? '✔ ' : '✘ ') + name;
  if (!ok) {
    const s = document.createElement('span');
    s.className = 'err';
    s.textContent = err instanceof AssertError ? err.message : String(err && err.stack ? err.stack.split('\n').slice(0, 2).join(' ') : err);
    li.appendChild(s);
  }
  list.appendChild(li);
  list.scrollTop = list.scrollHeight;
}

async function runAll() {
  list.innerHTML = '';
  passed = failed = 0;
  errors = [];
  const realBefore = localStorage.getItem(REAL_KEY);
  summary.textContent = 'En cours…';
  for (const t of tests) {
    if (t.group) {
      const li = document.createElement('li');
      li.className = 'group';
      li.textContent = t.group;
      list.appendChild(li);
      continue;
    }
    try {
      await t.fn();
      passed++;
      report(t.name, true);
    } catch (e) {
      failed++;
      report(t.name, false, e);
    }
  }
  // Vérifications finales
  try {
    eq(localStorage.getItem(REAL_KEY), realBefore, 'Les vraies données ne doivent pas changer');
    passed++; report('Isolation : les vraies données sont intactes', true);
  } catch (e) { failed++; report('Isolation : les vraies données sont intactes', false, e); }
  try {
    eq(errors, [], 'Erreurs JavaScript pendant les tests');
    passed++; report('Aucune erreur JavaScript', true);
  } catch (e) { failed++; report('Aucune erreur JavaScript', false, e); }
  localStorage.removeItem(TEST_KEY);
  localStorage.removeItem(TEST_KEY + '.backups');
  summary.textContent = `${passed} réussis · ${failed} échoué${failed > 1 ? 's' : ''}`;
  summary.style.color = failed ? 'var(--ko)' : 'var(--ok)';
  window.__testResult = { passed, failed };
}

/* =========================================================
   Scénarios
   ========================================================= */
group('Démarrage');
test('Données par défaut : 3 comptes, 16 catégories, accueil affiché', async () => {
  await loadApp(375, 760, true);
  eq(app('state.accounts.length'), 3, 'comptes');
  eq(app('state.categories.length'), 16, 'catégories');
  eq(txt(q('#title').textContent), 'Accueil', 'titre');
  assert(q('.hero'), 'carte de solde absente');
  assert(txt(q('.tip').textContent).includes('Bienvenue'), 'message de bienvenue absent');
  assert(!q('.recap'), 'pas de récap du mois sans montant saisi');
  assert(txt(q('.savings-card').textContent).includes('Livret A'), 'panneau épargne avec le détail des livrets');
});

group('Ajout express');
test('Dépense via le pavé numérique', async () => {
  addTx({ amount: '42,5', cat: 'Courses', note: 'Leclerc' });
  const t = app('state.transactions[0]');
  eq([t.type, t.amount, t.note], ['expense', 4250, 'Leclerc'], 'opération');
  assert(toastText().includes('Dépense ajoutée'), 'toast : ' + toastText());
  assert(q('#sheet-root').hidden, 'la fenêtre doit se fermer');
});
test('Refus sans montant puis sans catégorie', async () => {
  click('#fab');
  click('[data-action="save-tx"]');
  eq(toastText(), 'Saisis un montant', 'sans montant');
  enterAmount('10');
  click('[data-action="save-tx"]');
  eq(toastText(), 'Choisis une catégorie', 'sans catégorie');
  click('[data-action="close-sheet"]');
  eq(app('state.transactions.length'), 1, 'rien ne doit être ajouté');
});
test('Pavé : virgule unique, 2 décimales max, effacement', async () => {
  click('#fab');
  enterAmount('12,,345');
  eq(app('sheet.draft.amountStr'), '12,34', 'saisie');
  click('[data-action="key"][data-key="back"]');
  eq(app('sheet.draft.amountStr'), '12,3', 'effacement');
  click('[data-action="close-sheet"]');
});
test('Saisie au clavier physique (chiffres + Entrée)', async () => {
  click('#fab');
  for (const k of ['7', ',', '5']) D.body.dispatchEvent(new W.KeyboardEvent('keydown', { key: k, bubbles: true }));
  eq(txt(q('#amount-display').textContent), '7,5 €', 'affichage');
  click(`[data-action="pick-cat"][data-id="${catId('Loisirs')}"]`);
  D.body.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  eq(app('state.transactions.length'), 2, 'ajout par Entrée');
});
test('Revenu et virement entre comptes', async () => {
  addTx({ type: 'income', amount: '2000', cat: 'Salaire' });
  click('#fab');
  click('[data-action="tx-type"][data-type="transfer"]');
  enterAmount('300');
  const [a0, a1] = accIds();
  setVal('[data-draft="toAccountId"]', a1, 'change');
  click('[data-action="save-tx"]');
  const bal = app('Object.fromEntries(balances())');
  eq(bal[a0], 200000 - 4250 - 750 - 30000, 'compte courant');
  eq(bal[a1], 30000, 'livret');
  eq(app('totalBalance()'), 200000 - 4250 - 750, 'solde total (virement neutre)');
});
test('Accueil : disponible, épargne et récap du mois séparés', async () => {
  goto('home');
  const hero = txt(q('.hero').textContent);
  assert(hero.includes('Disponible') && hero.includes('1 650,00'), 'disponible (courant + espèces) : ' + hero);
  assert(hero.includes('Compte courant') && hero.includes('Espèces'), 'détail des comptes disponibles');
  eq(txt(q('.savings-head .v').textContent), '300,00 €', 'épargne totale');
  const recap = txt(q('.recap').textContent);
  assert(recap.includes('2 000,00') && recap.includes('50,00'), 'récap du mois : ' + recap);
  click('[data-action="month-prev"]');
  assert(!q('.recap'), 'pas de récap pour un mois vide');
  click('[data-action="month-next"]');
});
test('Virement refusé vers le même compte', async () => {
  click('#fab');
  click('[data-action="tx-type"][data-type="transfer"]');
  enterAmount('5');
  setVal('[data-draft="toAccountId"]', accIds()[0], 'change');
  click('[data-action="save-tx"]');
  eq(toastText(), 'Choisis deux comptes différents', 'message');
  click('[data-action="close-sheet"]');
});

group('Historique');
test('Modifier une opération', async () => {
  goto('history');
  const btn = qa('[data-action="edit-tx"]').find((b) => b.textContent.includes('Leclerc'));
  click(btn);
  for (let i = 0; i < 6; i++) click('[data-action="key"][data-key="back"]');
  enterAmount('50');
  click('[data-action="save-tx"]');
  assert(app('state.transactions.some(t => t.note === "Leclerc" && t.amount === 5000)'), 'montant modifié');
});
test('Supprimer puis annuler', async () => {
  const n = app('state.transactions.length');
  click(qa('[data-action="edit-tx"]')[0]);
  click('[data-action="delete-tx"]');
  eq(app('state.transactions.length'), n - 1, 'suppression');
  click('#toast button');
  eq(app('state.transactions.length'), n, 'annulation');
});
test('Recherche (sans accents, montant)', async () => {
  setVal('#hist-q', 'leclerc');
  eq(qa('#hist-results [data-action="edit-tx"]').length, 1, 'recherche texte');
  setVal('#hist-q', '7,50');
  eq(qa('#hist-results [data-action="edit-tx"]').length, 1, 'recherche montant');
  setVal('#hist-q', '');
});
test('Filtres type, catégorie, montant, période', async () => {
  click('[data-action="hist-type"][data-value="income"]');
  eq(qa('#hist-results [data-action="edit-tx"]').length, 1, 'revenus');
  click('[data-action="hist-type"][data-value=""]');
  click('[data-action="toggle-filters"]');
  setVal('[data-hist="categoryId"]', catId('Courses'), 'change');
  eq(qa('#hist-results [data-action="edit-tx"]').length, 1, 'catégorie');
  click('[data-action="reset-filters"]');
  setVal('[data-hist="min"]', '100');
  eq(qa('#hist-results [data-action="edit-tx"]').length, 2, 'montant min 100 € (salaire + virement)');
  click('[data-action="reset-filters"]');
  click('[data-action="month-prev"]');
  eq(qa('#hist-results [data-action="edit-tx"]').length, 0, 'mois précédent vide');
  click('[data-action="hist-period"][data-value="all"]');
  eq(qa('#hist-results [data-action="edit-tx"]').length, 4, 'toutes périodes');
  click('[data-action="hist-period"][data-value="month"]');
  click('[data-action="month-next"]');
});
test('Total de la liste : seulement les montants non nuls, sans couleur', async () => {
  click('[data-action="hist-type"][data-value="expense"]');
  const sum = txt(q('.summary-row').textContent);
  assert(!sum.includes('+0,00') && !sum.includes('+'), 'pas de « +0,00 » : ' + sum);
  assert(!q('.summary-row .amt'), 'pas de montant coloré');
  click('[data-action="hist-type"][data-value=""]');
});

group('Comptes et catégories');
test('Ajouter un compte avec solde de départ', async () => {
  goto('accounts');
  click('[data-action="add-account"]');
  setVal('#acc-name', 'Compte joint');
  setVal('#acc-initial', '1 250,75');
  click('[data-action="acc-save"]');
  const a = app('state.accounts.at(-1)');
  eq([a.name, a.initial], ['Compte joint', 125075], 'compte créé');
});
test('Solde de départ négatif (bouton ± et signe tapé)', async () => {
  click('[data-action="add-account"]');
  setVal('#acc-name', 'Découvert');
  setVal('#acc-initial', '250,40');
  click('[data-action="acc-sign"]');
  eq(txt(q('[data-action="acc-sign"]').textContent), '−', 'bouton sur −');
  click('[data-action="acc-save"]');
  eq(app('state.accounts.at(-1).initial'), -25040, 'solde négatif enregistré');
  assert(q('.acc .bal.neg'), 'solde affiché en négatif');
  click(qa('[data-action="edit-account"]').at(-1));
  eq(q('[data-action="acc-sign"]').getAttribute('aria-pressed'), 'true', 'signe conservé à la modification');
  eq(q('#acc-initial').value, '250,40', 'montant sans le signe');
  click('[data-action="acc-sign"]');
  setVal('#acc-initial', '-12');
  click('[data-action="acc-save"]');
  eq(app('state.accounts.at(-1).initial'), -1200, '« - » tapé au clavier');
  click(qa('[data-action="edit-account"]').at(-1));
  click('[data-action="acc-delete"]');
  eq(app('state.accounts.length'), 4, 'compte de test supprimé');
});
test('Suppression bloquée si le compte est utilisé, autorisée sinon', async () => {
  click(qa('[data-action="edit-account"]')[0]);
  assert(q('[data-action="acc-delete"]').disabled, 'le compte courant ne doit pas être supprimable');
  click('[data-action="close-sheet"]');
  click(qa('[data-action="edit-account"]').at(-1));
  click('[data-action="acc-delete"]');
  eq(app('state.accounts.length'), 3, 'compte supprimé');
});
test('Créer, renommer et supprimer une catégorie (réaffectation)', async () => {
  goto('settings');
  click('[data-action="add-cat"][data-kind="expense"]');
  setVal('#cat-name', 'Animaux');
  click('[data-emoji="🐶"]');
  click('[data-action="cat-save"]');
  const id = catId('Animaux');
  addTx({ amount: '15', cat: 'Animaux' });
  click(`[data-action="edit-cat"][data-id="${id}"]`);
  click('[data-action="cat-delete"]');
  const fb = app('fallbackCat("expense").id');
  assert(app(`state.transactions.every(t => t.categoryId !== "${id}")`), 'plus d\'opération dans la catégorie supprimée');
  assert(app(`state.transactions.some(t => t.categoryId === "${fb}" && t.amount === 1500)`), 'réaffectée à « Autre »');
});
test('La catégorie de secours ne peut pas être supprimée', async () => {
  click(`[data-action="edit-cat"][data-id="${app('fallbackCat("expense").id')}"]`);
  assert(!q('[data-action="cat-delete"]'), 'bouton supprimer présent');
  click('[data-action="close-sheet"]');
});

group('Budgets');
test('Créer un budget et suivre la consommation', async () => {
  goto('plan');
  click(`[data-action="edit-budget"][data-id="${catId('Courses')}"]`);
  setVal('[data-draft="amountStr"]', '100');
  click('[data-action="budget-save"]');
  const info = app(`budgetInfo("${catId('Courses')}", currentMonth())`);
  eq([info.available, info.spent, info.left], [10000, 5000, 5000], 'budget');
});
test('Alerte à 80 % puis au dépassement', async () => {
  addTx({ amount: '35', cat: 'Courses' });
  assert(toastText().includes('85 %'), 'alerte 80 % : ' + toastText());
  addTx({ amount: '20', cat: 'Courses' });
  assert(toastText().includes('dépassé de 5,00'), 'alerte dépassement : ' + toastText());
  const row = q(`.budget-row[data-id="${catId('Courses')}"]`);
  assert(txt(row.textContent).includes('Dépassé de 5,00'), 'ligne du budget');
});
test('Report du reste sur le mois suivant', async () => {
  const resto = catId('Restaurants');
  const prevMonth = app('shiftMonth(currentMonth(), -1)');
  addTx({ amount: '60', cat: 'Restaurants', date: prevMonth + '-10' });
  goto('plan');
  // Budget de 100 € le mois précédent (60 € dépensés)…
  click('[data-action="month-prev"]');
  click(`[data-action="edit-budget"][data-id="${resto}"]`);
  setVal('[data-draft="amountStr"]', '100');
  click('[data-action="budget-save"]');
  click('[data-action="month-next"]');
  // …puis 100 € ce mois-ci en reprenant le reste
  click(`[data-action="edit-budget"][data-id="${resto}"]`);
  setVal('[data-draft="amountStr"]', '100');
  setVal('[data-draft="rollover"]', true);
  click('[data-action="budget-save"]');
  const info = app(`budgetInfo("${resto}", currentMonth())`);
  eq([info.carry, info.available], [4000, 14000], 'report de 40 €');
});
test('« + Nouvelle catégorie » : nom, icône, couleur et montant', async () => {
  const n = app('state.categories.length');
  click('[data-action="budget-new-cat"]');
  eq(txt(q('#sheet-title').textContent), 'Nouvelle catégorie', 'titre');
  setVal('[data-draft="name"]', 'courses');
  setVal('[data-draft="amountStr"]', '80');
  click('[data-action="budget-save"]');
  assert(toastText().includes('existe déjà'), 'doublon refusé : ' + toastText());
  setVal('[data-draft="name"]', 'Vacances au ski');
  click('[data-emoji="🏖️"]');
  click(`[data-action="pick-color"][data-color="#7048e8"]`);
  assert(q('#cat-preview').textContent.includes('🏖️'), 'aperçu de l\'icône');
  click('[data-action="budget-save"]');
  eq(app('state.categories.length'), n + 1, 'catégorie créée');
  const c = app('state.categories.at(-1)');
  eq([c.name, c.icon, c.color, c.kind], ['Vacances au ski', '🏖️', '#7048e8', 'expense'], 'catégorie personnalisée');
  eq(app(`monthBudgets(currentMonth())["${c.id}"].amount`), 8000, 'budget du mois');
  assert(q(`.budget-row[data-id="${c.id}"]`), 'affichée dans Mes budgets');
});
test('Modifier une catégorie depuis son budget', async () => {
  const id = catId('Vacances au ski');
  click(`[data-action="edit-budget"][data-id="${id}"]`);
  setVal('[data-draft="name"]', 'Ski');
  setVal('[data-draft="amountStr"]', '120');
  click('[data-emoji="⚽"]');
  click('[data-action="budget-save"]');
  eq([app(`catById("${id}").name`), app(`catById("${id}").icon`), app(`monthBudgets(currentMonth())["${id}"].amount`)], ['Ski', '⚽', 12000], 'catégorie et budget modifiés');
  // On la retire pour ne pas fausser les tests suivants
  click(`[data-action="edit-budget"][data-id="${id}"]`);
  click('[data-action="budget-delete"]');
  app(`state.categories = state.categories.filter(c => c.id !== "${id}"); save(); render();`);
});
test('Budgets propres à chaque mois (pas de reprise automatique)', async () => {
  const courses = catId('Courses');
  const prev = app('shiftMonth(currentMonth(), -1)');
  eq(app(`monthBudgets("${prev}")["${courses}"]`), undefined, 'Courses sans budget le mois précédent');
  click('[data-action="month-next"]');
  eq(qa('.budget-row').length, 0, 'mois suivant vide');
  click('[data-action="month-prev"]');
  eq(qa('.budget-row').length, 2, 'mois en cours : 2 budgets');
});
test('Case « Dupliquer le budget du mois précédent »', async () => {
  click('[data-action="month-next"]');
  const next = app('ui.month');
  const box = q('[data-budget-copy]');
  assert(box && !box.checked, 'case présente et décochée');
  setVal(box, true, 'change');
  eq(qa('.budget-row').length, 2, 'budgets repris');
  eq(app(`monthBudgets("${next}")["${catId('Courses')}"].amount`), 10000, 'montant repris');
  assert(q('[data-budget-copy]').checked, 'case cochée');
  // Les modifications du mois suivant ne touchent pas le mois en cours
  click(`[data-action="edit-budget"][data-id="${catId('Courses')}"]`);
  setVal('[data-draft="amountStr"]', '150');
  click('[data-action="budget-save"]');
  eq(app(`monthBudgets(currentMonth())["${catId('Courses')}"].amount`), 10000, 'mois en cours inchangé');
  setVal(q('[data-budget-copy]'), false, 'change');
  eq(app(`monthHasBudgets("${next}")`), false, 'budgets retirés en décochant');
  click('[data-action="month-prev"]');
});
test('Ancien format de budgets converti au mois en cours', async () => {
  const s = app('normalizeState({ accounts: [{ id: "a", name: "C", type: "checking", initial: 0 }], categories: [], transactions: [], budgets: { x: { amount: 5000, rollover: true, since: "2026-01" } } })');
  eq(s.budgets, { [app('currentMonth()')]: { x: { amount: 5000, rollover: false } } }, 'migration');
});
test('Suggestion basée sur la moyenne des 3 derniers mois', async () => {
  click(`[data-action="edit-budget"][data-id="${catId('Restaurants')}"]`);
  assert(txt(q('[data-action="budget-suggest"]').textContent).includes('20,00'), 'moyenne 60/3 = 20 €');
  click('[data-action="budget-suggest"]');
  eq(q('[data-draft="amountStr"]').value, '20,00', 'suggestion appliquée');
  click('[data-action="close-sheet"]');
});
test('Reste à répartir = revenus − budgété', async () => {
  const stat = txt(q('.stat-grid').textContent);
  assert(stat.includes('Reste à répartir') && stat.includes('1 800,00'), stat);
});

group('Épargne');
test('Créer un objectif avec un montant déjà mis de côté', async () => {
  click('[data-action="plan-tab"][data-value="goals"]');
  click('[data-action="add-goal"]');
  setVal('[data-draft="name"]', 'Vacances');
  setVal('[data-draft="targetStr"]', '1200');
  setVal('[data-draft="initialStr"]', '200');
  const d = new Date();
  const deadline = app(`toISO(new Date(${d.getFullYear()}, ${d.getMonth() + 5}, 15))`);
  setVal('[data-draft="deadline"]', deadline);
  click('[data-action="goal-save"]');
  const g = app('state.goals[0]');
  eq([g.name, g.target, app('goalSaved(state.goals[0])')], ['Vacances', 120000, 20000], 'objectif');
  assert(txt(q('.goal').textContent).includes('200,00 € / mois'), 'rythme : ' + txt(q('.goal').textContent));
});
test('Mettre de côté, refuser un retrait trop grand, atteindre l\'objectif', async () => {
  const id = app('state.goals[0].id');
  click(`[data-action="goal-move"][data-id="${id}"]`);
  click('[data-action="move-dir"][data-type="out"]');
  setVal('[data-draft="amountStr"]', '500');
  click('[data-action="move-save"]');
  assert(toastText().includes('Tu ne peux pas retirer'), 'retrait refusé');
  click('[data-action="move-dir"][data-type="in"]');
  click('[data-action="move-fill"]');
  click('[data-action="move-save"]');
  assert(toastText().includes('atteint'), 'objectif atteint : ' + toastText());
  eq(app('goalSaved(state.goals[0])'), 120000, 'total');
});

group('Opérations récurrentes');
test('Calcul des échéances (fin de mois, bissextile, semaine)', async () => {
  eq(app('addPeriod("2026-01-31", "monthly", 31)'), '2026-02-28', '31 janvier + 1 mois');
  eq(app('addPeriod("2026-02-28", "monthly", 31)'), '2026-03-31', 'retour au 31');
  eq(app('addPeriod("2024-02-29", "yearly", 29)'), '2025-02-28', 'année bissextile');
  eq(app('addPeriod("2026-12-28", "weekly")'), '2027-01-04', 'semaine à cheval sur l\'année');
  eq(app('addPeriod("2026-11-30", "quarterly", 30)'), '2027-02-28', 'trimestre');
});
test('Rattrapage des échéances passées', async () => {
  click('[data-action="plan-tab"][data-value="recurring"]');
  click('[data-action="add-rec"]');
  setVal('[data-draft="name"]', 'Netflix');
  setVal('[data-draft="amountStr"]', '13,99');
  setVal('[data-draft="categoryId"]', catId('Abonnements'), 'change');
  const start = app('shiftMonth(currentMonth(), -2)') + '-01';
  setVal('[data-draft="nextDate"]', start);
  click('[data-action="rec-save"]');
  const r = app('state.recurring.find(r => r.name === "Netflix")');
  eq(app(`state.transactions.filter(t => t.recurringId === "${r.id}").length`), 3, '3 échéances créées');
  assert(r.nextDate > app('todayISO()'), 'prochaine échéance dans le futur');
  assert(toastText().includes('3 opérations ajoutées'), toastText());
});
test('Une récurrence en pause ne crée plus rien', async () => {
  const id = app('state.recurring.find(r => r.name === "Netflix").id');
  click(`[data-action="edit-rec"][data-id="${id}"]`);
  setVal('[data-draft="active"]', false);
  setVal('[data-draft="nextDate"]', app('shiftMonth(currentMonth(), -1)') + '-01');
  click('[data-action="rec-save"]');
  eq(app(`state.transactions.filter(t => t.recurringId === "${id}").length`), 3, 'aucune nouvelle opération');
  assert(q('.tx.paused'), 'affichée en pause');
});
test('Option « Répéter » dans l\'ajout express', async () => {
  addTx({ type: 'income', amount: '150', cat: 'Remboursements', note: 'Aide', repeat: 'monthly' });
  const r = app('state.recurring.find(r => r.name === "Aide")');
  assert(r && r.frequency === 'monthly' && r.active, 'récurrence créée');
  eq(r.nextDate, app('addPeriod(todayISO(), "monthly", new Date().getDate())'), 'prochaine échéance');
  goto('history');
  const row = qa('[data-action="edit-tx"]').find((b) => b.textContent.includes('Aide'));
  assert(row.textContent.includes('🔁'), 'marqueur 🔁');
  click(row);
  assert(q('.sheet [data-action="edit-rec"]'), 'lien vers la récurrence');
  click('[data-action="close-sheet"]');
});
test('Coût des abonnements et charges fixes', async () => {
  goto('plan');
  click('[data-action="plan-tab"][data-value="recurring"]');
  const id = app('state.recurring.find(r => r.name === "Netflix").id');
  click(`[data-action="edit-rec"][data-id="${id}"]`);
  setVal('[data-draft="active"]', true);
  setVal('[data-draft="nextDate"]', isoShift(40));
  click('[data-action="rec-save"]');
  const s = txt(q('.stat-grid').textContent);
  assert(s.includes('13,99') && s.includes('167,88'), s);
});

group('Statistiques et prévision');
test('Prévision de fin de mois = solde + récurrences à venir', async () => {
  const days = app('Number(endOfMonth(currentMonth()).slice(8)) - new Date().getDate()');
  if (days < 1) return; // dernier jour du mois : rien à prévoir
  goto('plan');
  click('[data-action="plan-tab"][data-value="recurring"]');
  click('[data-action="add-rec"]');
  setVal('[data-draft="name"]', 'Loyer');
  setVal('[data-draft="amountStr"]', '700');
  setVal('[data-draft="categoryId"]', catId('Logement'), 'change');
  setVal('[data-draft="nextDate"]', isoShift(1));
  click('[data-action="rec-save"]');
  eq(app('forecast().projected'), app('availableBalance()') - 70000, 'disponible prévu');
  goto('home');
  assert(q('.hero-forecast'), 'prévision sur l\'accueil');
});
test('Écran Statistiques : indicateurs et graphiques', async () => {
  goto('stats');
  eq(qa('.kpi').length, 4, 'indicateurs');
  eq(qa('.chart[data-chart="bars"] .hov').length, 6, 'barres sur 6 mois');
  eq(qa('.chart[data-chart="worth"] .hov').length, 6, 'points de la courbe');
  assert(q('.chart svg text'), 'axes');
  click('[data-action="stats-range"][data-value="12"]');
  eq(qa('.chart[data-chart="bars"] .hov').length, 12, 'barres sur 12 mois');
  assert(qa('.table-view tbody tr').length >= 12, 'vue tableau');
  click('[data-action="stats-range"][data-value="6"]');
});
test('Infobulle au survol d\'un mois', async () => {
  const g = qa('.chart[data-chart="bars"] .hov').at(-1);
  const r = g.getBoundingClientRect();
  g.querySelector('.hit').dispatchEvent(new W.PointerEvent('pointermove', { bubbles: true, clientX: r.x + 5, clientY: r.y + 20, pointerType: 'mouse' }));
  const tip = q('.viz-tip');
  assert(!tip.hidden, 'infobulle visible');
  assert(txt(tip.textContent).includes('Revenus') && txt(tip.textContent).includes('Dépenses'), txt(tip.textContent));
  q('.topbar').dispatchEvent(new W.PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse' }));
  assert(tip.hidden, 'infobulle masquée');
});
test('Comparaison des catégories avec la moyenne', async () => {
  const rows = qa('.cat-cmp');
  assert(rows.length >= 2, 'lignes');
  assert(txt(q('.cat-compare').textContent).includes('Restaurants'), 'Restaurants listé');
});

group('Import et export CSV');
test('Lecture des formats de montants et de dates', async () => {
  eq(app('parseSignedAmount("1.234,56")'), 123456, '1.234,56');
  eq(app('parseSignedAmount("-1 234,50 €")'), -123450, '-1 234,50 €');
  eq(app('parseSignedAmount("(12,50)")'), -1250, '(12,50)');
  eq(app('parseSignedAmount("1,234.56")'), 123456, '1,234.56');
  eq(app('parseSignedAmount("12.5")'), 1250, '12.5');
  eq(app('parseDateFR("31/12/26")'), '2026-12-31', 'jj/mm/aa');
  eq(app('parseDateFR("05.10.2026")'), '2026-10-05', 'jj.mm.aaaa');
  eq(app('parseDateFR("2026-02-30")'), null, 'date impossible');
});
const BANK_CSV = 'Compte courant n° 123456;;;\r\n\r\nDate;Libellé;Débit;Crédit\r\n' +
  '05/10/2026;CB CARREFOUR MARKET 04/10;-45,30;\r\n' +
  '06/10/2026;PRLV SEPA NETFLIX.COM;-13,99;\r\n' +
  '01/10/2026;VIR SEPA SALAIRE ACME;;2 100,00\r\n' +
  '07/10/2026;PAIEMENT CB SNCF;-1 234,50;\r\n';
const latin1 = (s) => new Uint8Array([...s].map((c) => c.charCodeAt(0) & 0xff));
test('Import d\'un relevé (Windows-1252, débit/crédit, lignes d\'en-tête)', async () => {
  goto('settings');
  click('[data-action="csv-open"]');
  await W.loadCsvFile(new W.File([latin1(BANK_CSV)], 'releve.csv'));
  const rows = app('sheet.draft.rows');
  eq(rows.length, 4, 'lignes reconnues');
  const by = (n) => rows.find((r) => r.note.toLowerCase().includes(n));
  eq([by('carrefour').amount, by('carrefour').type], [4530, 'expense'], 'Carrefour');
  eq(by('carrefour').categoryId, catId('Courses'), 'Carrefour → Courses');
  eq(by('netflix').categoryId, catId('Abonnements'), 'Netflix → Abonnements');
  eq([by('salaire').type, by('salaire').amount, by('salaire').categoryId], ['income', 210000, catId('Salaire')], 'Salaire');
  eq([by('sncf').amount, by('sncf').categoryId], [123450, catId('Transport')], 'SNCF');
  assert(q('[data-csv-map="debit"]').value !== '-1', 'colonne Débit détectée');
  const before = app('state.transactions.length');
  click('[data-action="csv-import"]');
  eq(app('state.transactions.length'), before + 4, '4 opérations importées');
});
test('Ré-import du même fichier : doublons repérés', async () => {
  click('[data-action="csv-open"]');
  await W.loadCsvFile(new W.File([latin1(BANK_CSV)], 'releve.csv'));
  eq(app('sheet.draft.rows.filter(r => r.dup).length'), 4, 'doublons');
  assert(q('[data-action="csv-import"]').disabled, 'import désactivé');
  click('[data-action="close-sheet"]');
});
test('Import format international (virgule, montant unique, dates ISO)', async () => {
  click('[data-action="csv-open"]');
  const csv = 'date,description,amount\n2026-10-02,"Amazon Marketplace, FR",-25.99\n2026-10-03,Remboursement CPAM,10.00\n';
  await W.loadCsvFile(new W.File([csv], 'export.csv'));
  const rows = app('sheet.draft.rows');
  eq(rows.length, 2, 'lignes');
  eq(rows.find((r) => r.amount === 2599).categoryId, catId('Shopping'), 'Amazon → Shopping');
  eq(rows.find((r) => r.amount === 1000).categoryId, catId('Remboursements'), 'CPAM → Remboursements');
  // Décocher une ligne et changer une catégorie
  const iAmazon = app('sheet.draft.rows.findIndex(r => r.amount === 2599)');
  const iCpam = app('sheet.draft.rows.findIndex(r => r.amount === 1000)');
  setVal(`[data-csv-row="${iAmazon}"]`, false, 'change');
  setVal(`[data-csv-cat="${iCpam}"]`, catId('Primes'), 'change');
  click('[data-action="csv-import"]');
  assert(app('state.transactions.some(t => t.amount === 1000 && t.categoryId === catId_primes)'.replace('catId_primes', JSON.stringify(catId('Primes')))), 'catégorie choisie appliquée');
  assert(!app('state.transactions.some(t => t.amount === 2599)'), 'ligne décochée non importée');
});
test('Apprentissage : un libellé déjà catégorisé est reconnu', async () => {
  const id = app('state.transactions.find(t => t.note.toLowerCase().includes("netflix") && t.imported).id');
  app(`state.transactions.find(t => t.id === "${id}").categoryId = catId_l`.replace('catId_l', JSON.stringify(catId('Loisirs'))));
  click('[data-action="csv-open"]');
  await W.loadCsvFile(new W.File(['Date;Libellé;Montant\n15/10/2026;PRLV SEPA NETFLIX.COM;-13,99\n'], 'n.csv'));
  eq(app('sheet.draft.rows[0].categoryId'), catId('Loisirs'), 'catégorie apprise');
  click('[data-action="close-sheet"]');
});
test('Export CSV lisible par Excel', async () => {
  let out = null;
  W.downloadFile = (name, content) => { out = { name, content }; };
  click('[data-action="csv-export"]');
  assert(out && out.name.endsWith('.csv'), 'fichier');
  assert(out.content.startsWith('﻿Date;Type;Montant'), 'en-tête + BOM');
  assert(out.content.includes(';Dépense;-45,30;Courses;'), 'ligne Carrefour');
});

group('Sauvegarde');
test('Export JSON, effacement puis restauration', async () => {
  let json = null;
  W.downloadFile = (name, content) => { json = content; };
  click('[data-action="export"]');
  const n = app('state.transactions.length');
  click('[data-action="reset-all"]');
  eq(app('state.transactions.length'), 0, 'données effacées');
  const input = q('#import-file');
  const dt = new W.DataTransfer();
  dt.items.add(new W.File([json], 'sauvegarde.json', { type: 'application/json' }));
  input.files = dt.files;
  input.dispatchEvent(new W.Event('change', { bubbles: true }));
  await wait(150);
  eq(app('state.transactions.length'), n, 'données restaurées');
  eq(app('state.goals.length'), 1, 'objectifs restaurés');
  eq(app('Object.keys(monthBudgets(currentMonth())).length'), 2, 'budgets du mois restaurés');
});
test('Persistance après rechargement', async () => {
  const n = app('state.transactions.length');
  await loadApp(375, 760);
  eq(app('state.transactions.length'), n, 'opérations conservées');
});

group('Code PIN');
test('Activer le code (saisie + confirmation)', async () => {
  goto('settings');
  click('[data-action="pin-set"]');
  for (const k of '1234') click(`[data-action="pin-key"][data-key="${k}"]`);
  for (const k of '1234') click(`[data-action="pin-key"][data-key="${k}"]`);
  await wait(100);
  assert(app('!!state.settings.pin && state.settings.pin.hash.length === 64'), 'code enregistré (haché)');
  assert(!JSON.stringify(S()).includes('"1234"'), 'le code ne doit pas être stocké en clair');
});
test('Verrouillage au lancement, code faux puis juste', async () => {
  await loadApp(375, 760);
  assert(!q('#lock').hidden, 'écran verrouillé');
  for (const k of '0000') click(`#lock [data-action="lock-key"][data-key="${k}"]`);
  await wait(100);
  assert(txt(q('#lock').textContent).includes('Code incorrect'), 'message d\'erreur');
  for (const k of '1234') D.body.dispatchEvent(new W.KeyboardEvent('keydown', { key: k, bubbles: true }));
  await wait(100);
  assert(q('#lock').hidden, 'déverrouillé au clavier');
});
test('Désactiver le code', async () => {
  goto('settings');
  click('[data-action="pin-disable"]');
  for (const k of '1234') click(`[data-action="pin-key"][data-key="${k}"]`);
  await wait(100);
  eq(app('state.settings.pin'), null, 'code supprimé');
});

group('Copies de sécurité');
const backups = () => JSON.parse(localStorage.getItem(TEST_KEY + '.backups') || '[]');
const OLD_DATA = () => JSON.stringify({
  version: 1, accounts: [{ id: 'a1', name: 'Compte courant', type: 'checking', initial: 0 }],
  categories: [{ id: 'c1', name: 'Courses', icon: '🛒', color: '#22a06b', kind: 'expense', fallback: false }],
  transactions: [{ id: 't1', type: 'expense', amount: 1234, categoryId: 'c1', accountId: 'a1', date: '2026-10-01', note: 'avant', createdAt: 1 }],
  budgets: { c1: { amount: 5000, rollover: false, since: '2026-10' } }, settings: {},
});
test('Copie automatique avant une mise à jour, données conservées', async () => {
  localStorage.removeItem(TEST_KEY + '.backups');
  localStorage.setItem(TEST_KEY, OLD_DATA());
  await loadApp(375, 760);
  eq(app('state.transactions.length'), 1, 'opération conservée');
  const b = backups().find((x) => x.reason === 'Avant la mise à jour');
  assert(b && JSON.parse(b.data).transactions[0].note === 'avant', 'copie avant mise à jour');
});
test('Données illisibles : copie gardée et avertissement', async () => {
  localStorage.setItem(TEST_KEY, '{oops');
  await loadApp(375, 760);
  assert(toastText().includes('pas pu être lues'), 'avertissement : ' + toastText());
  addTx({ amount: '5', cat: 'Courses' });
  assert(backups().some((b) => b.data === '{oops' && b.reason.includes('illisibles')), 'données d\'origine gardées malgré la sauvegarde suivante');
});
test('Restaurer une copie depuis les Réglages', async () => {
  goto('settings');
  const i = backups().findIndex((b) => b.reason === 'Avant la mise à jour');
  click(`[data-action="backup-restore"][data-value="${i}"]`);
  eq(app('state.transactions.map(t => t.note)'), ['avant'], 'copie restaurée');
  assert(backups().some((b) => b.reason === 'Avant restauration'), 'copie des données remplacées');
});
test('Effacer toutes les données garde une copie', async () => {
  click('[data-action="reset-all"]');
  eq(app('state.transactions.length'), 0, 'données effacées');
  const b = backups().find((x) => x.reason === 'Avant effacement');
  assert(b && JSON.parse(b.data).transactions.length === 1, 'copie avant effacement');
  assert(backups().length <= 6, 'nombre de copies limité');
});
test('Message d\'aide sur un appareil vide', async () => {
  goto('home');
  assert(txt(q('.tip').textContent).includes('Tu avais déjà saisi des données'), 'aide présente');
});

group('Thème et affichage');
test('Thème clair / sombre / auto', async () => {
  goto('settings');
  click('[data-action="theme"][data-value="dark"]');
  eq(D.documentElement.dataset.theme, 'dark', 'sombre');
  click('[data-action="theme"][data-value="light"]');
  eq(D.documentElement.dataset.theme, 'light', 'clair');
  click('[data-action="theme"][data-value="auto"]');
  eq(D.documentElement.dataset.theme, undefined, 'auto');
});
const VIEWS = ['home', 'history', 'plan', 'stats', 'accounts', 'settings'];
async function checkNoOverflow(label) {
  for (const v of VIEWS) {
    app(`goto("${v}")`);
    await wait(20);
    const sw = D.documentElement.scrollWidth;
    assert(sw <= W.innerWidth + 1, `${label} : débordement horizontal sur « ${v} » (${sw}px > ${W.innerWidth}px)`);
  }
}
test('Mobile (375 px) : barre du bas, bouton +, aucun débordement', async () => {
  await loadApp(375, 760);
  eq(W.getComputedStyle(q('.tabbar')).position, 'fixed', 'barre en bas');
  assert(W.getComputedStyle(q('#fab')).display !== 'none', 'bouton + visible');
  eq(W.getComputedStyle(q('.side-add')).display, 'none', 'pas de bouton latéral');
  assert(W.getComputedStyle(q('.topbar-settings')).display !== 'none', 'accès aux réglages');
  await checkNoOverflow('Mobile');
});
test('Petit téléphone (320 px) : aucun débordement', async () => {
  await loadApp(320, 640);
  await checkNoOverflow('320 px');
});
test('Tablette (768 px) : aucun débordement', async () => {
  await loadApp(768, 900);
  await checkNoOverflow('Tablette');
});
test('Ordinateur (1280 px) : barre latérale, colonnes, fenêtre centrée', async () => {
  await loadApp(1280, 800);
  eq(W.getComputedStyle(q('.tabbar')).position, 'sticky', 'barre latérale');
  eq(W.getComputedStyle(q('#fab')).display, 'none', 'bouton flottant masqué');
  assert(W.getComputedStyle(q('.side-add')).display !== 'none', 'bouton Ajouter latéral');
  assert(W.getComputedStyle(q('.tab-settings')).display !== 'none', 'Réglages dans la barre');
  app('goto("home")');
  const cols = qa('.dash > .col').map((c) => c.getBoundingClientRect());
  assert(cols.length === 2 && Math.abs(cols[0].top - cols[1].top) < 2 && cols[1].left > cols[0].right, 'accueil en 2 colonnes');
  click('.side-add');
  const r = q('.sheet').getBoundingClientRect();
  assert(Math.abs(r.left + r.width / 2 - W.innerWidth / 2) < 3 && r.width <= 520, 'fenêtre centrée');
  click('[data-action="close-sheet"]');
  await checkNoOverflow('Ordinateur');
});
test('Statistiques redessinées à la bonne largeur', async () => {
  app('goto("stats")');
  await wait(50);
  const chart = q('.chart[data-chart="bars"]');
  eq(Number(chart.querySelector('svg').getAttribute('width')), Math.max(260, chart.clientWidth), 'largeur du graphique');
});

document.getElementById('run').addEventListener('click', runAll);
if (new URLSearchParams(location.search).has('auto')) runAll();
