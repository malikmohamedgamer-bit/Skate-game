// Accessibility: applying settings to the page, and screen reader announcements
// through ARIA live regions (polite for gameplay, assertive for results).

/** Body classes and CSS variables for a settings object. Pure (unit tested). */
export function presentationFor(settings) {
  const a = settings.a11y;
  const classes = [];
  if (a.reducedMotion) classes.push('reduced-motion');
  if (a.highContrast) classes.push('high-contrast');
  if (a.colorblind) classes.push('cb-safe');
  if (a.oneHanded !== 'off') classes.push(`one-handed-${a.oneHanded}`);
  return {
    classes,
    vars: { '--text-scale': String(a.textScale), '--touch-scale': String(a.touchScale) },
  };
}

export function applyPresentation(settings, doc = document) {
  const p = presentationFor(settings);
  const body = doc.body;
  for (const c of ['reduced-motion', 'high-contrast', 'cb-safe', 'one-handed-left', 'one-handed-right']) body.classList.toggle(c, p.classes.includes(c));
  for (const [k, v] of Object.entries(p.vars)) doc.documentElement.style.setProperty(k, v);
  return p;
}

/** Does the OS ask for reduced motion? (Used as the default for new players.) */
export function systemPrefersReducedMotion() {
  try {
    return !!(globalThis.matchMedia && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}

/**
 * Announcement queue with throttling, so rapid tricks do not flood a screen reader.
 * Pure core (time is passed in) so it is unit tested; the DOM writer is separate.
 *   push(text, { priority, category }) queues a message
 *   flush(now) returns the message to speak now (or null)
 * Messages of the same category within `mergeWindow` replace each other (only the
 * latest trick is read); assertive messages jump the queue.
 */
export function createAnnouncementQueue({ minGap = 700, mergeWindow = 600, maxQueue = 6 } = {}) {
  let queue = [];
  let lastSpoken = -Infinity;
  return {
    push(text, { priority = 'polite', category = 'general', now = 0 } = {}) {
      if (!text) return;
      const existing = queue.findIndex((m) => m.category === category && category !== 'general' && now - m.at < mergeWindow);
      const msg = { text, priority, category, at: now };
      if (existing >= 0) queue[existing] = msg;
      else if (priority === 'assertive') queue.unshift(msg);
      else queue.push(msg);
      if (queue.length > maxQueue) queue = queue.filter((m) => m.priority === 'assertive').concat(queue.filter((m) => m.priority !== 'assertive').slice(-maxQueue));
    },
    flush(now) {
      if (!queue.length) return null;
      const head = queue[0];
      if (head.priority !== 'assertive' && now - lastSpoken < minGap) return null;
      queue.shift();
      lastSpoken = now;
      return head;
    },
    get size() {
      return queue.length;
    },
  };
}

/** DOM announcer writing to the polite / assertive live regions. */
export function createAnnouncer({ polite, assertive, now = () => performance.now() }) {
  const q = createAnnouncementQueue();
  let enabled = true;
  let categories = { trick: true };
  const history = [];
  function write(msg) {
    const el = msg.priority === 'assertive' ? assertive : polite;
    el.textContent = '';
    // Re-insert on the next tick so identical consecutive messages are re-read.
    setTimeout(() => (el.textContent = msg.text), 20);
    history.push(msg.text);
    if (history.length > 50) history.shift();
  }
  const timer = setInterval(() => {
    const m = q.flush(now());
    if (m) write(m);
  }, 120);
  return {
    say(text, opts = {}) {
      if (!enabled && opts.priority !== 'assertive') return;
      if (opts.category && categories[opts.category] === false) return;
      q.push(text, { ...opts, now: now() });
      const m = q.flush(now());
      if (m) write(m);
    },
    setEnabled(v) {
      enabled = !!v;
    },
    setCategory(cat, on) {
      categories = { ...categories, [cat]: !!on };
    },
    get history() {
      return history.slice();
    },
    destroy() {
      clearInterval(timer);
    },
  };
}
