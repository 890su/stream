// What the next message goes into (CONCEPT.md §2.9), chosen in the link window: a conversation — the message
// continues its last message and a chat's contact becomes the recipient; a task — the message is added to it once
// sent. Shown as a chip in the input row; a tap on the chip takes it back.
import { makeTaskChange } from './shared.js';

// `conversation(key)` — the conversation as the feed sees it now (feed.js).
export function createLinkState({ conversation, recipients, queue, onChange }) {
  let link = null; // { type: 'conversation', key, title } | { type: 'task', id, title }
  let applied = null; // the recipient this link chose, taken back with it

  function attach(next) {
    if (applied && recipients.selected()?.key === applied.key) recipients.choose(null);
    applied = null;
    link = next;
    const reply = next?.type === 'conversation' ? conversation(next.key)?.reply : null;
    if (reply && !recipients.selected()) { recipients.choose(reply); applied = reply; }
    onChange();
  }

  function continuation() {
    if (link?.type !== 'conversation') return undefined;
    const last = conversation(link.key)?.views.filter((view) => !view.deleted).at(-1);
    return last ? { target: last.id, on: true } : undefined;
  }

  // After the message is queued: into the chosen task; the link is spent either way.
  async function sent(entry) {
    const task = link?.type === 'task' ? link : null;
    link = null; applied = null;
    onChange();
    if (task) await queue(makeTaskChange(task.id, { op: 'update', add: [entry.event.id] }));
  }

  function chip() {
    if (!link) return null;
    const node = document.createElement('button');
    node.type = 'button';
    node.className = `chip on linked ${link.type}`;
    node.textContent = `${link.type === 'task' ? '☑' : '↳'} ${link.title}`;
    node.setAttribute('aria-label', `${link.type === 'task' ? 'В задачу' : 'В беседу'} «${link.title}». Убрать`);
    node.onclick = () => attach(null);
    return node;
  }

  return { attach, attached: () => link, continuation, sent, chip };
}
