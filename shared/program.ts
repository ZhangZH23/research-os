import { z } from 'zod';

export const GOAL_KINDS = ['Ultimate', 'Milestone'] as const;
export const GOAL_STATUSES = ['Active', 'Blocked', 'Achieved', 'Paused'] as const;
export const CONTRIBUTION_CLASSIFICATIONS = [
  'Unassessed',
  'Restatement',
  'Routine consequence',
  'New reduction',
  'New technique',
  'Barrier / counterexample',
] as const;
export const CONTRIBUTION_VERDICTS = ['Unreviewed', 'Needs work', 'Accepted'] as const;

export const goalInputSchema = z.object({
  title: z.string().trim().min(1).max(250),
  statement: z.string().trim().min(1).max(20000),
  successCriteria: z.string().trim().max(10000).default(''),
  baseline: z.string().max(10000).default(''),
  kind: z.enum(GOAL_KINDS).default('Milestone'),
  status: z.enum(GOAL_STATUSES).default('Active'),
  parentGoalId: z.string().min(1).max(200).nullable().default(null),
  linkedNodeIds: z.array(z.string().min(1).max(200)).max(100).default([]),
  nextAction: z.string().max(10000).default(''),
});
export type GoalInput = z.infer<typeof goalInputSchema>;
export interface ResearchGoal extends GoalInput {
  projectId?: string;
  id: string;
  createdAt: string;
  updatedAt: string;
  /** Current evidence integrity warnings; the recorded research judgment is retained. */
  warnings?: string[];
}

export const contributionInputSchema = z.object({
  classification: z.enum(CONTRIBUTION_CLASSIFICATIONS).default('Unassessed'),
  before: z.string().max(10000).default(''),
  after: z.string().max(10000).default(''),
  mechanism: z.string().max(10000).default(''),
  check: z.string().max(10000).default(''),
  verdict: z.enum(CONTRIBUTION_VERDICTS).default('Unreviewed'),
  reviewer: z.string().trim().max(200).default(''),
});
export type ContributionInput = z.infer<typeof contributionInputSchema>;
export interface ContributionAssessment extends ContributionInput {
  projectId?: string;
  nodeId: string;
  updatedAt: string;
  basisUpdatedAt?: string;
  basisFingerprint?: string;
  /** Derived from the current node revision; never changes the saved verdict. */
  stale?: boolean;
}

export interface ProgramState {
  goals: ResearchGoal[];
  assessments: ContributionAssessment[];
}
