// ✨ at the right of the tags row (docs/plans/2026-11-21-workspace-redesign-design.md): requests to the AI about
// what is open. «Создать задачу» (the topic switch on) and «Завершить задачу» (the «Готово» mark) work without AI;
// «Разобрать заново» triages the open conversation again (2026-11-23); «Подсказать ответ» and «Перевести» — «скоро». magicItems is pure; setupMagic draws the menu.
import { isTopic } from './topickind.js';

// `topic` — topicOf(conversation) (topic.js), or { state: 'task', tasks: [task] } for an open task; null — nothing open.
// `conversation` — an open conversation (not a task card): «Разобрать заново» sends its last session to the AI again.
export function magicItems({ topic, conversation = false }) {
  const real = topic?.tasks?.find((task) => !isTopic(task)) ?? null;
  return [
    { id: 'create', title: 'Создать задачу', icon: '☑', enabled: Boolean(topic) && topic.state !== 'task' },
    { id: 'finish', title: 'Завершить задачу', icon: '✓', enabled: Boolean(real), task: real },
    { id: 'again', title: 'Разобрать заново', icon: '✨', enabled: Boolean(conversation) },
    { id: 'suggest', title: 'Подсказать ответ · скоро', icon: '💬', enabled: false },
    { id: 'translate', title: 'Перевести · скоро', icon: '🌐', enabled: false },
  ];
}

// `topic()` — as above; `conversation()` — whether a conversation is open; `on`: { create(), finish(task), again() }.
export function setupMagic({ button, topic, conversation = () => false, on }) {
  let menu = null;
  const close = () => { menu?.remove(); menu = null; document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape); };
  const outside = (event) => { if (menu && !menu.contains(event.target) && event.target !== button) close(); };
  const escape = (event) => { if (event.key === 'Escape') close(); };
  button.onclick = () => {
    if (menu) { close(); return; }
    menu = document.createElement('div');
    menu.className = 'snooze-menu magic-menu';
    menu.setAttribute('role', 'menu');
    for (const item of magicItems({ topic: topic(), conversation: conversation() })) {
      const entry = document.createElement('button');
      entry.type = 'button';
      entry.setAttribute('role', 'menuitem');
      entry.disabled = !item.enabled;
      const mark = document.createElement('span');
      mark.className = 'snooze-icon';
      mark.textContent = item.icon;
      entry.append(mark, item.title);
      entry.onclick = (event) => { event.stopPropagation(); close(); if (item.id === 'create') on.create(); if (item.id === 'finish') on.finish(item.task); if (item.id === 'again') on.again?.(); };
      menu.append(entry);
    }
    document.body.append(menu);
    // Above the button, inside the screen.
    const box = button.getBoundingClientRect();
    const width = menu.offsetWidth;
    menu.style.left = `${Math.max(8, Math.min(box.right - width, window.innerWidth - width - 8))}px`;
    menu.style.top = `${Math.max(8, box.top - menu.offsetHeight - 4)}px`;
    setTimeout(() => { document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', escape); });
  };
  return { close };
}
