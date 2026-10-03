import { ResearchEngine, engineHash } from './research-engine';
import { LEGACY_PROJECT_ID } from './domain-store';
import { publicResearch, publicProgram } from '../cloud/access';
import type { ResearchState, ResearchNode } from '../shared/types';
import type { ProgramState } from '../shared/program';
/** Public DTOs are built only from frozen publication records, never from linked private state. */
export function publishedState(engine: ResearchEngine): ResearchState {
  const data = engine.data(),
    publications = data.publications.filter((p) => p.active);
  if (!engine.migrationReport().ready && engine.projectId === LEGACY_PROJECT_ID)
    return publicResearch(engine.store.state());
  const legacy = publications.some((p) => p.id === `legacy-publication:${engine.projectId}`)
    ? engine.legacyPublic()
    : null;
  if (!publications.length) throw new Error('Public project not found');
  const latest = publications.at(-1)!;
  const nodes: ResearchNode[] = publications
    .filter((p) => !p.id.startsWith('legacy-publication:'))
    .flatMap((p) =>
      p.revisions.map((r, i) => ({
        id: `published-${engineHash(`${p.id}:${i}`).slice(0, 24)}`,
        projectId: engine.projectId,
        title: r.title,
        summary: 'Explicitly published immutable statement; no proof certificate implied.',
        content: r.statement,
        type: r.kind === 'goal' ? 'Open Question' : r.kind === 'claim' ? 'Claim' : 'Note',
        epistemicStatus: 'Unverified',
        humanVerified: false,
        confidence: 0,
        originType: 'Human',
        originName: 'Researcher-published snapshot',
        provenanceText: '',
        tags: ['publication-snapshot'],
        links: [],
        createdAt: p.createdAt,
        updatedAt: p.createdAt,
      })),
    );
  return {
    project: legacy?.state.project ?? {
      id: engine.projectId,
      title: latest.title,
      description: 'Published research statements',
      createdAt: latest.createdAt,
    },
    nodes: [...(legacy?.state.nodes ?? []), ...nodes],
    edges: legacy?.state.edges ?? [],
    events: [],
    llmEnabled: false,
    canEdit: false,
  };
}
export function publishedProgram(engine: ResearchEngine): ProgramState {
  const data = engine.data();
  if (!engine.migrationReport().ready && engine.projectId === LEGACY_PROJECT_ID)
    return publicProgram(engine.program.state());
  const legacy = data.publications.some(
    (p) => p.active && p.id === `legacy-publication:${engine.projectId}`,
  )
    ? engine.legacyPublic()
    : null;
  if (!data.publications.some((p) => p.active)) throw new Error('Public project not found');
  return { goals: legacy?.program.goals ?? [], assessments: legacy?.program.assessments ?? [] };
}
/** Listing uses the same frozen metadata as the public page. Private title edits stay private. */
export function publishedProjects(engine: ResearchEngine) {
  return engine.listProjects().flatMap((project) => {
    const publication = engine.store.db
      .prepare(
        "SELECT data FROM engine_records WHERE project_id=? AND kind='publication' AND json_extract(data,'$.active')=1 ORDER BY rowid DESC",
      )
      .get(project.id);
    const legacy = engine.store.db
      .prepare(
        "SELECT data FROM engine_records WHERE project_id=? AND kind='legacy_public_snapshot'",
      )
      .get(project.id);
    const migration = engine.store.db
      .prepare("SELECT data FROM engine_records WHERE project_id=? AND kind='migration'")
      .get(project.id);
    const legacyPending =
      project.id === LEGACY_PROJECT_ID && (!migration || !JSON.parse(migration.data).ready);
    if (!publication && !legacyPending) return [];
    const legacyActive = engine.store.db
      .prepare(
        "SELECT id FROM engine_records WHERE id=? AND project_id=? AND kind='publication' AND json_extract(data,'$.active')=1",
      )
      .get(`legacy-publication:${project.id}`, project.id);
    const frozen =
      legacy && (legacyPending || legacyActive) ? JSON.parse(legacy.data).project : undefined;
    const snapshot = publication ? JSON.parse(publication.data) : undefined;
    return [
      {
        id: project.id,
        title: frozen?.title ?? snapshot?.title ?? project.title,
        description: '',
        visibility: 'public' as const,
        archived: false,
        createdAt: frozen?.createdAt ?? snapshot?.createdAt ?? project.createdAt,
        headCommitId: null,
      },
    ];
  });
}
