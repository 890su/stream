// Finds participants and opens a task's add dialog beside its trigger.
import { conversationParty } from './cardtalk.js';
import { holding } from './holdrender.js';
import { isParty, PARTY_LABELS } from './parties.js';
import { accountTitle } from './tgbubble.js';

const channelName = (channel) => ({ phone: 'Телефон', viber: 'Viber', whatsapp: 'WhatsApp' }[channel] ?? accountTitle(channel));

export function participantOptions({ conversations, recipients, people, exclude = [] }) {
  const known = new Set(exclude);
  const options = new Map();
  function add(party, { title, sub, pinned = false, count = 0, aliases = [], directory = false }) {
    if (!isParty(party) || Object.hasOwn(PARTY_LABELS, party) || known.has(party)) return;
    const prior = options.get(party);
    options.set(party, {
      party,
      title: directory ? title : prior?.title ?? title,
      sub: prior?.sub || sub,
      pinned: pinned || Boolean(prior?.pinned),
      count: Math.max(count, prior?.count ?? 0),
      aliases: [...new Set([...(prior?.aliases ?? []), title, ...aliases])],
    });
  }
  for (const item of recipients) {
    const party = item.group || String(item.chat_id).startsWith('-') ? `group:tg:${item.chat_id}` : `tg:${item.chat_id}`;
    add(party, { ...item, sub: channelName(item.account) });
  }
  for (const item of conversations) {
    const party = conversationParty(item);
    add(party, { title: item.title, sub: (item.channels ?? []).map(channelName).join(' · '), count: item.views.length });
  }
  for (const person of people) {
    if (person.status === 'deleted') continue;
    for (const point of person.points) {
      add(point, { title: person.name, sub: point.startsWith('tel:') ? point.slice(4) : 'Telegram',
        aliases: person.points.filter((item) => item.startsWith('tel:')).map((item) => item.slice(4)), directory: true });
    }
  }
  return [...options.values()].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.count - a.count || a.title.localeCompare(b.title, 'ru'));
}

export function filterParticipants(options, query, limit) {
  const text = query.trim().toLowerCase();
  if (!text) return options.filter((item) => item.pinned || item.count > 0).slice(0, limit);
  const number = /^[+\d ()-]+$/.test(text) ? text.replace(/\D/g, '') : '';
  const phoneMatches = (item) => {
    const phones = item.party.startsWith('tel:') ? [...item.aliases, item.party.slice(4)] : item.aliases;
    return number && phones.some((name) => /^[+\d ()-]+$/.test(name) && name.replace(/\D/g, '').includes(number));
  };
  return options.filter((item) => item.aliases.some((name) => name.toLowerCase().includes(text)) || phoneMatches(item))
    .sort((a, b) => a.title.localeCompare(b.title, 'ru'));
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function setupParticipantPicker(dialog) {
  const input = dialog.querySelector('input');
  const list = dialog.querySelector('.participant-results');
  const label = dialog.querySelector('.participant-results-label');
  let anchor = null;
  let options = [];
  let suggestLimit;
  let onPick;
  let onClose;
  const viewport = window.visualViewport;
  const placement = () => {
    if (!anchor || !dialog.open) return;
    const rect = anchor.getBoundingClientRect();
    const left = viewport?.offsetLeft ?? 0;
    const top = viewport?.offsetTop ?? 0;
    const right = left + (viewport?.width ?? window.innerWidth);
    const bottom = top + (viewport?.height ?? window.innerHeight);
    const gap = 8;
    const below = bottom - rect.bottom - gap;
    const above = rect.top - top - gap;
    dialog.style.maxHeight = `${Math.max(0, bottom - top - gap * 2)}px`;
    const { width, height } = dialog.getBoundingClientRect();
    const y = below >= height || below >= above ? rect.bottom + gap : rect.top - height - gap;
    dialog.style.left = `${Math.max(left + gap, Math.min(rect.right - width, right - width - gap))}px`;
    dialog.style.top = `${Math.max(top + gap, Math.min(y, bottom - height - gap))}px`;
  };
  const render = () => {
    const query = input.value.trim();
    const items = filterParticipants(options, query, suggestLimit);
    label.hidden = Boolean(query) || !items.length;
    const rows = items.map((item) => {
      const row = element('button', 'participant-result');
      row.type = 'button';
      row.append(element('span', 'participant-result-name', item.title));
      if (item.sub) row.append(element('small', 'participant-result-channel', item.sub));
      row.onclick = () => { dialog.close(); onPick(item.party); };
      return row;
    });
    list.replaceChildren(...(rows.length ? rows : [element('p', 'participant-empty', query ? 'Совпадений нет' : 'Введите имя или номер')]));
    placement();
  };
  input.oninput = render;
  dialog.querySelector('.participant-close').onclick = () => dialog.close();
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => {
    if (anchor) {
      holding(anchor, false);
      anchor.setAttribute('aria-expanded', 'false');
    }
    anchor = null;
    onClose?.();
  });
  window.addEventListener('resize', placement);
  viewport?.addEventListener('resize', placement);
  viewport?.addEventListener('scroll', placement);
  return (button, settings) => {
    anchor = button;
    options = settings.options;
    suggestLimit = settings.limit;
    onPick = settings.onPick;
    onClose = settings.onClose;
    holding(anchor);
    anchor.setAttribute('aria-expanded', 'true');
    input.value = '';
    render();
    dialog.showModal();
    placement();
  };
}
