// Input: keyboard, mouse, gamepad and touch (via the "virtual" channel used by
// src/ui/touch.js), with remappable keyboard bindings and conflict detection.
//
// Everything above `createInput` is pure and unit-tested (tests/input.test.js).

export const ACTIONS = ['forward', 'back', 'left', 'right', 'ollie', 'trick', 'brake', 'pause', 'camera', 'respawn'];

export const ACTION_LABELS = {
  forward: 'Push / Flip forward (in air)',
  back: 'Brake / Flip back (in air)',
  left: 'Steer left / Spin left',
  right: 'Steer right / Spin right',
  ollie: 'Ollie (jump)',
  trick: 'Trick modifier (grab, shove-it, tailwhip)',
  brake: 'Brake',
  pause: 'Pause',
  camera: 'Change camera',
  respawn: 'Respawn at start',
};

export const DEFAULT_BINDINGS = Object.freeze({
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  ollie: ['Space', 'KeyJ'],
  trick: ['KeyK', 'KeyE'],
  brake: ['ShiftLeft', 'ShiftRight'],
  pause: ['Escape', 'KeyP'],
  camera: ['KeyC', null],
  respawn: ['KeyR', null],
});

/** One-handed presets: every action reachable from one side of the keyboard. */
export const ONE_HANDED_PRESETS = Object.freeze({
  left: {
    forward: ['KeyW', null],
    back: ['KeyS', null],
    left: ['KeyA', null],
    right: ['KeyD', null],
    ollie: ['Space', null],
    trick: ['KeyE', 'KeyQ'],
    brake: ['ShiftLeft', null],
    pause: ['Escape', 'Digit1'],
    camera: ['KeyC', null],
    respawn: ['KeyR', null],
  },
  right: {
    forward: ['ArrowUp', null],
    back: ['ArrowDown', null],
    left: ['ArrowLeft', null],
    right: ['ArrowRight', null],
    ollie: ['Slash', 'Numpad0'],
    trick: ['Period', 'NumpadDecimal'],
    brake: ['ShiftRight', 'Numpad5'],
    pause: ['Escape', 'KeyP'],
    camera: ['KeyL', null],
    respawn: ['Semicolon', null],
  },
});

/** Keys that can never be bound: they are needed for menu navigation or the browser. */
export const RESERVED_CODES = Object.freeze(['Tab', 'Enter', 'NumpadEnter', 'MetaLeft', 'MetaRight', 'F5', 'F11', 'F12']);
/** Keys locked to a specific action (Escape always pauses / goes back). */
export const LOCKED_CODES = Object.freeze({ Escape: 'pause' });

export function cloneBindings(b) {
  const out = {};
  for (const a of ACTIONS) out[a] = [...(b && b[a] ? b[a] : DEFAULT_BINDINGS[a])].slice(0, 2);
  for (const a of ACTIONS) while (out[a].length < 2) out[a].push(null);
  return out;
}

/** Merge saved bindings over defaults, dropping unknown actions and invalid codes. */
export function normalizeBindings(saved) {
  const out = cloneBindings(DEFAULT_BINDINGS);
  if (!saved || typeof saved !== 'object') return out;
  for (const a of ACTIONS) {
    if (Array.isArray(saved[a])) {
      out[a] = [0, 1].map((i) => (typeof saved[a][i] === 'string' && saved[a][i] ? saved[a][i] : null));
    }
  }
  // If the saved data contains duplicates (hand-edited), fall back to defaults for safety.
  if (listConflicts(out).length) return cloneBindings(DEFAULT_BINDINGS);
  if (out.pause[0] !== 'Escape' && out.pause[1] !== 'Escape') out.pause[0] = 'Escape';
  return out;
}

/** Which action (other than `ignoreAction`/`ignoreSlot`) already uses `code`? */
export function findConflict(bindings, code, ignoreAction = null, ignoreSlot = null) {
  if (!code) return null;
  for (const a of ACTIONS) {
    const keys = bindings[a] || [];
    for (let i = 0; i < keys.length; i++) {
      if (keys[i] !== code) continue;
      if (a === ignoreAction && (ignoreSlot === null || ignoreSlot === i)) continue;
      return { action: a, slot: i };
    }
  }
  return null;
}

/** All duplicated codes across the binding table. */
export function listConflicts(bindings) {
  const seen = new Map();
  const conflicts = [];
  for (const a of ACTIONS) {
    for (const code of bindings[a] || []) {
      if (!code) continue;
      if (seen.has(code) && seen.get(code) !== a) conflicts.push({ code, actions: [seen.get(code), a] });
      else seen.set(code, a);
    }
  }
  return conflicts;
}

/**
 * Bind `code` to `action` in `slot` (0 = primary, 1 = secondary).
 * Returns { ok, bindings, conflict, reason }. If the key is used by another action
 * the change is refused unless `swap` is true, in which case the two bindings swap.
 */
export function rebind(bindings, action, slot, code, { swap = false } = {}) {
  const next = cloneBindings(bindings);
  if (!ACTIONS.includes(action)) return { ok: false, bindings, conflict: null, reason: 'unknown-action' };
  if (slot !== 0 && slot !== 1) return { ok: false, bindings, conflict: null, reason: 'bad-slot' };
  if (code === null) {
    if (action === 'pause' && next.pause[slot] === 'Escape') {
      return { ok: false, bindings, conflict: null, reason: 'locked' };
    }
    next[action][slot] = null;
    return { ok: true, bindings: next, conflict: null, reason: null };
  }
  if (RESERVED_CODES.includes(code)) return { ok: false, bindings, conflict: null, reason: 'reserved' };
  if (LOCKED_CODES[code] && LOCKED_CODES[code] !== action) {
    return { ok: false, bindings, conflict: { action: LOCKED_CODES[code], slot: 0 }, reason: 'locked' };
  }
  if (action === 'pause' && next.pause[slot] === 'Escape' && code !== 'Escape') {
    return { ok: false, bindings, conflict: null, reason: 'locked' };
  }
  const conflict = findConflict(next, code, action, slot);
  if (conflict && conflict.action === action) {
    // Same key already in the other slot of this action: just move it.
    next[action][conflict.slot] = next[action][slot];
    next[action][slot] = code;
    return { ok: true, bindings: next, conflict: null, reason: null };
  }
  if (conflict && !swap) return { ok: false, bindings, conflict, reason: 'conflict' };
  if (conflict && swap) {
    const old = next[action][slot];
    if (conflict.action === 'pause' && old === null && conflict.slot === 0) {
      return { ok: false, bindings, conflict, reason: 'locked' };
    }
    next[conflict.action][conflict.slot] = old;
  }
  next[action][slot] = code;
  return { ok: true, bindings: next, conflict: conflict || null, reason: null };
}

const KEY_NAMES = {
  Space: 'Space',
  ArrowUp: '↑ Up',
  ArrowDown: '↓ Down',
  ArrowLeft: '← Left',
  ArrowRight: '→ Right',
  ShiftLeft: 'Left Shift',
  ShiftRight: 'Right Shift',
  ControlLeft: 'Left Ctrl',
  ControlRight: 'Right Ctrl',
  AltLeft: 'Left Alt',
  AltRight: 'Right Alt',
  Escape: 'Esc',
  Slash: '/',
  Period: '.',
  Comma: ',',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  Backspace: 'Backspace',
  CapsLock: 'Caps Lock',
};

/** Human readable label for a KeyboardEvent.code. */
export function keyLabel(code) {
  if (!code) return '—';
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad/.test(code)) return 'Num ' + code.slice(6);
  return code;
}

/** Empty per-tick input snapshot. */
export function emptyFrame() {
  return {
    steer: 0,
    forward: false,
    back: false,
    left: false,
    right: false,
    brake: false,
    ollie: false,
    trick: false,
    pressed: { forward: false, back: false, left: false, right: false, ollie: false, trick: false, brake: false },
  };
}

// ---------------------------------------------------------------------------
// Runtime input (DOM). Not used by unit tests.
// ---------------------------------------------------------------------------

const GAMEPAD_BUTTONS = {
  0: 'ollie',
  1: 'brake',
  2: 'trick',
  3: 'camera',
  6: 'brake',
  7: 'forward',
  8: 'respawn',
  9: 'pause',
  12: 'forward',
  13: 'back',
  14: 'left',
  15: 'right',
};

export function createInput({ target = window, bindings = DEFAULT_BINDINGS } = {}) {
  let table = cloneBindings(bindings);
  let codeToAction = buildIndex(table);
  const downCodes = new Set();
  const virtual = {}; // action -> held (touch buttons)
  let virtualSteer = 0; // analog steer from touch swipe-steer
  const gamepadHeld = {};
  let gamepadSteer = 0;
  const pressedEdges = {};
  const listeners = { action: [] };
  let enabled = true;
  let captureHandler = null; // used by the remap UI to grab the next key

  function buildIndex(t) {
    const m = new Map();
    for (const a of ACTIONS) for (const c of t[a]) if (c) m.set(c, a);
    return m;
  }

  function held(action) {
    const keys = table[action] || [];
    for (const c of keys) if (c && downCodes.has(c)) return true;
    return !!virtual[action] || !!gamepadHeld[action];
  }

  function markPressed(action) {
    pressedEdges[action] = true;
    for (const fn of listeners.action) fn(action);
  }

  function isTypingTarget(el) {
    if (!el || !el.tagName) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  function onKeyDown(e) {
    if (captureHandler) {
      e.preventDefault();
      e.stopPropagation();
      const h = captureHandler;
      captureHandler = null;
      h(e.code);
      return;
    }
    const action = codeToAction.get(e.code);
    if (!enabled) {
      // Menus handle their own keys; only report pause/back.
      if (action === 'pause' || e.code === 'Escape') {
        if (!e.repeat) for (const fn of listeners.action) fn('pause');
      }
      return;
    }
    if (isTypingTarget(e.target)) return;
    if (action) {
      e.preventDefault();
      const wasHeld = held(action);
      downCodes.add(e.code);
      if (!wasHeld && !e.repeat) markPressed(action);
    } else if (e.code === 'Escape' && !e.repeat) {
      markPressed('pause');
    }
  }

  function onKeyUp(e) {
    downCodes.delete(e.code);
  }

  function onBlur() {
    downCodes.clear();
    for (const k of Object.keys(virtual)) virtual[k] = false;
  }

  target.addEventListener('keydown', onKeyDown, true);
  target.addEventListener('keyup', onKeyUp, true);
  if (typeof window !== 'undefined') window.addEventListener('blur', onBlur);

  const api = {
    get bindings() {
      return cloneBindings(table);
    },
    setBindings(b) {
      table = normalizeBindings(b);
      codeToAction = buildIndex(table);
    },
    setEnabled(v) {
      enabled = !!v;
      if (!enabled) api.reset();
    },
    get enabled() {
      return enabled;
    },
    /** Clear held keys and pending edges (used when resuming from a menu). */
    reset() {
      downCodes.clear();
      for (const k of Object.keys(pressedEdges)) pressedEdges[k] = false;
      for (const k of Object.keys(virtual)) virtual[k] = false;
      virtualSteer = 0;
    },
    held,
    /** Touch / on-screen controls feed actions in here. */
    setVirtual(action, isDown) {
      const was = held(action);
      virtual[action] = !!isDown;
      if (isDown && !was) markPressed(action);
    },
    /** A one-shot press (e.g. a swipe gesture). */
    pulse(action) {
      markPressed(action);
    },
    setVirtualSteer(v) {
      virtualSteer = Math.max(-1, Math.min(1, v || 0));
    },
    onAction(fn) {
      listeners.action.push(fn);
      return () => {
        listeners.action = listeners.action.filter((f) => f !== fn);
      };
    },
    /** Remap UI: call `fn(code)` with the next physical key pressed. */
    captureNextKey(fn) {
      captureHandler = fn;
    },
    cancelCapture() {
      captureHandler = null;
    },
    attachMouse(canvas) {
      canvas.addEventListener('mousedown', (e) => {
        if (!enabled) return;
        if (e.button === 0) {
          if (!held('ollie')) markPressed('ollie');
        } else if (e.button === 2) {
          gamepadHeld.trickMouse = true;
          markPressed('trick');
        }
      });
      canvas.addEventListener('mouseup', (e) => {
        if (e.button === 2) gamepadHeld.trickMouse = false;
      });
      canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    },
    /** Poll gamepads (call once per animation frame). */
    pollGamepads() {
      const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
      const next = {};
      let steer = 0;
      for (const p of pads || []) {
        if (!p) continue;
        p.buttons.forEach((b, i) => {
          const a = GAMEPAD_BUTTONS[i];
          if (a && (b.pressed || b.value > 0.5)) next[a] = true;
        });
        const ax = p.axes[0] || 0;
        const ay = p.axes[1] || 0;
        if (Math.abs(ax) > 0.2) steer = ax;
        if (ay < -0.6) next.forward = true;
        if (ay > 0.6) next.back = true;
      }
      for (const a of ACTIONS) {
        const was = !!gamepadHeld[a];
        if (next[a] && !was && !held(a)) {
          gamepadHeld[a] = true;
          markPressed(a);
        }
        gamepadHeld[a] = !!next[a];
      }
      gamepadSteer = steer;
      return pads;
    },
    /** Snapshot for one simulation tick. Edges are consumed. */
    sample() {
      const f = emptyFrame();
      f.forward = held('forward');
      f.back = held('back');
      f.left = held('left');
      f.right = held('right');
      f.brake = held('brake');
      f.ollie = held('ollie');
      f.trick = held('trick') || !!gamepadHeld.trickMouse;
      const digital = (f.right ? 1 : 0) - (f.left ? 1 : 0);
      const analog = Math.abs(gamepadSteer) > Math.abs(virtualSteer) ? gamepadSteer : virtualSteer;
      f.steer = digital !== 0 ? digital : analog;
      for (const a of Object.keys(f.pressed)) {
        f.pressed[a] = !!pressedEdges[a];
        pressedEdges[a] = false;
      }
      return f;
    },
    /** Peek at and clear a pending edge (used for pause/camera/respawn in main). */
    consume(action) {
      const v = !!pressedEdges[action];
      pressedEdges[action] = false;
      return v;
    },
    destroy() {
      target.removeEventListener('keydown', onKeyDown, true);
      target.removeEventListener('keyup', onKeyUp, true);
    },
  };
  return api;
}
