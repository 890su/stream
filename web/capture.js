import { makeEntry } from './shared.js';
import { enqueue, synchronize } from './outbox.js';

export function setupCapture(config, notify) {
  const text = document.querySelector('#message');
  const form = document.querySelector('#text-form');
  const recordButton = document.querySelector('#record');
  const photo = document.querySelector('#photo');
  const recordState = document.querySelector('#record-state');
  let recorder;
  let pendingRecording;
  let started;
  let recordingTimer;
  let busy = false;

  async function save(entry) {
    await enqueue(entry);
    notify('Сохранено на устройстве. Отправка из очереди');
    synchronize().catch((error) => notify(error.message));
  }

  async function saveRecording() {
    await save(await makeEntry({ kind: 'voice', files: [pendingRecording.blob], duration: pendingRecording.duration }));
    pendingRecording = undefined;
    recordButton.textContent = 'Записать голос';
    recordState.textContent = 'Готово к записи';
  }

  async function record() {
    if (busy) return;
    if (recorder?.state === 'recording') { recorder.stop(); return; }
    busy = true;
    recordButton.disabled = true;
    try {
      if (pendingRecording) { await saveRecording(); return; }
      if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) throw new Error('Запись голоса недоступна. Откройте Stream по HTTPS в Chrome');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      try {
        const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((mime) => MediaRecorder.isTypeSupported(mime));
        recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      } catch (error) { stream.getTracks().forEach((track) => track.stop()); throw error; }
      const chunks = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = async () => {
        clearInterval(recordingTimer);
        stream.getTracks().forEach((track) => track.stop());
        pendingRecording = { blob: new Blob(chunks, { type: recorder.mimeType }), duration: (Date.now() - started) / 1000 };
        recordButton.disabled = true;
        recordButton.classList.remove('recording');
        try { await saveRecording(); }
        catch (error) { recordButton.textContent = 'Сохранить запись'; notify(`Запись ждёт сохранения. ${error.message}`); }
        finally { recordButton.disabled = false; }
      };
      recorder.onerror = () => { notify('Ошибка микрофона. Сохраняем полученную часть записи'); if (recorder.state === 'recording') recorder.stop(); };
      started = Date.now();
      recorder.start(1000);
      recordButton.classList.add('recording');
      recordButton.textContent = 'Остановить и сохранить';
      recordState.textContent = 'Идёт запись';
      recordingTimer = setInterval(() => {
        recordState.textContent = `Идёт запись · ${Math.floor((Date.now() - started) / 1000)} с`;
        if (chunks.reduce((total, chunk) => total + chunk.size, 0) >= config.max_media_bytes - config.max_event_bytes) recorder.stop();
      }, 1000);
    } catch (error) { notify(error.message); }
    finally { busy = false; recordButton.disabled = false; }
  }

  recordButton.addEventListener('click', record);
  window.addEventListener('beforeunload', (event) => {
    if (recorder?.state === 'recording' || pendingRecording) { event.preventDefault(); event.returnValue = ''; }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!text.value.trim()) return;
    const button = form.querySelector('button');
    button.disabled = true;
    const original = text.value;
    try { await save(await makeEntry({ text: original })); if (text.value === original) text.value = ''; }
    catch (error) { notify(`Текст ждёт сохранения. ${error.message}`); }
    finally { button.disabled = false; }
  });
  photo.addEventListener('change', async () => {
    const files = Array.from(photo.files);
    if (!files.length) return;
    photo.disabled = true;
    try {
      for (const file of files) {
        if (file.size > config.max_media_bytes) throw new Error('Фото слишком большое для отправки');
        if (!config.mime_types.some((type) => type.endsWith('/*') ? file.type.startsWith(type.slice(0, -1)) : file.type === type)) throw new Error('Формат фото не поддерживается');
      }
      await save(await makeEntry({ kind: 'photo', files }));
      photo.value = '';
    } catch (error) { notify(error.message); }
    finally { photo.disabled = false; }
  });
  return { record };
}
