// Keys on the System screen (owner, 2026-11-21: connections set up in the app, like WhatsApp): the Google client and
// the Telegram bot tokens. A key is entered in a hidden field and never comes back — the row says only where it is set
// and its last four characters; «Заменить» opens the field again, «Удалить» drops the app's key (a .env one then works
// again). The server applies a key at once (src/secrets.ts). keyFacts is pure (tested in node).

export function keyFacts(item) {
  const status = !item.set ? 'не задан' : `задан ${item.source === 'app' ? 'на «Системе»' : 'в .env на сервере'}${item.tail ? `, …${item.tail}` : ''}`;
  return { status, editable: !item.set, removable: item.set && item.source === 'app' };
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

// Rows for the keys of `groups` (e.g. ['google'], ['telegram:by']). ctx: { call, notify, rerender }.
export async function keyRows(groups, { call, notify, rerender }) {
  let list;
  try { list = (await call('/api/secrets')).secrets; } catch { return []; } // a server without the key store: .env only
  return list.filter((item) => groups.includes(item.group)).map((item) => {
    const facts = keyFacts(item);
    const row = element('div', 'system-key');
    const head = element('div', 'system-row');
    head.append(element('span', '', item.title), element('span', `state ${item.set ? '' : 'failed'}`, facts.status));
    const form = element('form', 'system-key-form');
    const input = Object.assign(document.createElement('input'), { type: 'password', autocomplete: 'off', spellcheck: false, placeholder: item.title });
    input.setAttribute('aria-label', item.title);
    form.append(input, button('link-button', 'Сохранить', () => form.requestSubmit()));
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (!input.value.trim()) return;
      try {
        await call(`/api/secrets/${item.name}`, { method: 'PUT', body: JSON.stringify({ value: input.value }) });
        input.value = '';
        notify(`${item.title}: сохранён, работает сразу`);
        rerender();
      } catch (error) { notify(error.message); }
    };
    form.hidden = !facts.editable;
    if (!facts.editable) head.append(button('link-button', 'Заменить', () => { form.hidden = !form.hidden; if (!form.hidden) input.focus(); }));
    if (facts.removable) head.append(button('link-button', 'Удалить', async () => {
      if (!confirm(`Удалить «${item.title}» из Stream?`)) return;
      try { await call(`/api/secrets/${item.name}`, { method: 'DELETE' }); notify('Ключ удалён'); rerender(); } catch (error) { notify(error.message); }
    }));
    row.append(head, form);
    return row;
  });
}
