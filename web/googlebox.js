// Google Calendar on the System screen (docs/plans/2026-11-20-google-calendar-design.md, stage 1): «Подключить Google»,
// the linked accounts with their state and «Отключить», a switch per calendar — shown in «План» or not. Without the
// owner's Google client on the server it says how to set it up (deploy/GOOGLE.md). calendarToggles and googleNotice
// are pure (tested in node).

const STATE = { ok: 'работает', login_required: 'нужен вход', error: 'ошибка' };
const GUIDE = 'https://github.com/890su/stream/blob/main/deploy/GOOGLE.md';

// By account; the account's own calendar first, then by title.
export function calendarToggles(calendars) {
  return [...calendars].sort((a, b) => a.account.localeCompare(b.account) || Number(b.id === b.account) - Number(a.id === a.account) || a.title.localeCompare(b.title, 'ru'))
    .map((item) => ({ id: item.id, title: item.title, account: item.account, on: !item.hidden }));
}

// The toast after Google's redirect back (`?google=ok|error`), or null.
export function googleNotice(search) {
  const result = new URLSearchParams(search).get('google');
  if (result === 'ok') return 'Google подключён: календари появятся в «Плане» через минуту';
  if (result === 'error') return 'Не удалось подключить Google — попробуйте ещё раз на экране «Система»';
  return null;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(className, text, onClick) {
  const node = element('button', className, text);
  node.type = 'button';
  node.onclick = onClick;
  return node;
}

// The block's nodes. `call(path, init)` — the System screen's authorized fetch; `notify`, `rerender()`.
export async function googleBox({ call, notify, rerender }) {
  let data;
  try { data = await call('/api/calendar'); } catch (error) { return [element('p', 'system-empty', error.message)]; }
  if (!data.configured) {
    const guide = Object.assign(document.createElement('a'), { className: 'link-button', href: GUIDE, target: '_blank', rel: 'noopener', textContent: 'Как настроить' });
    return [element('p', 'system-empty', 'Не настроен: нужен свой проект Google Cloud и две строки в /srv/stream/.env.'), guide];
  }
  const nodes = [];
  for (const account of data.accounts) {
    const row = element('div', 'system-row');
    row.append(element('span', '', account.email), element('span', `state ${account.state === 'ok' ? '' : 'failed'}`, STATE[account.state] ?? account.state),
      button('link-button', 'Отключить', async () => {
        if (!confirm(`Отключить ${account.email} от Stream? Доступ можно отозвать и в настройках аккаунта Google.`)) return;
        try { await call(`/api/google/accounts/${encodeURIComponent(account.email)}`, { method: 'DELETE' }); notify('Аккаунт отключён'); rerender(); } catch (error) { notify(error.message); }
      }));
    nodes.push(row);
  }
  nodes.push(button('link-button system-google-connect', data.accounts.length ? '+ Подключить ещё аккаунт Google' : 'Подключить Google', async () => {
    try { const { url } = await call('/api/google/connect'); location.href = url; } catch (error) { notify(error.message); }
  }));
  const toggles = calendarToggles(data.calendars);
  if (toggles.length) {
    nodes.push(element('p', 'picker-section', 'Показывать в «Плане»'));
    for (const item of toggles) {
      const label = element('label', 'system-row system-calendar');
      const box = Object.assign(document.createElement('input'), { type: 'checkbox', checked: item.on });
      box.onchange = async () => {
        try { await call('/api/google/calendars', { method: 'POST', body: JSON.stringify({ id: item.id, hidden: !box.checked }) }); } catch (error) { box.checked = !box.checked; notify(error.message); }
      };
      label.append(box, element('span', '', item.title), element('span', 'state', item.account === item.id ? 'основной' : item.account));
      nodes.push(label);
    }
  }
  return nodes;
}
