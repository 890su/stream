// Microphone recording. Knows nothing about the queue: returns a Blob and its duration.
export function createRecorder(config) {
  let recorder;
  let stream;
  let chunks = [];
  let started = 0;
  let tickTimer;
  let finish;

  const active = () => recorder?.state === 'recording';
  const elapsed = () => (started ? (Date.now() - started) / 1000 : 0);

  function release() {
    clearInterval(tickTimer);
    stream?.getTracks().forEach((track) => track.stop());
    stream = undefined;
  }

  async function start({ onTick, onLimit } = {}) {
    if (active()) return;
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) {
      throw new Error('Запись голоса недоступна. Откройте Stream по HTTPS в Chrome');
    }
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    try {
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((mime) => MediaRecorder.isTypeSupported(mime));
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch (error) { release(); throw error; }
    chunks = [];
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = () => {
      release();
      const result = { blob: new Blob(chunks, { type: recorder.mimeType }), duration: elapsed() };
      started = 0;
      finish?.(result);
      finish = undefined;
    };
    recorder.onerror = () => { if (active()) recorder.stop(); };
    started = Date.now();
    recorder.start(1000);
    const limit = config.max_media_bytes - config.max_event_bytes;
    tickTimer = setInterval(() => {
      onTick?.(elapsed());
      if (chunks.reduce((total, chunk) => total + chunk.size, 0) >= limit) onLimit?.();
    }, 250);
  }

  // Resolves with { blob, duration } when keep is true, or null when the recording is discarded.
  function stop(keep = true) {
    if (!active()) return Promise.resolve(null);
    return new Promise((resolve) => {
      finish = (result) => resolve(keep && result.blob.size ? result : null);
      recorder.stop();
    });
  }

  return { start, stop, active, elapsed };
}

export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
