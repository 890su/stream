// Bulk actions on selected messages (select.js): copy, archive, delete, «Тема…» (topicpicker.js), link, unlink and
// tags for many at once. Each one is ordinary corrections or task changes, so undo works as usual.
import { makeCorrection, makeTaskChange, ownTask } from './shared.js';
import { setupSelection } from './select.js';
import { openTopicPicker, moveChanges, undoChanges } from './topicpicker.js';
import { pickable } from './topiclive.js';

export function setupBulk(feed, composer, { correct, link, pickLink, notify }) {
  const each = (views, op) => Promise.all(views.map((view) => correct(view, op)));
  // The tag row acts on the selection: link (one topic, or the picker for one message), unlink, toggle a tag.
  let selection;
  const linkAll = async (views) => {
    if (views.length === 1) { selection.leave(); pickLink(views[0]); return; }
    const changed = views.slice(1).filter((view, index) => view.continues !== views[index].id);
    await Promise.all(changed.map((view) => link(view, views[views.indexOf(view) - 1].id)));
    selection.leave();
    notify(`Связано в одну тему: ${views.length}`, { label: 'Отменить', run: () => each(changed, 'unlink') });
  };
  const unlinkAll = async (views) => {
    const linked = views.filter((view) => view.continues);
    if (!linked.length) { notify('Выбранные ни к чему не привязаны'); return; }
    const targets = linked.map((view) => [view, view.continues]);
    await each(linked, 'unlink');
    selection.leave();
    notify(`Отвязано: ${linked.length}`, { label: 'Отменить', run: () => Promise.all(targets.map(([view, target]) => link(view, target))) });
  };
  const toggleTag = async (views, tag) => {
    const all = views.every((view) => view.tags.includes(tag));
    const targets = all ? views : views.filter((view) => !view.tags.includes(tag));
    await Promise.all(targets.map((view) => composer.queue(makeCorrection(view.id, 'edit',
      { text: view.text, tags: all ? view.tags.filter((item) => item !== tag) : [...view.tags, tag] }))));
  };
  selection = setupSelection({
    getView: (id) => feed.view(id),
    onChange: (views) => composer.selectionTags(views && {
      link: () => linkAll(selection.selected()),
      unlink: () => unlinkAll(selection.selected()),
      toggleTag: (tag) => toggleTag(selection.selected(), tag),
      stateOf: (tag) => selection.selected().every((view) => view.tags.includes(tag)),
    }),
    actions: {
      copy: async (views) => {
        try { await navigator.clipboard.writeText(views.map((view) => view.text).filter(Boolean).join(String.fromCharCode(10, 10))); notify(`Скопировано: ${views.length}`); }
        catch { notify('Не удалось скопировать: браузер не дал доступ к буферу обмена'); }
      },
      archive: async (views) => { await each(views, 'archive'); notify(`В архиве: ${views.length}`, { label: 'Вернуть', run: () => each(views, 'unarchive') }); },
      delete: async (views) => { await each(views, 'delete'); notify(`Удалено: ${views.length}`, { label: 'Отменить', run: () => each(views, 'restore') }); },
      // «Тема…»: move the messages to another topic or add one more (topics design 2026-11-23).
      topic: async (views) => {
        const tasks = feed.tasks();
        const tasksById = new Map(tasks.map((task) => [task.id, task]));
        const lastAt = (task) => (task.messages ?? []).map((id) => feed.view(id)?.event.ts).filter(Boolean).sort().at(-1) ?? null;
        const groups = pickable(feed.conversations(), feed.conversationKey(), { now: new Date(), topics: feed.queueConfig().topics ?? { topic_days: 14, archive_days: 3 }, lastAt, tasks });
        openTopicPicker({ groups, count: views.length, onPick: async (target, mode) => {
          const fresh = typeof target === 'object';
          const id = fresh ? crypto.randomUUID() : target;
          const changes = moveChanges(views, id, mode, tasksById);
          if (fresh) changes[0] = { id, change: { ...ownTask(target.title, views[0].id), kind: 'topic', add: views.map((view) => view.id) } };
          if (!changes.length) { notify('Сообщения уже в этой теме'); return; }
          try { for (const { id: task, change } of changes) await composer.queue(makeTaskChange(task, change)); }
          catch (error) { notify(error.message); return; }
          const title = fresh ? target.title : tasksById.get(id)?.title ?? 'тема';
          const back = fresh ? [{ id, change: { op: 'update', status: 'cancelled', remove: views.map((view) => view.id) } }, ...undoChanges(changes.slice(1), tasksById)] : undoChanges(changes, tasksById);
          notify(`${mode === 'move' ? 'Перенесено' : 'Добавлено'} в «${title}»: ${views.length}`, { label: 'Вернуть',
            run: () => Promise.all(back.map(({ id: task, change }) => composer.queue(makeTaskChange(task, change)))).then(() => {}) });
        } });
      },
    },
  });
  return selection;
}
