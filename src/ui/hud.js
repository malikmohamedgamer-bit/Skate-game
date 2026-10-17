// HUD: score, combo, speed, trick text, Bolts, objective and quest tracker.
// Landing results always use an icon + a word ("✔ Clean" / "✖ Bail"), never color alone.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function createHud(root) {
  root.innerHTML = `
    <div class="box tl" id="hud-score-box">
      <div class="score"><span class="sr-only">Score </span><span id="hud-score">0</span></div>
      <div class="combo" id="hud-combo" aria-hidden="true"></div>
    </div>
    <div class="box objective" id="hud-objective" hidden></div>
    <div class="box tr">
      <div><span aria-hidden="true">⚡</span> <span class="bolts" id="hud-bolts">0</span> <span class="muted">Bolts</span></div>
      <div class="speed"><span id="hud-speed">0</span> km/h</div>
      <button class="btn pause-btn" id="hud-pause" aria-label="Pause">❚❚ Pause</button>
    </div>
    <div class="box tracker" id="hud-tracker" hidden></div>
    <div class="trick" id="hud-trick" hidden></div>
    <div class="box bl" id="hud-balance" hidden>
      <div class="muted" style="font-size:.8rem">Balance</div>
      <div class="balance-bar" aria-hidden="true"><span id="hud-balance-dot"></span></div>
    </div>
    <div class="toast" id="hud-toast" hidden></div>`;
  const el = (id) => root.querySelector('#' + id);
  const trick = el('hud-trick');
  const toast = el('hud-toast');
  let trickTimer = 0;
  let toastTimer = 0;
  let lastLive = '';
  let reducedMotion = false;
  const cache = {};
  const set = (id, text) => {
    if (cache[id] === text) return;
    cache[id] = text;
    el(id).textContent = text;
  };

  return {
    root,
    show(v) {
      root.hidden = !v;
    },
    setReducedMotion(v) {
      reducedMotion = !!v;
    },
    onPause(fn) {
      el('hud-pause').addEventListener('click', fn);
    },
    setScore(score, combo, multiplier) {
      set('hud-score', Math.round(score).toLocaleString('en-US'));
      set('hud-combo', combo > 1 ? `Combo ${combo} · x${multiplier.toFixed(1)}` : '');
    },
    setBolts(n) {
      set('hud-bolts', Math.floor(n).toLocaleString('en-US'));
    },
    setSpeed(ms) {
      set('hud-speed', String(Math.round(ms * 3.6)));
    },
    /** Live trick in progress (air or grind). */
    setLiveTrick(t) {
      if (trickTimer > 0) return;
      const text = t ? `${t.name}  ${t.points}` : '';
      if (text === lastLive) return;
      lastLive = text;
      if (!t) {
        trick.hidden = true;
        return;
      }
      trick.hidden = false;
      trick.className = 'trick';
      trick.innerHTML = `${esc(t.name)}<span class="pts">${t.points.toLocaleString('en-US')}</span>`;
    },
    /** Result of a landing. kind: 'clean' | 'bail'. */
    showResult(kind, title, detail) {
      trick.hidden = false;
      trick.className = 'trick ' + (kind === 'clean' ? 'good' : 'bad') + (reducedMotion ? '' : ' pop');
      const icon = kind === 'clean' ? '✔ Clean' : '✖ Bail';
      trick.innerHTML = `<span aria-hidden="true">${icon}</span> ${esc(title)}<span class="pts">${esc(detail || '')}</span>`;
      trickTimer = 1.6;
      lastLive = '';
    },
    setBalance(b) {
      const box = el('hud-balance');
      if (b === null || b === undefined) {
        box.hidden = true;
        return;
      }
      box.hidden = false;
      el('hud-balance-dot').style.left = `${50 + Math.max(-1, Math.min(1, b)) * 48}%`;
      el('hud-balance-dot').className = Math.abs(b) > 0.6 ? 'warn' : '';
    },
    setObjective(html) {
      const o = el('hud-objective');
      if (!html) {
        o.hidden = true;
        return;
      }
      o.hidden = false;
      if (cache.objective !== html) {
        cache.objective = html;
        o.innerHTML = html;
      }
    },
    setTracker(items) {
      const t = el('hud-tracker');
      if (!items || !items.length) {
        t.hidden = true;
        return;
      }
      t.hidden = false;
      const html =
        '<h3>Quests</h3><ul>' +
        items
          .map((q) => `<li>${q.done ? '✔' : '•'} ${esc(q.title)} <span class="muted">${esc(q.progressText)}</span></li>`)
          .join('') +
        '</ul>';
      if (cache.tracker !== html) {
        cache.tracker = html;
        t.innerHTML = html;
      }
    },
    toast(text, seconds = 2.5) {
      toast.hidden = false;
      toast.textContent = text;
      toastTimer = seconds;
    },
    update(dt) {
      if (trickTimer > 0) {
        trickTimer -= dt;
        if (trickTimer <= 0) trick.hidden = true;
      }
      if (toastTimer > 0) {
        toastTimer -= dt;
        if (toastTimer <= 0) toast.hidden = true;
      }
    },
    get trickText() {
      return trick.hidden ? '' : trick.textContent;
    },
  };
}
