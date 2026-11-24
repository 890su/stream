// «О каком деле?» right under a message (CONCEPT.md §2.8): the triage was not sure which case the message
// belongs to. Options: the case it went to (✓), other likely ones, «Новое дело». The owner's tap moves the
// message (a closed case comes back to work) or confirms it; the answer is the owner's task_change.
// Since triage v15 the same place asks about the AI's proposals (proposals.js): «ИИ: в задачу?» with the reason —
// the proposed task (its whole change is applied), another task, «+ Новое дело» or «✕» (a `reject_proposal`).
import { makeTaskChange, makeCorrection, ownTask } from './shared.js';
import { snippet } from './projection.js';
import { isOpen } from './taskfold.js';
import { acceptEvents } from './proposals.js';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// What to ask under a message, or null: `question` — { task, alternatives } from questionsByMessage.
export function questionOptions(view, question, tasksById) {
  if (!question) return null;
  const options = [question.task, ...question.alternatives].filter((id, index, all) => tasksById.has(id) && all.indexOf(id) === index)
    .map((id) => ({ id, title: tasksById.get(id).title, open: isOpen(tasksById.get(id)), current: view.taskIds.includes(id) }));
  return options.length > 1 ? { chosen: question.task, options } : null;
}

export function questionBlock(view) {
  const box = element('div', `case-question${view.question.proposal ? ' proposal' : ''}`);
  box.append(element('span', 'case-question-label', view.question.proposal ? 'ИИ предлагает в задачу:' : 'О каком деле?'));
  for (const option of view.question.options) {
    const chip = element('button', `chip ${option.current ? 'on' : 'suggest'}`, `${option.current ? '✓ ' : ''}${option.title}${option.open ? '' : ' · завершено'}`);
    chip.type = 'button';
    chip.dataset.pickTask = option.id;
    box.append(chip);
  }
  const fresh = element('button', 'chip suggest', '+ Новое дело');
  fresh.type = 'button';
  fresh.dataset.pickTask = 'new';
  box.append(fresh);
  if (view.question.proposal) {
    const none = element('button', 'chip suggest muted', '✕ Ни с чем');
    none.type = 'button';
    none.dataset.pickTask = 'none';
    box.append(none);
    if (view.question.reason) box.append(element('span', 'case-question-reason', `Почему: ${view.question.reason}`));
  }
  return box;
}

// Taps on the options anywhere (feed, details). `getView(id)` — the message view with its question.
export function setupQuestions({ getView, getTask, queue, notify }) {
  const save = (taskId, change) => queue(makeTaskChange(taskId, change));
  // An answer to an AI proposal: for all its messages; the event names the proposal (the AI log counts it).
  async function answer(view, target) {
    const { proposal, chosen, change, messageIds } = view.question;
    try {
      if (target === 'none') { await queue(makeCorrection(view.id, 'reject_proposal', { proposal })); notify('Предложение отклонено: сообщение остаётся в беседе'); return; }
      if (target === chosen) { for (const entry of acceptEvents({ id: proposal, task: chosen, change })) await queue(entry); notify('Добавлено в задачу'); return; }
      if (target === 'new') { await save(crypto.randomUUID(), { ...ownTask(snippet(view).slice(0, 120), view.id), add: messageIds, proposal }); notify('Сообщение — новое дело'); return; }
      const task = getTask(target);
      await save(target, { op: 'update', add: messageIds, proposal, ...(task && !isOpen(task) ? { status: 'todo' } : {}) });
      notify('Добавлено в другую задачу');
    } catch (error) { notify(error.message); }
  }
  document.body.addEventListener('click', async (event) => {
    const chip = event.target.closest('[data-pick-task]');
    if (!chip) return;
    event.stopPropagation();
    const view = getView(chip.closest('[data-id]')?.dataset.id);
    if (!view?.question) return;
    const target = chip.dataset.pickTask;
    const chosen = view.question.chosen;
    if (view.question.proposal) { await answer(view, target); return; }
    try {
      if (target === chosen) { await save(chosen, { op: 'update', add: [view.id] }); return; } // confirmed
      if (target === 'new') {
        await save(crypto.randomUUID(), ownTask(snippet(view).slice(0, 120), view.id));
      } else {
        const task = getTask(target);
        await save(target, { op: 'update', add: [view.id], ...(task && !isOpen(task) ? { status: 'todo' } : {}) });
      }
      await save(chosen, { op: 'update', remove: [view.id] });
      notify(target === 'new' ? 'Сообщение — новое дело' : 'Сообщение перенесено в другое дело');
    } catch (error) { notify(error.message); }
  }, true);
}
