import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  Code2,
  Compass,
  FlaskConical,
  GitBranch,
  Lightbulb,
  Link2,
  LoaderCircle,
  MessageSquare,
  Plus,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
  TriangleAlert,
  UserRound,
  X,
} from 'lucide-react';
import type { ResearchState } from '../shared/types';
import type { ProgramState } from '../shared/program';
import type {
  ChatMessage,
  ChatMode,
  ChatProposal,
  ChatSession,
  ChatState,
  ConnectionStatus,
} from '../shared/chat';
import { researchTextLabel } from '../shared/math';
import { useProjectApi } from './ProjectScope';
import { Modal } from './ui';
import MathEditor from './MathEditor';
import ResearchText from './ResearchText';
import './research-chat.css';

const starters = [
  {
    mode: 'explore' as const,
    icon: GitBranch,
    title: 'Find a useful intermediate lemma',
    description: 'Separate a new reduction from a restatement of the goal.',
    prompt:
      'Find one useful intermediate lemma toward the selected goal. State the exact assumptions and conclusion. Compare what was known before with what this lemma would add; explicitly say if it is only a restatement or routine consequence. Explain the nontrivial mechanism, which obstacle it removes, and how it feeds into the ultimate goal. Give a concrete proof or falsification route. Do not describe an unproved claim as established.',
  },
  {
    mode: 'attack' as const,
    icon: FlaskConical,
    title: 'Design the next attack',
    description: 'Choose a test that distinguishes progress from wishful thinking.',
    prompt:
      'Develop one concrete attack on the selected goal using the current research graph. Name the bottleneck, the proposed mechanism, and the smallest mathematical case or experiment that could falsify it. Explain what success would actually establish and what would still be missing. Propose a bounded next action and explicit stopping criterion. Separate established facts, hypotheses, and heuristic predictions.',
  },
  {
    mode: 'audit' as const,
    icon: ShieldCheck,
    title: 'Audit the mathematical gain',
    description: 'Challenge hidden assumptions, circularity, and cosmetic progress.',
    prompt:
      'Audit the focused lemma or approach against the selected goal and existing results. Write the precise before/after mathematical statements. Check whether the new claim is equivalent to the goal, follows routinely from known facts, or supplies a genuinely new reduction, technique, or barrier. Search for hidden assumptions, circular dependencies, and counterexamples. Identify the hardest unjustified step and one specific independent verification. Propose only changes justified by this audit; leave verification to the researcher.',
  },
];
const modes = [
  { id: 'explore' as const, title: 'Explore', icon: Compass },
  { id: 'attack' as const, title: 'Attack', icon: FlaskConical },
  { id: 'audit' as const, title: 'Audit', icon: ShieldCheck },
];
const emptyConnection: ConnectionStatus = {
  configured: false,
  model: '',
  source: 'none',
  persisted: false,
};
const stamp = (date: string) =>
  new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const clock = (date: string) =>
  new Date(date).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const countChanges = (proposal: ChatProposal) =>
  proposal.nodes.length +
  proposal.edges.length +
  proposal.goals.length +
  proposal.assessments.length;

export function ConnectionDialog({
  connection,
  onClose,
  onChange,
  notify,
}: {
  connection: ConnectionStatus;
  onClose: () => void;
  onChange: (connection: ConnectionStatus) => void;
  notify: (message: string) => void;
}) {
  const api = useProjectApi();
  const [key, setKey] = useState('');
  const [model, setModel] = useState(connection.model);
  const [persist, setPersist] = useState(connection.persisted);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  async function save(test: boolean) {
    setBusy(true);
    setError('');
    setResult('');
    try {
      const updated = await api<ConnectionStatus>('/research-chat/connection', 'PUT', {
        model: model.trim(),
        ...(key.trim() ? { apiKey: key.trim() } : {}),
        persist,
      });
      setKey('');
      onChange(updated);
      if (test) {
        const checked = await api<{ ok: boolean; message: string }>(
          '/research-chat/connection/test',
          'POST',
        );
        setResult(checked.message);
      } else {
        notify('OpenAI connection settings saved');
        onClose();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function disconnect() {
    setBusy(true);
    setError('');
    try {
      onChange(
        await api<ConnectionStatus>('/research-chat/connection', 'PUT', { disconnect: true }),
      );
      setKey('');
      notify('Disconnected. Planning worksheets are still available.');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Connect OpenAI"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="chat-connection-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save(false);
        }}
      >
        <p className="chat-connection-intro">
          Use GPT inside your research workspace. This connects to the OpenAI API; it does not sign
          into a ChatGPT conversation. Research context is sent only when you send a prompt.
        </p>
        <label htmlFor="chat-api-key">OpenAI API key</label>
        <input
          id="chat-api-key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={
            connection.configured ? 'Leave blank to keep the connected key' : 'Enter your API key'
          }
          disabled={busy}
        />
        <p className="chat-connection-hint">
          Your key is encrypted in a secure, server-only browser cookie. It is never written to
          research history or exposed to page scripts.
        </p>
        <label htmlFor="chat-model">Model</label>
        <input
          id="chat-model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="OpenAI model ID"
          required
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
        />
        <p className="chat-connection-hint">
          Choose a model available to your API project. Save &amp; test checks key and model access
          without generating a response.
        </p>
        <label className="chat-persist-label">
          <input
            type="checkbox"
            checked={persist}
            onChange={(e) => setPersist(e.target.checked)}
            disabled={busy}
          />
          <span>
            Remember in this browser for 30 days. Otherwise the encrypted connection lasts for this
            browser session, up to 24 hours.
          </span>
        </label>
        {connection.configured && (
          <p className="chat-connection-hint">
            Current connection:{' '}
            {connection.source === 'environment'
              ? 'server environment'
              : connection.persisted
                ? 'encrypted browser connection'
                : 'encrypted session connection'}
            .
          </p>
        )}
        {error && (
          <div className="chat-error" role="alert">
            <TriangleAlert size={16} />
            <p>{error}</p>
          </div>
        )}
        {result && (
          <div className="chat-test-result" role="status">
            <Check size={16} />
            <p>{result}</p>
          </div>
        )}
        <div className="chat-connection-actions">
          {connection.configured && (
            <button
              className="text-button"
              type="button"
              disabled={busy}
              onClick={() => void disconnect()}
            >
              Disconnect
            </button>
          )}
          <button
            className="button secondary"
            type="submit"
            disabled={busy || !model.trim() || (!key.trim() && !connection.configured)}
          >
            Save connection
          </button>
          <button
            className="button primary"
            type="button"
            disabled={busy || !model.trim() || (!key.trim() && !connection.configured)}
            onClick={() => void save(true)}
          >
            {busy ? <LoaderCircle size={14} /> : <Link2 size={14} />} Save &amp; test
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ProposalReview({
  message,
  state,
  program,
  busy,
  onApply,
  onDiscard,
}: {
  message: ChatMessage;
  state: ResearchState;
  program: ProgramState;
  busy: boolean;
  onApply: () => void;
  onDiscard: () => void;
}) {
  const proposal = message.proposal;
  if (!proposal || !countChanges(proposal)) return null;
  const nodeTitle = (id: string) =>
    proposal.nodes.find((node) => node.tempId === id)?.title ??
    state.nodes.find((node) => node.id === id)?.title ??
    id;
  const goalTitle = (id: string) =>
    proposal.goals.find((goal) => goal.tempId === id)?.title ??
    program.goals.find((goal) => goal.id === id)?.title ??
    id;
  return (
    <section className="chat-review" aria-label="Review proposed research updates">
      <div className="chat-review-heading">
        <GitBranch size={18} />
        <div>
          <strong>
            {countChanges(proposal)} proposed research update{countChanges(proposal) !== 1 && 's'}
          </strong>
          <p>
            Review the mathematical change before adding it to your program. New claims remain
            Unverified.
          </p>
        </div>
      </div>
      <div className="chat-review-items">
        {proposal.summary && (
          <div className="chat-review-item">
            <ResearchText>{proposal.summary}</ResearchText>
          </div>
        )}
        {proposal.nodes.map((node) => (
          <div className="chat-review-item" key={node.tempId}>
            <div className="chat-review-item-label">
              <Plus size={12} /> New {node.type} · Unverified
            </div>
            <strong>
              <ResearchText inline>{node.title}</ResearchText>
            </strong>
            <ResearchText>{node.summary}</ResearchText>
            <details>
              <summary>Read proposed statement and argument</summary>
              <ResearchText>{node.content || 'No argument supplied.'}</ResearchText>
              {node.tags.length > 0 && <p>Tags: {node.tags.join(', ')}</p>}
            </details>
          </div>
        ))}
        {proposal.goals.map((goal) => {
          const existing = program.goals.find((item) => item.id === goal.existingGoalId);
          return (
            <div className="chat-review-item" key={goal.tempId}>
              <div className="chat-review-item-label">
                <Target size={12} />
                {existing ? 'Update' : 'New'} {goal.kind.toLowerCase()} goal
              </div>
              <strong>
                <ResearchText inline>{goal.title}</ResearchText>
              </strong>
              <div className="chat-review-comparison">
                <div>
                  <small>Current statement</small>
                  <ResearchText>
                    {existing?.statement || 'No existing goal. This will add a new goal.'}
                  </ResearchText>
                </div>
                <div>
                  <small>Proposed statement</small>
                  <ResearchText>{goal.statement}</ResearchText>
                </div>
              </div>
              <details>
                <summary>Review success criteria, baseline, and next action</summary>
                <dl className="chat-review-assessment">
                  <dt>Success criteria</dt>
                  <dd>
                    <ResearchText>{goal.successCriteria || 'Not specified'}</ResearchText>
                  </dd>
                  <dt>Baseline</dt>
                  <dd>
                    <ResearchText>{goal.baseline || 'Not specified'}</ResearchText>
                  </dd>
                  <dt>Next action</dt>
                  <dd>
                    <ResearchText>{goal.nextAction || 'Not specified'}</ResearchText>
                  </dd>
                  <dt>Parent goal</dt>
                  <dd>
                    <ResearchText inline>
                      {goal.parentGoalId ? goalTitle(goal.parentGoalId) : 'None'}
                    </ResearchText>
                  </dd>
                  <dt>Linked items</dt>
                  <dd>
                    {goal.linkedNodeIds.length
                      ? goal.linkedNodeIds.map((id) => (
                          <div key={id}>
                            <ResearchText inline>{nodeTitle(id)}</ResearchText>
                          </div>
                        ))
                      : 'None'}
                  </dd>
                </dl>
                {existing && (
                  <details>
                    <summary>Compare original goal details</summary>
                    <ResearchText>{`**Title:** ${existing.title}\n\n**Success criteria:** ${existing.successCriteria || 'Not specified'}\n\n**Baseline:** ${existing.baseline || 'Not specified'}\n\n**Next action:** ${existing.nextAction || 'Not specified'}\n\n**Kind:** ${existing.kind}\n\n**Parent:** ${existing.parentGoalId ? goalTitle(existing.parentGoalId) : 'None'}\n\n**Linked items:** ${existing.linkedNodeIds.map(nodeTitle).join('; ') || 'None'}`}</ResearchText>
                  </details>
                )}
              </details>
            </div>
          );
        })}
        {proposal.assessments.map((assessment) => {
          const existing = program.assessments.find((item) => item.nodeId === assessment.nodeId);
          return (
            <div className="chat-review-item" key={assessment.nodeId}>
              <div className="chat-review-item-label">
                <ShieldCheck size={12} /> Contribution assessment · Unreviewed
              </div>
              <strong>
                <ResearchText inline>{nodeTitle(assessment.nodeId)}</ResearchText>
              </strong>
              <ResearchText>{`Proposed classification: **${assessment.classification}**${existing ? ` (current: ${existing.classification})` : ''}`}</ResearchText>
              <div className="chat-review-comparison">
                <div>
                  <small>Mathematical starting point</small>
                  <ResearchText>{assessment.before || 'Not specified'}</ResearchText>
                </div>
                <div>
                  <small>Claimed mathematical gain</small>
                  <ResearchText>{assessment.after || 'Not specified'}</ResearchText>
                </div>
              </div>
              <dl className="chat-review-assessment">
                <dt>Mechanism</dt>
                <dd>
                  <ResearchText>{assessment.mechanism || 'No mechanism supplied'}</ResearchText>
                </dd>
                <dt>Independent check</dt>
                <dd>
                  <ResearchText>{assessment.check || 'No check supplied'}</ResearchText>
                </dd>
              </dl>
              {existing && (
                <details>
                  <summary>Compare original assessment</summary>
                  <ResearchText>{`**Starting point:** ${existing.before || 'Not specified'}\n\n**Gain:** ${existing.after || 'Not specified'}\n\n**Mechanism:** ${existing.mechanism || 'Not specified'}\n\n**Check:** ${existing.check || 'Not specified'}\n\n**Review:** ${existing.verdict}`}</ResearchText>
                </details>
              )}
            </div>
          );
        })}
        {proposal.edges.map((edge, index) => (
          <div className="chat-review-item" key={index}>
            <div className="chat-review-item-label">
              <Link2 size={12} /> New relationship · {edge.edgeType.replaceAll('_', ' ')}
            </div>
            <strong>
              <ResearchText inline>{nodeTitle(edge.sourceNodeId)}</ResearchText> →{' '}
              <ResearchText inline>{nodeTitle(edge.targetNodeId)}</ResearchText>
            </strong>
            <ResearchText>{edge.explanation || 'No explanation supplied.'}</ResearchText>
          </div>
        ))}
      </div>
      <div className="chat-review-footer">
        {message.proposalStatus === 'pending' ? (
          <>
            <button className="text-button" onClick={onDiscard} disabled={busy}>
              Discard proposal
            </button>
            <button className="button primary" onClick={onApply} disabled={busy}>
              {busy ? <LoaderCircle size={14} /> : <Check size={14} />}Apply proposed updates
            </button>
          </>
        ) : (
          <span className="chat-review-status">
            <Check size={14} />
            {message.proposalStatus === 'applied'
              ? 'Applied to the research program · verification unchanged'
              : 'Proposal discarded · research program unchanged'}
          </span>
        )}
      </div>
    </section>
  );
}

export default function ResearchChat({
  state,
  program,
  onRefresh,
  onSelect,
  initialPrompt,
  initialGoalId,
  initialNodeIds,
  onPromptConsumed,
  notify,
}: {
  state: ResearchState;
  program: ProgramState;
  onRefresh: () => Promise<void>;
  onSelect: (id: string) => void;
  initialPrompt?: string;
  initialGoalId?: string;
  initialNodeIds?: string[];
  onPromptConsumed?: () => void;
  notify: (message: string) => void;
}) {
  const api = useProjectApi();
  const [chat, setChat] = useState<ChatState>({
    sessions: [],
    messages: [],
    connection: emptyConnection,
  });
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [goalId, setGoalId] = useState(
    initialGoalId ??
      program.goals.find((goal) => goal.kind === 'Ultimate' && goal.status === 'Active')?.id ??
      program.goals[0]?.id ??
      '',
  );
  const [nodeIds, setNodeIds] = useState<string[]>(initialNodeIds ?? []);
  const [prompt, setPrompt] = useState(initialPrompt ?? '');
  const [mode, setMode] = useState<ChatMode>('explore');
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [mutating, setMutating] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [sourceIds, setSourceIds] = useState<Set<string>>(new Set());
  const [lastAttempt, setLastAttempt] = useState<{
    content: string;
    mode: ChatMode;
    contextNodeIds: string[];
    goalId: string | null;
  } | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLDivElement>(null);
  const goal = program.goals.find((item) => item.id === goalId);
  const session = chat.sessions.find((item) => item.id === sessionId);
  const messages = chat.messages.filter((message) => message.sessionId === sessionId);
  const connected = chat.connection.configured;
  useEffect(() => {
    let active = true;
    api<ChatState>('/research-chat/state')
      .then((result) => {
        if (!active) return;
        setChat(result);
        setSessionId(result.sessions[0]?.id ?? null);
        setReady(true);
        setLoading(false);
      })
      .catch((e) => {
        if (active) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (initialPrompt !== undefined) {
      setPrompt(initialPrompt);
      if (initialGoalId !== undefined) setGoalId(initialGoalId);
      if (initialNodeIds !== undefined) setNodeIds(initialNodeIds.slice(0, 12));
      if (/^audit|audit the|audit this/i.test(initialPrompt)) setMode('audit');
      onPromptConsumed?.();
    }
  }, [initialPrompt, initialGoalId, initialNodeIds, onPromptConsumed]);
  useEffect(() => {
    setNodeIds((current) => current.filter((id) => state.nodes.some((node) => node.id === id)));
  }, [state.nodes]);
  useEffect(() => {
    if (goalId && !program.goals.some((item) => item.id === goalId)) setGoalId('');
  }, [goalId, program.goals]);
  async function reload() {
    const result = await api<ChatState>('/research-chat/state');
    setChat(result);
    setReady(true);
    return result;
  }
  async function retryLoad() {
    setLoading(true);
    setError('');
    try {
      const result = await reload();
      setSessionId(result.sessions[0]?.id ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  async function createSession() {
    setError('');
    setBusy(true);
    try {
      const created = await api<ChatSession>('/research-chat/sessions', 'POST', {});
      setChat((current) => ({ ...current, sessions: [created, ...current.sessions] }));
      setSessionId(created.id);
      setLastAttempt(null);
      composer.current?.querySelector('textarea')?.focus();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function send(override?: {
    content: string;
    mode: ChatMode;
    contextNodeIds: string[];
    goalId: string | null;
  }) {
    if (busy || mutating || !ready) return;
    const request = override ?? {
      content: prompt.trim(),
      mode,
      contextNodeIds: nodeIds,
      goalId: goalId || null,
    };
    if (!request.content) return;
    setBusy(true);
    setError('');
    setLastAttempt(request);
    try {
      let currentId = sessionId;
      if (!currentId) {
        const created = await api<ChatSession>('/research-chat/sessions', 'POST', {});
        currentId = created.id;
        setSessionId(created.id);
        setChat((current) => ({ ...current, sessions: [created, ...current.sessions] }));
      }
      setSending(true);
      const result = await api<{ userMessage: ChatMessage; assistantMessage: ChatMessage }>(
        `/research-chat/sessions/${currentId}/messages`,
        'POST',
        request,
      );
      setChat((current) => ({
        ...current,
        messages: [...current.messages, result.userMessage, result.assistantMessage],
      }));
      setPrompt((current) => (current.trim() === request.content ? '' : current));
      setLastAttempt(null);
      await reload();
      requestAnimationFrame(() =>
        end.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setSending(false);
    }
  }
  async function review(message: ChatMessage, action: 'apply' | 'discard') {
    setMutating(message.id);
    setError('');
    try {
      await api(`/research-chat/messages/${message.id}/${action}`, 'POST');
      setChat((current) => ({
        ...current,
        messages: current.messages.map((item) =>
          item.id === message.id
            ? {
                ...item,
                proposalStatus: action === 'apply' ? 'applied' : 'discarded',
              }
            : item,
        ),
      }));
      await reload();
      if (action === 'apply') await onRefresh();
      notify(
        action === 'apply'
          ? 'Proposed updates added. AI claims remain Unverified and contribution assessments remain Unreviewed.'
          : 'Proposal discarded',
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setMutating(null);
    }
  }
  function chooseStarter(starter: (typeof starters)[number]) {
    setPrompt(starter.prompt);
    setMode(starter.mode);
    composer.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    requestAnimationFrame(() => composer.current?.querySelector('textarea')?.focus());
  }
  function retryMessage(message: ChatMessage) {
    const index = messages.findIndex((item) => item.id === message.id);
    const previous = messages
      .slice(0, index)
      .reverse()
      .find((item) => item.role === 'user');
    if (previous)
      void send({
        content: previous.content,
        mode: previous.mode,
        contextNodeIds: previous.context.nodeIds.slice(0, 12),
        goalId: previous.context.goalIds[0] ?? null,
      });
  }
  return (
    <div className="chat-workbench">
      <div className="chat-page-heading">
        <div>
          <div className="eyebrow">
            <Sparkles size={13} /> RESEARCH WORKBENCH
          </div>
          <h1>Think together. Advance precisely.</h1>
          <p>A mathematical conversation connected to your goals, lemmas, and open attacks.</p>
        </div>
        <button
          className={`chat-connection-pill ${connected ? 'connected' : ''}`}
          disabled={!ready || busy || !!mutating}
          onClick={() => setConnectionOpen(true)}
        >
          <span className="chat-status-dot" />
          {connected ? `OpenAI · ${chat.connection.model}` : 'Planning worksheet'}
          <Settings2 size={13} />
        </button>
      </div>
      {error && (
        <div className="chat-error" role="alert">
          <TriangleAlert size={17} />
          <p>{error}</p>
          {lastAttempt && (
            <button className="text-button" disabled={busy} onClick={() => void send(lastAttempt)}>
              Try again
            </button>
          )}
          {!ready && (
            <button className="text-button" disabled={loading} onClick={() => void retryLoad()}>
              Reload connection and sessions
            </button>
          )}
          <button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}>
            <X size={14} />
          </button>
        </div>
      )}
      <div className="chat-layout">
        <aside className="chat-sidebar" aria-label="Research conversation context">
          <div className="chat-side-section">
            <div className="chat-section-label">
              <span>
                <Target size={13} /> Research context
              </span>
            </div>
            <label htmlFor="chat-goal">Working toward</label>
            <select
              id="chat-goal"
              value={goalId}
              disabled={busy}
              onChange={(e) => setGoalId(e.target.value)}
            >
              <option value="">Project overview</option>
              {program.goals.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.kind === 'Milestone' ? '↳ ' : ''}
                  {researchTextLabel(item.title)}
                </option>
              ))}
            </select>
            {goal && (
              <div className="chat-goal-brief">
                <ResearchText>{goal.statement}</ResearchText>
                <span className="chat-goal-status">
                  {goal.kind} goal · {goal.status}
                </span>
              </div>
            )}
            <div className="chat-context-field">
              <label htmlFor="chat-focus">Focus on a lemma or attack</label>
              <select
                id="chat-focus"
                value=""
                disabled={busy || nodeIds.length >= 12}
                onChange={(e) => {
                  if (e.target.value) setNodeIds([...nodeIds, e.target.value]);
                }}
              >
                <option value="">
                  {nodeIds.length >= 12 ? '12 focused items selected' : 'Add research item…'}
                </option>
                {state.nodes
                  .filter((node) => !nodeIds.includes(node.id))
                  .map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.type} · {researchTextLabel(node.title)}
                    </option>
                  ))}
              </select>
            </div>
            <div className="chat-context-items">
              {nodeIds.map((id) => {
                const node = state.nodes.find((item) => item.id === id);
                return node ? (
                  <div className="chat-context-chip" key={id}>
                    <button title={researchTextLabel(node.title)} onClick={() => onSelect(id)}>
                      <ResearchText inline>{node.title}</ResearchText>
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Remove ${researchTextLabel(node.title)} from context`}
                      disabled={busy}
                      onClick={() => setNodeIds(nodeIds.filter((item) => item !== id))}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : null;
              })}
            </div>
            <details className="chat-context-note">
              <summary>
                <BookOpen size={11} /> What is included?
                <ChevronDown size={10} />
              </summary>
              <p>
                Your project, selected goal, focused items, nearby relationships, evidence, and
                contribution assessments, plus recent messages in this session. With no focused
                items, the goal’s linked items or the first eight research items are used. Long
                context is truncated and disclosed on the response.{' '}
                {connected
                  ? 'This context is sent to OpenAI when you send.'
                  : 'Planning worksheets use your private workspace without sending context to OpenAI.'}
              </p>
            </details>
          </div>
          <div className="chat-side-section">
            <div className="chat-section-label">
              <span>
                <MessageSquare size={13} /> Sessions
              </span>
              <span>{chat.sessions.length}</span>
            </div>
            <button
              className="chat-new-session"
              onClick={() => void createSession()}
              disabled={busy || !ready || !!mutating}
            >
              <Plus size={13} />
              New research session
            </button>
            <div className="chat-session-list">
              {chat.sessions.map((item) => (
                <button
                  className={`chat-session-item ${item.id === sessionId ? 'active' : ''}`}
                  key={item.id}
                  disabled={busy || !!mutating}
                  aria-pressed={item.id === sessionId}
                  onClick={() => {
                    setSessionId(item.id);
                    setError('');
                    setLastAttempt(null);
                  }}
                >
                  <strong>{researchTextLabel(item.title)}</strong>
                  <small>
                    {stamp(item.updatedAt)} ·{' '}
                    {chat.messages.filter((message) => message.sessionId === item.id).length}{' '}
                    messages
                  </small>
                </button>
              ))}
            </div>
            {!chat.sessions.length && (
              <p className="chat-session-empty">
                Your mathematical conversations will be saved here.
              </p>
            )}
          </div>
          <div className="chat-side-principle">
            <Lightbulb size={18} />
            <strong>Demand a mathematical delta.</strong>
            <p>
              A rephrased problem is not an advance. Ask what changed, why it helps, and how to
              check it.
            </p>
          </div>
        </aside>
        <section className="chat-main" aria-label="Research conversation">
          <div className="chat-conversation-top">
            <div className="chat-conversation-title">
              <MessageSquare size={16} />
              <strong>
                {session ? researchTextLabel(session.title) : 'A new line of inquiry'}
              </strong>
            </div>
            <small>
              {connected ? 'Proposals stay in review until you apply them' : 'No model connected'}
            </small>
          </div>
          <div className="chat-messages" aria-live="polite" aria-busy={busy}>
            {loading ? (
              <div className="chat-loading">
                <LoaderCircle size={17} />
                Loading research sessions…
              </div>
            ) : (
              !messages.length && (
                <div className="chat-welcome">
                  <div className="chat-welcome-mark">
                    <GitBranch size={23} />
                  </div>
                  <h2>
                    What would count as
                    <br />
                    real progress today?
                  </h2>
                  <p>
                    Start with an exact goal. Develop an attack, challenge an intermediate lemma, or
                    make the missing proof step explicit.
                  </p>
                  <div className="chat-starters">
                    {starters.map((starter) => (
                      <button
                        className="chat-starter"
                        key={starter.mode}
                        onClick={() => chooseStarter(starter)}
                        disabled={busy}
                      >
                        <starter.icon size={19} />
                        <strong>{starter.title}</strong>
                        <p>{starter.description}</p>
                      </button>
                    ))}
                  </div>
                  {!connected && (
                    <div className="chat-offline-note">
                      <BookOpen size={18} />
                      <div>
                        <strong>A useful worksheet, even before connecting GPT.</strong>
                        <p>
                          The local mode organizes your question into a research checklist. It does
                          not generate mathematical answers or graph updates.{' '}
                          <button onClick={() => setConnectionOpen(true)}>Connect OpenAI</button>{' '}
                          for an actual model conversation.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )
            )}
            {messages.map((message) => (
              <article className={`chat-message ${message.role}`} key={message.id}>
                <div className="chat-message-heading">
                  <span className="chat-message-avatar">
                    {message.role === 'user' ? (
                      <UserRound size={14} />
                    ) : ['local', 'imported'].includes(message.provider) ? (
                      <BookOpen size={14} />
                    ) : (
                      <Sparkles size={14} />
                    )}
                  </span>
                  <strong>
                    {message.provider === 'imported'
                      ? message.role === 'user'
                        ? 'Imported user turn'
                        : `Imported reply${message.model ? ` · ${message.model} (reported)` : ''}`
                      : message.role === 'user'
                        ? 'You'
                        : message.provider === 'local'
                          ? 'Planning worksheet'
                          : message.provider === 'openai'
                            ? `GPT · ${message.model ?? 'OpenAI'}`
                            : 'Assistant'}
                  </strong>
                  <time dateTime={message.createdAt}>{clock(message.createdAt)}</time>
                  <button
                    className="chat-source-toggle"
                    onClick={() =>
                      setSourceIds((current) => {
                        const next = new Set(current);
                        if (next.has(message.id)) next.delete(message.id);
                        else next.add(message.id);
                        return next;
                      })
                    }
                  >
                    <Code2 size={12} />
                    {sourceIds.has(message.id) ? 'Typeset' : 'Source'}
                  </button>
                </div>
                {sourceIds.has(message.id) ? (
                  <pre className="chat-message-source">{message.content}</pre>
                ) : (
                  <div className="chat-message-body">
                    <ResearchText>{message.content}</ResearchText>
                  </div>
                )}
                {message.role === 'assistant' && (
                  <details className="chat-sent-context">
                    <summary>
                      {message.context.nodeIds.length}{' '}
                      {message.provider === 'imported'
                        ? 'linked research items'
                        : 'research items in context'}
                      {message.context.truncated ? ' · recorded context was truncated' : ''}
                      {message.provider === 'imported'
                        ? ' · imported record'
                        : message.provider === 'local'
                          ? ' · worksheet; no model request'
                          : message.provider === 'openai'
                            ? ' · OpenAI request context'
                            : ' · provider not recorded'}
                    </summary>
                    <p>
                      {message.context.characters.toLocaleString()}{' '}
                      {message.provider === 'imported'
                        ? 'recorded context characters. The original provider and request context are not verified by this import. Importing this message did not call OpenAI.'
                        : message.provider === 'local'
                          ? 'characters of project context used for this worksheet. No OpenAI request was made.'
                          : message.provider === 'openai'
                            ? 'characters of research context for the OpenAI request; recent session messages are included separately.'
                            : 'recorded context characters. No provider transmission is recorded.'}
                    </p>
                    {message.context.nodeIds.map((id) => {
                      const node = state.nodes.find((item) => item.id === id);
                      return node ? (
                        <button key={id} onClick={() => onSelect(id)}>
                          <ResearchText inline>{node.title}</ResearchText>
                        </button>
                      ) : null;
                    })}
                  </details>
                )}
                {message.error && (
                  <div className="chat-error" role="alert">
                    <TriangleAlert size={16} />
                    <p>
                      No research updates were applied. You can adjust the connection and retry this
                      request.
                    </p>
                    <button
                      className="text-button"
                      disabled={busy || !!mutating}
                      onClick={() => retryMessage(message)}
                    >
                      Retry request
                    </button>
                  </div>
                )}
                {message.proposal && (
                  <ProposalReview
                    message={message}
                    state={state}
                    program={program}
                    busy={busy || !!mutating}
                    onApply={() => void review(message, 'apply')}
                    onDiscard={() => void review(message, 'discard')}
                  />
                )}
              </article>
            ))}
            {sending && (
              <div className="chat-pending" role="status">
                <LoaderCircle size={18} />
                <div>
                  <strong>
                    {connected ? 'Waiting for OpenAI…' : 'Preparing your local worksheet…'}
                  </strong>
                  <p>Your research graph stays unchanged until you review and apply a proposal.</p>
                </div>
              </div>
            )}
            <div ref={end} />
          </div>
          <div className="chat-composer" ref={composer}>
            <div className="chat-composer-top">
              <div className="chat-mode-switch" role="group" aria-label="Research mode">
                {modes.map((item) => (
                  <button
                    key={item.id}
                    aria-pressed={mode === item.id}
                    disabled={busy}
                    onClick={() => setMode(item.id)}
                  >
                    <item.icon size={12} />
                    {item.title}
                  </button>
                ))}
              </div>
              <small>LaTeX and Markdown supported</small>
            </div>
            <MathEditor
              label="Your research prompt"
              value={prompt}
              onChange={setPrompt}
              rows={4}
              maxLength={30000}
              defaultMode="source"
              toolbar={false}
              placeholder={String.raw`State a precise question, an attempted proof, or a conjectured lemma. Use $...$ for mathematics.`}
            />
            <div className="chat-composer-footer">
              <p>
                {connected
                  ? 'GPT can be wrong. Proposed claims and assessments require your review; proof status is never upgraded automatically.'
                  : 'No OpenAI request is made in worksheet mode. Connect your API key to get a model response and proposed program updates.'}
              </p>
              <button
                className="button primary"
                disabled={busy || !ready || !!mutating || !prompt.trim()}
                onClick={() => void send()}
              >
                {busy ? (
                  <LoaderCircle size={14} />
                ) : connected ? (
                  <Send size={14} />
                ) : (
                  <ArrowRight size={14} />
                )}{' '}
                {connected ? 'Send to GPT' : 'Build a worksheet'}
              </button>
            </div>
          </div>
        </section>
      </div>
      {connectionOpen && (
        <ConnectionDialog
          connection={chat.connection}
          onClose={() => setConnectionOpen(false)}
          onChange={(connection) => setChat((current) => ({ ...current, connection }))}
          notify={notify}
        />
      )}
    </div>
  );
}
