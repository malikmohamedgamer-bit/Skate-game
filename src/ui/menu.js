// Menus: main menu, level select, free roam, pause, results, help.
// Every screen is a role="dialog" with a heading, native buttons (Tab/Enter work),
// visible focus, Escape = back, and focus trapped inside the dialog.

import { describeObjective, isMapUnlocked, levelUnlockState, totalStars } from '../game/levels.js';
import { keyLabel, ACTION_LABELS } from '../core/input.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Star rating as icons plus an accessible text equivalent. */
export function starsHtml(n, max = 3) {
  const icons = '★'.repeat(n) + '☆'.repeat(max - n);
  return `<span class="stars" aria-hidden="true">${icons}</span><span class="sr-only">${n} of ${max} stars</span>`;
}

export function createScreenManager(root) {
  let current = null;
  let onBack = null;
  let lastFocus = null;

  function trap(e) {
    if (e.key !== 'Tab' || !current) return;
    const items = [...current.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    } else if (!current.contains(document.activeElement)) {
      e.preventDefault();
      first.focus();
    }
  }
  document.addEventListener('keydown', trap);

  return {
    /**
     * Show a screen. opts: { id, title, html, onBack, narrow, focus (selector) }.
     * Returns the screen element so callers can wire events.
     */
    show({ id, title, html, onBack: back = null, narrow = false, focus = null, label = null }) {
      lastFocus = document.activeElement;
      root.innerHTML = `
        <div class="screen" id="screen-${esc(id)}" role="dialog" aria-modal="true" aria-labelledby="${esc(id)}-title">
          <div class="panel${narrow ? ' narrow' : ''}">
            <div class="row screen-head">
              ${back ? `<button class="btn back-btn" data-action="back" aria-label="Back${label ? ' to ' + esc(label) : ''}"><span aria-hidden="true">←</span> Back</button>` : ''}
              <h1 id="${esc(id)}-title" class="screen-title">${title}</h1>
            </div>
            ${html}
          </div>
        </div>`;
      current = root.firstElementChild;
      onBack = back;
      const backBtn = current.querySelector('[data-action="back"]');
      if (backBtn) backBtn.addEventListener('click', () => onBack && onBack());
      const target = (focus && current.querySelector(focus)) || current.querySelector('[data-autofocus]') || current.querySelector('.panel ' + FOCUSABLE.split(',')[0]);
      if (target) target.focus();
      return current;
    },
    close() {
      root.innerHTML = '';
      current = null;
      onBack = null;
    },
    /** Escape / gamepad B. Returns true if handled. */
    back() {
      if (onBack) {
        onBack();
        return true;
      }
      return false;
    },
    get current() {
      return current;
    },
    get lastFocus() {
      return lastFocus;
    },
  };
}

function on(el, sel, fn) {
  for (const b of el.querySelectorAll(sel)) b.addEventListener('click', () => fn(b));
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------
export function showMainMenu(sm, { profile, data }, actions) {
  const stars = totalStars(profile.levels);
  const maxStars = data.levels.length * 3;
  const el = sm.show({
    id: 'main',
    title: '<span class="bolt-mark" aria-hidden="true">⚡</span> Bolt Skate',
    narrow: true,
    html: `
      <p class="subtitle">Skate and scoot through the streets.</p>
      <p class="row">
        <span class="chip"><span aria-hidden="true">⚡</span> <span class="bolts" id="menu-bolts">${profile.bolts}</span>&nbsp;Bolts</span>
        <span class="chip"><span aria-hidden="true">★</span> <span id="menu-stars">${stars}</span>&nbsp;/ ${maxStars} stars</span>
      </p>
      <ul class="menu-list" role="list">
        <li><button class="btn primary" data-go="levels" data-autofocus><span class="icon" aria-hidden="true">▶</span>Play levels</button></li>
        <li><button class="btn" data-go="free"><span class="icon" aria-hidden="true">🛹</span>Free roam</button></li>
        <li><button class="btn" data-go="quests"><span class="icon" aria-hidden="true">📜</span>Quests</button></li>
        <li><button class="btn" data-go="shop"><span class="icon" aria-hidden="true">🛒</span>Shop &amp; garage</button></li>
        <li><button class="btn" data-go="settings"><span class="icon" aria-hidden="true">⚙</span>Settings &amp; accessibility</button></li>
        <li><button class="btn" data-go="help"><span class="icon" aria-hidden="true">?</span>How to play</button></li>
      </ul>`,
  });
  el.classList.add('main-menu');
  on(el, '[data-go]', (b) => actions.go(b.dataset.go));
  return el;
}

export function showLevelSelect(sm, { profile, data }, actions) {
  const byId = Object.fromEntries(data.levels.map((l) => [l.id, l]));
  let firstOpen = null;
  const sections = data.mapOrder
    .filter((m) => data.levels.some((l) => l.map === m))
    .map((m) => {
      const map = data.maps[m];
      const mapOpen = isMapUnlocked(map, profile.levels);
      const levels = data.levels.filter((l) => l.map === m);
      const cards = levels
        .map((l) => {
          const st = levelUnlockState(l, data.maps, profile.levels, byId);
          const best = profile.levels[l.id]?.bestStars || 0;
          const lockIcon = st.unlocked ? '' : '<span aria-hidden="true">🔒</span> ';
          const focusMe = st.unlocked && !firstOpen;
          if (focusMe) firstOpen = l.id;
          return `<li>
            <button class="btn level-card${st.unlocked ? '' : ' locked'}" data-level="${l.id}" ${st.unlocked ? '' : 'aria-disabled="true"'}${focusMe ? ' data-autofocus' : ''}
              aria-describedby="lvl-${l.id}-desc">
              <span class="level-name">${lockIcon}${esc(l.name)}</span>
              <span class="level-stars">${starsHtml(best)}</span>
            </button>
            <p class="muted level-desc" id="lvl-${l.id}-desc">${st.unlocked ? esc(describeObjective(l)) : 'Locked: ' + esc(st.reason)}</p>
          </li>`;
        })
        .join('');
      return `<section class="map-section" aria-labelledby="sec-${m}">
        <h2 id="sec-${m}">${mapOpen ? '' : '<span aria-hidden="true">🔒</span> '}${esc(map.name)}
          ${mapOpen ? '' : `<span class="muted small">(needs ${map.unlock.stars} ★)</span>`}</h2>
        <ul class="level-grid" role="list">${cards}</ul></section>`;
    })
    .join('');
  const el = sm.show({ id: 'levels', title: 'Levels', onBack: actions.back, label: 'main menu', html: sections });
  on(el, '[data-level]', (b) => {
    if (b.getAttribute('aria-disabled') === 'true') {
      actions.announce(b.parentElement.querySelector('.level-desc').textContent);
      return;
    }
    actions.startLevel(b.dataset.level);
  });
  return el;
}

export function showFreeRoam(sm, { profile, data }, actions) {
  const items = data.mapOrder
    .map((id) => {
      const m = data.maps[id];
      const open = isMapUnlocked(m, profile.levels);
      return `<li><button class="btn${open ? '' : ' locked'}" data-map="${id}" ${open ? '' : 'aria-disabled="true"'} aria-describedby="map-${id}-desc">
          <span class="icon" aria-hidden="true">${open ? '▶' : '🔒'}</span>${esc(m.name)}</button>
          <p class="muted level-desc" id="map-${id}-desc">${open ? esc(m.description) : `Locked: earn ${m.unlock.stars} ★ in levels (you have ${totalStars(profile.levels)}).`}</p></li>`;
    })
    .join('');
  const el = sm.show({ id: 'free', title: 'Free roam', onBack: actions.back, label: 'main menu', narrow: true, html: `<ul class="menu-list" id="map-list" role="list">${items}</ul>` });
  on(el, '[data-map]', (b) => {
    if (b.getAttribute('aria-disabled') === 'true') {
      actions.announce(b.parentElement.querySelector('.level-desc').textContent);
      return;
    }
    actions.startFree(b.dataset.map);
  });
  return el;
}

export function showPause(sm, { level }, actions) {
  const el = sm.show({
    id: 'pause',
    title: 'Paused',
    narrow: true,
    onBack: actions.resume,
    html: `
      ${level ? `<p class="muted">${esc(level.name)}: ${esc(describeObjective(level))}</p>` : ''}
      <ul class="menu-list" role="list">
        <li><button class="btn primary" data-act="resume" data-autofocus><span class="icon" aria-hidden="true">▶</span>Resume</button></li>
        <li><button class="btn" data-act="retry"><span class="icon" aria-hidden="true">↻</span>${level ? 'Retry level' : 'Restart run'}</button></li>
        <li><button class="btn" data-act="settings"><span class="icon" aria-hidden="true">⚙</span>Settings</button></li>
        <li><button class="btn" data-act="help"><span class="icon" aria-hidden="true">?</span>Controls</button></li>
        <li><button class="btn danger" data-act="quit"><span class="icon" aria-hidden="true">⏏</span>Quit to menu</button></li>
      </ul>`,
  });
  on(el, '[data-act]', (b) => actions[b.dataset.act]());
  return el;
}

export function showResults(sm, { level, result, next, nextUnlocked }, actions) {
  const ok = result.stars > 0;
  const valueText =
    level.objective.type === 'timeTrial'
      ? result.value !== null && result.value !== undefined
        ? `Time: ${result.value.toFixed(2)} s`
        : 'Did not finish in time'
      : level.objective.type === 'grindDistance'
        ? `Grind distance: ${result.value.toFixed(1)} m`
        : level.objective.type === 'score'
          ? `Score: ${Math.round(result.value).toLocaleString('en-US')}`
          : level.objective.type === 'tricks'
            ? `Clean tricks: ${result.value}`
            : `Bolts collected: ${result.value}`;
  const el = sm.show({
    id: 'results',
    title: ok ? '<span aria-hidden="true">✔</span> Level complete' : '<span aria-hidden="true">✖</span> Level failed',
    narrow: true,
    onBack: actions.menu,
    html: `
      <p class="result-stars">${starsHtml(result.stars)}</p>
      <p><strong>${esc(level.name)}</strong> · ${esc(valueText)}</p>
      ${level.objective.type === 'score' ? (result.improved ? '<p><strong>New best!</strong></p>' : '') : `<p>Score ${Math.round(result.score).toLocaleString('en-US')}${result.improved ? ' · <strong>New best!</strong>' : ''}</p>`}
      <p><span aria-hidden="true">⚡</span> +${result.boltsRun} Bolts from the run${result.boltsLevel ? `, +${result.boltsLevel} level reward` : ''}</p>
      ${!ok ? `<p class="muted">Need ${level.objective.type === 'timeTrial' ? `under ${level.objective.stars[0]} s` : `${level.objective.stars[0]}`} for 1 star.</p>` : ''}
      <ul class="menu-list" role="list">
        ${next && nextUnlocked ? `<li><button class="btn primary" data-act="next" data-autofocus><span class="icon" aria-hidden="true">▶</span>Next: ${esc(next.name)}</button></li>` : ''}
        <li><button class="btn${next && nextUnlocked ? '' : ' primary'}" data-act="retry" ${next && nextUnlocked ? '' : 'data-autofocus'}><span class="icon" aria-hidden="true">↻</span>Retry</button></li>
        <li><button class="btn" data-act="levels"><span class="icon" aria-hidden="true">☰</span>Level select</button></li>
        <li><button class="btn" data-act="menu"><span class="icon" aria-hidden="true">⌂</span>Main menu</button></li>
      </ul>`,
  });
  on(el, '[data-act]', (b) => actions[b.dataset.act]());
  return el;
}

export function showHelp(sm, { bindings }, actions) {
  const rows = Object.keys(ACTION_LABELS)
    .map((a) => `<tr><th scope="row">${esc(ACTION_LABELS[a])}</th><td>${(bindings[a] || []).filter(Boolean).map(keyLabel).map(esc).join(' or ') || '—'}</td></tr>`)
    .join('');
  return sm.show({
    id: 'help',
    title: 'How to play',
    onBack: actions.back,
    html: `
      <div class="help-grid">
        <section aria-labelledby="h-keys"><h2 id="h-keys">Keyboard</h2><table class="keys">${rows}</table>
          <p class="muted">Gamepad: left stick steers / flips, A ollie, X trick, RT push, LT or B brake, Start pause.</p></section>
        <section aria-labelledby="h-tricks"><h2 id="h-tricks">Tricks</h2>
          <ul>
            <li><strong>Ollie</strong>: press ollie. Faster = higher.</li>
            <li><strong>Spins</strong> (180, 360…): hold left/right in the air. Let go and the spin finishes to the next 180.</li>
            <li><strong>Flips</strong>: tap forward or back in the air (kickflip / heelflip, front flip / backflip on the scooter).</li>
            <li><strong>Shove-it / tailwhip</strong>: hold the trick button and tap left/right in the air.</li>
            <li><strong>Grabs</strong>: hold the trick button in the air (with forward or back for other grabs). Let go before landing.</li>
            <li><strong>Grinds</strong>: ollie and come down onto a rail, ledge or bench. Steer against the balance meter.</li>
            <li><strong>Landing</strong>: finish your rotation before you land, roughly straight. A bail resets your combo.</li>
            <li><strong>Combos</strong>: keep landing tricks within 3 s of each other for a multiplier up to ×5.</li>
          </ul></section>
        <section aria-labelledby="h-touch"><h2 id="h-touch">Touch</h2>
          <p>Use the on-screen buttons. Swipe up on the right half to ollie; swipe in the air to flip or spin. Turn on one-handed layouts and bigger buttons in Settings.</p></section>
      </div>`,
  });
}
