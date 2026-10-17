// On-screen touch controls: steer, push, brake, ollie, trick modifier, plus swipe
// gestures. Layouts: standard (two thumbs), one-handed left, one-handed right.
// Buttons are >= 44x44 CSS px at every scale and can be enlarged in Settings.

export const MIN_TOUCH = 44;

export const TOUCH_BUTTONS = [
  { id: 'left', action: 'left', label: 'Steer left (spin left in the air)', text: '◀' },
  { id: 'right', action: 'right', label: 'Steer right (spin right in the air)', text: '▶' },
  { id: 'forward', action: 'forward', label: 'Push (flip forward in the air)', text: 'PUSH' },
  { id: 'back', action: 'back', label: 'Brake (flip back in the air)', text: 'BRAKE' },
  { id: 'ollie', action: 'ollie', label: 'Ollie', text: 'OLLIE', big: true },
  { id: 'trick', action: 'trick', label: 'Trick modifier: hold for grabs, shove-its and tailwhips', text: 'TRICK' },
];

/**
 * Pure layout: where each button goes and how big it is.
 * Returns [{ id, zone: 'left'|'right', row, col, size }].
 */
export function layoutFor(layout = 'standard', scale = 1) {
  const s = Math.max(1, scale);
  const base = Math.round(64 * s);
  const big = Math.round(84 * s);
  const size = (id) => Math.max(MIN_TOUCH, id === 'ollie' ? big : base);
  if (layout === 'left' || layout === 'right') {
    // One hand: everything in a 3 x 2 cluster on one side.
    const grid = [
      ['forward', 'trick', 'ollie'],
      ['left', 'back', 'right'],
    ];
    const out = [];
    grid.forEach((row, r) => row.forEach((id, c) => out.push({ id, zone: layout, row: r, col: c, size: size(id) })));
    return out;
  }
  return [
    { id: 'left', zone: 'left', row: 1, col: 0, size: size('left') },
    { id: 'right', zone: 'left', row: 1, col: 1, size: size('right') },
    { id: 'forward', zone: 'right', row: 0, col: 0, size: size('forward') },
    { id: 'trick', zone: 'right', row: 1, col: 0, size: size('trick') },
    { id: 'back', zone: 'right', row: 0, col: 1, size: size('back') },
    { id: 'ollie', zone: 'right', row: 1, col: 1, size: size('ollie') },
  ];
}

/** Classify a finished touch drag. Returns 'up' | 'down' | 'left' | 'right' | null. */
export function classifySwipe({ dx, dy, dt }, { minDist = 35, maxTime = 650, ratio = 1.3 } = {}) {
  if (!(dt > 0) || dt > maxTime) return null;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < minDist) return null;
  if (ay >= ax * ratio) return dy < 0 ? 'up' : 'down';
  if (ax >= ay * ratio) return dx < 0 ? 'left' : 'right';
  return null;
}

/** What a swipe does. Returns { pulse?: action, hold?: action, ms? } or null. */
export function swipeAction(dir, airborne) {
  if (!dir) return null;
  if (!airborne) return dir === 'up' ? { pulse: 'ollie' } : null;
  if (dir === 'up') return { pulse: 'forward' };
  if (dir === 'down') return { pulse: 'back' };
  if (dir === 'left') return { hold: 'left', ms: 160 };
  if (dir === 'right') return { hold: 'right', ms: 160 };
  return null;
}

export function isTouchDevice() {
  try {
    return (globalThis.matchMedia && globalThis.matchMedia('(pointer: coarse)').matches) || (navigator.maxTouchPoints || 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Build the controls in `root`. opts: { input, getAirborne, layout, scale, swipeSteer }.
 * Returns { setVisible, rebuild(opts), destroy, lastSwipe }.
 */
export function createTouchControls(root, opts) {
  let o = { layout: 'standard', scale: 1, swipeSteer: false, ...opts };
  const { input } = o;
  let lastSwipe = null;
  const active = new Map(); // pointerId -> { action } for buttons, { swipe } for gestures
  const timers = new Set();

  function build() {
    const items = layoutFor(o.layout, o.scale);
    const zones = { left: [], right: [] };
    for (const it of items) zones[it.zone].push(it);
    const btn = (it) => {
      const def = TOUCH_BUTTONS.find((b) => b.id === it.id);
      return `<button type="button" class="tbtn tbtn-${it.id}${def.big ? ' big' : ''}" data-touch-action="${def.action}" aria-label="${def.label}"
        style="width:${it.size}px;height:${it.size}px;grid-row:${it.row + 1};grid-column:${it.col + 1}">${def.text}</button>`;
    };
    root.innerHTML = `
      <div class="tzone tzone-left" data-zone="left">${zones.left.map(btn).join('')}</div>
      <div class="tzone tzone-right" data-zone="right">${zones.right.map(btn).join('')}</div>
      <div class="tswipe" data-swipe="${o.layout === 'left' ? 'right' : 'left'}" aria-hidden="true"></div>`;
    root.dataset.layout = o.layout;
  }

  function releasePointer(id) {
    const a = active.get(id);
    if (!a) return;
    active.delete(id);
    if (a.action) {
      // Only release if no other finger holds the same action.
      if (![...active.values()].some((x) => x.action === a.action)) input.setVirtual(a.action, false);
      a.el && a.el.classList.remove('pressed');
    }
    if (a.steer) input.setVirtualSteer(0);
  }

  function onDown(e) {
    const b = e.target.closest('.tbtn');
    e.preventDefault();
    if (b) {
      try {
        b.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic events */
      }
      active.set(e.pointerId, { action: b.dataset.touchAction, el: b });
      b.classList.add('pressed');
      input.setVirtual(b.dataset.touchAction, true);
      return;
    }
    // Not a button: start a gesture (swipe, or swipe-steer on the steering side).
    const w = root.clientWidth || window.innerWidth;
    const steerSide = o.layout === 'left' ? 'right' : 'left';
    const side = e.clientX < w / 2 ? 'left' : 'right';
    const steer = o.swipeSteer && side === steerSide;
    active.set(e.pointerId, { swipe: true, steer, x: e.clientX, y: e.clientY, t: e.timeStamp || performance.now() });
  }

  function onMove(e) {
    const a = active.get(e.pointerId);
    if (!a) return;
    e.preventDefault();
    if (a.steer) input.setVirtualSteer((e.clientX - a.x) / 70);
  }

  function onUp(e) {
    const a = active.get(e.pointerId);
    if (a && a.swipe && !a.steer) {
      const dir = classifySwipe({ dx: e.clientX - a.x, dy: e.clientY - a.y, dt: (e.timeStamp || performance.now()) - a.t });
      const act = swipeAction(dir, o.getAirborne ? o.getAirborne() : false);
      lastSwipe = dir;
      if (act && act.pulse) input.pulse(act.pulse);
      if (act && act.hold) {
        input.setVirtual(act.hold, true);
        const t = setTimeout(() => {
          input.setVirtual(act.hold, false);
          timers.delete(t);
        }, act.ms);
        timers.add(t);
      }
    }
    releasePointer(e.pointerId);
  }

  const prevent = (e) => {
    if (e.cancelable) e.preventDefault();
  };

  build();
  root.addEventListener('pointerdown', onDown);
  root.addEventListener('pointermove', onMove);
  root.addEventListener('pointerup', onUp);
  root.addEventListener('pointercancel', (e) => releasePointer(e.pointerId));
  root.addEventListener('lostpointercapture', (e) => releasePointer(e.pointerId));
  // Never scroll, zoom or trigger the back gesture from the control layer.
  root.addEventListener('touchstart', prevent, { passive: false });
  root.addEventListener('touchmove', prevent, { passive: false });
  root.addEventListener('contextmenu', prevent);

  return {
    setVisible(v) {
      root.hidden = !v;
      if (!v) for (const id of [...active.keys()]) releasePointer(id);
    },
    rebuild(next) {
      o = { ...o, ...next };
      for (const id of [...active.keys()]) releasePointer(id);
      build();
    },
    get lastSwipe() {
      return lastSwipe;
    },
    destroy() {
      for (const t of timers) clearTimeout(t);
      root.innerHTML = '';
    },
  };
}
