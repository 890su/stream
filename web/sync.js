async function accepted(response) {
  if (response.status === 200 || response.status === 201) return response.json();
  const body = await response.json().catch(() => ({}));
  const error = new Error(body.error || `Ошибка отправки ${response.status}`);
  error.status = response.status;
  throw error;
}

export async function syncEntries(repository, token, request = fetch, onAccepted = async () => {}, timeoutMs) {
  if (!token) return false;
  let success = true;
  const headers = { Authorization: `Bearer ${token}` };
  const send = (url, init) => request(url, { ...init, ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}) });
  // Oldest first: a reply or a correction never reaches the server before its message.
  const entries = (await repository.list()).sort((a, b) => a.event.ts.localeCompare(b.event.ts));
  for (const entry of entries) {
    try {
      for (const file of entry.files) {
        const metadata = await accepted(await send(`/api/media/${file.id}`, {
          method: 'PUT', headers: { ...headers, 'Content-Type': file.blob.type }, body: file.blob,
        }));
        for (const reference of entry.event.payload.media ?? []) {
          if (reference.media_id === file.id) {
            reference.mime = metadata.mime;
            reference.size_bytes = metadata.size_bytes;
          }
        }
      }
      // Persist canonical media metadata before posting, including before a lost response.
      delete entry.error;
      await repository.save(entry);
      const saved = await accepted(await send('/api/events', {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(entry.event),
      }));
      await onAccepted(saved);
      await repository.remove(entry.event.id);
    } catch (error) {
      entry.error = error.status === 409
        ? 'Конфликт id. Запись сохранена на устройстве. Нужна проверка владельца'
        : error.status === 401 ? 'Токен не принят. Обновите его в настройках' : error.message;
      await repository.save(entry);
      success = false;
      if (!error.status || error.status === 401 || error.status >= 500) break;
    }
  }
  return success;
}
