import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import type { TopicDays } from './config.ts';

// The owner's settings made on the System screen (docs/plans/2026-11-21-workspace-redesign-design.md): how the AI
// makes new tasks — `unconfirmed` (it proposes, the owner confirms; the default) or `confirmed` (real at once). Kept in
// the data volume (`settings.json`) next to the switches; system state, not the journal. Also how long a topic stays
// live (topics design 2026-11-23): days without messages and days after its conversation left the queue.

export type TriageNewTasks = 'unconfirmed' | 'confirmed';
const MODES: readonly TriageNewTasks[] = ['unconfirmed', 'confirmed'];
export const TOPIC_DAYS_ERROR = 'Нужно topic_days и archive_days — целые от 1 до 365';
const isDays = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 365;
type Data = { triage_new_tasks?: TriageNewTasks; topics?: TopicDays };

export class OwnerSettings {
  #file: string;
  #data: Data;

  constructor(file: string) {
    this.#file = file;
    let saved: Data = {};
    try { if (existsSync(file)) saved = JSON.parse(readFileSync(file, 'utf8')); } catch { console.error('Settings: the file is unreadable, defaults'); }
    this.#data = saved;
  }

  static isMode(value: unknown): value is TriageNewTasks { return (MODES as readonly unknown[]).includes(value); }

  triageNewTasks(): TriageNewTasks { return OwnerSettings.isMode(this.#data.triage_new_tasks) ? this.#data.triage_new_tasks : 'unconfirmed'; }

  setTriageNewTasks(value: TriageNewTasks): void {
    if (!OwnerSettings.isMode(value)) throw new Error('Нужно value: unconfirmed или confirmed');
    this.#save({ ...this.#data, triage_new_tasks: value });
  }

  static isTopics(value: unknown): value is TopicDays {
    const days = value as Partial<TopicDays> | null;
    return Boolean(days) && isDays(days!.topic_days) && isDays(days!.archive_days);
  }

  // The owner's topic lifetimes over the registry defaults (registry/conversations.json).
  topics(defaults: TopicDays): TopicDays {
    const saved = this.#data.topics;
    return OwnerSettings.isTopics(saved) ? { topic_days: saved.topic_days, archive_days: saved.archive_days } : { ...defaults };
  }

  setTopics(value: TopicDays): void {
    if (!OwnerSettings.isTopics(value)) throw new Error(TOPIC_DAYS_ERROR);
    this.#save({ ...this.#data, topics: { topic_days: value.topic_days, archive_days: value.archive_days } });
  }

  #save(data: Data): void {
    this.#data = data;
    const temporary = `${this.#file}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.#data));
    renameSync(temporary, this.#file);
  }
}
