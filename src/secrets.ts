import { existsSync, readFileSync, renameSync, writeFileSync, chmodSync } from 'node:fs';

// Keys entered on the System screen (owner, 2026-11-21: connections are set up in the app, like WhatsApp): the Google
// client and the Telegram bot tokens. Kept in the data volume (`secrets.json`, mode 600), never in git, the journal or
// the log, never sent back to the client — the screen sees only «задан, оканчивается на …». A key entered in the app
// wins over `/srv/stream/.env`; without it the .env value works as before. The owner token stays in .env.

export const SECRETS = [
  { name: 'STREAM_GOOGLE_CLIENT_ID', group: 'google', title: 'Google — Client ID', check: (value: string) => /^[\w-]+\.apps\.googleusercontent\.com$/.test(value), hint: 'Client ID оканчивается на .apps.googleusercontent.com' },
  { name: 'STREAM_GOOGLE_CLIENT_SECRET', group: 'google', title: 'Google — Client secret', check: (value: string) => /^[\w-]{10,200}$/.test(value), hint: 'Client secret — строка из букв, цифр и дефисов' },
  { name: 'STREAM_TG_BY_BOT_TOKEN', group: 'telegram:by', title: 'Telegram BY — токен бота', check: (value: string) => /^\d{5,15}:[\w-]{30,60}$/.test(value), hint: 'токен бота вида 123456789:AAE… из @BotFather' },
  { name: 'STREAM_TG_PL_BOT_TOKEN', group: 'telegram:pl', title: 'Telegram PL — токен бота', check: (value: string) => /^\d{5,15}:[\w-]{30,60}$/.test(value), hint: 'токен бота вида 123456789:AAE… из @BotFather' },
] as const;
export type SecretName = typeof SECRETS[number]['name'];

export class SecretStore {
  #file: string;
  #env: Record<string, string | undefined>;
  #values: Record<string, string>;
  #listeners = new Set<(name: SecretName) => void>();

  constructor(file: string, env: Record<string, string | undefined> = process.env) {
    this.#file = file;
    this.#env = env;
    let saved: Record<string, string> = {};
    try { if (existsSync(file)) saved = JSON.parse(readFileSync(file, 'utf8')); } catch { console.error('Secrets: the file is unreadable, .env only'); }
    this.#values = saved;
  }

  static known(name: string): name is SecretName { return SECRETS.some((item) => item.name === name); }

  get(name: SecretName): string | undefined { return this.#values[name] || this.#env[name] || undefined; }

  set(name: string, value: string): void {
    const spec = SECRETS.find((item) => item.name === name);
    if (!spec) throw new Error('Неизвестный ключ');
    const trimmed = String(value ?? '').trim();
    if (!spec.check(trimmed)) throw new Error(`Не похоже на ${spec.hint}`);
    this.#values[name] = trimmed;
    this.#save();
    for (const listener of this.#listeners) listener(name as SecretName);
  }

  remove(name: string): void {
    if (!SecretStore.known(name)) throw new Error('Неизвестный ключ');
    delete this.#values[name];
    this.#save();
    for (const listener of this.#listeners) listener(name);
  }

  onChange(listener: (name: SecretName) => void): void { this.#listeners.add(listener); }

  // What the System screen may see: set or not, where from, the last four characters.
  describe() {
    return SECRETS.map(({ name, group, title }) => {
      const source = this.#values[name] ? 'app' : this.#env[name] ? 'env' : null;
      const value = this.get(name) ?? '';
      return { name, group, title, set: Boolean(source), source, tail: value.length > 12 ? value.slice(-4) : '' };
    });
  }

  #save(): void {
    const temporary = `${this.#file}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.#values), { mode: 0o600 });
    try { chmodSync(temporary, 0o600); } catch { /* not on every file system */ }
    renameSync(temporary, this.#file);
  }
}
