import type { JournalEvent } from '../contracts/validate.ts';

// Projects as the fold of `project_change` events (CONCEPT.md §2.11), server side for the triage; the client folds
// the same way (web/projects.js).

export interface ProjectSection { id: string; title: string; role?: 'next' | 'ideas' }
export interface Project { id: string; title: string; parent: string | null; kind: string; status: string; sections: ProjectSection[]; sources: string[]; scope: string }

export function foldProjects(events: JournalEvent[]): Project[] {
  const projects = new Map<string, Project>();
  const ordered = events.filter((event) => event.kind === 'project_change')
    .sort((a, b) => a.ts.localeCompare(b.ts) || (a.received_at ?? '').localeCompare(b.received_at ?? ''));
  for (const event of ordered) {
    const id = event.payload.ref!.id;
    const change = event.payload.data!.project as Record<string, any>;
    let project = projects.get(id);
    if (!project) {
      if (change.op !== 'create') continue;
      project = { id, title: change.title, parent: null, kind: 'stream', status: 'active', sections: [], sources: [], scope: '' };
      projects.set(id, project);
    }
    for (const key of ['title', 'parent', 'kind', 'status', 'sections', 'sources', 'scope'] as const) if (change[key] !== undefined) (project as any)[key] = change[key];
  }
  return [...projects.values()];
}

// The source key of a triage stream (`tg|by|<chat>`, `phone`, `me`) as projects name it: `tg:by`, `phone`, `me`.
export const sourceKeyOf = (stream: string): string => (stream.startsWith('tg|') ? `tg:${stream.split('|')[1]}` : stream);

// The default project of a stream: the first active project (by title) that takes its source.
export function defaultProject(projects: Project[], stream: string): Project | null {
  const key = sourceKeyOf(stream);
  return projects.filter((project) => project.status === 'active' && project.sources.includes(key))
    .sort((a, b) => a.title.localeCompare(b.title, 'ru'))[0] ?? null;
}
