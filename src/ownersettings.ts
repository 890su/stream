import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';

// The owner's settings made on the System screen (docs/plans/2026-11-21-workspace-redesign-design.md): how the AI
// makes new tasks — `unconfirmed` (it proposes, the owner confirms; the default) or `confirmed` (real at once). Kept in
// the data volume (`settings.json`) next to the switches; system state, not the journal.

export type TriageNewTasks = 'unconfirmed' | 'confirmed';
const MODES: readonly TriageNewTasks[] = ['unconfirmed', 'confirmed'];

export class OwnerSettings {
  #file: string;
  #data: { triage_new_tasks?: TriageNewTasks };

  constructor(file: string) {
    this.#file = file;
    let saved: { triage_new_tasks?: TriageNewTasks } = {};
    try { if (existsSync(file)) saved = JSON.parse(readFileSync(file, 'utf8')); } catch { console.error('Settings: the file is unreadable, defaults'); }
    this.#data = saved;
  }

  static isMode(value: unknown): value is TriageNewTasks { return (MODES as readonly unknown[]).includes(value); }

  triageNewTasks(): TriageNewTasks { return OwnerSettings.isMode(this.#data.triage_new_tasks) ? this.#data.triage_new_tasks : 'unconfirmed'; }

  setTriageNewTasks(value: TriageNewTasks): void {
    if (!OwnerSettings.isMode(value)) throw new Error('Нужно value: unconfirmed или confirmed');
    this.#data = { ...this.#data, triage_new_tasks: value };
    const temporary = `${this.#file}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.#data));
    renameSync(temporary, this.#file);
  }
}
