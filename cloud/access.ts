import type { ResearchState } from '../shared/types';
import type { ProgramState } from '../shared/program';

export interface AccessEnvironment {
  WORKSPACE_OWNER_EMAIL?: string;
  LOCAL_PREVIEW_OWNER?: string;
}

// These headers are supplied by Sites dispatch after ChatGPT authentication.
// Browser-provided identities are not trusted by the hosting gateway.
export function workspaceAccess(request: Request, env: AccessEnvironment) {
  if (
    env.LOCAL_PREVIEW_OWNER === 'true' &&
    ['localhost', '127.0.0.1'].includes(new URL(request.url).hostname)
  )
    return { authenticated: true, canEdit: true };
  const userId = request.headers.get('oai-authenticated-user-id');
  const email = request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase();
  const owner = env.WORKSPACE_OWNER_EMAIL?.trim().toLowerCase();
  return { authenticated: !!userId, canEdit: !!userId && !!owner && email === owner };
}

export function isPublicRead(request: Request) {
  return (
    request.method === 'GET' &&
    ['/api/state', '/api/program', '/api/health'].includes(new URL(request.url).pathname)
  );
}

export function publicResearch(state: Omit<ResearchState, 'llmEnabled'>): ResearchState {
  return {
    project: {
      id: state.project.id,
      title: state.project.title,
      description: state.project.description,
      createdAt: state.project.createdAt,
    },
    nodes: state.nodes.map((n) => ({
      id: n.id,
      projectId: n.projectId,
      title: n.title,
      summary: n.summary,
      content: n.content,
      type: n.type,
      epistemicStatus: n.epistemicStatus,
      confidence: n.confidence,
      originType: n.originType,
      originName: n.originType,
      provenanceText: '',
      tags: n.tags,
      links: n.links.filter((link) => /^https?:\/\//i.test(link)),
      humanVerified: n.humanVerified,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
    })),
    edges: state.edges.map((e) => ({
      id: e.id,
      projectId: e.projectId,
      sourceNodeId: e.sourceNodeId,
      targetNodeId: e.targetNodeId,
      edgeType: e.edgeType,
      explanation: e.explanation,
      createdAt: e.createdAt,
    })),
    events: [],
    llmEnabled: false,
    canEdit: false,
  };
}

export function publicProgram(program: ProgramState): ProgramState {
  return {
    goals: program.goals.map((g) => ({
      id: g.id,
      title: g.title,
      statement: g.statement,
      successCriteria: g.successCriteria,
      baseline: g.baseline,
      kind: g.kind,
      status: g.status,
      parentGoalId: g.parentGoalId,
      linkedNodeIds: g.linkedNodeIds,
      nextAction: g.nextAction,
      createdAt: g.createdAt,
      updatedAt: g.updatedAt,
      warnings: g.warnings,
    })),
    assessments: program.assessments.map((a) => ({
      nodeId: a.nodeId,
      classification: a.classification,
      before: a.before,
      after: a.after,
      mechanism: a.mechanism,
      check: a.check,
      verdict: a.verdict,
      reviewer: '',
      updatedAt: a.updatedAt,
      stale: a.stale,
    })),
  };
}
