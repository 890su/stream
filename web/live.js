// Live updates over Server-Sent Events, read with fetch so the owner token travels in a header
// (EventSource cannot send headers, and a token in the URL would end up in proxy logs).
const MIN_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000;

export function parseEvents(buffer, onMessage) {
  let index;
  while ((index = buffer.indexOf('\n\n')) >= 0) {
    const block = buffer.slice(0, index);
    buffer = buffer.slice(index + 2);
    let name = 'message';
    const data = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) name = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (data.length) onMessage(name, data.join('\n'));
  }
  return buffer; // an unfinished block waits for the next chunk
}

export function startLive({ getToken, onEvent, onConnect }) {
  let controller;
  let retryTimer;
  let delay = MIN_DELAY_MS;
  let connected = false;

  function schedule() {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(connect, delay);
    delay = Math.min(delay * 2, MAX_DELAY_MS);
  }

  async function connect() {
    // In the background the phone keeps no connection; returning to the app reconnects and catches up.
    if (controller || document.hidden || !navigator.onLine) return;
    const token = await getToken();
    if (!token) { schedule(); return; }
    const own = new AbortController();
    controller = own;
    try {
      const response = await fetch('/api/live', {
        headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' }, cache: 'no-store', signal: own.signal,
      });
      if (!response.ok || !response.body) throw new Error(`live ${response.status}`);
      connected = true;
      delay = MIN_DELAY_MS;
      onConnect(); // fetch whatever was written while this client was not listening
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer = parseEvents(buffer + value, (name, data) => {
          if (name === 'append') { try { onEvent(JSON.parse(data)); } catch { /* malformed message: the next refresh fixes the feed */ } }
        });
      }
    } catch { /* network drop or abort: handled below */ }
    if (controller === own) { controller = undefined; connected = false; }
    if (!own.signal.aborted) schedule();
  }

  function disconnect() {
    clearTimeout(retryTimer);
    const current = controller;
    controller = undefined;
    connected = false;
    current?.abort();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) disconnect();
    else { delay = MIN_DELAY_MS; connect(); }
  });
  window.addEventListener('online', () => { delay = MIN_DELAY_MS; connect(); });
  window.addEventListener('offline', disconnect);
  connect();
  return { connected: () => connected, reconnect: () => { disconnect(); delay = MIN_DELAY_MS; connect(); } };
}
