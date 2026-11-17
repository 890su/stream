// The System screen (CONCEPT.md §5): what works without the owner — gateways, the phone companion —
// its state, the replies sent outside, and the chats switched off with «Не отслеживать».
import { getSetting } from './db.js';

const STATE = { ok: 'работает', silent: 'молчит', login_required: 'нужен вход', error: 'ошибка' };
const ACTION = { proposed: 'ждёт', approved: 'в очереди', running: 'отправляется', done: 'отправлено', failed: 'не отправлено', rejected: 'отменено' };
const clock = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function ago(iso, now = Date.now()) {
  if (!iso) return 'никогда';
  const minutes = Math.round((now - Date.parse(iso)) / 60000);
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} мин назад`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} ч назад`;
  return clock.format(new Date(iso));
}

export function setupSystem({ notify, onTrack }) {
  const dialog = document.querySelector('#system');
  const sources = document.querySelector('#system-sources');
  const actions = document.querySelector('#system-actions');
  const exclusions = document.querySelector('#system-exclusions');

  async function call(path, init = {}) {
    const response = await fetch(path, { ...init, headers: { Authorization: `Bearer ${await getSetting('ownerToken')}` } });
    if (!response.ok) throw new Error(response.status === 401 ? 'Токен не принят' : 'Сервер недоступен');
    return response.json();
  }

  function sourceRow(item) {
    const row = element('div', 'system-source');
    row.append(element('span', `system-dot ${item.state}`), element('span', 'system-name', `${item.title} — ${STATE[item.state] ?? item.state}`));
    const facts = [];
    if (item.pulse_at) facts.push(`сигнал ${ago(item.pulse_at)}`);
    facts.push(`последнее сообщение ${ago(item.last_event_at)}`);
    if (item.info?.chats !== undefined) facts.push(`чатов ${item.info.chats}, групп ${item.info.groups}, отключено ${item.info.excluded}`);
    if (item.failed_24h) facts.push(`не отправлено за сутки: ${item.failed_24h}`);
    const detail = element('span', 'system-detail', facts.join(' · '));
    if (item.detail && item.state !== 'ok') detail.append(element('div', '', item.detail));
    row.append(detail);
    return row;
  }

  function actionRow(action) {
    const row = element('div', 'system-row');
    row.append(element('span', '', `${action.params?.text ?? action.operation}`));
    row.title = action.error ?? '';
    row.append(element('span', `state ${action.status}`, `${ACTION[action.status] ?? action.status} · ${ago(action.updated_at)}`));
    if (action.status === 'failed') {
      const retry = element('button', 'link-button', 'Повторить');
      retry.type = 'button';
      retry.onclick = () => retryAction(action.id);
      row.append(retry);
    }
    return row;
  }

  function exclusionRow(item) {
    const row = element('div', 'system-row');
    row.append(element('span', '', item.chat_title || item.chat_id));
    const back = element('button', 'link-button', 'Вернуть');
    back.type = 'button';
    back.onclick = async () => { await onTrack(item.message); notify('Чат снова отслеживается: шлюз подтянет сегодняшние сообщения'); render(); };
    row.append(back);
    return row;
  }

  async function retryAction(id) {
    try { await call(`/api/actions/${id}/retry`, { method: 'POST' }); notify('Отправка повторится'); render(); }
    catch (error) { notify(error.message); }
  }

  async function render() {
    try {
      const data = await call('/api/system');
      sources.replaceChildren(...data.sources.map(sourceRow));
      actions.replaceChildren(...(data.actions.length ? data.actions.map(actionRow) : [element('p', 'system-empty', 'Ответов наружу ещё не было')]));
      exclusions.replaceChildren(...(data.exclusions.length ? data.exclusions.map(exclusionRow) : [element('p', 'system-empty', 'Все чаты отслеживаются')]));
    } catch (error) {
      sources.replaceChildren(element('p', 'system-empty', `${error.message}. Экран «Система» работает только в сети`));
    }
  }

  document.querySelector('#system-close').onclick = () => dialog.close();
  document.querySelector('#system-refresh').onclick = render;
  return { open: () => { dialog.showModal(); render(); }, retry: retryAction };
}
