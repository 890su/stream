// The composer: text, voice, files and modes (reply, edit, continue) of the next message; the row above it — the
// «связь» button with its window (linkwindow.js), the chosen conversation or task (linkstate.js), the recipient
// (recipients.js), tags (tagrow.js).
import { makeEntry, makeCorrection, makeTaskChange } from './shared.js';
import { snippet, chatOf } from './projection.js';
import { enqueue, synchronize } from './outbox.js';
import { createRecorder, formatDuration } from './voice.js';
import { createTagRow, leadButtons } from './tagrow.js';
import { outboundData, phoneAnswerable } from './outbound.js';
import { openRecipientSheet } from './recipientsheet.js';
import { createRecipients } from './recipients.js';
import { createDraftFiles } from './draftfiles.js';
import { createLinkState } from './linkstate.js';
import { setupLinkWindow } from './linkwindow.js';
import { backStack } from './backclose.js';
import { conceal, toggleHidden } from './motion.js';

const HOLD_MS = 350; // holding the mic longer than this and releasing sends the recording
const SEND_HOLD_MS = 500; // holding «Отправить» this long opens the list of recipients (an open task card)

const $ = (selector) => document.querySelector(selector);

// `recipientList()` — while a task card is open, the people to choose from by a long press on «Отправить» (details.js).
export function setupComposer(config, { notify, onSent, getViews, linkContext, recipientList = () => null }) {
  const form = $('#composer');
  const text = $('#message');
  const action = $('#action-button');
  const linkButton = $('#link-button');
  const attachButton = $('#attach-button');
  const linkPanel = $('#link-panel');
  const attachMenu = $('#attach-menu');
  const recordingBar = $('#recording-bar');
  const inputs = { camera: $('#camera-input'), gallery: $('#gallery-input'), file: $('#file-input') };
  inputs.file.accept = config.mime_types.join(',');

  const recorder = createRecorder(config);
  // While a case is open in the details panel, every new message continues its latest message (details.js).
  let topic = null; // { last: () => view | null, task (an open task card's id) }
  // While messages are selected (select.js) the tag row acts on the selection: link, unlink, tags.
  let selection = null; // { link(), unlink(), toggleTag(tag), stateOf(tag) }
  // Chips before the tags: link / unlink for a selection; else the conversation or task chosen in «связь» and the
  // recipient — unless it is the one chosen in an open conversation's line of interlocutors (peoplerow.js).
  const lead = () => (selection ? leadButtons({ selection })
    : [link.chip(), chatDefault && recipients.selected()?.key === chatDefault.key ? null : recipients.chip()].filter(Boolean));
  // The connection of the draft: the explicit "continue" mode, a conversation chosen in the window, or the topic.
  const continuation = () => (mode?.type === 'continue' ? { target: mode.view.id, on: true }
    : link.continuation() ?? (topic?.last() ? { target: topic.last().id, on: true } : undefined));
  // After a message is queued: into the task chosen in «связь»; in an open task card a message that continues nothing
  // of it (the first comment) is added to the task itself. `continued` — the continuation the entry was made with.
  async function sent(entry, continued) {
    await link.sent(entry);
    if (topic?.task && !continued) await queue(makeTaskChange(topic.task, { op: 'update', add: [entry.event.id] }));
  }
  let linkWindow = null;
  const rowChanged = () => { tagRow.render(); updateAction(); linkWindow?.refresh(); };
  const tagRow = createTagRow({
    dictionary: config.tagging, getViews, lead,
    override: () => selection && { click: (tag) => selection.toggleTag(tag), stateOf: (tag) => selection.stateOf(tag) },
    onChange: () => linkWindow?.refresh(),
  });
  // «кому»: no recipient — a note to myself (CONCEPT.md §2.9).
  const recipients = createRecipients({ getViews, notify, queue: (entry) => queue(entry), onChange: rowChanged });
  const link = createLinkState({ conversation: (key) => linkContext().conversations.find((item) => item.key === key), recipients, queue: (entry) => queue(entry), onChange: rowChanged });
  linkWindow = setupLinkWindow({ tagRow, recipients, context: linkContext, attached: link.attached, attach: link.attach, notify, close: () => togglePanel(linkPanel, linkButton, false) });
  const draftFiles = createDraftFiles(config, { notify, onChange: () => updateAction() });
  let pendingVoice; // a finished recording that could not be queued yet
  let pressedAt = 0;
  let locked = false;
  let busy = false;
  let mode = null; // null, or { type: 'reply' | 'edit' | 'continue', view }
  // While one messenger chat is shown (chat bar), that chat is the default recipient (CONCEPT.md §8.2).
  let chatDefault = null;

  const hasDraft = () => Boolean(text.value.trim() || draftFiles.list().length);

  function updateAction() {
    const send = hasDraft() || recorder.active() || pendingVoice || mode?.type === 'edit' || Boolean(recipients.selected());
    action.dataset.mode = send ? 'send' : 'voice';
    action.setAttribute('aria-label', recorder.active() ? 'Отправить голосовое' : send ? 'Отправить' : 'Голосовое сообщение');
    action.classList.toggle('recording', recorder.active());
  }

  function autosize() {
    text.style.height = 'auto';
    text.style.height = `${Math.min(text.scrollHeight, 160)}px`;
  }

  // The system back closes an open panel (backclose.js); closing it otherwise takes its history entry back.
  const released = new Map(); // panel -> release of its history entry
  function togglePanel(panel, button, open = panel.hidden) {
    for (const [other, otherButton] of [[linkPanel, linkButton], [attachMenu, attachButton]]) {
      if (other !== panel) { conceal(other); released.get(other)?.(); released.delete(other); }
      otherButton.setAttribute('aria-expanded', 'false');
    }
    if (open && panel.hidden && backStack) released.set(panel, backStack.opened(() => { released.delete(panel); togglePanel(panel, button, false); }));
    if (!open) { released.get(panel)?.(); released.delete(panel); }
    if (open && panel === linkPanel) linkWindow.reset();
    toggleHidden(panel, !open);
    if (open && panel === linkPanel) linkWindow.render();
    button.setAttribute('aria-expanded', String(open));
  }
  const closePanels = () => togglePanel(linkPanel, linkButton, false);

  // A fresh draft: tags start from suggestions again (edit mode starts from the message's own tags).
  function resetTags(initial = []) { tagRow.reset(initial); tagRow.update(text.value); }

  async function queue(entry) {
    await enqueue(entry);
    onSent();
    synchronize().catch((error) => notify(error.message));
  }

  const contextBar = $('#context-bar');

  function setMode(next) {
    const leavingEdit = mode?.type === 'edit';
    mode = next;
    toggleHidden(contextBar, !mode);
    contextBar.classList.toggle('reply', mode?.type === 'reply');
    contextBar.classList.toggle('edit', mode?.type === 'edit');
    contextBar.classList.toggle('continue', mode?.type === 'continue');
    // Photos and files are not edited; an edit is not sent anywhere.
    attachButton.hidden = mode?.type === 'edit';
    recipients.enable(mode?.type !== 'edit');
    if (mode) {
      $('#context-title').textContent = { edit: 'Редактирование', reply: 'Ответ', continue: 'Продолжение' }[mode.type];
      $('#context-snippet').textContent = snippet(mode.view);
    }
    if (mode?.type === 'edit') {
      text.value = mode.view.text; draftFiles.clear();
      resetTags(mode.view.tags);
    } else if (leavingEdit) { text.value = ''; resetTags(); } else resetTags(tagRow.active());
    autosize(); draftFiles.render();
    if (mode) text.focus();
    updateAction();
  }

  // Sending to a recipient is the confirmation (class C, CONCEPT.md §8.2): text only, a personal chat within 24 hours;
  // Viber (deploy/DESKTOP.md) and WhatsApp (deploy/WHATSAPP.md) — only to a phone.
  async function sendOutbound(chat) {
    const message = text.value.trim();
    const whatsapp = chat.account.startsWith('whatsapp_');
    const where = chat.account === 'viber' ? 'Viber' : whatsapp ? 'WhatsApp' : 'Telegram';
    if (draftFiles.list().length) { notify(`В ${where} уходит только текст: уберите вложения или адресата`); return; }
    if (!message) { notify(`Напишите текст: в ${where} уходит только текст`); return; }
    if (!phoneAnswerable(chat)) {
      notify(whatsapp ? `«${chat.title}»: WhatsApp не показал номер — ответьте в WhatsApp на телефоне`
        : `«${chat.title}»: Viber не показывает номер — ответьте в Viber на телефоне или добавьте контакт в Viber`);
      return;
    }
    if (!recipients.isOpen(chat)) {
      notify(`«${chat.title}»: окно 24 часа закрыто — ответьте в Telegram`, { label: 'Открыть', run: () => { location.href = `tg://user?id=${chat.chat_id}`; } });
      return;
    }
    const view = mode?.type === 'reply' ? mode.view : undefined;
    const continued = continuation();
    const entry = await makeEntry({ kind: 'text', text: message, tags: tagRow.active(), tagging: tagRow.tagging(), continuation: continued,
      outbound: outboundData(chat, view, config), replyTo: view?.id });
    await queue(entry);
    text.value = '';
    if (mode) setMode(null);
    await sent(entry, continued);
    recipients.reset(chatDefault);
    autosize(); resetTags(); closePanels();
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
    const chat = recipients.selected();
    if (chat) {
      busy = true;
      try { await sendOutbound(chat); } catch (error) { notify(`Сообщение не сохранено. ${error.message}`); }
      finally { busy = false; updateAction(); }
      return;
    }
    if (!hasDraft()) return;
    busy = true;
    const message = text.value.trim();
    const attached = draftFiles.list();
    const kind = !attached.length ? 'text' : attached.every((file) => file.type.startsWith('image/')) ? 'photo' : 'file';
    try {
      const continued = continuation();
      const entry = await makeEntry({ kind, text: message, files: attached, tags: tagRow.active(), tagging: tagRow.tagging(), continuation: continued,
        replyTo: mode?.type === 'reply' ? mode.view.id : undefined });
      await queue(entry);
      text.value = ''; draftFiles.clear();
      if (mode) setMode(null);
      await sent(entry, continued);
      autosize(); resetTags(); closePanels();
    } catch (error) { notify(`Сообщение не сохранено. ${error.message}`); }
    finally { busy = false; updateAction(); }
  }

  async function queueVoice(recording) {
    pendingVoice = recording;
    try {
      const replyTo = mode?.type === 'reply' ? mode.view.id : undefined;
      const continued = continuation();
      const entry = await makeEntry({ kind: 'voice', files: [recording.blob], duration: recording.duration, tags: tagRow.active(), tagging: tagRow.tagging(), continuation: continued, replyTo });
      await queue(entry);
      pendingVoice = undefined;
      await sent(entry, continued);
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
    closePanels();
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
  // «Отправить» held: the list of recipients of the open task card; the choice sends there (CONCEPT.md §5, 2026-11-24).
  let holdTimer = 0;
  let listed = false; // the long press opened the list
  action.addEventListener('pointerdown', (event) => {
    if (action.dataset.mode !== 'send' || event.button > 0) return;
    listed = false;
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      const options = recipientList();
      if (!options?.length) return;
      listed = true;
      navigator.vibrate?.(10);
      openRecipientSheet(options, (option) => { option.choose(); sendDraft(); });
    }, SEND_HOLD_MS);
  });
  for (const type of ['pointerup', 'pointerleave', 'pointercancel']) action.addEventListener(type, () => clearTimeout(holdTimer));
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
    if (listed) { listed = false; return; } // the long press opened the list: no plain send
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
  // Cancelling a reply to a chat also takes back the recipient the reply chose.
  const cancelMode = () => {
    const replied = mode?.type === 'reply' && chatOf(mode.view.event);
    setMode(null);
    if (replied && recipients.selected()?.key === replied.key) recipients.reset(chatDefault);
  };
  $('#context-cancel').onclick = cancelMode;
  text.addEventListener('keydown', (event) => { if (event.key === 'Escape' && mode) cancelMode(); });

  text.addEventListener('input', () => { autosize(); updateAction(); tagRow.update(text.value); });
  text.addEventListener('focus', closePanels); // the keyboard replaces open panels
  form.addEventListener('submit', (event) => { event.preventDefault(); sendDraft(); });
  linkButton.onclick = () => togglePanel(linkPanel, linkButton);
  attachButton.onclick = () => togglePanel(attachMenu, attachButton);
  for (const button of attachMenu.querySelectorAll('[data-attach]')) {
    button.onclick = () => { togglePanel(attachMenu, attachButton, false); inputs[button.dataset.attach].click(); };
  }
  for (const input of Object.values(inputs)) {
    input.addEventListener('change', () => { draftFiles.accept(Array.from(input.files)); input.value = ''; text.focus(); });
  }
  window.addEventListener('beforeunload', (event) => {
    if (recorder.active() || pendingVoice || hasDraft()) { event.preventDefault(); event.returnValue = ''; }
  });

  resetTags();
  return {
    refreshTags: () => tagRow.update(text.value),
    selectionTags: (state) => { selection = state; tagRow.update(selection ? '' : text.value); },
    busy: () => recorder.active() || Boolean(pendingVoice) || hasDraft() || Boolean(mode),
    loadRecipients: () => recipients.load(),
    pinned: () => recipients.items().filter((item) => item.pinned), // «Избранные» of the left panel
    knownRecipients: recipients.known,
    // A reply to a messenger message chooses its chat as the recipient; another can be chosen in the link window.
    choose: (chat) => recipients.choose(chat), // a recipient chosen from outside (the long-press list)
    reply: (view) => { setMode({ type: 'reply', view }); const chat = chatOf(view.event); if (chat) recipients.choose(chat); },
    chat: (chat) => { chatDefault = chat; recipients.reset(chat); },
    recipient: () => recipients.selected(),
    // A draft the AI wrote (taskdraft.js) waits in the input, never sent: only into an empty input, and taken out again
    // when it is still as it was.
    prefill: (value) => {
      if (text.value.trim() || mode || draftFiles.list().length) return false;
      text.value = value; autosize(); tagRow.update(text.value); updateAction();
      return true;
    },
    unfill: (value) => { if (text.value === value) { text.value = ''; autosize(); tagRow.update(''); updateAction(); } },
    topic: () => topic,
    proceed: (view) => setMode({ type: 'continue', view }),
    edit: (view) => setMode({ type: 'edit', view }),
    enterTopic: (state, placeholder = 'Сообщение в тему') => { topic = state; resetTags(tagRow.active()); text.placeholder = placeholder; },
    leaveTopic: () => { topic = null; resetTags(tagRow.active()); text.placeholder = 'Сообщение'; },
    hint: (value) => { text.placeholder = value; },
    queue,
    attach: (next) => link.attach(next),
    record: () => { locked = true; return startRecording(); },
    focus: () => text.focus(),
    openAttach: () => togglePanel(attachMenu, attachButton, true),
  };
}

