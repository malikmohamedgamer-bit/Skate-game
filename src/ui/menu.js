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

// ---------------------------------------------------------------------------
// Settings (accessibility, gameplay, camera, audio, touch, controls, graphics)
// ---------------------------------------------------------------------------
function check(id, label, value, hint = '') {
  return `<div class="setting"><label for="${id}">${label}${hint ? `<span class="hint">${hint}</span>` : ''}</label>
    <input type="checkbox" id="${id}" ${value ? 'checked' : ''} /></div>`;
}
function select(id, label, value, options, hint = '') {
  return `<div class="setting"><label for="${id}">${label}${hint ? `<span class="hint">${hint}</span>` : ''}</label>
    <select id="${id}">${options.map(([v, t]) => `<option value="${v}" ${String(v) === String(value) ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`;
}
function range(id, label, value, min, max, step, text) {
  return `<div class="setting"><label for="${id}">${label} <output id="${id}-out" for="${id}">${text}</output></label>
    <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}" aria-valuetext="${text}" /></div>`;
}

function keysTable(bindings) {
  return Object.keys(ACTION_LABELS)
    .map((a) => {
      const k = bindings[a] || [];
      const cell = (slot) =>
        `<td><button class="btn keybtn" data-rebind="${a}" data-slot="${slot}" aria-label="${esc(ACTION_LABELS[a])}, ${slot === 0 ? 'primary' : 'secondary'} key: ${esc(keyLabel(k[slot]))}. Activate to change.">${esc(keyLabel(k[slot]))}</button></td>`;
      return `<tr><th scope="row">${esc(ACTION_LABELS[a])}</th>${cell(0)}${cell(1)}</tr>`;
    })
    .join('');
}

/**
 * actions: { back, change(path, value), rebind(action, slot, code, swap) -> result,
 *            preset(name), resetKeys(), captureKey(fn), cancelCapture(), getBindings() }
 */
export function showSettings(sm, { settings, bindings, inGame = false }, actions) {
  const a = settings.a11y;
  const c = settings.camera;
  const html = `
    <p class="muted">Changes apply right away and are saved.</p>
    <div class="settings-grid">
      <fieldset><legend>Accessibility &amp; display</legend>
        ${check('set-reduced', 'Reduced motion', a.reducedMotion, 'No camera shake, flashing or rapid zoom')}
        ${check('set-contrast', 'High contrast', a.highContrast, 'Stronger colors and outlines in menus and the world')}
        ${check('set-cb', 'Colorblind-safe palette', a.colorblind, 'Okabe-Ito colors for good/bad, rails, ramps and pickups')}
        ${range('set-text', 'Text size', Math.round(a.textScale * 100), 80, 200, 10, `${Math.round(a.textScale * 100)}%`)}
        ${check('set-captions', 'Sound captions', a.captions, 'On-screen text for every important sound')}
        ${check('set-announce', 'Screen reader: announce tricks and Bolts', a.announceTricks, 'Quests, levels and bails are always announced')}
        ${check('set-tracker', 'Quest tracker on the HUD', a.questTracker)}
      </fieldset>
      <fieldset><legend>Gameplay</legend>
        ${select('set-speed', 'Game speed', a.gameSpeed, [
          [1, 'Normal (100%)'],
          [0.75, 'Slow (75%)'],
          [0.5, 'Slower (50%)'],
        ], 'Slower speed gives more time for trick timing')}
        ${check('set-forgiving', 'Forgiving landings', a.forgivingLandings, 'Wider landing tolerance and calmer grind balance')}
        ${check('set-autopush', 'Auto-push', a.autoPush, 'Keeps pushing for you up to cruising speed')}
      </fieldset>
      <fieldset><legend>Camera</legend>
        ${select('set-cam', 'Camera view', c.mode, [
          ['follow', 'Third-person follow'],
          ['close', 'Close (over the shoulder)'],
          ['first', 'First person'],
          ['top', 'Top-down'],
        ])}
        ${range('set-smooth', 'Camera smoothing', Math.round(c.smoothing * 100), 0, 100, 10, c.smoothing <= 0.001 ? 'Off' : `${Math.round(c.smoothing * 100)}%`)}
        ${check('set-shake', 'Camera shake', c.shake && !a.reducedMotion, a.reducedMotion ? 'Off while reduced motion is on' : '')}
      </fieldset>
      <fieldset><legend>Audio</legend>
        ${check('set-mute', 'Mute all sound', settings.audio.muted)}
        ${range('set-volume', 'Volume', Math.round(settings.audio.volume * 100), 0, 100, 5, `${Math.round(settings.audio.volume * 100)}%`)}
      </fieldset>
      <fieldset><legend>Touch controls</legend>
        ${select('set-touch', 'Show touch controls', a.touchControls, [
          ['auto', 'Automatic (touch screens)'],
          ['on', 'Always'],
          ['off', 'Never'],
        ])}
        ${select('set-touch-layout', 'Button layout', a.touchLayout, [
          ['standard', 'Two thumbs'],
          ['left', 'One hand: left side'],
          ['right', 'One hand: right side'],
        ])}
        ${select('set-touch-size', 'Button size', a.touchScale, [
          [1, 'Normal'],
          [1.25, 'Large'],
          [1.5, 'Extra large'],
        ])}
        ${check('set-swipe-steer', 'Swipe to steer', a.swipeSteer, 'Drag on the steering side to steer smoothly')}
      </fieldset>
      <fieldset><legend>Graphics</legend>
        ${check('set-shadows', 'Shadows', settings.graphics.shadows, 'Turn off for better performance')}
      </fieldset>
    </div>
    <fieldset class="keys-fieldset"><legend>Keyboard controls</legend>
      ${select('set-onehand', 'One-handed keyboard', a.oneHanded, [
        ['off', 'Off (default keys)'],
        ['left', 'Left hand only (WASD side)'],
        ['right', 'Right hand only (arrow keys side)'],
      ], 'Puts every action within reach of one hand')}
      <div id="key-notice" role="status" aria-live="polite"></div>
      <table class="keys-table"><thead><tr><th scope="col">Action</th><th scope="col">Primary</th><th scope="col">Secondary</th></tr></thead>
        <tbody id="keys-body">${keysTable(bindings)}</tbody></table>
      <p class="row"><button class="btn" id="keys-reset">Reset keys to defaults</button></p>
      <p class="muted small">Esc always pauses and goes back. Tab and Enter are kept for menu navigation.</p>
    </fieldset>
    ${inGame ? '<p class="muted small">Some visual changes apply when you resume.</p>' : ''}`;
  const el = sm.show({ id: 'settings', title: 'Settings &amp; accessibility', onBack: actions.back, html, label: inGame ? 'pause menu' : 'main menu' });

  const bindCheck = (id, path) => el.querySelector('#' + id).addEventListener('change', (e) => actions.change(path, e.target.checked));
  const bindSelect = (id, path, num = false) => el.querySelector('#' + id).addEventListener('change', (e) => actions.change(path, num ? Number(e.target.value) : e.target.value));
  const bindRange = (id, path, scale, fmt) => {
    const inp = el.querySelector('#' + id);
    const out = el.querySelector(`#${id}-out`);
    inp.addEventListener('input', () => {
      const t = fmt(Number(inp.value));
      out.textContent = t;
      inp.setAttribute('aria-valuetext', t);
      actions.change(path, Number(inp.value) / scale);
    });
  };
  bindCheck('set-reduced', 'a11y.reducedMotion');
  bindCheck('set-contrast', 'a11y.highContrast');
  bindCheck('set-cb', 'a11y.colorblind');
  bindRange('set-text', 'a11y.textScale', 100, (v) => `${v}%`);
  bindCheck('set-captions', 'a11y.captions');
  bindCheck('set-announce', 'a11y.announceTricks');
  bindCheck('set-tracker', 'a11y.questTracker');
  bindSelect('set-speed', 'a11y.gameSpeed', true);
  bindCheck('set-forgiving', 'a11y.forgivingLandings');
  bindCheck('set-autopush', 'a11y.autoPush');
  bindSelect('set-cam', 'camera.mode');
  bindRange('set-smooth', 'camera.smoothing', 100, (v) => (v === 0 ? 'Off' : `${v}%`));
  bindCheck('set-shake', 'camera.shake');
  bindCheck('set-mute', 'audio.muted');
  bindRange('set-volume', 'audio.volume', 100, (v) => `${v}%`);
  bindSelect('set-touch', 'a11y.touchControls');
  bindSelect('set-touch-layout', 'a11y.touchLayout');
  bindSelect('set-touch-size', 'a11y.touchScale', true);
  bindCheck('set-swipe-steer', 'a11y.swipeSteer');
  bindCheck('set-shadows', 'graphics.shadows');

  const notice = el.querySelector('#key-notice');
  const refreshKeys = (focusSel) => {
    el.querySelector('#keys-body').innerHTML = keysTable(actions.getBindings());
    wireKeys();
    const f = focusSel && el.querySelector(focusSel);
    if (f) f.focus();
  };
  el.querySelector('#set-onehand').addEventListener('change', (e) => {
    actions.preset(e.target.value);
    notice.textContent = e.target.value === 'off' ? 'Default keys restored.' : `One-handed ${e.target.value} keys applied.`;
    refreshKeys();
  });
  el.querySelector('#keys-reset').addEventListener('click', () => {
    actions.resetKeys();
    el.querySelector('#set-onehand').value = 'off';
    notice.textContent = 'Keys reset to defaults.';
    refreshKeys('#keys-reset');
  });

  function wireKeys() {
    for (const b of el.querySelectorAll('[data-rebind]')) {
      b.addEventListener('click', () => {
        const action = b.dataset.rebind;
        const slot = Number(b.dataset.slot);
        b.classList.add('capturing');
        b.textContent = 'Press a key…';
        notice.textContent = `Press the new key for ${ACTION_LABELS[action]}, or Escape to cancel.`;
        actions.captureKey((code) => {
          b.classList.remove('capturing');
          if (code === 'Escape') {
            notice.textContent = 'Cancelled.';
            refreshKeys(`[data-rebind="${action}"][data-slot="${slot}"]`);
            return;
          }
          const r = actions.rebind(action, slot, code, false);
          if (r.ok) {
            notice.textContent = `${ACTION_LABELS[action]}: ${keyLabel(code)}.`;
            refreshKeys(`[data-rebind="${action}"][data-slot="${slot}"]`);
          } else if (r.reason === 'conflict') {
            notice.innerHTML = `<div class="notice" role="alert"><strong>${esc(keyLabel(code))}</strong> is already used for <strong>${esc(ACTION_LABELS[r.conflict.action])}</strong>.
              <div class="row"><button class="btn primary" id="key-swap">Swap keys</button><button class="btn" id="key-cancel">Cancel</button></div></div>`;
            refreshKeys();
            el.querySelector('#key-swap').addEventListener('click', () => {
              actions.rebind(action, slot, code, true);
              notice.textContent = `Swapped: ${ACTION_LABELS[action]} is now ${keyLabel(code)}.`;
              refreshKeys(`[data-rebind="${action}"][data-slot="${slot}"]`);
            });
            el.querySelector('#key-cancel').addEventListener('click', () => {
              notice.textContent = 'Cancelled.';
              refreshKeys(`[data-rebind="${action}"][data-slot="${slot}"]`);
            });
            el.querySelector('#key-swap').focus();
          } else {
            notice.textContent =
              r.reason === 'reserved'
                ? `${keyLabel(code)} cannot be used: it is needed for menu navigation.`
                : r.reason === 'locked'
                  ? 'Escape always pauses and cannot be moved.'
                  : 'That key cannot be used.';
            refreshKeys(`[data-rebind="${action}"][data-slot="${slot}"]`);
          }
        });
      });
    }
  }
  wireKeys();
  return el;
}
