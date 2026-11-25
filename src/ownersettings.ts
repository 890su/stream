import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';

// The owner's settings made on the System screen and in ⋮ (docs/plans/2026-11-21-workspace-redesign-design.md,
// docs/plans/2026-11-25-read-queue-and-task-talk-design.md): how the AI makes new tasks — `unconfirmed` (it proposes,
// the owner confirms; the default) or `confirmed` (real at once) — and after how many quiet days a read conversation
// goes to the archive (default 3, 0 = never, at most 30). Kept in the data volume (`settings.json`) next to the
// switches; system state, not the journal.

export type TriageNewTasks = 'unconfirmed' | 'confirmed';
const MODES: readonly TriageNewTasks[] = ['unconfirmed', 'confirmed'];

export class OwnerSettings {
  #file: string;
  #data: { triage_new_tasks?: TriageNewTasks; archive_read_days?: number };

  constructor(file: string) {
    this.#file = file;
    let saved: { triage_new_tasks?: TriageNewTasks; archive_read_days?: number } = {};
    try { if (existsSync(file)) saved = JSON.parse(readFileSync(file, 'utf8')); } catch { console.error('Settings: the file is unreadable, defaults'); }
    this.#data = saved;
  }

  static isMode(value: unknown): value is TriageNewTasks { return (MODES as readonly unknown[]).includes(value); }

  static isArchiveDays(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 30;
  }

  triageNewTasks(): TriageNewTasks { return OwnerSettings.isMode(this.#data.triage_new_tasks) ? this.#data.triage_new_tasks : 'unconfirmed'; }

  setTriageNewTasks(value: TriageNewTasks): void {
    if (!OwnerSettings.isMode(value)) throw new Error('Нужно value: unconfirmed или confirmed');
    this.#data = { ...this.#data, triage_new_tasks: value };
    this.#save();
  }

  // Quiet days before a read conversation leaves the queue (CONCEPT.md §2.5). Missing or corrupt → 3.
  archiveReadDays(): number { return OwnerSettings.isArchiveDays(this.#data.archive_read_days) ? this.#data.archive_read_days : 3; }

  setArchiveReadDays(value: number): void {
    if (!OwnerSettings.isArchiveDays(value)) throw new Error('Нужно число дней от 0 до 30');
    this.#data = { ...this.#data, archive_read_days: value };
    this.#save();
  }

  #save(): void {
    const temporary = `${this.#file}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.#data));
    renameSync(temporary, this.#file);
  }
}
