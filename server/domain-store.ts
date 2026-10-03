import type { DatabaseLike } from '../cloud/sqlite';
import { randomUUID } from 'node:crypto';
import {
  nodeInputSchema,
  edgeInputSchema,
  proposalSchema,
  type ResearchNode,
  type ResearchEdge,
  type ActivityEvent,
  type Project,
  type IngestionDraft,
  type Proposal,
  type ReviewItem,
} from '../shared/types';
import { project, seedNodes, seedEdges } from './seed';
import { migrateSeedMathematics } from './math-seed-migration';
export const LEGACY_PROJECT_ID = project.id;
let transactionSequence = 0;

export class Store {
  db: DatabaseLike;
  readonly projectId: string;
  constructor(database: DatabaseLike, seed = true, projectId?: string) {
    this.projectId = projectId ?? LEGACY_PROJECT_ID;
    this.db = database;
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS nodes(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS edges(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), source_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE, target_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE, edge_type TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(source_id,target_id,edge_type));
      CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, node_id TEXT, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS drafts(id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS events_node ON events(node_id);`);
    if (!this.db.prepare('SELECT id FROM projects WHERE id=?').get(this.projectId)) {
      if (projectId !== undefined) throw new Error('Project not found');
      this.transaction(() => {
        this.db
          .prepare('INSERT INTO projects VALUES(?,?)')
          .run(project.id, JSON.stringify({ ...project, createdAt: new Date().toISOString() }));
        if (seed) this.seed();
      });
    }
    if (this.projectId === LEGACY_PROJECT_ID)
      this.transaction(() => migrateSeedMathematics(this.db));
  }
  transaction<T>(fn: () => T): T {
    const name = `research_store_${++transactionSequence}`;
    this.db.exec(`SAVEPOINT ${name}`);
    try {
      const v = fn();
      this.db.exec(`RELEASE SAVEPOINT ${name}`);
      return v;
    } catch (e) {
      this.db.exec(`ROLLBACK TO SAVEPOINT ${name}`);
      this.db.exec(`RELEASE SAVEPOINT ${name}`);
      throw e;
    }
  }
  rows<T>(table: 'nodes' | 'edges' | 'events' | 'drafts' | 'projects'): T[] {
    const rows =
      table === 'projects'
        ? this.db.prepare('SELECT data FROM projects WHERE id=?').all(this.projectId)
        : table === 'drafts'
          ? this.db
              .prepare(
                "SELECT data FROM drafts WHERE COALESCE(json_extract(data,'$.projectId'),?)=? ORDER BY rowid",
              )
              .all(LEGACY_PROJECT_ID, this.projectId)
          : this.db
              .prepare(`SELECT data FROM ${table} WHERE project_id=? ORDER BY rowid`)
              .all(this.projectId);
    return (rows as { data: string }[]).map((r) => JSON.parse(r.data));
  }
  /** Missing legacy scope belongs only to the original project, never the active project. */
  owns(record: { projectId?: string }) {
    return (record.projectId ?? LEGACY_PROJECT_ID) === this.projectId;
  }

  getNode(id: string) {
    const r = this.db
      .prepare('SELECT data FROM nodes WHERE id=? AND project_id=?')
      .get(id, this.projectId) as { data: string } | undefined;
    if (!r) throw new Error('Node not found');
    return JSON.parse(r.data) as ResearchNode;
  }
  state() {
    return {
      project: this.rows<Project>('projects')[0],
      nodes: this.rows<ResearchNode>('nodes'),
      edges: this.rows<ResearchEdge>('edges'),
      events: this.rows<ActivityEvent>('events').sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      ),
    };
  }
  event(
    nodeId: string | null,
    nodeTitle: string,
    eventType: string,
    previousValue: unknown,
    newValue: unknown,
    reason: string,
    createdAt = new Date().toISOString(),
  ) {
    // A deleted node may legitimately be referenced by its retained audit event.
    if (nodeId) {
      const owner = this.db.prepare('SELECT project_id FROM nodes WHERE id=?').get(nodeId);
      if (owner && owner.project_id !== this.projectId) throw new Error('Node not found');
    }
    const event: ActivityEvent = {
      id: randomUUID(),
      projectId: this.projectId,
      nodeId,
      nodeTitle,
      eventType,
      previousValue: previousValue == null ? null : JSON.stringify(previousValue),
      newValue: newValue == null ? null : JSON.stringify(newValue),
      reason,
      createdAt,
    };
    this.db
      .prepare('INSERT INTO events VALUES(?,?,?,?)')
      .run(event.id, event.projectId, nodeId, JSON.stringify(event));
    return event;
  }
  createNode(
    raw: unknown,
    reason = 'Created by researcher',
    id: string = randomUUID(),
    date = new Date().toISOString(),
  ) {
    const input = nodeInputSchema.parse(raw);
    const node: ResearchNode = {
      ...input,
      id,
      projectId: this.projectId,
      createdAt: date,
      updatedAt: date,
    };
    this.db
      .prepare('INSERT INTO nodes VALUES(?,?,?)')
      .run(id, this.projectId, JSON.stringify(node));
    this.event(id, node.title, 'node_created', null, node, reason, date);
    return node;
  }
  updateNode(id: string, raw: unknown, reason: string) {
    const previous = this.getNode(id);
    const parsed = nodeInputSchema.parse({ ...previous, ...(raw as object) });
    if (
      (parsed.title !== previous.title ||
        parsed.summary !== previous.summary ||
        parsed.content !== previous.content) &&
      !(raw as Record<string, unknown>).humanVerified
    )
      parsed.humanVerified = false;
    if (
      parsed.type !== 'Experiment' &&
      this.rows<ResearchEdge>('edges').some(
        (e) => e.edgeType === 'tested_by' && e.targetNodeId === id,
      )
    )
      throw new Error(
        'Remove incoming tested_by relationships before changing an Experiment to another type',
      );
    if (previous.epistemicStatus !== parsed.epistemicStatus && !reason.trim())
      throw new Error('A reason is required for a status change');
    const node: ResearchNode = { ...previous, ...parsed, updatedAt: new Date().toISOString() };
    this.db
      .prepare('UPDATE nodes SET data=? WHERE id=? AND project_id=?')
      .run(JSON.stringify(node), id, this.projectId);
    this.event(
      id,
      node.title,
      previous.epistemicStatus !== node.epistemicStatus ? 'status_changed' : 'node_updated',
      previous,
      node,
      reason || 'Research item edited',
    );
    return node;
  }
  deleteNode(id: string, reason: string) {
    const node = this.getNode(id);
    const edges = this.rows<ResearchEdge>('edges').filter(
      (e) => e.sourceNodeId === id || e.targetNodeId === id,
    );
    this.db.prepare('DELETE FROM nodes WHERE id=? AND project_id=?').run(id, this.projectId);
    this.event(
      id,
      node.title,
      'node_deleted',
      { node, edges },
      null,
      reason || 'Deleted by researcher',
    );
  }
  createEdge(raw: unknown) {
    const input = edgeInputSchema.parse(raw);
    if (input.sourceNodeId === input.targetNodeId)
      throw new Error('A relationship must connect distinct nodes');
    const source = this.getNode(input.sourceNodeId);
    const target = this.getNode(input.targetNodeId);
    if (input.edgeType === 'tested_by' && target.type !== 'Experiment')
      throw new Error('tested_by must point to an Experiment');
    const edge: ResearchEdge = {
      ...input,
      id: randomUUID(),
      projectId: this.projectId,
      createdAt: new Date().toISOString(),
    };
    this.db
      .prepare('INSERT INTO edges VALUES(?,?,?,?,?,?)')
      .run(
        edge.id,
        this.projectId,
        edge.sourceNodeId,
        edge.targetNodeId,
        edge.edgeType,
        JSON.stringify(edge),
      );
    this.event(
      source.id,
      source.title,
      'edge_created',
      null,
      edge,
      `${source.title} ${input.edgeType.replaceAll('_', ' ')} ${target.title}. ${input.explanation}`,
    );
    return edge;
  }
  deleteEdge(id: string) {
    const edge = this.rows<ResearchEdge>('edges').find((e) => e.id === id);
    if (!edge) throw new Error('Relationship not found');
    const node = this.getNode(edge.sourceNodeId);
    this.db.prepare('DELETE FROM edges WHERE id=? AND project_id=?').run(id, this.projectId);
    this.event(
      node.id,
      node.title,
      'edge_deleted',
      edge,
      null,
      'Relationship removed by researcher',
    );
  }
  saveDraft(proposal: Proposal, transcript: string, sourceName: string, mode: 'manual' | 'openai') {
    const validated = proposalSchema.parse(proposal);
    const draft: IngestionDraft = {
      ...validated,
      projectId: this.projectId,
      id: randomUUID(),
      transcript,
      sourceName,
      mode,
      createdAt: new Date().toISOString(),
      committedAt: null,
    };
    this.db.prepare('INSERT INTO drafts VALUES(?,?)').run(draft.id, JSON.stringify(draft));
    return draft;
  }
  getDraft(id: string) {
    const draft = this.rows<IngestionDraft>('drafts').find((d) => d.id === id);
    if (!draft) throw new Error('Draft not found');
    return draft;
  }
  commitDraft(id: string, items: ReviewItem[], edges: Proposal['edges']) {
    return this.transaction(() => {
      const draft = this.getDraft(id);
      if (draft.committedAt) throw new Error('This session was already committed');
      proposalSchema.parse({ items, edges });
      const selected = items.filter((i) => i.decision !== 'discard');
      if (!selected.length) throw new Error('Select at least one item to commit');
      const map = new Map<string, string>();
      const created: ResearchNode[] = [];
      const session = this.createNode(
        {
          title: `Session: ${draft.sourceName}`,
          type: 'Agent Run',
          originType: 'AI-extracted',
          originName:
            draft.mode === 'openai' ? 'OpenAI structured extraction' : 'Local heuristic extraction',
          content: draft.transcript,
          summary: `Human-reviewed ingestion of ${selected.length} items.`,
          provenanceText: `Original transcript retained. Draft ${draft.id}. Approval admits items into the graph; it does not verify their truth.`,
          tags: ['ingested-session'],
        },
        'Original source preserved before reviewed ingestion',
      );
      for (const item of selected) {
        if (item.decision === 'merge') {
          if (!item.mergeNodeId) throw new Error('Choose a merge target');
          const existing = this.getNode(item.mergeNodeId);
          const merged = this.updateNode(
            existing.id,
            {
              content: `${existing.content}\n\n---\nUnverified material from ${draft.sourceName}:\n${item.content}`,
              provenanceText: `${existing.provenanceText}\nAI-extracted material merged from session ${session.id}. ${item.provenanceText}`,
              humanVerified: false,
            },
            'Human-approved merge of unverified session material; verification cleared',
          );
          map.set(item.tempId, merged.id);
        } else if (item.decision === 'create') {
          const node = this.createNode(
            {
              ...item,
              epistemicStatus: 'Unverified',
              originType: 'AI-extracted',
              originName: draft.sourceName,
              humanVerified: false,
              confidence: 0.3,
              provenanceText: `${item.provenanceText}\nExtracted from session ${session.id}. Human reviewed for ingestion; truth remains unverified.`,
            },
            'Human-approved ingestion; epistemic status remains Unverified',
          );
          map.set(item.tempId, node.id);
          created.push(node);
        } else throw new Error('Invalid review decision');
      }
      const addUnique = (
        sourceNodeId: string,
        targetNodeId: string,
        edgeType: ResearchEdge['edgeType'],
        explanation: string,
      ) => {
        if (sourceNodeId === targetNodeId) return;
        if (
          !this.db
            .prepare('SELECT id FROM edges WHERE source_id=? AND target_id=? AND edge_type=?')
            .get(sourceNodeId, targetNodeId, edgeType)
        )
          this.createEdge({ sourceNodeId, targetNodeId, edgeType, explanation });
      };
      for (const [_, nodeId] of map)
        addUnique(nodeId, session.id, 'derived_from', 'Reviewed session ingestion');
      for (const e of edges) {
        const s = map.get(e.sourceTempId),
          t = map.get(e.targetTempId);
        if (s && t) addUnique(s, t, e.edgeType, e.explanation);
      }
      draft.committedAt = new Date().toISOString();
      this.db.prepare('UPDATE drafts SET data=? WHERE id=?').run(JSON.stringify(draft), id);
      this.event(
        session.id,
        session.title,
        'session_ingested',
        null,
        {
          created: created.length,
          merged: selected.length - created.length,
          discarded: items.length - selected.length,
        },
        'Human reviewed the proposed items and relationships',
      );
      return { created, sessionId: session.id };
    });
  }
  seed() {
    if (this.projectId !== LEGACY_PROJECT_ID)
      throw new Error('The sample can only initialize its explicit legacy project');
    const transitions: Record<string, { before: string; reason: string }> = {
      'strong-conjecture': {
        before: 'Plausible',
        reason: 'Exact counterexample f=0, g=x² over F5 refutes disjointness.',
      },
      'failed-approach': {
        before: 'Heuristic',
        reason: 'The pair 0 and x² has a shared jet, invalidating disjoint-neighborhood counting.',
      },
      'numerical-experiment': {
        before: 'Unverified',
        reason: 'Illustrative finite check recorded; does not establish a general proof.',
      },
    };
    for (const item of seedNodes) {
      const date = new Date(Date.now() - (item.age ?? 1) * 86400000).toISOString();
      const transition = transitions[item.id];
      const created = this.createNode(
        {
          ...item,
          epistemicStatus: transition?.before ?? item.epistemicStatus,
          originType: item.originType ?? 'Human',
          originName: item.originName ?? 'Demo researcher',
          provenanceText:
            item.provenanceText ??
            'Illustrative seed data for Research OS. Not an externally verified research finding.',
        },
        'Demo project initialized',
        item.id,
        date,
      );
      if (transition) {
        const next = {
          ...created,
          epistemicStatus: item.epistemicStatus,
          updatedAt: new Date(Date.parse(date) + 3600000).toISOString(),
        };
        this.db.prepare('UPDATE nodes SET data=? WHERE id=?').run(JSON.stringify(next), item.id);
        this.event(
          item.id,
          item.title,
          'status_changed',
          created,
          next,
          transition.reason,
          next.updatedAt,
        );
      }
    }
    for (const edge of seedEdges) this.createEdge(edge);
  }
  close() {
    this.db.close();
  }
}
