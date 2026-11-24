// The long-press list of recipients on «Отправить» (CONCEPT.md §5, 2026-11-24): a small sheet over the input row with
// the open task card's people and each of their chats, and the task's comment; a tap on a row chooses it (the composer
// then sends), a tap outside or Esc closes it.
export function openRecipientSheet(options, pick) {
  const layer = document.createElement('div');
  layer.className = 'recipient-sheet-layer';
  const sheet = document.createElement('div');
  sheet.className = 'recipient-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', 'Кому отправить');
  const title = document.createElement('p');
  title.className = 'recipient-sheet-title';
  title.textContent = 'Кому отправить';
  sheet.append(title);
  const close = () => { layer.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (event) => { if (event.key === 'Escape') close(); };
  for (const option of options) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'recipient-sheet-row';
    row.textContent = option.label;
    row.onclick = () => { close(); pick(option); };
    sheet.append(row);
  }
  layer.onclick = (event) => { if (event.target === layer) close(); };
  document.addEventListener('keydown', onKey);
  layer.append(sheet);
  document.body.append(layer);
  sheet.querySelector('button')?.focus();
}
