import { z } from 'zod';
import { CONTRIBUTION_CLASSIFICATIONS } from './program';
export const RESULT_KINDS = [
  'Claim',
  'Lemma',
  'Reduction',
  'Counterexample',
  'Barrier',
  'Calculation',
  'Proof obligation',
] as const;
export const REVIEW_DECISIONS = [
  'Unreviewed',
  'Advance',
  'Useful partial result',
  'Reformulation',
  'Rejected',
] as const;
export const candidateDraftSchema = z
  .object({
    title: z.string().trim().min(1).max(250),
    kind: z.enum(RESULT_KINDS),
    classification: z.enum(CONTRIBUTION_CLASSIFICATIONS),
    statement: z.string().trim().min(1).max(12000),
    sourceQuote: z.string().trim().min(3).max(6000),
    baseline: z.string().max(8000),
    gain: z.string().max(8000),
    mechanism: z.string().max(8000),
    evidence: z.string().max(12000),
    gap: z.string().max(8000),
    nextCheck: z.string().max(8000),
    relatedNodeIds: z.array(z.string().min(1).max(200)).max(12),
    /** Explicit logical prerequisites; related context is never automatically a premise. */
    premiseNodeIds: z.array(z.string().min(1).max(200)).max(12).optional(),
  })
  .strict();
export type CandidateDraft = z.infer<typeof candidateDraftSchema>;
export interface ReviewBasis {
  goalId: string | null;
  goalHash: string;
  nodes: { id: string; hash: string }[];
}
export interface Candidate extends CandidateDraft {
  projectId?: string;
  legacyPremiseSelection?: boolean;
  id: string;
  sessionId: string;
  messageId: string;
  promptMessageId: string | null;
  goalId: string | null;
  basis: ReviewBasis;
  revision: number;
  origin: 'model' | 'researcher';
  original: CandidateDraft;
  decision: (typeof REVIEW_DECISIONS)[number];
  reason: string;
  verification: string;
  integratedNodeId: string | null;
  integratedHash?: string;
  createdAt: string;
  updatedAt: string;
  history: { at: string; action: string; reason: string; revision: number }[];
  stale?: boolean;
  duplicateOf?: string | null;
}
export interface NotebookState {
  candidates: Candidate[];
}
export function parseTranscript(text: string): { role: 'user' | 'assistant'; content: string }[] {
  const parts: { role: 'user' | 'assistant'; content: string }[] = [];
  let current: (typeof parts)[number] | undefined;
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const match = line.match(/^(?:#{1,6}\s*)?(User|You|Assistant|ChatGPT|GPT)(?::\s*(.*)|\s*)$/i);
    if (match) {
      current = {
        role: /^(user|you)$/i.test(match[1]) ? 'user' : 'assistant',
        content: match[2] ?? '',
      };
      parts.push(current);
    } else if (current) current.content += (current.content ? '\n' : '') + line;
    else if (line.trim())
      throw new Error('Start with a User: or Assistant: label, and label each turn.');
  }
  return parts.map((p) => ({ ...p, content: p.content.trim() })).filter((p) => p.content);
}
