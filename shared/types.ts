import { z } from 'zod';

export const NODE_TYPES = [
  'Claim',
  'Conjecture',
  'Lemma',
  'Theorem',
  'Open Question',
  'Approach',
  'Experiment',
  'Evidence',
  'Counterexample',
  'Source / Paper',
  'Agent Run',
  'Note',
] as const;
export const STATUSES = [
  'Unverified',
  'Plausible',
  'Heuristic',
  'Conditional',
  'Numerically Supported',
  'Partially Proved',
  'Proved',
  'Disproved',
  'Superseded',
  'Abandoned',
] as const;
export const ORIGINS = ['Human', 'AI-extracted', 'AI agent', 'Literature', 'Numerical'] as const;
export const EDGE_TYPES = [
  'depends_on',
  'supports',
  'contradicts',
  'proves',
  'disproves',
  'derived_from',
  'tested_by',
  'motivated_by',
  'supersedes',
  'related_to',
] as const;
export type NodeType = (typeof NODE_TYPES)[number];
export type Status = (typeof STATUSES)[number];
export type EdgeType = (typeof EDGE_TYPES)[number];
export const nodeInputSchema = z.object({
  title: z.string().trim().min(1).max(250),
  summary: z.string().max(2000).default(''),
  content: z.string().max(100000).default(''),
  type: z.enum(NODE_TYPES),
  epistemicStatus: z.enum(STATUSES).default('Unverified'),
  confidence: z.number().min(0).max(1).default(0.3),
  originType: z.enum(ORIGINS).default('Human'),
  originName: z.string().max(200).default('Researcher'),
  provenanceText: z.string().max(20000).default(''),
  tags: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  links: z
    .array(
      z
        .string()
        .max(2000)
        .refine(
          (s) => /^(https?:\/\/|file:\/\/|\/)/.test(s),
          'Use an http(s) URL or absolute file path',
        ),
    )
    .max(30)
    .default([]),
  humanVerified: z.boolean().default(false),
});
export type NodeInput = z.infer<typeof nodeInputSchema>;
export interface ResearchNode extends NodeInput {
  id: string;
  projectId: string;
  createdAt: string;
  updatedAt: string;
}
export const edgeInputSchema = z.object({
  sourceNodeId: z.string().min(1),
  targetNodeId: z.string().min(1),
  edgeType: z.enum(EDGE_TYPES),
  explanation: z.string().max(4000).default(''),
});
export type EdgeInput = z.infer<typeof edgeInputSchema>;
export interface ResearchEdge extends EdgeInput {
  id: string;
  projectId: string;
  createdAt: string;
}
export interface ActivityEvent {
  id: string;
  projectId: string;
  nodeId: string | null;
  nodeTitle: string;
  eventType: string;
  previousValue: string | null;
  newValue: string | null;
  reason: string;
  createdAt: string;
}
export interface Project {
  id: string;
  title: string;
  description: string;
  createdAt: string;
}
export interface ResearchState {
  project: Project;
  nodes: ResearchNode[];
  edges: ResearchEdge[];
  events: ActivityEvent[];
  llmEnabled: boolean;
}
export const proposalSchema = z
  .object({
    items: z
      .array(
        z.object({
          tempId: z.string().min(1).max(100),
          title: z.string().trim().min(1).max(250),
          summary: z.string().max(2000),
          content: z.string().max(100000),
          type: z.enum(NODE_TYPES),
          tags: z.array(z.string().min(1).max(80)).max(30),
          provenanceText: z.string().max(20000),
        }),
      )
      .max(50),
    edges: z
      .array(
        z.object({
          sourceTempId: z.string(),
          targetTempId: z.string(),
          edgeType: z.enum(EDGE_TYPES),
          explanation: z.string().max(4000),
        }),
      )
      .max(150),
  })
  .superRefine((value, ctx) => {
    const ids = new Set(value.items.map((n) => n.tempId));
    if (ids.size !== value.items.length)
      ctx.addIssue({ code: 'custom', message: 'Proposal IDs must be unique' });
    for (const e of value.edges)
      if (!ids.has(e.sourceTempId) || !ids.has(e.targetTempId) || e.sourceTempId === e.targetTempId)
        ctx.addIssue({
          code: 'custom',
          message: 'Proposal relationships must connect two distinct proposed items',
        });
  });
export type Proposal = z.infer<typeof proposalSchema>;
export type ReviewItem = Proposal['items'][number] & {
  decision: 'create' | 'merge' | 'discard';
  mergeNodeId?: string;
};
export interface IngestionDraft extends Proposal {
  id: string;
  mode: 'manual' | 'openai';
  transcript: string;
  sourceName: string;
  createdAt: string;
  committedAt: string | null;
}
export const CLAIM_TYPES: NodeType[] = ['Claim', 'Conjecture', 'Lemma', 'Theorem'];
