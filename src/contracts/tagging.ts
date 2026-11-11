import { HttpError } from '../server/errors.ts';
import type { JournalEvent } from './validate.ts';

interface Tagging { engine: string; suggested: string[]; auto: string[]; owner_on: string[]; owner_off: string[] }

// Tag feedback (CONCEPT.md §2.2) is training data, so it must describe the final tags exactly.
// The JSON Schema checks the shape; this checks how the lists relate to payload.tags.
export function checkTagging(event: JournalEvent): void {
  const tagging = event.payload.data?.tagging as Tagging | undefined;
  if (!tagging) return;
  const tags = new Set(event.payload.tags ?? []);
  const lists = ['suggested', 'auto', 'owner_on', 'owner_off'] as const;
  const seen = new Set<string>();
  for (const list of lists) {
    for (const tag of tagging[list]) {
      if (seen.has(tag)) throw new HttpError(400, `Метка ${tag} указана в tagging дважды`);
      seen.add(tag);
    }
  }
  for (const tag of [...tagging.auto, ...tagging.owner_on]) {
    if (!tags.has(tag)) throw new HttpError(400, `Включённая метка ${tag} должна быть в payload.tags`);
  }
  for (const tag of [...tagging.owner_off, ...tagging.suggested]) {
    if (tags.has(tag)) throw new HttpError(400, `Невключённая метка ${tag} не должна быть в payload.tags`);
  }
}
