import { useMemo, useState, type FormEvent } from 'react';
import {
  Target,
  Plus,
  ArrowUpRight,
  GitBranch,
  Pencil,
  CheckCircle2,
  Circle,
  LockKeyhole,
  Scale,
  Sparkles,
  ArrowRight,
  Flag,
  FlaskConical,
  Route,
  ChevronRight,
} from 'lucide-react';
import {
  GOAL_KINDS,
  GOAL_STATUSES,
  type GoalInput,
  type ResearchGoal,
  type ProgramState,
} from '../shared/program';
import type { ResearchNode, ResearchState } from '../shared/types';
import { belief } from '../shared/epistemics';
import { researchTextLabel } from '../shared/math';
import { programNodeIds } from '../shared/program-scope';
import ResearchText from './ResearchText';
import MathEditor from './MathEditor';
import { Modal, Badge, TypeIcon } from './ui';
import { api } from './api';
import './program.css';

export { programNodeIds } from '../shared/program-scope';

export default function Program({
  state,
  program,
  onRefresh,
  onSelect,
  onDiscuss,
  onAssess,
  onGraph,
}: {
  state: ResearchState;
  program: ProgramState;
  onRefresh: () => Promise<void>;
  onSelect: (id: string) => void;
  onDiscuss: (prompt: string, goalId?: string, nodeIds?: string[]) => void;
  onAssess: (node: ResearchNode) => void;
  onGraph: (goalId: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{
    goal?: ResearchGoal;
    parentGoalId?: string | null;
  } | null>(null);
  const [view, setView] = useState<'roadmap' | 'audit'>('roadmap');
  const [auditFilter, setAuditFilter] = useState('all');
  const roots = program.goals.filter((g) => !g.parentGoalId);
  const selected = program.goals.find((g) => g.id === selectedId) ?? roots[0] ?? program.goals[0];
  const assessments = useMemo(
    () => new Map(program.assessments.map((a) => [a.nodeId, a])),
    [program.assessments],
  );
  const scope = selected
    ? programNodeIds(selected.id, program, state)
    : new Set(state.nodes.map((n) => n.id));
  const scopeNodes = state.nodes.filter((n) => scope.has(n.id));
  const linked = state.nodes.filter((n) => selected?.linkedNodeIds.includes(n.id));
  const attacks = scopeNodes.filter((n) => n.type === 'Approach');
  const bottlenecks = scopeNodes.filter(
    (n) =>
      ['Claim', 'Lemma', 'Theorem', 'Conjecture', 'Open Question'].includes(n.type) &&
      !(n.epistemicStatus === 'Proved' && n.humanVerified) &&
      !['Disproved', 'Abandoned', 'Superseded'].includes(n.epistemicStatus),
  );
  const proofNodes = scopeNodes.filter((n) =>
    ['Claim', 'Lemma', 'Theorem', 'Conjecture', 'Counterexample'].includes(n.type),
  );
  const assessed = proofNodes.filter((n) => assessments.has(n.id));
  const needsReview = proofNodes.filter(
    (n) =>
      !assessments.get(n.id) ||
      assessments.get(n.id)?.stale ||
      assessments.get(n.id)?.verdict !== 'Accepted',
  );
  const auditNodes = proofNodes.filter(
    (n) =>
      auditFilter === 'all' ||
      (auditFilter === 'unreviewed'
        ? !assessments.get(n.id) ||
          assessments.get(n.id)?.stale ||
          assessments.get(n.id)?.verdict !== 'Accepted'
        : ['Restatement', 'Routine consequence'].includes(
            assessments.get(n.id)?.classification ?? '',
          )),
  );
  function tree(g: ResearchGoal, depth = 0): React.ReactNode {
    if (depth > 12) return null;
    return (
      <div className="goal-tree-branch" key={g.id}>
        <button
          className={`goal-tree-item ${selected?.id === g.id ? 'selected' : ''}`}
          onClick={() => setSelectedId(g.id)}
        >
          <span className={`goal-dot goal-${g.status.toLowerCase()}`}>
            {g.status === 'Achieved' ? (
              <CheckCircle2 size={16} />
            ) : g.kind === 'Ultimate' ? (
              <Target size={16} />
            ) : (
              <Circle size={13} />
            )}
          </span>
          <span>
            <small>{g.kind === 'Ultimate' ? 'ULTIMATE GOAL' : 'MILESTONE'}</small>
            <ResearchText inline>{g.title}</ResearchText>
            <em>{g.status}</em>
          </span>
          <ChevronRight size={13} />
        </button>
        {program.goals
          .filter((child) => child.parentGoalId === g.id)
          .map((child) => tree(child, depth + 1))}
      </div>
    );
  }
  const workPrompt = selected
    ? `Work on the goal “${selected.title}”.\n\nTarget:\n${selected.statement}\n\nSuccess criteria:\n${selected.successCriteria}\n\nBaseline:\n${selected.baseline}\n\nPropose one concrete attack. Specify the bottleneck lemma, exact gain over the baseline, non-obvious mechanism, and cheapest rigorous check. If the step is merely a restatement, say so. Preserve all unproved obligations.`
    : '';
  return (
    <div className="program-page">
      <div className="page-heading program-page-heading">
        <div>
          <span className="eyebrow">THE RESEARCH PROGRAM</span>
          <h1>A destination. A path. A reason.</h1>
          <p>Make the target precise. Keep every intermediate step accountable.</p>
        </div>
        <button className="button secondary" onClick={() => setEditing({ parentGoalId: null })}>
          <Plus size={16} /> New goal
        </button>
      </div>
      <div className="program-overview-strip">
        <div>
          <Target size={17} />
          <strong>{roots.length}</strong>
          <span>ultimate {roots.length === 1 ? 'goal' : 'goals'}</span>
        </div>
        <div>
          <GitBranch size={17} />
          <strong>{program.goals.filter((g) => g.kind === 'Milestone').length}</strong>
          <span>milestones</span>
        </div>
        <div>
          <Scale size={17} />
          <strong>{needsReview.length}</strong>
          <span>steps need assessment</span>
        </div>
        <div className="program-overview-note">
          Progress is a mathematical gain, not a node count.
        </div>
      </div>
      {!selected ? (
        <section className="panel program-empty">
          <Target size={34} />
          <h2>Start with a precise target</h2>
          <p>
            Write the theorem you want, the current benchmark, and a criterion for calling it
            solved.
          </p>
          <button className="button primary" onClick={() => setEditing({ parentGoalId: null })}>
            Define an ultimate goal
          </button>
        </section>
      ) : (
        <div className="program-layout">
          <aside className="program-sidebar">
            <div className="program-section-heading">
              <h2>Goal hierarchy</h2>
              <Flag size={16} />
            </div>
            <div className="goal-tree">{roots.map((g) => tree(g))}</div>
            <button
              className="program-add-milestone"
              onClick={() => setEditing({ parentGoalId: selected.id })}
            >
              <Plus size={14} /> Add milestone to this goal
            </button>
            <div className="program-principle">
              <Scale size={20} />
              <h3>The contribution test</h3>
              <p>
                What could we prove before? What can we prove now? Which step created the
                difference?
              </p>
              <button className="text-button" onClick={() => setView('audit')}>
                Inspect the steps <ArrowRight size={13} />
              </button>
            </div>
          </aside>
          <div className="program-main">
            <section className="goal-target-card">
              <div className="goal-target-top">
                <span className="eyebrow">
                  <Target size={14} />
                  {selected.kind === 'Ultimate' ? 'ULTIMATE GOAL' : 'CURRENT MILESTONE'}
                </span>
                <div>
                  <span className={`goal-status goal-${selected.status.toLowerCase()}`}>
                    {selected.status}
                  </span>
                  <button
                    className="icon-button"
                    aria-label="Edit selected goal"
                    onClick={() => setEditing({ goal: selected })}
                  >
                    <Pencil size={16} />
                  </button>
                </div>
              </div>
              <h2>
                <ResearchText inline>{selected.title}</ResearchText>
              </h2>
              {selected.warnings?.map((w) => (
                <p key={w} className="warning">
                  {w}
                </p>
              ))}
              <ResearchText className="goal-statement">{selected.statement}</ResearchText>
              <div className="goal-contract">
                <div>
                  <h3>Starting point</h3>
                  <ResearchText>
                    {selected.baseline || 'Record the strongest existing bound or result.'}
                  </ResearchText>
                </div>
                <div>
                  <h3>What would count as success</h3>
                  <ResearchText>
                    {selected.successCriteria || 'Define a checkable success criterion.'}
                  </ResearchText>
                </div>
              </div>
              <div className="goal-target-actions">
                <button
                  className="button primary"
                  onClick={() => onDiscuss(workPrompt, selected.id, selected.linkedNodeIds)}
                >
                  <Sparkles size={16} /> Work on this goal
                </button>
                <button className="button secondary" onClick={() => onGraph(selected.id)}>
                  <GitBranch size={15} /> Explore dependencies
                </button>
              </div>
            </section>
            <div className="program-view-tabs" role="group" aria-label="Program view">
              <button
                className={view === 'roadmap' ? 'active' : ''}
                onClick={() => setView('roadmap')}
              >
                <Route size={16} /> Routes &amp; obligations
              </button>
              <button className={view === 'audit' ? 'active' : ''} onClick={() => setView('audit')}>
                <Scale size={16} /> Contribution audit{' '}
                <span>
                  {assessed.length}/{proofNodes.length}
                </span>
              </button>
            </div>
            {view === 'roadmap' ? (
              <>
                {selected.nextAction && (
                  <section className="program-next-action">
                    <span className="program-next-icon">
                      <ArrowUpRight size={22} />
                    </span>
                    <div>
                      <span className="eyebrow">NEXT DECISIVE STEP</span>
                      <ResearchText>{selected.nextAction}</ResearchText>
                    </div>
                    <button
                      className="text-button"
                      onClick={() =>
                        onDiscuss(
                          `Develop a precise research task for this next step:\n${selected.nextAction}\n\nGoal: ${selected.title}. Give the anticipated mathematical gain, a cheap falsification test, and a concrete stopping condition.`,
                          selected.id,
                          selected.linkedNodeIds,
                        )
                      }
                    >
                      Open in chat <ArrowUpRight size={14} />
                    </button>
                  </section>
                )}
                <div className="program-two-columns">
                  <section className="panel program-section">
                    <div className="program-section-heading">
                      <h2>
                        <LockKeyhole size={17} /> Open proof obligations
                      </h2>
                      <span>{bottlenecks.length}</span>
                    </div>
                    <p className="program-caption">
                      Unresolved claims on this goal’s dependency path.
                    </p>
                    {bottlenecks.length ? (
                      bottlenecks.map((n) => (
                        <button
                          className="program-node-row"
                          key={n.id}
                          onClick={() => onSelect(n.id)}
                        >
                          <TypeIcon type={n.type} />
                          <span>
                            <strong>
                              <ResearchText inline>{n.title}</ResearchText>
                            </strong>
                            <small>
                              {n.type} · {n.epistemicStatus}
                            </small>
                          </span>
                          <ChevronRight size={14} />
                        </button>
                      ))
                    ) : (
                      <p className="empty-inline">
                        No unresolved proof obligations recorded. The target still requires your
                        judgment.
                      </p>
                    )}
                  </section>
                  <section className="panel program-section">
                    <div className="program-section-heading">
                      <h2>
                        <Route size={17} /> Attacks on the problem
                      </h2>
                      <span>{attacks.length}</span>
                    </div>
                    <p className="program-caption">Keep competing and failed routes visible.</p>
                    {attacks.length ? (
                      attacks.map((n) => {
                        const relations = state.edges.flatMap((edge) => {
                          const label =
                            edge.sourceNodeId === n.id && edge.edgeType === 'depends_on'
                              ? 'Requires'
                              : edge.sourceNodeId === n.id && edge.edgeType === 'supersedes'
                                ? 'Replaces'
                                : edge.targetNodeId === n.id && edge.edgeType === 'supersedes'
                                  ? 'Replaced by'
                                  : null;
                          if (!label) return [];
                          const target = state.nodes.find(
                            (node) =>
                              node.id ===
                              (label === 'Replaced by' ? edge.sourceNodeId : edge.targetNodeId),
                          );
                          if (
                            !target ||
                            (edge.edgeType === 'supersedes' && target.type !== 'Approach')
                          )
                            return [];
                          return [{ edge, label, target }];
                        });
                        return (
                          <div className="program-attack" key={n.id}>
                            <button onClick={() => onSelect(n.id)}>
                              <strong>
                                <ResearchText inline>{n.title}</ResearchText>
                              </strong>
                              <Badge status={n.epistemicStatus} />
                            </button>
                            <ResearchText>{n.summary}</ResearchText>
                            {relations.length > 0 && (
                              <dl className="program-attack-relations">
                                {relations.map(({ edge, label, target }) => (
                                  <div key={edge.id}>
                                    <dt>{label}</dt>
                                    <dd>
                                      <button
                                        className="text-button"
                                        onClick={() => onSelect(target.id)}
                                      >
                                        <ResearchText inline>{target.title}</ResearchText>
                                        <ChevronRight size={12} />
                                      </button>
                                      <small>{target.epistemicStatus}</small>
                                      {edge.explanation && (
                                        <ResearchText className="program-relation-explanation">
                                          {edge.explanation}
                                        </ResearchText>
                                      )}
                                    </dd>
                                  </div>
                                ))}
                              </dl>
                            )}
                            <button
                              className="text-button"
                              onClick={() =>
                                onDiscuss(
                                  `Stress-test the approach “${n.title}” toward “${selected.title}”. Which specific lemma makes this route work? Give its exact statement, the gain if true, circular dependencies, and a smallest counterexample to search for. Do not relabel the target as a lemma.`,
                                  selected.id,
                                  [n.id],
                                )
                              }
                            >
                              Stress-test this attack <ArrowUpRight size={13} />
                            </button>
                          </div>
                        );
                      })
                    ) : (
                      <div className="program-empty-route">
                        <p>No approaches linked yet.</p>
                        <button
                          className="text-button"
                          onClick={() => onDiscuss(workPrompt, selected.id, selected.linkedNodeIds)}
                        >
                          Develop an attack in chat <ArrowUpRight size={13} />
                        </button>
                      </div>
                    )}
                  </section>
                </div>
                <section className="panel program-section">
                  <div className="program-section-heading">
                    <h2>
                      <GitBranch size={17} /> Directly connected research
                    </h2>
                    <button className="text-button" onClick={() => setEditing({ goal: selected })}>
                      Edit connections
                    </button>
                  </div>
                  <div className="program-linked-grid">
                    {linked.map((n) => (
                      <button
                        className="program-linked-card"
                        key={n.id}
                        onClick={() => onSelect(n.id)}
                      >
                        <span className="eyebrow">
                          <TypeIcon type={n.type} size={13} />
                          {n.type}
                        </span>
                        <strong>
                          <ResearchText inline>{n.title}</ResearchText>
                        </strong>
                        <div>
                          <Badge status={n.epistemicStatus} />
                          {assessments.get(n.id) && (
                            <span className="program-classification">
                              {assessments.get(n.id)!.classification}
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                    {!linked.length && (
                      <p className="empty-inline">
                        Link the lemmas, approaches, and experiments that serve this goal.
                      </p>
                    )}
                  </div>
                </section>
              </>
            ) : (
              <section className="panel program-section contribution-audit">
                <div className="program-section-heading">
                  <div>
                    <h2>What did this step actually buy?</h2>
                    <p className="program-caption">
                      Assess the mathematical gain separately from proof status.
                    </p>
                  </div>
                  <select
                    aria-label="Filter contribution assessments"
                    value={auditFilter}
                    onChange={(e) => setAuditFilter(e.target.value)}
                  >
                    <option value="all">All steps</option>
                    <option value="unreviewed">Needs assessment</option>
                    <option value="routine">Routine / restated</option>
                  </select>
                </div>
                {auditNodes.map((n) => {
                  const a = assessments.get(n.id);
                  return (
                    <article className="audit-step" key={n.id}>
                      <div className="audit-step-heading">
                        <button onClick={() => onSelect(n.id)}>
                          <TypeIcon type={n.type} />
                          <strong>
                            <ResearchText inline>{n.title}</ResearchText>
                          </strong>
                        </button>
                        <Badge status={n.epistemicStatus} />
                      </div>
                      <div className="contribution-badges">
                        <span
                          className={`depth-badge depth-${a?.classification === 'Restatement' ? 'restatement' : a?.classification === 'Routine consequence' ? 'routine' : 'candidate'}`}
                        >
                          {a?.classification ?? 'Unassessed'}
                        </span>
                        <span className="review-verdict">
                          {a?.stale
                            ? 'Needs re-review · item changed'
                            : (a?.verdict ?? 'Unreviewed')}
                        </span>
                      </div>
                      {a ? (
                        <div className="contribution-delta">
                          <div>
                            <small>BEFORE</small>
                            <ResearchText>{a.before}</ResearchText>
                          </div>
                          <ArrowRight size={17} />
                          <div>
                            <small>AFTER</small>
                            <ResearchText>{a.after}</ResearchText>
                          </div>
                        </div>
                      ) : (
                        <p className="program-caption">
                          No explicit comparison with the baseline has been recorded.
                        </p>
                      )}
                      <div className="audit-step-actions">
                        <button className="text-button" onClick={() => onAssess(n)}>
                          <Scale size={14} /> {a ? 'Review contribution' : 'Assess contribution'}
                        </button>
                        <button
                          className="text-button"
                          onClick={() =>
                            onDiscuss(
                              `Audit “${n.title}” for substantive mathematical progress toward “${selected.title}”. Show the before/after comparison and the one step that does real work. Classify a mere reformulation as such; distinguish a routine but useful lemma from a new reduction. State all unresolved obligations.`,
                              selected.id,
                              [n.id],
                            )
                          }
                        >
                          <Sparkles size={14} /> Challenge with GPT
                        </button>
                      </div>
                    </article>
                  );
                })}
                {!auditNodes.length && <p className="empty-inline">No steps match this filter.</p>}
              </section>
            )}
          </div>
        </div>
      )}
      {editing && (
        <GoalEditor
          program={program}
          state={state}
          goal={editing.goal}
          parentGoalId={editing.parentGoalId}
          onClose={() => setEditing(null)}
          onSaved={async (g) => {
            setSelectedId(g.id);
            await onRefresh();
          }}
        />
      )}
    </div>
  );
}

function GoalEditor({
  goal,
  parentGoalId,
  program,
  state,
  onClose,
  onSaved,
}: {
  goal?: ResearchGoal;
  parentGoalId?: string | null;
  program: ProgramState;
  state: ResearchState;
  onClose: () => void;
  onSaved: (goal: ResearchGoal) => Promise<void>;
}) {
  const [form, setForm] = useState<GoalInput>(
    goal ?? {
      title: '',
      statement: '',
      successCriteria: '',
      baseline: '',
      kind: parentGoalId ? 'Milestone' : 'Ultimate',
      status: 'Active',
      parentGoalId: parentGoalId ?? null,
      linkedNodeIds: [],
      nextAction: '',
    },
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [query, setQuery] = useState('');
  const field = <K extends keyof GoalInput>(key: K, value: GoalInput[K]) =>
    setForm({ ...form, [key]: value });
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const saved = await api<ResearchGoal>(
        goal ? `/program/goals/${goal.id}` : '/program/goals',
        goal ? 'PATCH' : 'POST',
        form,
      );
      await onSaved(saved);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={goal ? 'Edit research goal' : 'Define a research goal'} onClose={onClose} wide>
      <form className="editor-form" onSubmit={save}>
        <label>
          Goal title
          <input
            required
            maxLength={250}
            value={form.title}
            onChange={(e) => field('title', e.target.value)}
            placeholder="The exact result you want to establish"
          />
        </label>
        <div className="form-row">
          <label>
            Goal kind
            <select
              value={form.kind}
              onChange={(e) =>
                setForm({
                  ...form,
                  kind: e.target.value as GoalInput['kind'],
                  parentGoalId: e.target.value === 'Ultimate' ? null : form.parentGoalId,
                })
              }
            >
              {GOAL_KINDS.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select
              value={form.status}
              onChange={(e) => field('status', e.target.value as GoalInput['status'])}
            >
              {GOAL_STATUSES.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
        </div>
        {form.kind === 'Milestone' && (
          <label>
            Parent goal
            <select
              value={form.parentGoalId ?? ''}
              onChange={(e) => field('parentGoalId', e.target.value || null)}
            >
              <option value="">Standalone milestone</option>
              {program.goals
                .filter((g) => g.id !== goal?.id)
                .map((g) => (
                  <option value={g.id} key={g.id}>
                    {researchTextLabel(g.title)}
                  </option>
                ))}
            </select>
          </label>
        )}
        <MathEditor
          label="Target statement · quantifiers and parameters"
          value={form.statement}
          onChange={(v) => field('statement', v)}
          rows={5}
          maxLength={20000}
          required
        />
        <MathEditor
          label="Current baseline"
          value={form.baseline}
          onChange={(v) => field('baseline', v)}
          rows={3}
          maxLength={10000}
          toolbar={false}
        />
        <MathEditor
          label="Success criteria"
          value={form.successCriteria}
          onChange={(v) => field('successCriteria', v)}
          rows={3}
          maxLength={10000}
          toolbar={false}
          placeholder="What bound, proof, counterexample, or parameter range will settle this goal?"
        />
        <MathEditor
          label="Next decisive step"
          value={form.nextAction}
          onChange={(v) => field('nextAction', v)}
          rows={3}
          maxLength={10000}
          toolbar={false}
        />
        <div className="goal-links-picker">
          <div className="program-section-heading">
            <h3>Linked lemmas, attacks &amp; experiments</h3>
            <span>{form.linkedNodeIds.length} selected</span>
          </div>
          <input
            aria-label="Find research to connect"
            placeholder="Find a research item…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div>
            {form.linkedNodeIds
              .filter((id) => !state.nodes.some((n) => n.id === id))
              .map((id) => (
                <div className="goal-link-option" key={id}>
                  <span>Missing research item: {id}</span>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      field(
                        'linkedNodeIds',
                        form.linkedNodeIds.filter((x) => x !== id),
                      )
                    }
                  >
                    Remove link
                  </button>
                </div>
              ))}
            {state.nodes
              .filter((n) => researchTextLabel(n.title).toLowerCase().includes(query.toLowerCase()))
              .map((n) => (
                <label className="goal-link-option" key={n.id}>
                  <input
                    type="checkbox"
                    checked={form.linkedNodeIds.includes(n.id)}
                    onChange={(e) =>
                      field(
                        'linkedNodeIds',
                        e.target.checked
                          ? [...form.linkedNodeIds, n.id]
                          : form.linkedNodeIds.filter((id) => id !== n.id),
                      )
                    }
                  />
                  <TypeIcon type={n.type} size={14} />
                  <span>
                    <ResearchText inline>{n.title}</ResearchText>
                    <small>{n.type}</small>
                  </span>
                </label>
              ))}
          </div>
        </div>
        {form.status === 'Achieved' && (
          <p className="hint">
            Completion records your judgment that the success criteria are met. Link a
            human-verified proof and resolve its recorded dependencies first.
          </p>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="modal-footer">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy || !form.statement.trim()}>
            {busy ? 'Saving…' : 'Save goal'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
