import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';

// Connections switched off and on from the System screen (owner, 2026-11-21). Off keeps every setting — keys, tokens,
// linked devices: a bot or a client stops, Google stops reading, the triage pauses; a channel that sends from a device
// (Viber bridge, the phone) is answered 503 so the device keeps its queue until it is on again. Kept in the data volume
// (`switches.json`); everything is on until switched off.

export const CONNECTORS = ['telegram_by', 'telegram_pl', 'whatsapp_pl', 'viber', 'android_phone', 'google_calendar', 'ai_triage'] as const;

export class ConnectorSwitches {
  #file: string;
  #off: Record<string, boolean>;
  #listeners = new Set<(id: string, on: boolean) => void>();

  constructor(file: string) {
    this.#file = file;
    let saved: { off?: Record<string, boolean> } = {};
    try { if (existsSync(file)) saved = JSON.parse(readFileSync(file, 'utf8')); } catch { console.error('Switches: the file is unreadable, all on'); }
    this.#off = saved.off ?? {};
  }

  static known(id: string): boolean { return (CONNECTORS as readonly string[]).includes(id); }

  isOn(id: string): boolean { return !this.#off[id]; }

  off(): string[] { return Object.keys(this.#off).filter((id) => this.#off[id]); }

  set(id: string, on: boolean): void {
    if (!ConnectorSwitches.known(id)) throw new Error('Неизвестное подключение');
    if (this.isOn(id) === on) return;
    if (on) delete this.#off[id]; else this.#off[id] = true;
    const temporary = `${this.#file}.tmp`;
    writeFileSync(temporary, JSON.stringify({ off: this.#off }));
    renameSync(temporary, this.#file);
    for (const listener of this.#listeners) listener(id, on);
  }

  onChange(listener: (id: string, on: boolean) => void): void { this.#listeners.add(listener); }
}
