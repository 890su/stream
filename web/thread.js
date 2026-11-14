import { related, versions, snippet } from './projection.js';

const stamp = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const KIND = { voice: 'Голосовое', photo: 'Фото', file: 'Файл', link: 'Ссылка' };

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// The history window: the message and everything related to it. Up and down — messages;
// left and right on one message — its versions, the source text at the far left.
export function setupThread({ getViews }) {
  const dialog = document.querySelector('#thread');
  const list = document.querySelector('#thread-list');
  document.querySelector('#thread-close').onclick = () => dialog.close();
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });

  function card(view, focused) {
    const all = versions(view);
    const article = element('article', `thread-card${focused ? ' focused' : ''}`);
    const strip = element('div', 'versions');
    strip.tabIndex = 0;
    strip.setAttribute('aria-label', all.length > 1 ? `Версии сообщения: ${all.length}. Листайте влево и вправо` : 'Сообщение без правок');
    for (const version of all) {
      const slide = element('div', 'version');
      slide.append(element('div', 'version-label', `${version.label} · ${stamp.format(new Date(version.at))}`));
      if (version.tags.length) slide.append(element('div', 'tags', version.tags.join(' ')));
      const media = view.event.payload?.media?.length ? KIND[view.event.kind] ?? 'Вложение' : '';
      slide.append(element('div', 'text', version.text || media || snippet(view)));
      if (version.text && media) slide.append(element('div', 'version-label', media));
      strip.append(slide);
    }
    article.append(strip);
    if (all.length > 1) {
      const bar = element('div', 'version-bar');
      const back = element('button', 'icon-button', '‹');
      const forward = element('button', 'icon-button', '›');
      const counter = element('span', 'version-count');
      back.type = 'button'; forward.type = 'button';
      back.setAttribute('aria-label', 'Предыдущая версия'); forward.setAttribute('aria-label', 'Следующая версия');
      const index = () => Math.round(strip.scrollLeft / Math.max(1, strip.clientWidth));
      const update = () => {
        const current = index();
        counter.textContent = `${current + 1} из ${all.length}`;
        back.disabled = current === 0; forward.disabled = current === all.length - 1;
      };
      const move = (step) => strip.scrollBy({ left: step * strip.clientWidth, behavior: 'smooth' });
      back.onclick = () => move(-1); forward.onclick = () => move(1);
      strip.addEventListener('scroll', update, { passive: true });
      strip.addEventListener('keydown', (event) => { if (event.key === 'ArrowLeft') move(-1); if (event.key === 'ArrowRight') move(1); });
      bar.append(back, counter, forward);
      article.append(bar);
      article.ready = () => { strip.scrollLeft = strip.scrollWidth; update(); }; // start at the current version
    }
    return article;
  }

  function open(id) {
    const group = related(getViews(), id);
    if (!group.length) return;
    document.querySelector('#thread-title').textContent = group.length > 1 ? `Связанные сообщения: ${group.length}` : 'История сообщения';
    const cards = group.map((view) => card(view, view.id === id));
    list.replaceChildren(...cards);
    dialog.showModal();
    for (const item of cards) item.ready?.();
    list.querySelector('.focused')?.scrollIntoView({ block: 'center' });
  }

  return { open };
}
