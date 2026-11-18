// «О каком деле?» right under a message (CONCEPT.md §2.8): the triage was not sure which case the message
// belongs to. Options: the case it went to (✓), other likely ones, «Новое дело». The owner's tap moves the
// message (a closed case comes back to work) or confirms it; the answer is the owner's task_change.
import { makeTaskChange } from './shared.js';
import { snippet } from './projection.js';
import { isOpen } from './taskfold.js';

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
  const box = element('div', 'case-question');
  box.append(element('span', 'case-question-label', 'О каком деле?'));
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
  return box;
}

// Taps on the options anywhere (feed, details). `getView(id)` — the message view with its question.
export function setupQuestions({ getView, getTask, queue, notify }) {
  const save = (taskId, change) => queue(makeTaskChange(taskId, change));
  document.body.addEventListener('click', async (event) => {
    const chip = event.target.closest('[data-pick-task]');
    if (!chip) return;
    event.stopPropagation();
    const view = getView(chip.closest('[data-id]')?.dataset.id);
    if (!view?.question) return;
    const target = chip.dataset.pickTask;
    const chosen = view.question.chosen;
    try {
      if (target === chosen) { await save(chosen, { op: 'update', add: [view.id] }); return; } // confirmed
      if (target === 'new') {
        await save(crypto.randomUUID(), { op: 'create', title: snippet(view).slice(0, 120), assignee: 'me', status: 'todo', add: [view.id] });
      } else {
        const task = getTask(target);
        await save(target, { op: 'update', add: [view.id], ...(task && !isOpen(task) ? { status: 'todo' } : {}) });
      }
      await save(chosen, { op: 'update', remove: [view.id] });
      notify(target === 'new' ? 'Сообщение — новое дело' : 'Сообщение перенесено в другое дело');
    } catch (error) { notify(error.message); }
  }, true);
}
