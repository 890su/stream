// Selection mode: a long press selects a message, then taps add or remove more; a bar replaces the composer
// with bulk actions. Back or × leaves the mode.
export function setupSelection({ getView, actions, onChange = () => {} }) {
  const bar = document.querySelector('#select-bar');
  const count = document.querySelector('#select-count');
  const ids = new Set();

  const node = (id) => document.querySelector(`.bubble[data-id="${CSS.escape(id)}"]`);
  const selected = () => [...ids].map(getView).filter(Boolean).sort((a, b) => Date.parse(a.event.ts) - Date.parse(b.event.ts));

  function paint() {
    for (const element of document.querySelectorAll('.bubble.picked')) if (!ids.has(element.dataset.id)) element.classList.remove('picked');
    for (const id of ids) node(id)?.classList.add('picked');
    count.textContent = `Выбрано: ${ids.size}`;
    onChange(ids.size ? selected() : null);
  }

  function enter(view) {
    if (!document.body.classList.contains('selecting')) {
      document.body.classList.add('selecting');
      bar.hidden = false;
      history.pushState({ selecting: true }, '');
    }
    ids.add(view.id);
    paint();
  }

  function toggle(view) {
    if (ids.has(view.id)) ids.delete(view.id); else ids.add(view.id);
    if (!ids.size) { leave(); return; }
    paint();
  }

  function leave(fromHistory = false) {
    if (!document.body.classList.contains('selecting')) return;
    ids.clear();
    paint();
    document.body.classList.remove('selecting');
    bar.hidden = true;
    if (!fromHistory && history.state?.selecting) history.back();
  }

  document.querySelector('#select-close').onclick = () => leave();
  window.addEventListener('popstate', () => leave(true));
  for (const button of bar.querySelectorAll('[data-bulk]')) {
    button.onclick = async () => {
      const views = selected();
      leave();
      if (views.length) await actions[button.dataset.bulk](views);
    };
  }

  return { enter, toggle, leave, selected, repaint: () => { if (ids.size) paint(); } };
}
