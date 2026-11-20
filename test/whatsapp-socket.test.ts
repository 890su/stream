import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SOCKET_OPTIONS, createSocket, saveQuietly, updateOf } from '../src/whatsapp/socket.ts';

test('updateOf: logged out is 401', () => {
  assert.deepEqual(updateOf({ connection: 'close', lastDisconnect: { error: { output: { statusCode: 401 }, message: 'logged out' } } }),
    { connection: 'close', loggedOut: true, reason: 'logged out' });
});

test('updateOf: a restart is not a logout', () => {
  const update = updateOf({ connection: 'close', lastDisconnect: { error: { output: { statusCode: 515 }, message: 'restart required' } } });
  assert.equal(update.loggedOut, false);
  assert.equal(update.restart, true);
  assert.equal(update.reason, 'restart required');
});

test('updateOf: the QR passes through', () => {
  assert.deepEqual(updateOf({ qr: '2@abc' }), { qr: '2@abc', loggedOut: false });
});

test('createSocket is a socket factory', () => {
  assert.equal(typeof createSocket, 'function');
});

test('a failed key write does not crash the server', async () => {
  const unhandled: unknown[] = [];
  const catcher = (reason: unknown) => { unhandled.push(reason); };
  process.on('unhandledRejection', catcher);
  try {
    saveQuietly(async () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); })();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
  } finally { process.off('unhandledRejection', catcher); }
});

test('the socket never shows the owner online and keeps the LID mappings', () => {
  assert.equal(SOCKET_OPTIONS.markOnlineOnConnect, false, 'otherwise the phone stops showing WhatsApp notifications');
  assert.equal(SOCKET_OPTIONS.emitOwnEvents, false, 'a reply sent from the feed must not come back as a message');
  assert.equal(SOCKET_OPTIONS.syncFullHistory, false);
  assert.equal(SOCKET_OPTIONS.generateHighQualityLinkPreview, false);
  assert.equal('shouldSyncHistoryMessage' in SOCKET_OPTIONS, false,
    "Baileys' default sync (all but FULL) carries the LID ↔ phone mappings; history itself never reaches the journal");
});
