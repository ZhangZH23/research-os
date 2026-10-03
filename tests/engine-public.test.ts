import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store';
import { ProgramStore } from '../server/program-store';
import { ResearchEngine } from '../server/research-engine';
import { publishedState, publishedProjects } from '../server/engine-public';

test('anonymous project listing excludes private projects and freezes published metadata', () => {
  const store = new Store(':memory:', false),
    root = new ResearchEngine(store, new ProgramStore(store));
  try {
    const project = root.createProject({ title: 'Private title never selected for publication' });
    const scoped = new StoreForProject(store, project.id);
    assert.ok(!publishedProjects(root).some((p) => p.id === project.id));
    const source = scoped.source({ kind: 'human_note', text: 'Synthetic statement $x=x$.' });
    const sources = [
      {
        sourceId: source.id,
        sourceHash: source.hash,
        start: 0,
        end: source.text.length,
        quote: source.text,
      },
    ];
    const proposal = scoped.propose({
      title: 'Admit an open observation',
      baseCommitId: null,
      sources,
      operations: [
        { type: 'add_claim', tempId: 'c', title: 'Observation', statement: source.text, sources },
      ],
    });
    scoped.check(proposal.id);
    scoped.reviewProposal(proposal.id, {
      revision: 1,
      decision: 'approve',
      reason: 'Keep an open observation for later review.',
    });
    const commit = scoped.commit(proposal.id, {
      revision: 1,
      idempotencyKey: 'public-test-observation',
    });
    const input = { revisionIds: [commit.temporaryIds.c], title: 'Public selected title' };
    const preview = scoped.publicationPreview(input);
    const publication = scoped.publish({
      ...input,
      previewHash: preview.previewHash,
      confirm: true,
    });
    scoped.updateProject({ title: 'SECRET private renamed project' });
    const listing = publishedProjects(root).find((p) => p.id === project.id)!;
    assert.equal(listing.title, 'Public selected title');
    assert.equal(publishedState(scoped).project.title, 'Public selected title');
    assert.ok(!JSON.stringify(scoped.publicExport()).includes('SECRET'));
    scoped.retractPublication(publication.id, { reason: 'Withdraw this synthetic demonstration.' });
    assert.ok(!publishedProjects(root).some((p) => p.id === project.id));
    assert.throws(() => publishedState(scoped), /not found/i);
  } finally {
    store.close();
  }
});

import { Store as DomainStore } from '../server/domain-store';
class StoreForProject extends ResearchEngine {
  constructor(parent: Store, projectId: string) {
    const store = new DomainStore(parent.db, false, projectId);
    super(store, new ProgramStore(store));
  }
}

test('partially migrated legacy public project keeps its full existing public snapshot', () => {
  const store = new Store(':memory:'),
    engine = new ResearchEngine(store, new ProgramStore(store));
  try {
    for (let i = 0; i < 110; i++)
      store.createNode({ title: `Synthetic migration item ${i}`, type: 'Note' });
    const count = store.state().nodes.length;
    assert.equal(engine.migrate({ confirm: true }).ready, false);
    assert.equal(publishedState(engine).nodes.length, count);
    while (!engine.migrationReport().ready) engine.migrate({ confirm: true });
    assert.equal(publishedState(engine).nodes.length, count);
    const original = publishedState(engine).project.title;
    engine.updateProject({ title: 'Private title changed after migration' });
    assert.equal(publishedProjects(engine)[0].title, original);
    assert.equal(publishedState(engine).project.title, original);
  } finally {
    store.close();
  }
});
