// Attachments of the next message (composer.js): size and type checks (registry/capture.json), previews, removal.
import { toggleHidden } from './motion.js';

export function createDraftFiles(config, { notify, onChange }) {
  const row = document.querySelector('#draft-files');
  const draft = document.querySelector('#draft');
  let files = [];

  function render() {
    for (const image of row.querySelectorAll('img')) URL.revokeObjectURL(image.src);
    row.replaceChildren(...files.map((file, index) => {
      const item = document.createElement('div');
      item.className = 'draft-file';
      if (file.type.startsWith('image/')) {
        const image = document.createElement('img'); image.src = URL.createObjectURL(file); image.alt = ''; item.append(image);
      } else item.textContent = file.name || 'Файл';
      const remove = document.createElement('button');
      remove.type = 'button'; remove.textContent = '×'; remove.setAttribute('aria-label', 'Убрать вложение');
      remove.onclick = () => { files.splice(index, 1); render(); };
      item.append(remove);
      return item;
    }));
    toggleHidden(draft, !files.length);
    onChange();
  }

  function accept(list) {
    for (const file of list) {
      if (file.size > config.max_media_bytes) { notify(`«${file.name}» слишком большой для отправки`); continue; }
      const allowed = config.mime_types.some((type) => type.endsWith('/*') ? file.type.startsWith(type.slice(0, -1)) : file.type === type);
      if (!allowed) { notify(`Формат «${file.name}» не поддерживается`); continue; }
      files.push(file);
    }
    render();
  }

  // `list()` hands out the current array; `clear()` starts a new one, so a list being sent stays intact.
  return { list: () => files, accept, render, clear: () => { files = []; render(); } };
}
