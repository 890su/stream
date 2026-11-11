import { makeEntry } from './shared.js';
import { enqueue, synchronize } from './outbox.js';
import { createRecorder, formatDuration } from './voice.js';

const HOLD_MS = 350; // holding the mic longer than this and releasing sends the recording

const $ = (selector) => document.querySelector(selector);

export function setupComposer(config, { notify, onSent }) {
  const form = $('#composer');
  const text = $('#message');
  const action = $('#action-button');
  const tagButton = $('#tag-button');
  const attachButton = $('#attach-button');
  const tagPanel = $('#tag-panel');
  const attachMenu = $('#attach-menu');
  const draft = $('#draft');
  const recordingBar = $('#recording-bar');
  const inputs = { camera: $('#camera-input'), gallery: $('#gallery-input'), file: $('#file-input') };
  inputs.file.accept = config.mime_types.join(',');

  const recorder = createRecorder(config);
  const tags = new Set();
  let files = [];
  let pendingVoice; // a finished recording that could not be queued yet
  let pressedAt = 0;
  let locked = false;
  let busy = false;

  const hasDraft = () => Boolean(text.value.trim() || files.length);

  function updateAction() {
    const send = hasDraft() || recorder.active() || pendingVoice;
    action.dataset.mode = send ? 'send' : 'voice';
    action.setAttribute('aria-label', recorder.active() ? 'Отправить голосовое' : send ? 'Отправить' : 'Голосовое сообщение');
    action.classList.toggle('recording', recorder.active());
  }

  function autosize() {
    text.style.height = 'auto';
    text.style.height = `${Math.min(text.scrollHeight, 160)}px`;
  }

  function togglePanel(panel, button, open = panel.hidden) {
    for (const [other, otherButton] of [[tagPanel, tagButton], [attachMenu, attachButton]]) {
      other.hidden = true; otherButton.setAttribute('aria-expanded', 'false');
    }
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  }

  function renderDraft() {
    const tagRow = $('#draft-tags');
    tagRow.replaceChildren(...[...tags].map((tag) => {
      const chip = document.createElement('button');
      chip.type = 'button'; chip.className = 'chip removable'; chip.textContent = tag;
      chip.setAttribute('aria-label', `Убрать метку ${tag}`);
      chip.onclick = () => { tags.delete(tag); renderTags(); };
      return chip;
    }));
    const fileRow = $('#draft-files');
    for (const image of fileRow.querySelectorAll('img')) URL.revokeObjectURL(image.src);
    fileRow.replaceChildren(...files.map((file, index) => {
      const item = document.createElement('div');
      item.className = 'draft-file';
      if (file.type.startsWith('image/')) {
        const image = document.createElement('img'); image.src = URL.createObjectURL(file); image.alt = ''; item.append(image);
      } else item.textContent = file.name || 'Файл';
      const remove = document.createElement('button');
      remove.type = 'button'; remove.textContent = '×'; remove.setAttribute('aria-label', 'Убрать вложение');
      remove.onclick = () => { files.splice(index, 1); renderDraft(); };
      item.append(remove);
      return item;
    }));
    draft.hidden = !tags.size && !files.length;
    tagButton.classList.toggle('active', tags.size > 0);
    updateAction();
  }

  function renderTags() {
    $('#tag-options').replaceChildren(...config.quick_tags.map((tag) => {
      const chip = document.createElement('button');
      chip.type = 'button'; chip.className = 'chip'; chip.textContent = tag;
      chip.setAttribute('aria-pressed', String(tags.has(tag)));
      chip.onclick = () => { tags.has(tag) ? tags.delete(tag) : tags.add(tag); renderTags(); };
      return chip;
    }));
    renderDraft();
  }

  function accept(list) {
    for (const file of list) {
      if (file.size > config.max_media_bytes) { notify(`«${file.name}» слишком большой для отправки`); continue; }
      const allowed = config.mime_types.some((type) => type.endsWith('/*') ? file.type.startsWith(type.slice(0, -1)) : file.type === type);
      if (!allowed) { notify(`Формат «${file.name}» не поддерживается`); continue; }
      files.push(file);
    }
    renderDraft();
  }

  async function queue(entry) {
    await enqueue(entry);
    onSent();
    synchronize().catch((error) => notify(error.message));
  }

  async function sendDraft() {
    if (!hasDraft() || busy) return;
    busy = true;
    const message = text.value.trim();
    const attached = files;
    const kind = !attached.length ? 'text' : attached.every((file) => file.type.startsWith('image/')) ? 'photo' : 'file';
    try {
      await queue(await makeEntry({ kind, text: message, files: attached, tags: [...tags] }));
      text.value = ''; files = []; tags.clear();
      autosize(); renderTags(); togglePanel(tagPanel, tagButton, false);
    } catch (error) { notify(`Сообщение не сохранено. ${error.message}`); }
    finally { busy = false; updateAction(); }
  }

  async function queueVoice(recording) {
    pendingVoice = recording;
    try {
      await queue(await makeEntry({ kind: 'voice', files: [recording.blob], duration: recording.duration, tags: [...tags] }));
      pendingVoice = undefined; tags.clear(); renderTags();
    } catch (error) { notify(`Голосовое ждёт сохранения, нажмите «Отправить» ещё раз. ${error.message}`); }
    updateAction();
  }

  function showRecording(on) {
    recordingBar.hidden = !on;
    text.hidden = on; attachButton.hidden = on;
    if (on) $('#rec-time').textContent = '0:00';
    updateAction();
  }

  async function startRecording() {
    togglePanel(tagPanel, tagButton, false);
    try {
      await recorder.start({
        onTick: (seconds) => { $('#rec-time').textContent = formatDuration(seconds); },
        onLimit: () => finishRecording(true),
      });
      showRecording(true);
      navigator.vibrate?.(15);
    } catch (error) { notify(error.name === 'NotAllowedError' ? 'Разрешите доступ к микрофону в настройках браузера' : error.message); }
  }

  async function finishRecording(keep) {
    locked = false;
    const recording = await recorder.stop(keep);
    showRecording(false);
    if (recording) await queueVoice(recording);
  }

  // Mic: press and hold to talk, release to send; a short tap keeps recording until the next tap.
  action.addEventListener('pointerdown', async (event) => {
    if (action.dataset.mode === 'send' || event.button > 0) return;
    pressedAt = Date.now();
    locked = false;
    await startRecording();
  });
  action.addEventListener('pointerup', () => {
    if (!recorder.active() || !pressedAt) return;
    const held = Date.now() - pressedAt;
    pressedAt = 0;
    if (held >= HOLD_MS) finishRecording(true); else locked = true;
  });
  action.addEventListener('click', () => {
    if (pressedAt) return;
    if (recorder.active()) { if (locked) finishRecording(true); return; }
    if (pendingVoice) { queueVoice(pendingVoice); return; }
    if (action.dataset.mode === 'send') sendDraft();
  });
  action.addEventListener('keydown', (event) => {
    if ((event.key === 'Enter' || event.key === ' ') && action.dataset.mode === 'voice' && !recorder.active()) {
      event.preventDefault(); locked = true; startRecording();
    }
  });
  $('#rec-cancel').onclick = () => finishRecording(false);

  text.addEventListener('input', () => { autosize(); updateAction(); });
  text.addEventListener('focus', () => togglePanel(tagPanel, tagButton, false)); // the keyboard replaces open panels
  form.addEventListener('submit', (event) => { event.preventDefault(); sendDraft(); });
  tagButton.onclick = () => togglePanel(tagPanel, tagButton);
  attachButton.onclick = () => togglePanel(attachMenu, attachButton);
  for (const button of attachMenu.querySelectorAll('[data-attach]')) {
    button.onclick = () => { togglePanel(attachMenu, attachButton, false); inputs[button.dataset.attach].click(); };
  }
  for (const input of Object.values(inputs)) {
    input.addEventListener('change', () => { accept(Array.from(input.files)); input.value = ''; text.focus(); });
  }
  window.addEventListener('beforeunload', (event) => {
    if (recorder.active() || pendingVoice || hasDraft()) { event.preventDefault(); event.returnValue = ''; }
  });

  renderTags();
  return {
    record: () => { locked = true; return startRecording(); },
    focus: () => text.focus(),
    openAttach: () => togglePanel(attachMenu, attachButton, true),
  };
}
