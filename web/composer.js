import { makeEntry, makeCorrection } from './shared.js';
import { snippet } from './projection.js';
import { enqueue, synchronize } from './outbox.js';
import { createRecorder, formatDuration } from './voice.js';
import { createTagRow } from './tagrow.js';

const HOLD_MS = 350; // holding the mic longer than this and releasing sends the recording

const $ = (selector) => document.querySelector(selector);

export function setupComposer(config, { notify, onSent, getViews, getLatest }) {
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
  // "↳ продолжение": offered when writing soon after the latest message; on or off, the answer is saved.
  let suggestTarget = null; // the message the next one may continue
  let continueOn = false;
  const continuationChip = () => {
    if (!suggestTarget) return [];
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `chip continue-chip ${continueOn ? 'on' : 'suggest'}`;
    chip.textContent = '↳ продолжение';
    chip.setAttribute('aria-pressed', String(continueOn));
    chip.setAttribute('aria-label', `Продолжение сообщения: ${snippet(suggestTarget)}`);
    chip.onclick = () => { continueOn = !continueOn; tagRow.render(); };
    return [chip];
  };
  const refreshSuggestion = () => {
    const latest = getLatest();
    const fresh = latest && !mode && Date.now() - Date.parse(latest.event.ts) <= config.burst_gap_min * 60000;
    if (!fresh) { suggestTarget = null; continueOn = false; return; }
    if (suggestTarget?.id !== latest.id) { suggestTarget = latest; continueOn = false; }
  };
  // What to save about the connection: the explicit "continue" mode, or the answer to the suggestion.
  const continuation = () => (mode?.type === 'continue' ? { target: mode.view.id, on: true }
    : suggestTarget ? { target: suggestTarget.id, on: continueOn } : undefined);
  const tagRow = createTagRow({
    dictionary: config.tagging, getViews, lead: continuationChip,
    onChange: (on) => tagButton.classList.toggle('active', on.length > 0),
  });
  let files = [];
  let pendingVoice; // a finished recording that could not be queued yet
  let pressedAt = 0;
  let locked = false;
  let busy = false;
  let mode = null; // null, or { type: 'reply' | 'edit', view } — a message the next send refers to

  const hasDraft = () => Boolean(text.value.trim() || files.length);

  function updateAction() {
    const send = hasDraft() || recorder.active() || pendingVoice || mode?.type === 'edit';
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
    draft.hidden = !files.length;
    updateAction();
  }

  // A fresh draft: tags start from suggestions again (edit mode starts from the message's own tags).
  function resetTags(initial = []) { tagRow.reset(initial); refreshSuggestion(); tagRow.update(text.value); }

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

  const contextBar = $('#context-bar');

  function setMode(next) {
    const leavingEdit = mode?.type === 'edit';
    mode = next;
    contextBar.hidden = !mode;
    contextBar.classList.toggle('reply', mode?.type === 'reply');
    contextBar.classList.toggle('edit', mode?.type === 'edit');
    contextBar.classList.toggle('continue', mode?.type === 'continue');
    attachButton.hidden = mode?.type === 'edit'; // photos and files are not edited, only text and tags
    if (mode) {
      $('#context-title').textContent = { edit: 'Редактирование', reply: 'Ответ', continue: 'Продолжение' }[mode.type];
      $('#context-snippet').textContent = snippet(mode.view);
    }
    if (mode?.type === 'edit') {
      text.value = mode.view.text; files = [];
      resetTags(mode.view.tags);
    } else if (leavingEdit) { text.value = ''; resetTags(); } else resetTags(tagRow.active());
    autosize(); renderDraft();
    if (mode) text.focus();
  }

  async function sendEdit() {
    const { view } = mode;
    const message = text.value.trim();
    const tags = tagRow.active();
    const sameTags = [...tags].sort().join(' ') === [...view.tags].sort().join(' ');
    if (message === view.text.trim() && sameTags) { setMode(null); return; }
    if (!message && view.event.kind === 'text') { notify('Текст не может быть пустым. Чтобы убрать сообщение, удалите его'); return; }
    await queue(makeCorrection(view.id, 'edit', { text: message, tags }));
    setMode(null);
  }

  async function sendDraft() {
    if (busy) return;
    if (mode?.type === 'edit') {
      busy = true;
      try { await sendEdit(); } catch (error) { notify(`Правка не сохранена. ${error.message}`); }
      finally { busy = false; updateAction(); }
      return;
    }
    if (!hasDraft()) return;
    busy = true;
    const message = text.value.trim();
    const attached = files;
    const kind = !attached.length ? 'text' : attached.every((file) => file.type.startsWith('image/')) ? 'photo' : 'file';
    try {
      await queue(await makeEntry({ kind, text: message, files: attached, tags: tagRow.active(), tagging: tagRow.tagging(), continuation: continuation(),
        replyTo: mode?.type === 'reply' ? mode.view.id : undefined }));
      text.value = ''; files = [];
      if (mode) setMode(null);
      autosize(); resetTags(); renderDraft(); togglePanel(tagPanel, tagButton, false);
    } catch (error) { notify(`Сообщение не сохранено. ${error.message}`); }
    finally { busy = false; updateAction(); }
  }

  async function queueVoice(recording) {
    pendingVoice = recording;
    try {
      const replyTo = mode?.type === 'reply' ? mode.view.id : undefined;
      await queue(await makeEntry({ kind: 'voice', files: [recording.blob], duration: recording.duration, tags: tagRow.active(), tagging: tagRow.tagging(), continuation: continuation(), replyTo }));
      pendingVoice = undefined;
      if (mode?.type === 'reply' || mode?.type === 'continue') setMode(null);
      resetTags();
    } catch (error) { notify(`Голосовое ждёт сохранения, нажмите «Отправить» ещё раз. ${error.message}`); }
    updateAction();
  }

  function showRecording(on) {
    recordingBar.hidden = !on;
    text.hidden = on; attachButton.hidden = on || mode?.type === 'edit';
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
  $('#context-cancel').onclick = () => setMode(null);
  text.addEventListener('keydown', (event) => { if (event.key === 'Escape' && mode) setMode(null); });

  text.addEventListener('input', () => { autosize(); updateAction(); refreshSuggestion(); tagRow.update(text.value); });
  $('#new-tag-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = $('#new-tag');
    if (tagRow.addNew(input.value)) input.value = '';
    else notify('Метка — одно слово: буквы, цифры, «-» или «_»');
  });
  text.addEventListener('focus', () => { togglePanel(tagPanel, tagButton, false); refreshSuggestion(); tagRow.render(); }); // the keyboard replaces open panels
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

  resetTags();
  return {
    refreshTags: () => { refreshSuggestion(); tagRow.update(text.value); },
    busy: () => recorder.active() || Boolean(pendingVoice) || hasDraft() || Boolean(mode),
    reply: (view) => setMode({ type: 'reply', view }),
    proceed: (view) => setMode({ type: 'continue', view }),
    edit: (view) => setMode({ type: 'edit', view }),
    queue,
    record: () => { locked = true; return startRecording(); },
    focus: () => text.focus(),
    openAttach: () => togglePanel(attachMenu, attachButton, true),
  };
}
