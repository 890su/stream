import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { toItem, bareJid, phoneOfJid } from '../src/whatsapp/convert.ts';
import type { WaFiles, WaKey, WaMessage } from '../src/whatsapp/types.ts';

const m = (key: Partial<WaKey> = {}, message: Record<string, any> | null = { conversation: 'Cześć' }, extra: Partial<WaMessage> = {}): WaMessage =>
  ({ key: { remoteJid: '48500000001@s.whatsapp.net', id: 'A1', fromMe: false, ...key }, message, messageTimestamp: 1763632800, pushName: 'Anna', ...extra });

function files({ limit = 20971520, allowed = (_mime: string): boolean => true, bytes = Buffer.from('file-bytes'), fail = false } = {}) {
  const stored: { sha: string; mime: string; size: number }[] = [];
  const f: WaFiles = {
    limit, allowed,
    download: async () => { if (fail) throw new Error('boom'); return bytes; },
    store: (sha, mime, data) => { stored.push({ sha, mime, size: data.length }); },
  };
  return { f, stored };
}
const noLid = async () => null;

test('an incoming text from a phone address', async () => {
  const item = await toItem(m(), files().f, noLid);
  assert.equal(item?.id, 'A1');
  assert.equal(item?.jid, '48500000001@s.whatsapp.net');
  assert.equal(item?.phone, '+48500000001');
  assert.equal(item?.chat, 'Anna');
  assert.equal(item?.out, false);
  assert.equal(item?.kind, 'text');
  assert.equal(item?.text, 'Cześć');
  assert.equal(item?.media, undefined);
});

test('a LID address takes the phone from remoteJidAlt', async () => {
  const item = await toItem(m({ remoteJid: '1234@lid', remoteJidAlt: '48500000001@s.whatsapp.net' }), files().f, noLid);
  assert.equal(item?.phone, '+48500000001');
  assert.equal(item?.jid, '1234@lid');
});

test('a LID address falls back to the cached mapping', async () => {
  const asked: string[] = [];
  const item = await toItem(m({ remoteJid: '1234@lid' }), files().f, async (lid) => { asked.push(lid); return '48500000001:3@s.whatsapp.net'; });
  assert.deepEqual(asked, ['1234@lid']);
  assert.equal(item?.phone, '+48500000001');
});

test('an unresolved LID has no phone and keeps the name', async () => {
  const item = await toItem(m({ remoteJid: '1234@lid' }), files().f, noLid);
  assert.equal(item?.phone, undefined);
  assert.equal(item?.chat, 'Anna');
  assert.equal(item?.jid, '1234@lid');
});

test('my own message from the phone is out', async () => {
  const item = await toItem(m({ fromMe: true }, { conversation: 'Jestem w drodze' }, { pushName: 'Owner' }), files().f, noLid);
  assert.equal(item?.out, true);
  assert.equal(item?.chat, '+48500000001');
  assert.equal(item?.text, 'Jestem w drodze');
});

test('groups, status and channels are skipped', async () => {
  for (const remoteJid of ['120363000000000000@g.us', 'status@broadcast', '120363000000000001@newsletter']) {
    assert.equal(await toItem(m({ remoteJid }), files().f, noLid), null, remoteJid);
  }
  assert.equal(await toItem(m({ id: null }), files().f, noLid), null, 'no id');
  assert.equal(await toItem(m({ remoteJid: null }), files().f, noLid), null, 'no address');
});

test('reactions, stickers, edits and service messages are skipped', async () => {
  const kinds = [
    { reactionMessage: { text: '👍' } }, { stickerMessage: { mimetype: 'image/webp' } }, { protocolMessage: { type: 0 } },
    { editedMessage: { message: { conversation: 'poprawione' } } }, { senderKeyDistributionMessage: {} }, { pollUpdateMessage: {} },
  ];
  for (const message of kinds) assert.equal(await toItem(m({}, message), files().f, noLid), null, Object.keys(message)[0]);
  assert.equal(await toItem(m({}, null), files().f, noLid), null, 'no content');
});

test('a photo with a caption is stored', async () => {
  const bytes = Buffer.from('jpeg-bytes');
  const { f, stored } = files({ bytes });
  const item = await toItem(m({}, { imageMessage: { mimetype: 'image/jpeg', caption: 'Zdjęcie', fileLength: bytes.length } }), f, noLid);
  const sha = createHash('sha256').update(bytes).digest('hex');
  assert.equal(item?.kind, 'photo');
  assert.equal(item?.text, 'Zdjęcie');
  assert.deepEqual(item?.media, [{ media_id: sha, mime: 'image/jpeg', size_bytes: bytes.length }]);
  assert.deepEqual(stored, [{ sha, mime: 'image/jpeg', size: bytes.length }]);
});

test('a voice note is voice', async () => {
  const item = await toItem(m({}, { audioMessage: { ptt: true, mimetype: 'audio/ogg; codecs=opus', seconds: 7, fileLength: 10 } }), files().f, noLid);
  assert.equal(item?.kind, 'voice');
  assert.equal(item?.media?.[0]?.mime, 'audio/ogg');
  assert.equal(item?.media?.[0]?.duration_s, 7);
});

test('a document keeps its name and a too large one becomes a note', async () => {
  const { f, stored } = files();
  const big = await toItem(m({}, { documentMessage: { mimetype: 'application/pdf', fileName: 'umowa.pdf', fileLength: 30000000 } }), f, noLid);
  assert.equal(big?.kind, 'text');
  assert.match(big?.text ?? '', /«umowa\.pdf» не загружен: больше 20 МБ/);
  assert.equal(stored.length, 0);
  const refused = await toItem(m({}, { documentMessage: { mimetype: 'application/x-msdownload', fileName: 'setup.exe' } }), files({ allowed: () => false }).f, noLid);
  assert.match(refused?.text ?? '', /«setup\.exe» не загружен: такой тип не принимается/);
  const small = await toItem(m({}, { documentMessage: { mimetype: 'application/pdf', fileName: 'umowa.pdf', fileLength: 10 } }), files().f, noLid);
  assert.equal(small?.kind, 'file');
  assert.equal(small?.media?.[0]?.mime, 'application/pdf');
});

test('a failed download becomes a note', async () => {
  const item = await toItem(m({}, { imageMessage: { mimetype: 'image/jpeg', caption: 'Zdjęcie', fileLength: 10 } }), files({ fail: true }).f, noLid);
  assert.equal(item?.kind, 'text');
  assert.match(item?.text ?? '', /^Zdjęcie\n\[файл «image\/jpeg» не загружен: ошибка загрузки\]$/);
});

test('wrappers are unwrapped and the device suffix dropped', async () => {
  const item = await toItem(m({ remoteJid: '48500000001:12@s.whatsapp.net' }, { ephemeralMessage: { message: { extendedTextMessage: { text: 'Znikające' } } } }), files().f, noLid);
  assert.equal(item?.jid, '48500000001@s.whatsapp.net');
  assert.equal(item?.text, 'Znikające');
  assert.equal(bareJid('1234:5@lid'), '1234@lid');
  assert.equal(phoneOfJid('1234@lid'), undefined);
});

test('a timestamp as Long is read', async () => {
  const item = await toItem(m({}, { conversation: 'x' }, { messageTimestamp: { toNumber: () => 1763632800 } }), files().f, noLid);
  assert.equal(item?.date, '2025-11-20T10:00:00.000Z');
});

// Review fixes (2026-11-20): nothing big without a known size, nothing vanishes silently.
test('a file of unknown size is not downloaded', async () => {
  let asked = 0;
  const f: WaFiles = { limit: 20971520, allowed: () => true, download: async () => { asked += 1; return Buffer.from('x'); }, store: () => {} };
  const item = await toItem(m({}, { videoMessage: { mimetype: 'video/mp4' } }), f, noLid);
  assert.equal(asked, 0);
  assert.equal(item?.kind, 'text');
  assert.match(item?.text ?? '', /«video\/mp4» не загружен: размер неизвестен/);
});

test('round video notes are files', async () => {
  const item = await toItem(m({}, { ptvMessage: { mimetype: 'video/mp4', fileLength: 10, seconds: 4 } }), files().f, noLid);
  assert.equal(item?.kind, 'file');
  assert.equal(item?.media?.[0]?.mime, 'video/mp4');
});

test('contacts, polls and live locations are shown in words', async () => {
  const contacts = await toItem(m({}, { contactsArrayMessage: { contacts: [{ displayName: 'Jan' }, { displayName: 'Ola' }] } }), files().f, noLid);
  assert.equal(contacts?.text, '👤 Jan, Ola');
  const poll = await toItem(m({}, { pollCreationMessageV3: { name: 'Kiedy?' } }), files().f, noLid);
  assert.equal(poll?.text, '📊 Kiedy?');
  const live = await toItem(m({}, { liveLocationMessage: { degreesLatitude: 52.2297, degreesLongitude: 21.0122 } }), files().f, noLid);
  assert.equal(live?.text, '📍 52.22970, 21.01220');
});

test('a business message shows its text', async () => {
  const template = await toItem(m({}, { templateMessage: { hydratedTemplate: { hydratedContentText: 'Twoja paczka jest w drodze' } } }), files().f, noLid);
  assert.equal(template?.text, 'Twoja paczka jest w drodze');
  const interactive = await toItem(m({}, { interactiveMessage: { body: { text: 'Wybierz termin' } } }), files().f, noLid);
  assert.equal(interactive?.text, 'Wybierz termin');
  const buttons = await toItem(m({}, { buttonsMessage: { contentText: 'Potwierdź wizytę' } }), files().f, noLid);
  assert.equal(buttons?.text, 'Potwierdź wizytę');
});

test('an unknown kind leaves a note instead of vanishing', async () => {
  const item = await toItem(m({}, { someNewMessage: { x: 1 }, messageContextInfo: {} }), files().f, noLid);
  assert.equal(item?.text, '[сообщение WhatsApp, которое Stream не показывает — откройте в WhatsApp]');
  assert.equal(await toItem(m({}, { messageContextInfo: {}, senderKeyDistributionMessage: {} }), files().f, noLid), null, 'service parts only');
});
