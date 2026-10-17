// Quest log: Story / Daily / Challenges tabs (WAI-ARIA tabs pattern) with progress
// bars, text progress and status icons + words (never color alone).

import { questView } from '../game/quests.js';
import { esc } from './menu.js';

const TABS = [
  { id: 'story', label: 'Story' },
  { id: 'daily', label: 'Daily' },
  { id: 'challenge', label: 'Challenges' },
];

function statusLabel(q) {
  if (q.status === 'done') return '<span class="chip good"><span aria-hidden="true">✔</span> Done' + (q.rewarded ? ' · reward collected' : '') + '</span>';
  if (q.status === 'locked') return '<span class="chip"><span aria-hidden="true">🔒</span> Locked</span>';
  return '<span class="chip"><span aria-hidden="true">•</span> Active</span>';
}

function questItem(q) {
  return `<li class="quest ${q.status}">
    <div class="row"><strong class="quest-title">${esc(q.title)}</strong><span class="spacer"></span>${statusLabel(q)}</div>
    <p class="muted">${esc(q.description)}</p>
    <div class="row">
      <div class="progress quest-bar" role="progressbar" aria-label="${esc(q.title)} progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(q.fraction * 100)}" aria-valuetext="${esc(q.progressText)}"><span style="width:${Math.round(q.fraction * 100)}%"></span></div>
      <span class="quest-progress">${esc(q.progressText)}</span>
      <span class="bolts"><span aria-hidden="true">⚡</span> ${q.reward}<span class="sr-only"> Bolts reward</span></span>
    </div>
  </li>`;
}

export function showQuestLog(sm, { profile, data, day }, actions, initialTab = 'story') {
  const view = questView(profile.quests, data.quests);
  const panels = TABS.map((t) => {
    const items = view.filter((q) => q.type === t.id);
    const done = items.filter((q) => q.status === 'done').length;
    const note = t.id === 'daily' ? `<p class="muted">New daily quests every day (device clock). Today: ${esc(day)}.</p>` : t.id === 'story' ? '<p class="muted">Story quests unlock one at a time, in order.</p>' : '<p class="muted">One-time challenges.</p>';
    return `<div role="tabpanel" id="qpanel-${t.id}" aria-labelledby="qtab-${t.id}" ${t.id === initialTab ? '' : 'hidden'} tabindex="0">
      ${note}<p class="small">${done} of ${items.length} complete</p>
      <ul class="quest-list" role="list">${items.map(questItem).join('')}</ul></div>`;
  }).join('');
  const tabs = TABS.map(
    (t) =>
      `<button role="tab" class="btn tab" id="qtab-${t.id}" aria-controls="qpanel-${t.id}" aria-selected="${t.id === initialTab}" tabindex="${t.id === initialTab ? 0 : -1}" data-tab="${t.id}">${t.label}</button>`,
  ).join('');
  const el = sm.show({ id: 'quests', title: 'Quests', onBack: actions.back, label: 'main menu', html: `<div role="tablist" aria-label="Quest types" class="tabs row">${tabs}</div>${panels}`, focus: `#qtab-${initialTab}` });
  const tabEls = [...el.querySelectorAll('[role="tab"]')];
  const select = (id, focus = true) => {
    for (const b of tabEls) {
      const on = b.dataset.tab === id;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      el.querySelector(`#qpanel-${b.dataset.tab}`).hidden = !on;
      if (on && focus) b.focus();
    }
  };
  for (const b of tabEls) {
    b.addEventListener('click', () => select(b.dataset.tab));
    b.addEventListener('keydown', (e) => {
      const i = tabEls.indexOf(b);
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        select(tabEls[(i + 1) % tabEls.length].dataset.tab);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        select(tabEls[(i + tabEls.length - 1) % tabEls.length].dataset.tab);
      } else if (e.key === 'Home') {
        e.preventDefault();
        select(tabEls[0].dataset.tab);
      } else if (e.key === 'End') {
        e.preventDefault();
        select(tabEls[tabEls.length - 1].dataset.tab);
      }
    });
  }
  return el;
}

/** Up to `max` active quests for the HUD tracker (story first, then dailies, then nearest challenges). */
export function trackerItems(profile, data, max = 3) {
  const view = questView(profile.quests, data.quests).filter((q) => q.status === 'active');
  const order = { story: 0, daily: 1, challenge: 2 };
  view.sort((a, b) => order[a.type] - order[b.type] || b.fraction - a.fraction);
  return view.slice(0, max).map((q) => ({ title: q.title, progressText: q.progressText, done: false }));
}
