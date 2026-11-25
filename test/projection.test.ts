import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { project, snippet } from '../web/projection.js';

let clock = Date.parse('2026-11-11T10:00:00Z');
const at = () => new Date(clock += 1000).toISOString();
const message = (text: string, extra: Record<string, unknown> = {}) => ({ id: crypto.randomUUID(), kind: 'text', ts: at(), payload: { text }, ...extra });
const fix = (target: string, op: string, payload: Record<string, unknown> = {}) =>
  ({ id: crypto.randomUUID(), kind: 'correction', ts: at(), payload: { ref: { type: 'event', id: target }, data: { op }, ...payload } });

test('the latest edit wins and earlier versions stay in history', () => {
  const original = message('купить кабель');
  const first = fix(original.id, 'edit', { text: 'купить кабель UTP' });
  const second = fix(original.id, 'edit', { text: 'купить кабель UTP 305 м', tags: ['#закупка'] });
  const [view] = project([second, original, first]); // arrival order does not matter
  assert.equal(view.text, 'купить кабель UTP 305 м');
  assert.deepEqual(view.tags, ['#закупка']);
  assert.equal(view.edited, true);
  assert.deepEqual(view.history.map((item: { text: string }) => item.text), ['купить кабель', 'купить кабель UTP']);
  assert.equal(view.event.payload.text, 'купить кабель', 'the source event is untouched');
});

test('archive, delete and their undo are plain state, corrections are never messages', () => {
  const a = message('a'), b = message('b');
  const views = project([a, b, fix(a.id, 'archive'), fix(b.id, 'delete'), fix(b.id, 'restore'), fix(a.id, 'unarchive'), fix(a.id, 'archive')]);
  assert.equal(views.length, 2);
  assert.deepEqual(views.map((view: { archived: boolean; deleted: boolean }) => [view.archived, view.deleted]), [[true, false], [false, false]]);
  const deleted = project([a, fix(a.id, 'delete')]);
  assert.equal(deleted[0].deleted, true);
});

test('a correction for a message not loaded yet is ignored until the message arrives', () => {
  const later = message('позже');
  const early = fix(later.id, 'edit', { text: 'исправлено' });
  assert.equal(project([early]).length, 0);
  assert.equal(project([early, later])[0].text, 'исправлено');
});

test('replies quote the current text of their parent, or say it is gone', () => {
  const parent = message('звонил Марек');
  const reply = message('перезвонить в четверг', { reply_to: parent.id });
  let views = project([parent, reply, fix(parent.id, 'edit', { text: 'звонил Марек с Урсынова' })]);
  assert.equal(snippet(views[1].replyTo), 'звонил Марек с Урсынова');
  views = project([parent, reply, fix(parent.id, 'delete')]);
  assert.equal(snippet(views[1].replyTo), 'Удалённое сообщение');
  assert.equal(snippet(project([reply])[0].replyTo), 'Сообщение');
});

test('pending corrections mark their message as waiting for the queue', () => {
  const original = message('x');
  const edit = fix(original.id, 'edit', { text: 'y' });
  assert.equal(project([original, edit], new Set([edit.id]))[0].pending, true);
  assert.equal(project([original, edit])[0].pending, false);
});

test('related messages follow reply links in both directions; versions run from the source to the current text', async () => {
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { related, versions } = await import('../web/projection.js');
  const root = message('заявка'), a = message('ответ 1', { reply_to: root.id }), b = message('ответ на ответ', { reply_to: a.id });
  const other = message('другое'), gone = message('удалённый ответ', { reply_to: root.id });
  const views = project([root, a, b, other, gone, fix(gone.id, 'delete'), fix(a.id, 'edit', { text: 'ответ 1, исправлен' }), fix(a.id, 'edit', { text: 'ответ 1, финал' })]);
  for (const from of [root.id, a.id, b.id]) assert.deepEqual(related(views, from).map((view: { text: string }) => view.text), ['заявка', 'ответ 1, финал', 'ответ на ответ']);
  assert.deepEqual(related(views, other.id).map((view: { text: string }) => view.text), ['другое']);
  const edited = views.find((view: { id: string }) => view.id === a.id);
  assert.deepEqual(versions(edited).map((item: { label: string; text: string }) => [item.label, item.text]),
    [['Исходное', 'ответ 1'], ['Редакция 1', 'ответ 1, исправлен'], ['Текущая', 'ответ 1, финал']]);
  assert.equal(versions(edited)[0].at, a.ts);
  assert.deepEqual(versions(views[0]).map((item: { label: string }) => item.label), ['Без правок']);
});

test('only continuations join a bubble, never time alone; links and unlinks change it later', async () => {
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { bursts, chains, related } = await import('../web/projection.js');
  const at = (time: string) => `2026-11-12T${time}:00Z`;
  const cont = (target: string, on = true) => ({ data: { continuation: { target, on } } });
  const a = message('выезжаю', { ts: at('09:00') });
  const b = message('приехал', { ts: at('09:03'), payload: { text: 'приехал', ...cont(a.id) } });
  const c = message('другое дело', { ts: at('09:04'), payload: { text: 'другое дело', ...cont(b.id, false) } });
  const d = message('на машине', { ts: at('09:05') });
  const texts = (groups: Array<Array<{ text: string }>>) => groups.map((group) => group.map((view) => view.text));
  let views = project([a, b, c, d]);
  assert.deepEqual(texts(bursts(views)), [['выезжаю', 'приехал'], ['другое дело'], ['на машине']], 'a minute apart is not enough');
  views = project([a, b, c, d, fix(d.id, 'link', { data: { op: 'link', target: c.id } }), fix(b.id, 'unlink')]);
  assert.deepEqual(texts(bursts(views)), [['выезжаю'], ['приехал'], ['другое дело', 'на машине']]);
  assert.deepEqual(related(views, d.id).map((view: { text: string }) => view.text), ['другое дело', 'на машине']);
  assert.equal(chains(views).get(c.id).title, 'другое дело');
});

test('a hand-given topic name replaces the first message as the title of its chain', async () => {
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { chains } = await import('../web/projection.js');
  const a = message('выезжаю'), b = message('приехал', { payload: { text: 'приехал', data: { continuation: { target: a.id, on: true } } } });
  let chain = chains(project([a, b])).get(b.id);
  assert.deepEqual([chain.title, chain.named, chain.root], ['выезжаю', false, a.id]);
  chain = chains(project([a, b, fix(a.id, 'topic', { data: { op: 'topic', title: 'Клиент А — сеть' } })])).get(b.id);
  assert.deepEqual([chain.title, chain.named], ['Клиент А — сеть', true]);
});

test('a topic is archived and restored on its first message; the whole chain reports it', async () => {
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { chains } = await import('../web/projection.js');
  const a = message('выезжаю'), b = message('приехал', { payload: { text: 'приехал', data: { continuation: { target: a.id, on: true } } } });
  const archive = fix(a.id, 'topic_archive', { data: { op: 'topic_archive' } });
  assert.equal(chains(project([a, b, archive])).get(b.id).archived, true);
  assert.equal(chains(project([a, b, archive, fix(a.id, 'topic_unarchive', { data: { op: 'topic_unarchive' } })])).get(b.id).archived, false);
});

test('chains are the same as related() gives, a deleted message out, and stay fast on a big journal', async () => {
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { chains, related } = await import('../web/projection.js');
  const cont = (target: string) => ({ data: { continuation: { target, on: true } } });
  const a = message('раз'), b = message('два', { payload: { text: 'два', ...cont(a.id) } });
  const c = message('три', { payload: { text: 'три', ...cont(b.id) } }), lone = message('отдельно');
  const d = message('ответ', { reply_to: c.id }), gone = message('удалено', { payload: { text: 'удалено', ...cont(a.id) } });
  const views = project([a, b, c, lone, d, gone, fix(gone.id, 'delete', { data: { op: 'delete' } })]);
  const result = chains(views);
  for (const view of views.filter((item: { deleted: boolean }) => !item.deleted)) {
    const expected = related(views, view.id).map((item: { id: string }) => item.id);
    assert.deepEqual(result.get(view.id)?.ids, expected.length < 2 ? undefined : expected, view.text);
  }
  assert.deepEqual(result.get(d.id).ids, [a.id, b.id, c.id, d.id]);
  assert.equal(result.get(d.id).index, 3);
  assert.equal(result.has(lone.id), false);

  // Every redraw of the queue and of a conversation runs chains over the whole journal (feed.js): it must be linear.
  const many = Array.from({ length: 4000 }, (_, index) => message(`сообщение ${index}`));
  const big = project(many);
  const started = performance.now();
  chains(big);
  assert.ok(performance.now() - started < 150, `chains over 4000 messages took ${Math.round(performance.now() - started)} ms`);
});

test('calls and SMS get a header from their data; hidden numbers are named', async () => {
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { phoneLabel } = await import('../web/phonebubble.js');
  const call = (data: Record<string, unknown>) => ({ kind: 'call', payload: { data: { call: { started_at: at(), ...data } } } });
  const sms = (data: Record<string, unknown>) => ({ kind: 'sms', payload: { text: 'Буду в 10', data: { sms: { sent_at: at(), ...data } } } });
  assert.deepEqual(phoneLabel(call({ direction: 'in', number: '+48500000001', duration_s: 75 })), { icon: 'in', title: 'Входящий · 1 мин 15 с', who: '+48500000001', number: '+48500000001' });
  assert.equal(phoneLabel(call({ direction: 'out', number: '+48500000001', duration_s: 12 })).title, 'Исходящий · 12 с');
  assert.equal(phoneLabel(call({ direction: 'out', number: '1', duration_s: 3720 })).title, 'Исходящий · 1 ч 2 мин');
  assert.equal(phoneLabel(call({ direction: 'missed', number: '+48500000001' })).title, 'Пропущенный');
  assert.equal(phoneLabel(call({ direction: 'rejected', number: '+48500000001' })).title, 'Отклонённый');
  assert.deepEqual(phoneLabel(call({ direction: 'missed', number: '' })), { icon: 'missed', title: 'Пропущенный', who: 'Скрытый номер', number: null });
  assert.equal(phoneLabel(call({ direction: 'in', number: '+48500000001', name: 'Анна', duration_s: 5 })).who, 'Анна');
  assert.equal(phoneLabel(sms({ direction: 'in', number: '+48500000002' })).title, 'Входящее SMS');
  assert.equal(phoneLabel(sms({ direction: 'out', number: '+48500000002' })).icon, 'sms-out');

  const [callView, smsView] = project([{ id: crypto.randomUUID(), ...call({ direction: 'in', number: '1' }), ts: at() }, { id: crypto.randomUUID(), ...sms({ direction: 'in', number: '2' }), ts: at() }]);
  assert.equal(snippet(callView), 'Входящий · 1');
  assert.equal(snippet(smsView), 'Буду в 10');
});

test('queue marks: snoozes and requeues are stacks, their undo takes the last one off', () => {
  const original = message('когда приедете?');
  const snooze = (until: string) => ({ ...fix(original.id, 'snooze'), payload: { ref: { type: 'event', id: original.id }, data: { op: 'snooze', until } } });
  const first = snooze('2026-11-12T09:00:00.000Z');
  const second = snooze('2026-11-12T18:00:00.000Z');
  const undo = fix(original.id, 'unsnooze');
  const lift = fix(original.id, 'requeue');
  const liftAgain = fix(original.id, 'requeue');
  const drop = fix(original.id, 'unrequeue');
  const [view] = project([original, first, second, undo, lift, liftAgain, drop]);
  assert.deepEqual(view.snoozes, [{ at: first.ts, until: '2026-11-12T09:00:00.000Z' }]);
  assert.deepEqual(view.requeues, [lift.ts]);
  const [plain] = project([message('без отметок')]);
  assert.deepEqual([plain.snoozes, plain.requeues], [[], []]);
});

test('a read mark marks its message read', () => {
  const incoming = message('когда приедете?');
  const mark = fix(incoming.id, 'read');
  const [view] = project([incoming, mark]);
  assert.equal(view.read, true);
  assert.equal(view.readAt, mark.ts);
  const [plain] = project([message('без отметки')]);
  assert.equal(plain.read, false);
});
