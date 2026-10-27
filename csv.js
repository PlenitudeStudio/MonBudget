'use strict';

/* =========================================================
   Lot 3 : import de relevés bancaires CSV et export CSV.
   Uniquement des déclarations (chargé avant app.js).
   ========================================================= */

/* ---------- Lecture du CSV ---------- */
function decodeFile(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^﻿/, '');
  } catch {
    // Beaucoup de banques françaises exportent en Windows-1252
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

function detectDelimiter(text) {
  const sample = text.split(/\r?\n/).slice(0, 10).join('\n');
  const score = (d) => sample.split('\n').map((l) => l.split(d).length - 1);
  let best = ';', bestScore = -1;
  for (const d of [';', ',', '\t', '|']) {
    const counts = score(d).filter((c) => c > 0);
    const s = counts.length ? Math.min(...counts) * counts.length : 0;
    if (s > bestScore) { best = d; bestScore = s; }
  }
  return best;
}

function parseCSV(text, delim) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ''));
}

/** "31/12/2026", "31-12-26", "2026-12-31", "31.12.2026" -> "2026-12-31" (ou null) */
function parseDateFR(s) {
  s = String(s || '').trim().split(/[ T]/)[0];
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return validDate(y, +m[2], +m[1]);
  }
  return null;
}
function validDate(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d);
  return dt.getMonth() === mo - 1 ? toISO(dt) : null;
}

/** "-1 234,56 €", "1.234,56", "(12,50)", "+12.5" -> centimes signés (ou NaN) */
function parseSignedAmount(s) {
  s = String(s || '').replace(/[\s  €]|EUR/gi, '');
  if (!s) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.endsWith('-')) { neg = true; s = s.slice(0, -1); }
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); } else if (s.startsWith('+')) s = s.slice(1);
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma > -1) {
    s = s.replace(',', '.');
  } else if (lastDot > -1 && /\.\d{3}$/.test(s) && (s.match(/\./g) || []).length > 1) {
    s = s.replace(/\./g, '');
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  const v = Math.round(Number(s) * 100);
  return neg ? -v : v;
}

/* ---------- Détection des colonnes ---------- */
function guessMapping(header, sample) {
  const h = header.map(norm);
  const find = (...keys) => h.findIndex((x) => keys.some((k) => x === k || x.includes(k)));
  const map = { date: -1, label: -1, amount: -1, debit: -1, credit: -1 };
  map.date = find('date operation', 'date op', 'date comptable', 'date');
  map.label = find('libelle', 'description', 'intitule', 'detail', 'beneficiaire', 'nom', 'label', 'operation');
  map.debit = find('debit');
  map.credit = find('credit');
  map.amount = find('montant', 'amount', 'somme', 'valeur');
  if (map.label === map.date) map.label = -1;

  // Pas d'en-tête reconnu : deviner par le contenu
  if (map.date < 0) map.date = header.findIndex((_, i) => sample.every((r) => parseDateFR(r[i])));
  if (map.amount < 0 && (map.debit < 0 || map.credit < 0)) {
    map.amount = header.findIndex((_, i) => i !== map.date && sample.every((r) => !Number.isNaN(parseSignedAmount(r[i]))));
  }
  if (map.label < 0) {
    let best = -1, bestLen = 0;
    header.forEach((_, i) => {
      if (i === map.date || i === map.amount || i === map.debit || i === map.credit) return;
      const len = sample.reduce((s, r) => s + (r[i] || '').length, 0);
      if (len > bestLen) { best = i; bestLen = len; }
    });
    map.label = best;
  }
  return map;
}

/* ---------- Catégorisation automatique ---------- */
const CATEGORY_RULES = [
  ['Courses', ['carrefour', 'leclerc', 'auchan', 'lidl', 'aldi', 'intermarche', 'monoprix', 'franprix', 'casino', 'super u', 'hyper u', 'systeme u', 'picard', 'grand frais', 'netto', 'biocoop', 'naturalia', 'boulangerie']],
  ['Restaurants', ['restaurant', 'mcdonald', 'mc do', 'burger king', 'kfc', 'quick', 'uber eats', 'deliveroo', 'just eat', 'starbucks', 'brasserie', 'pizza', 'sushi', 'cafe ', 'bar ']],
  ['Transport', ['sncf', 'ratp', 'navigo', 'uber', 'bolt', 'blablacar', 'total', 'esso', 'shell', 'bp ', 'avia', 'carburant', 'station', 'peage', 'autoroute', 'vinci', 'sanef', 'aprr', 'parking', 'indigo', 'tisseo', 'tcl', 'rtm']],
  ['Abonnements', ['netflix', 'spotify', 'deezer', 'disney', 'canal+', 'amazon prime', 'prime video', 'apple.com', 'icloud', 'google', 'youtube', 'free mobile', 'free telecom', 'orange', 'sfr', 'bouygues', 'sosh', 'red by', 'basic fit', 'fitness park', 'salle de sport']],
  ['Factures', ['edf', 'engie', 'totalenergies', 'veolia', 'suez', 'eau de', 'gaz', 'electricite', 'assurance', 'maaf', 'macif', 'matmut', 'axa', 'allianz', 'groupama', 'mutuelle', 'impots', 'dgfip', 'tresor public']],
  ['Logement', ['loyer', 'foncia', 'nexity', 'citya', 'syndic', 'leroy merlin', 'castorama', 'ikea', 'brico']],
  ['Santé', ['pharmacie', 'doctolib', 'medecin', 'dentiste', 'docteur', 'kine', 'opticien', 'laboratoire', 'hopital', 'clinique']],
  ['Shopping', ['amazon', 'fnac', 'darty', 'decathlon', 'zara', 'h&m', 'kiabi', 'cdiscount', 'vinted', 'zalando', 'shein', 'boulanger', 'sephora']],
  ['Loisirs', ['cinema', 'ugc', 'pathe', 'gaumont', 'steam', 'playstation', 'xbox', 'nintendo', 'fnac spectacles', 'ticketmaster', 'musee', 'concert']],
  ['Salaire', ['salaire', 'paie', 'remuneration']],
  ['Remboursements', ['remboursement', 'cpam', 'ameli', 'avoir', 'refund']],
];

function cleanLabel(s) {
  return String(s || '')
    .replace(/^(paiement|achat|prlv|prelevement|vir|virement|cb|carte)( sepa)?( inst(antane)?)?( cb)?( recu| emis)?( de)?\s+/i, '')
    .replace(/\b(carte|cb)\s*x?\*?\d{2,}\b/gi, '')
    .replace(/\b\d{2}[/.]\d{2}([/.]\d{2,4})?\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
const labelKey = (s) => norm(cleanLabel(s)).replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();

function categoryLearner() {
  const known = new Map();
  for (const t of sortedTx()) {
    if (t.type === 'transfer' || !t.note) continue;
    const k = labelKey(t.note);
    if (k && !known.has(k)) known.set(k, t.categoryId);
  }
  return known;
}

function suggestCategory(label, kind, known) {
  const k = labelKey(label);
  const fromHistory = known.get(k);
  if (fromHistory && catById(fromHistory)?.kind === kind) return fromHistory;
  const hay = ' ' + norm(label) + ' ';
  for (const [name, words] of CATEGORY_RULES) {
    const cat = state.categories.find((c) => c.kind === kind && norm(c.name) === norm(name));
    if (cat && words.some((w) => hay.includes(w))) return cat.id;
  }
  return fallbackCat(kind).id;
}

/* ---------- Construction des lignes à importer ---------- */
function buildImportRows(d) {
  const known = categoryLearner();
  const existing = new Set(
    state.transactions.filter((t) => t.accountId === d.accountId).map((t) => `${t.date}|${t.type}|${t.amount}`)
  );
  const seen = new Map();
  const rows = [];
  for (const r of d.body) {
    const date = parseDateFR(r[d.map.date]);
    let cents;
    if (d.map.amount >= 0) cents = parseSignedAmount(r[d.map.amount]);
    else {
      const deb = parseSignedAmount(r[d.map.debit]);
      const cre = parseSignedAmount(r[d.map.credit]);
      cents = (Number.isNaN(cre) ? 0 : Math.abs(cre)) - (Number.isNaN(deb) ? 0 : Math.abs(deb));
      if (Number.isNaN(deb) && Number.isNaN(cre)) cents = NaN;
    }
    if (!date || Number.isNaN(cents) || cents === 0) continue;
    const type = cents > 0 ? 'income' : 'expense';
    const amount = Math.abs(cents);
    const rawLabel = d.map.label >= 0 ? r[d.map.label] || '' : '';
    const note = (cleanLabel(rawLabel) || rawLabel).slice(0, 80);
    // Doublon : même compte, date, sens et montant déjà enregistrés (on compte les répétitions)
    const key = `${date}|${type}|${amount}`;
    const n = (seen.get(key) || 0) + 1;
    seen.set(key, n);
    const dupCount = state.transactions.filter((t) => t.accountId === d.accountId && `${t.date}|${t.type}|${t.amount}` === key).length;
    const dup = existing.has(key) && n <= dupCount;
    rows.push({ date, type, amount, note, categoryId: suggestCategory(rawLabel, type, known), include: !dup, dup });
  }
  rows.sort((a, b) => (a.date < b.date ? 1 : -1));
  return rows;
}

/* ---------- Feuille d'import ---------- */
function openCsvImport() {
  const accId = accById(state.settings.lastAccountId) ? state.settings.lastAccountId : state.accounts[0].id;
  openSheet('csv', { step: 'file', accountId: accId, fileName: '' });
}

async function loadCsvFile(file) {
  const d = sheet?.draft;
  if (!d || !file) return;
  try {
    const text = decodeFile(await file.arrayBuffer());
    const delim = detectDelimiter(text);
    let table = parseCSV(text, delim);
    // Ignore les lignes d'introduction (nom du compte, solde…) : on part de la première
    // ligne datée, en gardant la ligne juste au-dessus si c'est un en-tête.
    const filled = (r) => r.filter((c) => c !== '').length;
    let start = 0;
    for (let i = 0; i < Math.min(table.length, 30); i++) {
      if (table[i].some((c) => parseDateFR(c))) {
        const prev = table[i - 1];
        start = prev && filled(prev) >= 2 && !prev.some((c) => parseDateFR(c)) ? i - 1 : i;
        break;
      }
    }
    table = table.slice(start);
    if (table.length < 1 || !table.some((r) => r.some((c) => parseDateFR(c)))) throw new Error('aucune date');
    const first = table[0];
    const hasHeader = !first.some((c) => parseDateFR(c)) && first.some((c) => /[a-z]/i.test(c));
    d.header = hasHeader ? first : first.map((_, i) => `Colonne ${i + 1}`);
    d.body = hasHeader ? table.slice(1) : table;
    d.map = guessMapping(d.header, d.body.slice(0, 8));
    d.fileName = file.name;
    d.step = 'preview';
    d.rows = buildImportRows(d);
    renderSheet();
  } catch (e) {
    console.warn(e);
    toast("Impossible de lire ce fichier CSV");
  }
}

function csvSheet(d) {
  const head = sheetHead('Importer un relevé CSV');
  const accountField = `<label class="field"><span>Compte concerné</span><select class="input" data-draft="accountId" data-csv-remap>${accountOptions(d.accountId)}</select></label>`;
  if (d.step === 'file') {
    return `${head}
      <p class="muted small" style="margin-top:0">Télécharge un relevé au format CSV depuis l'espace client de ta banque, puis choisis-le ici. Les doublons déjà présents sont repérés et les catégories sont proposées automatiquement.</p>
      ${accountField}
      <div class="btn-row"><button class="btn primary" data-action="csv-pick">Choisir un fichier CSV</button></div>`;
  }
  const colOpts = (sel, allowNone) =>
    (allowNone ? `<option value="-1" ${sel < 0 ? 'selected' : ''}>—</option>` : '') +
    d.header.map((h, i) => `<option value="${i}" ${sel === i ? 'selected' : ''}>${esc(h || 'Colonne ' + (i + 1))}</option>`).join('');
  const mode = d.map.amount >= 0 ? 'amount' : 'split';
  const selected = d.rows.filter((r) => r.include);
  const inSum = selected.filter((r) => r.type === 'income').reduce((s, r) => s + r.amount, 0);
  const outSum = selected.filter((r) => r.type === 'expense').reduce((s, r) => s + r.amount, 0);
  const dups = d.rows.filter((r) => r.dup).length;
  const catOptions = (kind, sel) =>
    state.categories.filter((c) => c.kind === kind).map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.icon + ' ' + c.name)}</option>`).join('');

  return `${head}
    <p class="muted small" style="margin-top:0">📄 ${esc(d.fileName)} · ${d.body.length} ligne${d.body.length > 1 ? 's' : ''} lue${d.body.length > 1 ? 's' : ''}</p>
    ${accountField}
    <details class="card csv-map" ${d.rows.length ? '' : 'open'}><summary><strong>Colonnes</strong> <span class="muted small">(détectées automatiquement)</span></summary>
      <div class="row2" style="margin-top:10px">
        <label class="field"><span>Date</span><select class="input" data-csv-map="date">${colOpts(d.map.date)}</select></label>
        <label class="field"><span>Libellé</span><select class="input" data-csv-map="label">${colOpts(d.map.label, true)}</select></label>
      </div>
      <div class="seg" style="margin-bottom:10px">
        <button data-action="csv-mode" data-type="amount" aria-pressed="${mode === 'amount'}">Une colonne montant</button>
        <button data-action="csv-mode" data-type="split" aria-pressed="${mode === 'split'}">Débit / Crédit</button>
      </div>
      ${mode === 'amount'
        ? `<label class="field"><span>Montant (négatif = dépense)</span><select class="input" data-csv-map="amount">${colOpts(d.map.amount)}</select></label>`
        : `<div class="row2">
            <label class="field"><span>Débit</span><select class="input" data-csv-map="debit">${colOpts(d.map.debit, true)}</select></label>
            <label class="field"><span>Crédit</span><select class="input" data-csv-map="credit">${colOpts(d.map.credit, true)}</select></label>
          </div>`}
    </details>
    ${d.rows.length
      ? `<div class="summary-row" style="margin:10px 2px"><span>${selected.length} / ${d.rows.length} sélectionnée${selected.length > 1 ? 's' : ''}${dups ? ` · ${dups} doublon${dups > 1 ? 's' : ''} ignoré${dups > 1 ? 's' : ''}` : ''}</span><span class="num">${[inSum ? '+' + money(inSum) : '', outSum ? '−' + money(outSum) : ''].filter(Boolean).join(' · ')}</span></div>
        <ul class="csv-rows">${d.rows
          .map(
            (r, i) => `<li class="${r.dup ? 'dup' : ''}">
              <input type="checkbox" data-csv-row="${i}" ${r.include ? 'checked' : ''} aria-label="Importer cette ligne">
              <span class="csv-main"><span class="row-between"><span class="ellipsis">${esc(r.note || '(sans libellé)')}</span><span class="num amt ${r.type}">${signedMoney(r.amount, r.type)}</span></span>
              <span class="row-between small"><span class="muted">${esc(shortDate(r.date))} ${parseISO(r.date).getFullYear()}${r.dup ? ' · déjà présente' : ''}</span>
              <select class="input mini" data-csv-cat="${i}" aria-label="Catégorie">${catOptions(r.type, r.categoryId)}</select></span></span>
            </li>`
          )
          .join('')}</ul>`
      : `<p class="empty">Aucune opération reconnue avec ces colonnes. Vérifie la colonne Date et Montant.</p>`}
    <div class="btn-row">
      <button class="btn" data-action="csv-restart">Autre fichier</button>
      <button class="btn primary" data-action="csv-import" ${selected.length ? '' : 'disabled'}>Importer ${selected.length || ''}</button>
    </div>`;
}

function importCsvRows() {
  const d = sheet.draft;
  const rows = d.rows.filter((r) => r.include);
  if (!rows.length) return;
  const now = Date.now();
  rows.forEach((r, i) =>
    state.transactions.push({
      id: uid(), type: r.type, amount: r.amount, categoryId: catById(r.categoryId) ? r.categoryId : fallbackCat(r.type).id,
      accountId: d.accountId, toAccountId: null, date: r.date, note: r.note, createdAt: now + i, imported: true,
    })
  );
  save();
  closeSheet();
  render();
  toast(`${rows.length} opération${rows.length > 1 ? 's' : ''} importée${rows.length > 1 ? 's' : ''}`);
}

function csvAction(action, el, d) {
  switch (action) {
    case 'csv-open': openCsvImport(); return true;
    case 'csv-pick': $('#csv-file').click(); return true;
    case 'csv-restart': d.step = 'file'; renderSheet(); return true;
    case 'csv-mode':
      if (el.dataset.type === 'amount') {
        d.map.amount = d.map.amount >= 0 ? d.map.amount : Math.max(0, d.map.debit, d.map.credit);
      } else {
        d.map.amount = -1;
      }
      d.rows = buildImportRows(d);
      renderSheet();
      return true;
    case 'csv-import': importCsvRows(); return true;
  }
  return false;
}

/** Changements des listes et cases de l'aperçu (appelé par app.js). */
function csvChange(t) {
  if (!sheet || sheet.kind !== 'csv') return false;
  const d = sheet.draft;
  if (t.dataset.csvMap) {
    d.map[t.dataset.csvMap] = Number(t.value);
    d.rows = buildImportRows(d);
    renderSheet();
    return true;
  }
  if (t.hasAttribute('data-csv-remap')) {
    d.accountId = t.value;
    if (d.step === 'preview') { d.rows = buildImportRows(d); renderSheet(); }
    return true;
  }
  if (t.dataset.csvRow !== undefined) {
    d.rows[Number(t.dataset.csvRow)].include = t.checked;
    const btn = sheetBody.querySelector('[data-action="csv-import"]');
    const n = d.rows.filter((r) => r.include).length;
    btn.textContent = `Importer ${n || ''}`;
    btn.disabled = !n;
    return true;
  }
  if (t.dataset.csvCat !== undefined) {
    d.rows[Number(t.dataset.csvCat)].categoryId = t.value;
    return true;
  }
  return false;
}

/* ---------- Export CSV (ouvrable dans Excel) ---------- */
function exportCsv() {
  const cell = (v) => {
    const s = String(v ?? '');
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const types = { expense: 'Dépense', income: 'Revenu', transfer: 'Virement' };
  const lines = [['Date', 'Type', 'Montant', 'Catégorie', 'Compte', 'Vers le compte', 'Note'].join(';')];
  for (const t of sortedTx()) {
    const signed = t.type === 'expense' ? -t.amount : t.amount;
    lines.push([
      t.date.split('-').reverse().join('/'), types[t.type], (signed / 100).toFixed(2).replace('.', ','),
      catById(t.categoryId)?.name || '', accById(t.accountId)?.name || '', accById(t.toAccountId)?.name || '', t.note || '',
    ].map(cell).join(';'));
  }
  downloadFile(`mon-budget-operations-${todayISO()}.csv`, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
  toast('Opérations exportées en CSV');
}
