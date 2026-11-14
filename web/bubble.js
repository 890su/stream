import { formatDuration } from './voice.js';
import { snippet } from './projection.js';

// Static, trusted icon markup. User content is only ever set through textContent.
const ICONS = {
  clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor"/><path d="M12 7.5V12l3 2"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  alert: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor"/><path d="M12 7.5v5.5M12 16.5v.2"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5-11-6.5Z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>',
  history: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5"/><path d="M4 4.5v4h4M12 8v4.5l3 1.8"/></svg>',
  link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
  continue: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4v8a4 4 0 0 0 4 4h9"/><path d="m15 12 4 4-4 4"/></svg>',
  more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5.5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18.5" cy="12" r="1.7"/></svg>',
  file: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5"/></svg>',
};
const clock = new Intl.DateTimeFormat('ru', { hour: '2-digit', minute: '2-digit' });
let playing; // the one audio element playing right now

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function sizeLabel(bytes) {
  if (!bytes) return '';
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} КБ` : `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

export function bubbleSignature(view, queued, chain) {
  const reply = view.replyTo && [view.replyTo.id, snippet(view.replyTo)];
  return JSON.stringify([view.event.payload.media, view.event.ts, view.text, view.tags, view.edited, view.archived, view.pending, view.replies, reply,
    chain && [chain.index, chain.ids.length, chain.title],
    queued ? queued.error || 'queued' : 'accepted']);
}

function meta(view, queued, extraClass = '', hasHistory = false) {
  const event = view.event;
  const box = element('span', `meta ${extraClass}`.trim());
  if (view.archived) box.append(element('span', 'meta-note', 'в архиве'));
  // A small link instead of the word "edited": opens versions and related messages (thread.js).
  if (hasHistory) {
    const link = element('button', 'history-link');
    link.type = 'button';
    link.innerHTML = ICONS.history;
    link.setAttribute('aria-label', view.edited ? 'Изменено. Открыть историю' : 'Открыть связанные сообщения');
    link.dataset.history = '';
    box.append(link);
  }
  const time = element('time', '', clock.format(new Date(event.ts)));
  time.dateTime = event.ts;
  const status = element('span');
  const waiting = queued || view.pending;
  const state = queued?.error ? 'alert' : waiting ? 'clock' : 'check';
  status.innerHTML = ICONS[state];
  status.setAttribute('role', 'img');
  status.setAttribute('aria-label', queued?.error ? 'Не отправлено' : waiting ? 'В очереди' : 'Принято');
  if (queued?.error) box.classList.add('error');
  box.append(time, status);
  return box;
}

function voice(reference, load, notify) {
  const box = element('div', 'voice');
  const button = element('button', 'play');
  button.type = 'button';
  button.innerHTML = ICONS.play;
  button.setAttribute('aria-label', 'Слушать голосовое');
  const wave = element('div', 'wave');
  const track = element('div', 'track');
  const bar = element('span');
  track.append(bar);
  const duration = element('span', 'duration', formatDuration(reference.duration_s ?? 0));
  wave.append(track, duration);
  let audio;
  const show = (isPlaying) => {
    button.innerHTML = isPlaying ? ICONS.pause : ICONS.play;
    button.setAttribute('aria-label', isPlaying ? 'Пауза' : 'Слушать голосовое');
  };
  button.onclick = async () => {
    try {
      if (!audio) {
        button.disabled = true;
        audio = new Audio(await load(reference));
        audio.ontimeupdate = () => {
          const total = Number.isFinite(audio.duration) ? audio.duration : reference.duration_s || 1;
          bar.style.width = `${Math.min(100, (audio.currentTime / total) * 100)}%`;
          duration.textContent = formatDuration(audio.currentTime);
        };
        audio.onended = () => { show(false); bar.style.width = '0'; duration.textContent = formatDuration(reference.duration_s ?? 0); };
        audio.onpause = () => show(false);
        audio.onplay = () => show(true);
      }
      if (audio.paused) {
        if (playing && playing !== audio) playing.pause();
        playing = audio;
        await audio.play();
      } else audio.pause();
    } catch (error) { notify(error.message); }
    finally { button.disabled = false; }
  };
  box.append(button, wave);
  return box;
}

function gallery(photos, load, notify, view) {
  const box = element('div', `gallery count-${Math.min(photos.length, 4)}`);
  for (const reference of photos) box.append(photo(reference, load, notify, view));
  return box;
}

function photo(reference, load, notify, view) {
  const image = element('img', 'photo');
  image.alt = 'Фото';
  image.decoding = 'async';
  load(reference).then((url) => { image.src = url; }).catch((error) => { image.alt = 'Фото недоступно'; notify(error.message); });
  image.dataset.viewer = ''; // a tap opens the full-size viewer (app.js)
  image.alt = view?.text ? `Фото: ${snippet(view)}` : 'Фото';
  return image;
}

function file(reference, load, notify) {
  const button = element('button', 'file');
  button.type = 'button';
  const round = element('span', 'round');
  round.innerHTML = ICONS.file;
  const label = element('span');
  const kind = reference.mime === 'application/pdf' ? 'PDF' : reference.mime.split('/')[0] === 'audio' ? 'Аудио' : 'Файл';
  label.append(element('div', 'file-name', kind), element('div', 'file-size', sizeLabel(reference.size_bytes)));
  button.append(round, label);
  button.onclick = async () => {
    try {
      const link = element('a');
      link.href = await load(reference);
      link.download = reference.media_id;
      link.click();
    } catch (error) { notify(error.message); }
  };
  return button;
}

// Long texts fold under a cut; the limits are data in registry/capture.json.
function textBlock(text, limits) {
  const block = element('div', 'text', text);
  const long = text.length > limits.collapse_chars || text.split(/\r?\n/).length > limits.collapse_lines;
  if (!long) return block;
  block.classList.add('clamped');
  const wrap = element('div', 'cut');
  const toggle = element('button', 'cut-toggle', 'Показать полностью');
  toggle.type = 'button';
  toggle.onclick = (event) => {
    event.stopPropagation();
    const open = block.classList.toggle('clamped') === false;
    toggle.textContent = open ? 'Свернуть' : 'Показать полностью';
  };
  wrap.append(block, toggle);
  return wrap;
}

// The topic line: one tappable line with the topic name and size; it opens the topic screen (topicscreen.js).
function topicLine(chain) {
  const line = element('button', 'topic-line');
  line.type = 'button';
  line.dataset.topicOpen = '';
  line.setAttribute('aria-label', `Тема «${chain.title}», сообщений: ${chain.ids.length}. Открыть тему`);
  const icon = element('span', 'topic-icon');
  icon.innerHTML = ICONS.link;
  line.append(icon, element('span', `topic-title${chain.named ? ' named' : ''}`, chain.title),
    element('span', 'topic-pos', `· ${chain.ids.length}`), element('span', 'topic-go', '›'));
  return line;
}

export function createBubble(view, queued, { load, notify, jump, chain, limits }) {
  const event = view.event;
  const payload = event.payload ?? {};
  const media = payload.media ?? [];
  const photos = media.filter((item) => item.mime.startsWith('image/'));
  const bubble = element('div', 'bubble');
  bubble.dataset.id = event.id;
  bubble.tabIndex = 0;
  bubble.setAttribute('aria-label', `Сообщение: ${snippet(view)}. Действия — долгое нажатие или клавиша меню`);
  bubble.classList.toggle('has-photo', photos.length > 0);
  bubble.classList.toggle('has-text', Boolean(view.text || payload.url));
  bubble.classList.toggle('has-tags', view.tags.length > 0);
  bubble.classList.toggle('archived', view.archived);

  // Mouse users: a "more" button next to the bubble; touch users long-press (actions.js).
  const more = element('button', 'more');
  more.type = 'button';
  more.innerHTML = ICONS.more;
  more.setAttribute('aria-label', 'Действия с сообщением');
  more.dataset.actions = '';
  bubble.append(more);

  if (chain) bubble.append(topicLine(chain));
  if (view.replyTo) {
    const quote = element('button', 'quote');
    quote.type = 'button';
    quote.append(element('span', 'quote-title', 'Ответ на'), element('span', 'quote-text', snippet(view.replyTo)));
    quote.onclick = (clickEvent) => { clickEvent.stopPropagation(); if (!view.replyTo.deleted) jump(view.replyTo.id); };
    bubble.append(quote);
  }
  if (photos.length) bubble.append(gallery(photos, load, notify, view));
  for (const reference of media) {
    if (reference.mime.startsWith('image/')) continue;
    bubble.append(event.kind === 'voice' || reference.mime.startsWith('audio/') ? voice(reference, load, notify) : file(reference, load, notify));
  }
  if (view.tags.length) bubble.append(element('div', 'tags', view.tags.join(' ')));
  if (view.text) bubble.append(textBlock(view.text, limits));
  if (payload.url) {
    try {
      const parsed = new URL(payload.url);
      if (['http:', 'https:'].includes(parsed.protocol)) {
        const link = element('a', '', payload.url);
        link.href = parsed.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
        const line = element('div', 'text');
        line.append(link);
        bubble.append(line);
      }
    } catch { /* malformed URLs stay in the journal payload */ }
  }
  const onlyPhoto = photos.length && !view.text && !payload.url && !view.tags.length && !view.replyTo && !chain;
  // Bottom left: continue this message — the next one is written already connected to it.
  const next = element('button', 'continue-link');
  next.type = 'button';
  next.innerHTML = ICONS.continue;
  next.setAttribute('aria-label', 'Продолжить это сообщение');
  next.dataset.continue = '';
  bubble.append(next);
  bubble.append(meta(view, queued, onlyPhoto ? 'photo-meta' : '', Boolean(view.edited || view.replyTo || view.replies || chain)));
  if (queued?.error) bubble.append(element('div', 'error-text', queued.error));
  return bubble;
}
