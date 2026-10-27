'use strict';

/* =========================================================
   Lot 3 : verrouillage optionnel par code à 4 chiffres.
   Écran de confidentialité : le code est stocké haché (SHA-256),
   mais les données elles-mêmes ne sont pas chiffrées.
   Uniquement des déclarations (chargé avant app.js).
   ========================================================= */

const PIN_LENGTH = 4;
const RELOCK_AFTER_MS = 60 * 1000;
let lockState = { locked: false, entered: '', error: '' };
let hiddenAt = 0;

const lockSupported = () => !!(window.crypto && crypto.subtle && window.isSecureContext);

async function hashPin(pin, salt) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + pin));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function checkPin(pin) {
  const p = state.settings.pin;
  return !!p && (await hashPin(pin, p.salt)) === p.hash;
}

function pinDots(n, error) {
  return `<div class="pin-dots ${error ? 'shake' : ''}" aria-hidden="true">${Array.from({ length: PIN_LENGTH }, (_, i) => `<span class="${i < n ? 'on' : ''}"></span>`).join('')}</div>`;
}

function pinPad(action) {
  return `<div class="keypad pin-pad">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back']
    .map((k) =>
      k === ''
        ? '<span></span>'
        : `<button class="key" data-action="${action}" data-key="${k}" aria-label="${k === 'back' ? 'Effacer' : k}">${k === 'back' ? ICON.back : k}</button>`
    )
    .join('')}</div>`;
}

/* ---------- Écran de verrouillage ---------- */
const lockEl = () => $('#lock');

function showLock() {
  if (!state.settings.pin || !lockSupported()) return;
  lockState = { locked: true, entered: '', error: '' };
  if (sheet) closeSheet();
  renderLock();
  lockEl().hidden = false;
  document.body.classList.add('is-locked');
}

function renderLock() {
  lockEl().innerHTML = `<div class="lock-box">
    <img src="icons/icon.svg" alt="" width="64" height="64">
    <h2>Mon Budget</h2>
    <p class="muted">${lockState.error ? `<span style="color:var(--expense)">${esc(lockState.error)}</span>` : 'Entre ton code'}</p>
    ${pinDots(lockState.entered.length, !!lockState.error)}
    ${pinPad('lock-key')}
    <button class="link small" data-action="lock-forgot" style="margin-top:14px">Code oublié ?</button>
  </div>`;
}

async function lockKey(k) {
  if (!lockState.locked) return;
  if (k === 'back') lockState.entered = lockState.entered.slice(0, -1);
  else if (/^\d$/.test(k) && lockState.entered.length < PIN_LENGTH) lockState.entered += k;
  lockState.error = '';
  if (lockState.entered.length === PIN_LENGTH) {
    const ok = await checkPin(lockState.entered);
    if (ok) {
      lockState = { locked: false, entered: '', error: '' };
      lockEl().hidden = true;
      lockEl().innerHTML = '';
      document.body.classList.remove('is-locked');
      return;
    }
    lockState.entered = '';
    lockState.error = 'Code incorrect';
  }
  renderLock();
}

function lockForgot() {
  if (!confirm("Sans le code, la seule solution est d'effacer toutes les données de cet appareil. Continuer ?")) return;
  if (!confirm('Dernière confirmation : effacer comptes, catégories et opérations ?')) return;
  state = defaultState();
  save();
  lockState = { locked: false, entered: '', error: '' };
  lockEl().hidden = true;
  document.body.classList.remove('is-locked');
  applyTheme();
  render();
  toast('Données effacées, code supprimé');
}

/* ---------- Feuille : activer / changer / désactiver le code ---------- */
function openPinSheet(mode) {
  if (!lockSupported()) return toast("Le code nécessite d'ouvrir l'appli via http://localhost ou en ligne (https)");
  openSheet('pin', { mode, step: mode === 'set' ? 'new' : 'current', entered: '', first: '', error: '' });
}

function pinSheet(d) {
  const titles = { set: 'Activer le code', change: 'Changer le code', disable: 'Désactiver le code' };
  const prompts = { current: 'Entre ton code actuel', new: `Choisis un code à ${PIN_LENGTH} chiffres`, confirm: 'Confirme le code' };
  return `${sheetHead(titles[d.mode])}
    <div class="pin-sheet">
      <p class="muted">${d.error ? `<span style="color:var(--expense)">${esc(d.error)}</span>` : prompts[d.step]}</p>
      ${pinDots(d.entered.length, !!d.error)}
      ${pinPad('pin-key')}
      <p class="muted small">Le code protège l'accès à l'appli sur cet appareil. En cas d'oubli, il faudra effacer les données : garde une sauvegarde exportée.</p>
    </div>`;
}

async function pinKey(k) {
  const d = sheet.draft;
  if (k === 'back') d.entered = d.entered.slice(0, -1);
  else if (/^\d$/.test(k) && d.entered.length < PIN_LENGTH) d.entered += k;
  d.error = '';
  if (d.entered.length < PIN_LENGTH) return renderSheet();

  const code = d.entered;
  d.entered = '';
  if (d.step === 'current') {
    if (!(await checkPin(code))) {
      d.error = 'Code incorrect';
      return renderSheet();
    }
    if (d.mode === 'disable') {
      state.settings.pin = null;
      save();
      closeSheet();
      render();
      return toast('Code désactivé');
    }
    d.step = 'new';
  } else if (d.step === 'new') {
    d.first = code;
    d.step = 'confirm';
  } else if (d.step === 'confirm') {
    if (code !== d.first) {
      d.step = 'new';
      d.first = '';
      d.error = 'Les deux codes sont différents, recommence';
      return renderSheet();
    }
    const salt = uid() + uid();
    state.settings.pin = { salt, hash: await hashPin(code, salt) };
    save();
    closeSheet();
    render();
    return toast(d.mode === 'change' ? 'Code modifié' : 'Code activé');
  }
  renderSheet();
}

function lockAction(action, el) {
  switch (action) {
    case 'lock-key': lockKey(el.dataset.key); return true;
    case 'lock-forgot': lockForgot(); return true;
    case 'pin-set': openPinSheet('set'); return true;
    case 'pin-change': openPinSheet('change'); return true;
    case 'pin-disable': openPinSheet('disable'); return true;
    case 'pin-key': pinKey(el.dataset.key); return true;
    case 'lock-now': showLock(); return true;
  }
  return false;
}

function settingsSecurity() {
  if (!lockSupported()) {
    return `<p class="muted small" style="margin:0">Le verrouillage par code est disponible quand l'appli est ouverte via <strong>Lancer Mon Budget.bat</strong> ou en ligne.</p>`;
  }
  return state.settings.pin
    ? `<p class="muted small" style="margin-top:0">🔒 Code activé. L'appli se verrouille à l'ouverture et après 1 minute en arrière-plan.</p>
       <div class="btn-row" style="position:static;margin:0;padding:0;background:none">
         <button class="btn" data-action="pin-change">Changer</button><button class="btn" data-action="lock-now">Verrouiller</button><button class="btn danger" data-action="pin-disable">Désactiver</button>
       </div>`
    : `<p class="muted small" style="margin-top:0">Protège l'accès à l'appli par un code à ${PIN_LENGTH} chiffres.</p>
       <button class="btn block" data-action="pin-set">Activer le code</button>`;
}
