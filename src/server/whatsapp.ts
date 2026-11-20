import type { ServerResponse } from 'node:http';
import QRCode from 'qrcode';
import { HttpError } from './errors.ts';
import type { WhatsAppClient } from '../whatsapp/client.ts';

// GET /api/whatsapp/<account>/qr (owner token): the linking QR as a PNG while WhatsApp waits for the owner to scan
// it with the phone — the System screen shows it (deploy/WHATSAPP.md). An unscanned QR expires; asking for it again
// wakes the client for a new one. Nothing to show once the device is linked.
export async function whatsappQr(response: ServerResponse, client: WhatsAppClient | undefined): Promise<void> {
  const qr = client?.qr;
  if (!qr && client?.requestQr()) throw new HttpError(404, 'QR готовится — экран «Система» покажет его через несколько секунд');
  if (!qr) throw new HttpError(404, 'QR нет: WhatsApp уже подключён или ещё не запросил вход');
  const png = await QRCode.toBuffer(qr, { type: 'png', margin: 2, width: 320 });
  response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'Content-Length': png.length });
  response.end(png);
}
