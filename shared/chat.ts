import { z } from 'zod';
import { NODE_TYPES } from './types';
import { CONTRIBUTION_CLASSIFICATIONS } from './program';
import type { CandidateDraft, ReviewBasis } from './workbench';

export const CHAT_MODES = ['explore', 'attack', 'audit'] as const;
export type ChatMode = (typeof CHAT_MODES)[number];
export interface ConnectionStatus {
  configured: boolean;
  model: string;
  source: 'none' | 'environment' | 'memory' | 'local-file';
  persisted: boolean;
}
export const CHAT_EDGE_TYPES = [
  'depends_on',
  'supports',
  'contradicts',
  'derived_from',
  'tested_by',
  'motivated_by',
  'related_to',
] as const;
const ref = z.string().min(1).max(200);
export const chatProposalSchema = z
  .object({
    summary: z.string().max(4000),
    nodes: z
      .array(
        z
          .object({
            tempId: z
              .string()
              .regex(/^new:[a-zA-Z0-9_-]+$/)
              .max(100),
            title: z.string().trim().min(1).max(250),
            summary: z.string().max(2000),
            content: z.string().max(30000),
            type: z.enum(NODE_TYPES),
            tags: z.array(z.string().min(1).max(80)).max(12),
          })
          .strict(),
      )
      .max(8),
    edges: z
      .array(
        z
          .object({
            sourceNodeId: ref,
            targetNodeId: ref,
            edgeType: z.enum(CHAT_EDGE_TYPES),
            explanation: z.string().max(4000),
          })
          .strict(),
      )
      .max(16),
    goals: z
      .array(
        z
          .object({
            tempId: z
              .string()
              .regex(/^goal:[a-zA-Z0-9_-]+$/)
              .max(100),
            existingGoalId: ref.nullable(),
            title: z.string().trim().min(1).max(250),
            statement: z.string().trim().min(1).max(20000),
            successCriteria: z.string().max(10000),
            baseline: z.string().max(10000),
            kind: z.enum(['Ultimate', 'Milestone']),
            parentGoalId: ref.nullable(),
            linkedNodeIds: z.array(ref).max(30),
            nextAction: z.string().max(10000),
          })
          .strict(),
      )
      .max(5),
    assessments: z
      .array(
        z
          .object({
            nodeId: ref,
            classification: z.enum(CONTRIBUTION_CLASSIFICATIONS),
            before: z.string().max(10000),
            after: z.string().max(10000),
            mechanism: z.string().max(10000),
            check: z.string().max(10000),
          })
          .strict(),
      )
      .max(8),
  })
  .strict();
export type ChatProposal = z.infer<typeof chatProposalSchema>;
export const chatResponseSchema = z
  .object({
    content: z.string().trim().min(1).max(60000),
    proposal: chatProposalSchema.nullable(),
    candidates: z.array(z.unknown()).optional(),
  })
  .strict();
export const sendMessageSchema = z
  .object({
    content: z.string().trim().min(1).max(30000),
    mode: z.enum(CHAT_MODES).default('explore'),
    contextNodeIds: z.array(ref).max(12).default([]),
    goalId: ref.nullable().optional(),
    progressCriterion: z.string().max(3000).default(''),
    notebook: z.boolean().default(false),
  })
  .strict();
export interface ChatContext {
  nodeIds: string[];
  goalIds: string[];
  truncated: boolean;
  characters: number;
}
export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  goalId?: string | null;
  progressCriterion?: string;
  scratchpad?: string;
  draft?: string;
  source?: string;
}
export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  mode: ChatMode;
  provider: 'openai' | 'local' | 'user' | 'imported';
  model: string | null;
  proposal: ChatProposal | null;
  proposalStatus: 'none' | 'pending' | 'applied' | 'discarded';
  context: ChatContext;
  createdAt: string;
  error?: string;
  replyToId?: string;
  goalId?: string | null;
  progressCriterion?: string;
  targetSnapshot?: { title: string; statement: string; baseline: string; successCriteria: string };
  reviewBasis?: ReviewBasis;
  candidates?: CandidateDraft[];
  extractionNote?: string;
  turnReview?: { decision: 'No new result' | 'Clarification' | 'Open'; reason: string; at: string };
  turnReviewHistory?: {
    decision: 'No new result' | 'Clarification' | 'Open';
    reason: string;
    at: string;
  }[];
}
export interface ChatState {
  sessions: ChatSession[];
  messages: ChatMessage[];
  connection: ConnectionStatus;
}
