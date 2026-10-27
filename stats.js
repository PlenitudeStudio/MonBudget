'use strict';

/* =========================================================
   Lot 3 : statistiques et solde prévisionnel.
   Uniquement des déclarations (chargé avant app.js).
   Graphiques en SVG dessinés à la largeur réelle du conteneur
   (voir hydrateCharts), pour garder un texte lisible partout.
   ========================================================= */

const compactNum = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 });
const compactMoney = (cents) => compactNum.format(cents / 100) + ' €';
const monthShort = (key) => parseISO(key + '-01').toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '');
const monthLong = (key) => parseISO(key + '-01').toLocaleDateString('fr-FR', { month: 'long' });
let chartData = {};

/* ---------- Calculs ---------- */
function lastMonths(n, end = currentMonth()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(shiftMonth(end, -i));
  return out;
}

const endOfMonth = (key) => {
  const d = parseISO(key + '-01');
  return toISO(new Date(d.getFullYear(), d.getMonth() + 1, 0));
};

/** Solde total de tous les comptes à la fin du jour donné. */
function balanceAt(iso) {
  let total = state.accounts.reduce((s, a) => s + (a.initial || 0), 0);
  for (const t of state.transactions) {
    if (t.date > iso) continue;
    if (t.type === 'income') total += t.amount;
    else if (t.type === 'expense') total -= t.amount;
  }
  return total;
}

/** Dépenses du mois jusqu'au jour N inclus. */
function expenseUntilDay(key, day) {
  let s = 0;
  for (const t of state.transactions) {
    if (t.type === 'expense' && monthOf(t.date) === key && Number(t.date.slice(8, 10)) <= day) s += t.amount;
  }
  return s;
}

function recurringOccurrences(r, afterISO, untilISO) {
  const out = [];
  let d = r.nextDate;
  let guard = 0;
  while (d <= untilISO && guard++ < 400) {
    if (d > afterISO) out.push(d);
    d = addPeriod(d, r.frequency, r.day);
  }
  return out;
}

/** Solde prévu à la fin du mois en cours, d'après les opérations récurrentes à venir. */
function forecast() {
  const today = todayISO();
  const end = endOfMonth(currentMonth());
  const items = [];
  for (const r of state.recurring) {
    if (!r.active || r.type === 'transfer' || !recIsValid(r)) continue;
    for (const date of recurringOccurrences(r, today, end)) {
      items.push({ date, name: recName(r), type: r.type, amount: r.amount, cat: catById(r.categoryId) });
    }
  }
  items.sort((a, b) => (a.date < b.date ? -1 : 1));
  const start = totalBalance();
  const delta = items.reduce((s, it) => s + (it.type === 'income' ? it.amount : -it.amount), 0);
  return { start, end, items, delta, projected: start + delta };
}

function heroForecast() {
  const f = forecast();
  return `<button class="hero-forecast" data-action="goto" data-view="stats">
    <span>Prévu fin ${esc(monthLong(currentMonth()))}</span>
    <span class="num"><strong>${money(f.projected)}</strong> ›</span>
  </button>`;
}

/* ---------- Écran Statistiques ---------- */
function renderStats() {
  const n = ui.statsRange === 12 ? 12 : 6;
  const months = lastMonths(n);
  const data = months.map((key) => ({ key, ...monthStats(key) }));
  const cur = currentMonth();

  // Moyennes sur les mois complets (hors mois en cours)
  const full = data.filter((d) => d.key !== cur);
  const sumInc = full.reduce((s, d) => s + d.income, 0);
  const sumExp = full.reduce((s, d) => s + d.expense, 0);
  const avgInc = full.length ? Math.round(sumInc / full.length) : 0;
  const avgExp = full.length ? Math.round(sumExp / full.length) : 0;
  const rate = sumInc > 0 ? (sumInc - sumExp) / sumInc : null;

  // Ce mois vs mois dernier, à la même date
  const day = new Date().getDate();
  const thisMonth = expenseUntilDay(cur, day);
  const prevMonth = expenseUntilDay(shiftMonth(cur, -1), day);
  const diff = prevMonth > 0 ? (thisMonth - prevMonth) / prevMonth : null;

  chartData = {
    bars: data.map((d) => ({ key: d.key, income: d.income, expense: d.expense })),
    worth: months.map((key) => ({ key, value: balanceAt(key === cur ? todayISO() : endOfMonth(key)) })),
  };

  const chip = (v, l) => `<button class="chip" data-action="stats-range" data-value="${v}" aria-pressed="${n === v}">${l}</button>`;
  let html = `<div class="chips">${chip(6, '6 mois')}${chip(12, '12 mois')}</div>`;

  html += `<div class="kpis">
    <section class="card kpi"><div class="k">Revenus moyens</div><div class="v num">${money(avgInc)}</div><div class="s">par mois${full.length ? ` · ${full.length} mois complets` : ''}</div></section>
    <section class="card kpi"><div class="k">Dépenses moyennes</div><div class="v num">${money(avgExp)}</div><div class="s">par mois</div></section>
    <section class="card kpi"><div class="k">Taux d'épargne</div><div class="v num">${rate === null ? '—' : Math.round(rate * 100) + ' %'}</div><div class="s">${rate === null ? 'pas encore de revenus' : rate >= 0 ? 'de tes revenus mis de côté' : 'tu dépenses plus que tu ne gagnes'}</div></section>
    <section class="card kpi"><div class="k">Dépenses au ${day} ${esc(monthLong(cur))}</div><div class="v num">${money(thisMonth)}</div><div class="s">${diff === null ? 'rien à comparer le mois dernier' : `${diff > 0 ? '▲ +' : diff < 0 ? '▼ −' : ''}${Math.abs(Math.round(diff * 100))} % vs même date le mois dernier`}</div></section>
  </div>`;

  html += `<div class="stats-grid">`;

  // Revenus vs dépenses
  html += `<section class="card chart-card">
    <div class="chart-head"><h3>Revenus et dépenses</h3>
      <div class="viz-legend"><span><i style="background:var(--series-1)"></i>Revenus</span><span><i style="background:var(--series-2)"></i>Dépenses</span></div>
    </div>
    <div class="chart" data-chart="bars" style="height:220px"></div>
    <details class="table-view"><summary>Voir en tableau</summary>
      <table><thead><tr><th>Mois</th><th>Revenus</th><th>Dépenses</th><th>Solde</th></tr></thead><tbody>${data
        .map((d) => `<tr><td>${esc(monthLabel(d.key))}</td><td class="num">${money(d.income)}</td><td class="num">${money(d.expense)}</td><td class="num">${money(d.income - d.expense)}</td></tr>`)
        .join('')}</tbody></table>
    </details>
  </section>`;

  // Évolution du solde total
  html += `<section class="card chart-card">
    <div class="chart-head"><h3>Évolution du solde total</h3><span class="muted small num">${money(chartData.worth.at(-1).value)}</span></div>
    <div class="chart" data-chart="worth" style="height:220px"></div>
    <details class="table-view"><summary>Voir en tableau</summary>
      <table><thead><tr><th>Fin de mois</th><th>Solde total</th></tr></thead><tbody>${chartData.worth
        .map((w) => `<tr><td>${esc(monthLabel(w.key))}</td><td class="num">${money(w.value)}</td></tr>`)
        .join('')}</tbody></table>
    </details>
  </section>`;

  // Prévision
  const f = forecast();
  html += `<section class="card">
    <div class="chart-head"><h3>Prévision fin ${esc(monthLong(cur))}</h3></div>
    <div class="forecast-line"><span class="muted">Solde actuel</span><span class="num">${money(f.start)}</span></div>
    <div class="forecast-line"><span class="muted">Opérations récurrentes à venir</span><span class="num">${f.delta >= 0 ? '+' : '−'}${money(Math.abs(f.delta))}</span></div>
    <div class="forecast-line total"><span>Solde prévu au ${esc(shortDate(f.end))}</span><span class="num">${money(f.projected)}</span></div>
    ${f.items.length
      ? `<ul class="list small" style="margin-top:6px">${f.items
          .map((it) => `<li class="forecast-line"><span><span class="date-pill">${esc(shortDate(it.date))}</span> ${esc(it.name)}</span><span class="num amt ${it.type}">${signedMoney(it.amount, it.type)}</span></li>`)
          .join('')}</ul>`
      : `<p class="muted small">Aucune opération récurrente d'ici la fin du mois. <button class="link" data-action="goto-plan" data-value="recurring">Ajouter tes charges fixes</button> pour une prévision plus juste.</p>`}
  </section>`;

  // Catégories : ce mois vs moyenne des 3 mois précédents
  const idx = spendIndex();
  const prev3 = lastMonths(3, shiftMonth(cur, -1));
  const rows = state.categories
    .filter((c) => c.kind === 'expense')
    .map((c) => {
      const now = idx.get(c.id + '|' + cur) || 0;
      const avg = Math.round(prev3.reduce((s, m) => s + (idx.get(c.id + '|' + m) || 0), 0) / 3);
      return { c, now, avg };
    })
    .filter((r) => r.now || r.avg)
    .sort((a, b) => b.now - a.now || b.avg - a.avg);
  const maxV = Math.max(1, ...rows.map((r) => Math.max(r.now, r.avg)));
  html += `<section class="card">
    <div class="chart-head"><h3>Catégories ce mois-ci</h3><span class="muted small">vs moyenne des 3 mois précédents</span></div>
    ${rows.length
      ? `<ul class="list cat-compare">${rows
          .map(({ c, now, avg }) => {
            const d = avg > 0 ? (now - avg) / avg : null;
            const trend =
              d === null ? '<span class="muted">nouveau</span>'
                : Math.abs(d) < 0.05 ? '<span class="muted">stable</span>'
                  : `<span style="color:${d > 0 ? 'var(--expense)' : 'var(--income)'}">${d > 0 ? '▲ +' : '▼ −'}${Math.abs(Math.round(d * 100))} %</span>`;
            return `<li><button class="cat-cmp" data-action="cat-filter" data-id="${c.id}">
              ${catIcon(c, 34)}
              <span class="grow">
                <span class="row-between"><span class="ellipsis">${esc(c.name)}</span><span class="num small"><strong>${money(now)}</strong></span></span>
                <span class="cmp-bars"><span class="cmp-now" style="width:${((now / maxV) * 100).toFixed(1)}%;background:${safeColor(c.color)}"></span></span>
                <span class="cmp-bars avg"><span style="width:${((avg / maxV) * 100).toFixed(1)}%"></span></span>
                <span class="row-between small"><span class="muted num">moy. ${money(avg)}</span>${trend}</span>
              </span>
            </button></li>`;
          })
          .join('')}</ul>`
      : `<p class="muted small">Pas encore de dépenses à comparer.</p>`}
  </section>`;

  html += `</div>`;
  return html;
}

/* ---------- Dessin des graphiques ---------- */
function niceMax(v) {
  if (v <= 0) return 100;
  const raw = v / 4;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw);
  return step * 4;
}

function topRoundedBar(x, y, w, h, r) {
  if (h <= 0) return '';
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

const tipAttr = (html) => `data-tip="${esc(html)}"`;

function drawBars(el, rows) {
  const W = Math.max(260, el.clientWidth);
  const H = el.clientHeight || 220;
  const padL = 46, padR = 6, padT = 10, padB = 24;
  const max = niceMax(Math.max(...rows.flatMap((r) => [r.income, r.expense]), 0));
  const ih = H - padT - padB;
  const cw = (W - padL - padR) / rows.length;
  const bw = Math.max(4, Math.min(22, (cw - 12) / 2));
  const y = (v) => padT + ih - (v / max) * ih;
  let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Revenus et dépenses par mois">`;
  for (let i = 0; i <= 4; i++) {
    const v = (max * i) / 4;
    s += `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/>`;
    s += `<text class="axis" x="${padL - 6}" y="${y(v) + 4}" text-anchor="end">${esc(compactMoney(v))}</text>`;
  }
  const cur = currentMonth();
  rows.forEach((r, i) => {
    const cx = padL + i * cw + cw / 2;
    const tip = `<strong>${esc(monthLabel(r.key))}</strong><br><i style="background:var(--series-1)"></i>Revenus ${esc(money(r.income))}<br><i style="background:var(--series-2)"></i>Dépenses ${esc(money(r.expense))}<br>Solde ${esc(money(r.income - r.expense))}`;
    s += `<g class="hov" ${tipAttr(tip)}><rect class="hit" x="${padL + i * cw}" y="${padT}" width="${cw}" height="${ih + padB}"/>`;
    s += `<path fill="var(--series-1)" d="${topRoundedBar(cx - bw - 1, y(r.income), bw, padT + ih - y(r.income), 4)}"/>`;
    s += `<path fill="var(--series-2)" d="${topRoundedBar(cx + 1, y(r.expense), bw, padT + ih - y(r.expense), 4)}"/>`;
    s += `<text class="axis ${r.key === cur ? 'strong' : ''}" x="${cx}" y="${H - 6}" text-anchor="middle">${esc(monthShort(r.key))}</text></g>`;
  });
  s += `<line class="baseline" x1="${padL}" x2="${W - padR}" y1="${padT + ih}" y2="${padT + ih}"/></svg>`;
  el.innerHTML = s;
}

function drawWorth(el, rows) {
  const W = Math.max(260, el.clientWidth);
  const H = el.clientHeight || 220;
  const padL = 52, padR = 12, padT = 12, padB = 24;
  const vals = rows.map((r) => r.value);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (lo === hi) { lo -= 10000; hi += 10000; }
  const span = hi - lo;
  lo -= span * 0.1;
  hi += span * 0.1;
  const ih = H - padT - padB;
  const cw = (W - padL - padR) / rows.length;
  const x = (i) => padL + i * cw + cw / 2;
  const y = (v) => padT + ih - ((v - lo) / (hi - lo)) * ih;
  let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Évolution du solde total">`;
  for (let i = 0; i <= 3; i++) {
    const v = lo + ((hi - lo) * i) / 3;
    s += `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/>`;
    s += `<text class="axis" x="${padL - 6}" y="${y(v) + 4}" text-anchor="end">${esc(compactMoney(v))}</text>`;
  }
  if (lo < 0 && hi > 0) s += `<line class="baseline" x1="${padL}" x2="${W - padR}" y1="${y(0)}" y2="${y(0)}"/>`;
  s += `<polyline class="line" points="${rows.map((r, i) => `${x(i).toFixed(1)},${y(r.value).toFixed(1)}`).join(' ')}"/>`;
  const cur = currentMonth();
  rows.forEach((r, i) => {
    const tip = `<strong>${esc(r.key === cur ? "Aujourd'hui" : 'Fin ' + monthLabel(r.key))}</strong><br>${esc(money(r.value))}`;
    s += `<g class="hov" ${tipAttr(tip)}><rect class="hit" x="${padL + i * cw}" y="${padT}" width="${cw}" height="${ih + padB}"/>
      <line class="xhair" x1="${x(i)}" x2="${x(i)}" y1="${padT}" y2="${padT + ih}"/>
      <circle class="pt ${i === rows.length - 1 ? 'last' : ''}" cx="${x(i)}" cy="${y(r.value)}" r="4"/>
      <text class="axis ${r.key === cur ? 'strong' : ''}" x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(monthShort(r.key))}</text></g>`;
  });
  el.innerHTML = s + '</svg>';
}

function hydrateCharts() {
  viewEl.querySelectorAll('.chart[data-chart]').forEach((el) => {
    const rows = chartData[el.dataset.chart];
    if (!rows || !rows.length) return;
    if (el.dataset.chart === 'bars') drawBars(el, rows);
    else drawWorth(el, rows);
  });
}

/* ---------- Infobulle des graphiques ---------- */
function setupChartTooltip() {
  const tip = document.createElement('div');
  tip.className = 'viz-tip';
  tip.hidden = true;
  document.body.appendChild(tip);
  let current = null;
  const place = (e) => {
    const pad = 12;
    const r = tip.getBoundingClientRect();
    let left = e.clientX + pad;
    let top = e.clientY - r.height - pad;
    if (left + r.width > innerWidth - 8) left = e.clientX - r.width - pad;
    if (top < 8) top = e.clientY + pad;
    tip.style.left = Math.max(8, left) + 'px';
    tip.style.top = top + 'px';
  };
  const show = (g, e) => {
    if (current) current.classList.remove('on');
    current = g;
    g.classList.add('on');
    tip.innerHTML = g.dataset.tip;
    tip.hidden = false;
    place(e);
  };
  const hide = () => {
    if (current) current.classList.remove('on');
    current = null;
    tip.hidden = true;
  };
  document.addEventListener('pointermove', (e) => {
    const g = e.target.closest?.('[data-tip]');
    if (g) {
      if (g !== current) show(g, e);
      else place(e);
    } else if (current && e.pointerType === 'mouse') hide();
  });
  document.addEventListener('pointerdown', (e) => {
    const g = e.target.closest?.('[data-tip]');
    if (g) show(g, e);
    else hide();
  });
  window.addEventListener('scroll', hide, { passive: true });
}
