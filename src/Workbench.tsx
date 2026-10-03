import { useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Table2,
  Plus,
  GitBranch,
  Upload,
  Send,
  Settings2,
  ChevronRight,
  LoaderCircle,
  Search,
  Target,
} from 'lucide-react';
import type { ResearchState } from '../shared/types';
import type { ProgramState } from '../shared/program';
import type { ChatMessage, ChatMode, ChatSession, ChatState } from '../shared/chat';
import type { Candidate, NotebookState } from '../shared/workbench';
import type { SourceArtifact, EngineData } from '../shared/engine';
import { useProjectApi } from './ProjectScope';
import ResearchText from './ResearchText';
import MathEditor from './MathEditor';
import { ConnectionDialog } from './ResearchChat';
import NotebookReview from './NotebookReview';
import NotebookImport from './NotebookImport';
import { Modal } from './ui';
import { researchTextLabel } from '../shared/math';
import './workbench.css';
const emptyChat: ChatState = {
  sessions: [],
  messages: [],
  connection: { configured: false, model: '', source: 'none', persisted: false },
};
const plain = (s: string, n = 110) => researchTextLabel(s).slice(0, n);
const time = (s: string) =>
  new Date(s).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
export default function Workbench({
  onProposeSource,
  state,
  program,
  onRefresh,
  onSelect,
  notify,
  initialPrompt,
  initialGoalId,
  initialNodeIds,
  onPromptConsumed,
}: {
  onProposeSource?: (sourceId: string) => void;
  state: ResearchState;
  program: ProgramState;
  onRefresh: () => Promise<void>;
  onSelect: (id: string) => void;
  notify: (message: string) => void;
  initialPrompt?: string;
  initialGoalId?: string;
  initialNodeIds?: string[];
  onPromptConsumed?: () => void;
}) {
  const api = useProjectApi();
  const [chat, setChat] = useState(emptyChat),
    [notebook, setNotebook] = useState<NotebookState>({ candidates: [] }),
    [sessionId, setSessionId] = useState(''),
    [replyId, setReplyId] = useState(''),
    [candidateId, setCandidateId] = useState(''),
    [goalId, setGoalId] = useState(initialGoalId ?? program.goals[0]?.id ?? ''),
    [criterion, setCriterion] = useState(''),
    [prompt, setPrompt] = useState(initialPrompt ?? ''),
    [notes, setNotes] = useState(''),
    [mode, setMode] = useState<ChatMode>('explore'),
    [nodeIds, setNodeIds] = useState<string[]>(initialNodeIds ?? []),
    [view, setView] = useState<'notebook' | 'sheet'>('notebook'),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(''),
    [connectionOpen, setConnectionOpen] = useState(false),
    [importOpen, setImportOpen] = useState(false),
    [turnReason, setTurnReason] = useState(''),
    [query, setQuery] = useState(''),
    [draftDirty, setDraftDirty] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [captureReply, setCaptureReply] = useState<ChatMessage | null>(null),
    [captureQuote, setCaptureQuote] = useState('');
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  function persistSession(id: string, patch: unknown): Promise<ChatSession> {
    const next = saveQueue.current
      .catch(() => {})
      .then(() => api<ChatSession>(`/research-chat/sessions/${id}`, 'PATCH', patch))
      .then((s) => {
        setChat((c) => ({ ...c, sessions: c.sessions.map((x) => (x.id === s.id ? s : x)) }));
        return s;
      });
    saveQueue.current = next;
    return next;
  }
  const messages = chat.messages.filter((m) => m.sessionId === sessionId),
    candidates = notebook.candidates.filter((c) => c.sessionId === sessionId),
    selected = notebook.candidates.find((c) => c.id === candidateId),
    reply = messages.find((m) => m.id === replyId),
    goal = program.goals.find((g) => g.id === goalId),
    replies = messages.filter((m) => m.role === 'assistant');
  const currentAdvances = candidates.filter(
      (c) => c.decision === 'Advance' && c.integratedNodeId && !c.stale,
    ),
    useful = candidates.filter(
      (c) => c.decision === 'Useful partial result' && c.integratedNodeId && !c.stale,
    ),
    pending = candidates.filter((c) => c.decision === 'Unreviewed' || c.stale);
  function choose(s: ChatSession, all: ChatMessage[]) {
    setSessionId(s.id);
    setNodeIds([]);
    setGoalId(s.goalId === null ? '' : (s.goalId ?? program.goals[0]?.id ?? ''));
    setCriterion(s.progressCriterion ?? '');
    setPrompt(s.draft ?? '');
    setNotes(s.scratchpad ?? '');
    setDraftDirty(false);
    setSaved('');
    setCandidateId('');
    setReplyId(all.filter((m) => m.sessionId === s.id && m.role === 'assistant').at(-1)?.id ?? '');
    setTurnReason('');
  }
  async function reload() {
    const [c, n] = await Promise.all([
      api<ChatState>('/research-chat/state'),
      api<NotebookState>('/notebook/state'),
    ]);
    setChat(c);
    setNotebook(n);
    return c;
  }
  useEffect(() => {
    let active = true;
    Promise.all([api<ChatState>('/research-chat/state'), api<NotebookState>('/notebook/state')])
      .then(([c, n]) => {
        if (!active) return;
        setChat(c);
        setNotebook(n);
        if (c.sessions[0]) choose(c.sessions[0], c.messages);
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
    if (initialPrompt !== undefined && !loading) {
      setPrompt(initialPrompt);
      setDraftDirty(true);
      if (initialGoalId) setGoalId(initialGoalId);
      if (initialNodeIds) setNodeIds(initialNodeIds);
      onPromptConsumed?.();
    }
  }, [initialPrompt, loading]);
  useEffect(() => {
    if (!draftDirty || !sessionId || busy) return;
    setSaved('Saving draft…');
    const timer = setTimeout(() => {
      persistSession(sessionId, { draft: prompt })
        .then((s) => {
          setChat((c) => ({ ...c, sessions: c.sessions.map((x) => (x.id === s.id ? s : x)) }));
          setSaved('Draft saved');
        })
        .catch(() => setSaved('Draft not saved — keep this page open and retry.'));
    }, 1200);
    return () => clearTimeout(timer);
  }, [prompt, sessionId, draftDirty, busy]);
  async function act(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await saveQueue.current.catch(() => {});
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function newSession() {
    await act(async () => {
      if (sessionId)
        await persistSession(sessionId, {
          draft: prompt,
          scratchpad: notes,
          goalId: goalId || null,
          progressCriterion: criterion,
        });
      let s = await api<ChatSession>('/research-chat/sessions', 'POST', {});
      if (!sessionId)
        s = await persistSession(s.id, {
          draft: prompt,
          scratchpad: notes,
          goalId: goalId || null,
          progressCriterion: criterion,
        });
      setChat((c) => ({ ...c, sessions: [s, ...c.sessions] }));
      choose(s, []);
    });
  }
  async function saveContext() {
    if (!sessionId) return;
    await act(async () => {
      const s = await persistSession(sessionId, {
        goalId: goalId || null,
        progressCriterion: criterion,
        scratchpad: notes,
        draft: prompt,
      });
      setChat((c) => ({ ...c, sessions: c.sessions.map((x) => (x.id === s.id ? s : x)) }));
      setDraftDirty(false);
      setSaved('Session notes saved');
    });
  }
  async function send() {
    if (!sessionId || !prompt.trim() || !chat.connection.configured) return;
    await act(async () => {
      await persistSession(sessionId, {
        goalId: goalId || null,
        progressCriterion: criterion,
        draft: prompt,
      });
      const result = await api<{ assistantMessage: ChatMessage }>(
        `/research-chat/sessions/${sessionId}/messages`,
        'POST',
        {
          content: prompt,
          mode,
          goalId: goalId || null,
          progressCriterion: criterion,
          contextNodeIds: nodeIds,
          notebook: true,
        },
      );
      setPrompt('');
      setDraftDirty(false);
      setReplyId(result.assistantMessage.id);
      setCandidateId('');
      setView('notebook');
      await persistSession(sessionId, { draft: '' });
      await reload();
      if (result.assistantMessage.error) setError(result.assistantMessage.error);
    });
  }
  function capture(m: ChatMessage) {
    const selection = window.getSelection()?.toString().trim();
    setCaptureQuote(
      selection && m.content.includes(selection)
        ? selection.slice(0, 6000)
        : m.content.length <= 6000
          ? m.content
          : '',
    );
    setCaptureReply(m);
  }
  async function saveCapture() {
    if (!captureReply) return;
    const m = captureReply,
      quote = captureQuote.trim();
    await act(async () => {
      const c = await api<Candidate>(`/notebook/messages/${m.id}/candidates`, 'POST', {
        title: plain(quote, 100) || 'Candidate result',
        kind: 'Claim',
        classification: 'Unassessed',
        statement: quote,
        sourceQuote: quote,
        baseline: m.targetSnapshot?.baseline ?? '',
        gain: '',
        mechanism: '',
        evidence: '',
        gap: '',
        nextCheck: '',
        relatedNodeIds: [],
      });
      await reload();
      setCandidateId(c.id);
      setReplyId(m.id);
      setCaptureReply(null);
    });
  }
  function focusReply(id: string) {
    setReplyId(id);
    setView('notebook');
    setTimeout(
      () =>
        document
          .getElementById(`nb-${id}`)
          ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
      30,
    );
  }
  function followup(text: string) {
    setPrompt(text);
    setMode('audit');
    setDraftDirty(true);
    setView('notebook');
    setTimeout(() => promptRef.current?.focus(), 30);
    notify('Follow-up drafted. Review it before sending.');
  }
  const outcome = (m: ChatMessage) => {
    const items = candidates.filter((c) => c.messageId === m.id);
    if (m.error) return 'Reply failed';
    if (m.provider === 'local') return 'Worksheet · no GPT call';
    const count = items.filter(
      (c) => c.decision === 'Advance' && c.integratedNodeId && !c.stale,
    ).length;
    if (count) return `${count} accepted advance${count === 1 ? '' : 's'} in project`;
    if (items.some((c) => c.stale)) return 'Context changed · re-review';
    if (m.turnReview && m.turnReview.decision !== 'Open') return m.turnReview.decision;
    if (!items.length) return 'No extracted result · review needed';
    if (items.every((c) => c.decision === 'Rejected' || c.decision === 'Reformulation'))
      return 'No accepted advance';
    return `${items.filter((c) => c.decision === 'Unreviewed').length} awaiting review · ${items.filter((c) => c.decision !== 'Unreviewed').length} reviewed`;
  };
  if (loading) return <div className="nb-empty">Loading your research notebook…</div>;
  return (
    <div className="workbench">
      <header className="workbench-heading">
        <div>
          <span className="eyebrow">RESEARCH NOTEBOOK</span>
          <h1>Work through the problem.</h1>
          <p>Keep the conversation. Inspect the gain. Decide what changes.</p>
        </div>
        <button className="button secondary" onClick={() => setConnectionOpen(true)}>
          <Settings2 size={14} />
          {chat.connection.configured ? chat.connection.model : 'Connect GPT'}
        </button>
      </header>
      <div className="nb-toolbar">
        <select
          aria-label="Research session"
          value={sessionId}
          disabled={busy}
          onChange={(e) => {
            const s = chat.sessions.find((s) => s.id === e.target.value);
            if (s)
              void act(async () => {
                if (sessionId)
                  await persistSession(sessionId, {
                    draft: prompt,
                    scratchpad: notes,
                    goalId: goalId || null,
                    progressCriterion: criterion,
                  });
                choose(s, chat.messages);
              });
          }}
        >
          <option value="" disabled>
            Choose a research session
          </option>
          {chat.sessions.map((s) => (
            <option value={s.id} key={s.id}>
              {s.title}
            </option>
          ))}
        </select>
        <button className="button secondary" disabled={busy} onClick={newSession}>
          <Plus size={14} /> New session
        </button>
        <button className="button secondary" disabled={busy} onClick={() => setImportOpen(true)}>
          <Upload size={14} /> Import conversation
        </button>
        <span className="workbench-private">Private notebook</span>
      </div>
      {error && (
        <div className="nb-error" role="alert">
          {error}
          <button
            className="text-button"
            disabled={busy}
            onClick={() =>
              act(async () => {
                await reload();
              })
            }
          >
            Reload saved work
          </button>
        </div>
      )}
      <section className="nb-target">
        <label>
          <Target size={14} /> Working toward
          <select value={goalId} disabled={busy} onChange={(e) => setGoalId(e.target.value)}>
            <option value="">Choose a goal</option>
            {program.goals.map((g) => (
              <option key={g.id} value={g.id}>
                {plain(g.title, 150)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Progress this turn would mean…
          <input
            value={criterion}
            maxLength={3000}
            disabled={busy}
            onChange={(e) => setCriterion(e.target.value)}
            placeholder="Remove an assumption, resolve a gap, or find a counterexample"
          />
        </label>
        <button className="text-button" disabled={busy || !sessionId} onClick={saveContext}>
          Save context
        </button>
      </section>
      {goal && (
        <details className="nb-target-details">
          <summary>Target, baseline, and current obligations</summary>
          <div className="nb-target-grid">
            <div>
              <small>EXACT TARGET</small>
              <ResearchText>{goal.statement}</ResearchText>
            </div>
            <div>
              <small>KNOWN BASELINE</small>
              <ResearchText>
                {goal.baseline || 'Record a baseline in the Research Program.'}
              </ResearchText>
            </div>
            <div>
              <small>SUCCESS CRITERION</small>
              <ResearchText>{goal.successCriteria || 'Not specified.'}</ResearchText>
              <small>NEXT OBLIGATION</small>
              <ResearchText>{goal.nextAction || 'Choose a falsifiable next step.'}</ResearchText>
            </div>
          </div>
        </details>
      )}
      <div className="nb-summary">
        <span>
          <b>{currentAdvances.length}</b> accepted advances in project
        </span>
        <span>
          <b>{useful.length}</b> useful partial results in project
        </span>
        <span>
          <b>{pending.length}</b> candidates awaiting review
        </span>
        <span>Researcher judgments · not proof certificates</span>
      </div>
      <div className="nb-view-tabs">
        <button className={view === 'notebook' ? 'active' : ''} onClick={() => setView('notebook')}>
          <BookOpen size={15} /> Notebook
        </button>
        <button className={view === 'sheet' ? 'active' : ''} onClick={() => setView('sheet')}>
          <Table2 size={15} /> Session review <span>{replies.length}</span>
        </button>
        <label>
          <Search size={14} />
          <input
            placeholder="Find in this session"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      <div className="nb-workspace">
        <div className="nb-main">
          {view === 'sheet' ? (
            <div className="nb-sheet">
              <table>
                <thead>
                  <tr>
                    <th>Prompt / attempt</th>
                    <th>What came out</th>
                    <th>Research judgment</th>
                    <th>Project effect</th>
                  </tr>
                </thead>
                <tbody>
                  {messages
                    .filter((m) => m.role === 'user')
                    .map((p, i) => {
                      const following = messages.slice(messages.indexOf(p) + 1);
                      const r =
                        replies.find((r) => r.replyToId === p.id) ||
                        (following[0]?.role === 'assistant' ? following[0] : undefined);
                      const cs = r ? candidates.filter((c) => c.messageId === r.id) : [];
                      if (
                        query &&
                        !`${p.content} ${r?.content ?? ''}`
                          .toLowerCase()
                          .includes(query.toLowerCase())
                      )
                        return null;
                      return (
                        <tr key={p.id} onClick={() => r && focusReply(r.id)}>
                          <td>
                            <small>
                              {String(i + 1).padStart(2, '0')} · {time(p.createdAt)}
                            </small>
                            <strong>{plain(p.content, 170)}</strong>
                            <span>{p.progressCriterion || 'No explicit progress criterion'}</span>
                          </td>
                          <td>
                            {cs.length
                              ? cs.map((c) => (
                                  <button
                                    key={c.id}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setCandidateId(c.id);
                                      setReplyId(c.messageId);
                                    }}
                                  >
                                    {plain(c.title, 95)}
                                    <ChevronRight size={12} />
                                  </button>
                                ))
                              : 'No candidate recorded'}
                          </td>
                          <td>{r ? outcome(r) : 'Prompt saved · no reply yet'}</td>
                          <td>
                            {cs.some((c) => c.integratedNodeId)
                              ? cs
                                  .filter((c) => c.integratedNodeId)
                                  .map((c) => (
                                    <p key={c.id}>
                                      {c.stale ? 'Needs re-review' : 'Added unverified result'}:{' '}
                                      {plain(c.title, 70)}
                                    </p>
                                  ))
                              : 'Project unchanged'}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
              {!messages.some((m) => m.role === 'user') && (
                <p className="nb-empty">
                  Your prompts will appear here with their results and reviewed effect. Imported
                  replies without a labeled prompt remain in the notebook.
                </p>
              )}
              <p className="nb-caption">
                Only explicitly reviewed, integrated, current results enter the counts above. A
                useful partial result is separate from a nontrivial advance.
              </p>
            </div>
          ) : (
            <div className="nb-messages">
              {!messages.length && (
                <div className="nb-empty">
                  <BookOpen size={28} />
                  <h2>Start with one precise obstacle.</h2>
                  <p>
                    Choose a goal and say what would count as progress. Each reply can yield
                    independent candidates; inspect their gain before changing the project.
                  </p>
                  <button
                    className="button secondary"
                    onClick={() => {
                      setPrompt(
                        'For the selected goal, isolate the first unresolved mathematical step. Compare the exact target with the known baseline. Propose one strictly weaker, useful intermediate statement and explain why it is not equivalent to the original problem. State the remaining proof obligations.',
                      );
                      setDraftDirty(true);
                    }}
                  >
                    Draft a first investigation
                  </button>
                </div>
              )}
              {messages
                .filter((m) => !query || m.content.toLowerCase().includes(query.toLowerCase()))
                .map((m) => (
                  <article
                    id={`nb-${m.id}`}
                    className={`nb-message ${m.role} ${m.id === replyId ? 'selected' : ''}`}
                    key={m.id}
                    onClick={(e) => {
                      if (m.role === 'assistant' && !(e.target as HTMLElement).closest('button')) {
                        setReplyId(m.id);
                        setCandidateId('');
                      }
                    }}
                  >
                    <div className="nb-message-meta">
                      <strong>
                        {m.role === 'user'
                          ? 'Your prompt'
                          : m.provider === 'imported'
                            ? 'Imported reply'
                            : m.provider === 'local'
                              ? 'Planning worksheet'
                              : 'GPT response'}
                      </strong>
                      <span>
                        {m.model ?? ''} · {time(m.createdAt)}
                      </span>
                      {m.role === 'assistant' && <span className="nb-outcome">{outcome(m)}</span>}
                    </div>
                    {m.progressCriterion && m.role === 'user' && (
                      <div className="nb-criterion">
                        <b>Progress would mean:</b>{' '}
                        <ResearchText inline>{m.progressCriterion}</ResearchText>
                      </div>
                    )}
                    <ResearchText className="nb-message-content">{m.content}</ResearchText>
                    {onProposeSource && (
                      <div className="nb-message-actions">
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() =>
                            act(async () => {
                              if (m.role === 'assistant' && m.researchRunId) {
                                const engine = await api<EngineData>('/engine/state');
                                const source = engine.sources.find(
                                  (s) => s.id === `chat-output:${m.id}`,
                                );
                                if (source) {
                                  onProposeSource(source.id);
                                  return;
                                }
                                throw new Error(
                                  'The recorded run output is not yet available as an immutable source. Reload this project and retry.',
                                );
                              }
                              const source = await api<SourceArtifact>('/engine/sources', 'POST', {
                                kind: m.role === 'user' ? 'human_note' : 'model_response',
                                text: m.content,
                                attribution:
                                  m.role === 'user'
                                    ? 'Researcher; notebook prompt'
                                    : `${m.provider ?? 'Assistant'} / ${m.model ?? 'not supplied'}; visible notebook reply`,
                              });
                              onProposeSource(source.id);
                            })
                          }
                        >
                          <GitBranch size={13} /> Propose research change
                        </button>
                      </div>
                    )}
                    {m.role === 'assistant' && !m.error && m.provider !== 'local' && (
                      <>
                        <div className="nb-message-actions">
                          <button
                            className="text-button"
                            disabled={busy}
                            onClick={() => capture(m)}
                          >
                            <Plus size={13} /> Capture selected passage
                          </button>
                          <button
                            className="text-button"
                            disabled={busy || !chat.connection.configured}
                            onClick={() =>
                              act(async () => {
                                const r = await api<{ note: string }>(
                                  `/notebook/messages/${m.id}/analyze`,
                                  'POST',
                                  {},
                                );
                                await reload();
                                setReplyId(m.id);
                                notify(r.note);
                              })
                            }
                          >
                            Extract / audit results with GPT
                          </button>
                        </div>
                        {m.extractionNote && <p className="nb-caption">{m.extractionNote}</p>}
                        {m.context.truncated && (
                          <p className="nb-caption">
                            Context was bounded: recent exchanges and selected research were
                            included, not the full historical transcript.
                          </p>
                        )}
                        <div className="nb-result-strip">
                          {candidates
                            .filter((c) => c.messageId === m.id)
                            .map((c) => (
                              <button
                                className={candidateId === c.id ? 'active' : ''}
                                key={c.id}
                                onClick={() => {
                                  setCandidateId(c.id);
                                  setReplyId(m.id);
                                }}
                              >
                                <small>
                                  {c.kind} · {c.stale ? 'Re-review needed' : c.decision}
                                </small>
                                <ResearchText inline>{c.title}</ResearchText>
                                <ChevronRight size={14} />
                              </button>
                            ))}
                        </div>
                      </>
                    )}
                  </article>
                ))}
              {busy && (
                <div className="nb-working" role="status">
                  <LoaderCircle size={16} /> Working… saved prompts and results remain in the
                  notebook.
                </div>
              )}
            </div>
          )}
          <div className="nb-composer">
            <div className="nb-composer-top">
              <select
                aria-label="Research mode"
                value={mode}
                onChange={(e) => setMode(e.target.value as ChatMode)}
                disabled={busy}
              >
                <option value="explore">Explore a step</option>
                <option value="attack">Develop an attack</option>
                <option value="audit">Challenge / verify</option>
              </select>
              <details>
                <summary>Context · {nodeIds.length || 'goal defaults'}</summary>
                <div className="nb-context-list">
                  {state.nodes.map((n) => (
                    <label key={n.id} className="nb-checkbox">
                      <input
                        type="checkbox"
                        checked={nodeIds.includes(n.id)}
                        disabled={busy}
                        onChange={(e) =>
                          setNodeIds((ids) =>
                            e.target.checked
                              ? [...ids, n.id].slice(0, 12)
                              : ids.filter((id) => id !== n.id),
                          )
                        }
                      />
                      {plain(n.title, 100)}
                    </label>
                  ))}
                </div>
              </details>
              <span>{saved}</span>
            </div>
            <textarea
              ref={promptRef}
              aria-label="Research prompt"
              value={prompt}
              maxLength={30000}
              rows={5}
              disabled={busy}
              placeholder="Ask for a concrete derivation, test a conjecture, or challenge the previous step…"
              onChange={(e) => {
                setPrompt(e.target.value);
                setDraftDirty(true);
              }}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <div className="nb-composer-bottom">
              <span>
                {!sessionId
                  ? 'Create a session to save prompts.'
                  : !chat.connection.configured
                    ? 'Connect GPT to send, or import a conversation and review it manually.'
                    : 'Includes the goal, focused research, recent exchanges, and recorded candidate decisions.'}
              </span>
              <button
                className="button primary"
                disabled={busy || !prompt.trim() || !sessionId || !chat.connection.configured}
                onClick={send}
              >
                <Send size={14} /> Send to GPT
              </button>
            </div>
          </div>
          <details className="nb-scratchpad">
            <summary>Session notes · private</summary>
            <MathEditor label="Working notes" value={notes} onChange={setNotes} rows={6} />
            <button
              className="button secondary"
              disabled={busy || !sessionId}
              onClick={saveContext}
            >
              Save notes
            </button>
          </details>
        </div>
        <aside className="nb-review-panel">
          {selected ? (
            <NotebookReview
              key={`${selected.id}:${selected.revision}`}
              candidate={selected}
              state={state}
              busy={busy}
              onSave={(body) =>
                act(async () => {
                  await api(`/notebook/candidates/${selected.id}`, 'PATCH', body);
                  await reload();
                  notify('Review saved privately. The project has not changed.');
                })
              }
              onIntegrate={() =>
                act(async () => {
                  await api(`/notebook/candidates/${selected.id}/integrate`, 'POST', {
                    revision: selected.revision,
                    admitToProject: true,
                  });
                  await reload();
                  await onRefresh();
                  notify('Reviewed result added to the project as unverified.');
                })
              }
              onCheck={followup}
              onSelect={onSelect}
              onSource={() => focusReply(selected.messageId)}
            />
          ) : (
            <div className="nb-review-empty">
              <span className="eyebrow">WHAT DID THIS STEP BUY?</span>
              <h2>{reply ? 'Review this reply' : 'Choose a result to inspect'}</h2>
              <p>
                Separate the mathematical statement from its presentation. A promising argument is a
                candidate until you review it.
              </p>
              {reply && (
                <>
                  <p className="nb-outcome">{outcome(reply)}</p>
                  {candidates
                    .filter((c) => c.messageId === reply.id)
                    .map((c) => (
                      <button
                        className="nb-candidate-link"
                        key={c.id}
                        onClick={() => setCandidateId(c.id)}
                      >
                        <ResearchText inline>{c.title}</ResearchText>
                        <ChevronRight size={14} />
                      </button>
                    ))}
                  {!reply.error && reply.provider !== 'local' && (
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => capture(reply)}
                    >
                      Capture a candidate manually
                    </button>
                  )}
                  <details>
                    <summary>Record a turn with no new result</summary>
                    <label>
                      Your reason
                      <textarea
                        value={turnReason}
                        maxLength={8000}
                        rows={4}
                        placeholder="Explain why the reply did not remove a mathematical obligation."
                        onChange={(e) => setTurnReason(e.target.value)}
                      />
                    </label>
                    <button
                      className="button secondary"
                      disabled={busy || turnReason.trim().length < 15}
                      onClick={() =>
                        act(async () => {
                          await api(`/notebook/messages/${reply.id}/review`, 'POST', {
                            decision: 'No new result',
                            reason: turnReason,
                          });
                          await reload();
                          setTurnReason('');
                        })
                      }
                    >
                      Record no new result
                    </button>
                  </details>
                  {reply.turnReview && <ResearchText>{reply.turnReview.reason}</ResearchText>}
                </>
              )}
              <ol>
                <li>What was known before?</li>
                <li>Which assumption, bound, or obstacle changed?</li>
                <li>What makes the step nontrivial?</li>
                <li>What evidence supports it?</li>
                <li>What remains unproved?</li>
              </ol>
              <p className="nb-caption">
                GPT can propose and critique these comparisons. It cannot certify mathematical
                correctness or originality.
              </p>
            </div>
          )}
        </aside>
      </div>
      {connectionOpen && (
        <ConnectionDialog
          connection={chat.connection}
          onClose={() => setConnectionOpen(false)}
          onChange={(connection) => {
            setChat((c) => ({ ...c, connection }));
            void onRefresh();
          }}
          notify={notify}
        />
      )}
      {importOpen && (
        <NotebookImport
          program={program}
          busy={busy}
          onClose={() => setImportOpen(false)}
          onImport={(body) =>
            act(async () => {
              if (sessionId)
                await persistSession(sessionId, {
                  draft: prompt,
                  scratchpad: notes,
                  goalId: goalId || null,
                  progressCriterion: criterion,
                });
              const s = await api<ChatSession>('/notebook/import', 'POST', body);
              const c = await reload();
              choose(s, c.messages);
              setImportOpen(false);
              notify(
                'Conversation imported privately. Select a reply to extract or capture its results.',
              );
            })
          }
        />
      )}
      {captureReply && (
        <Modal
          title="Capture one result from this reply"
          onClose={() => !busy && setCaptureReply(null)}
        >
          <div className="nb-import">
            <p>
              Select the exact passage you want to review. Preserve the LaTeX source so its
              mathematical meaning and provenance remain inspectable.
            </p>
            <details>
              <summary>Original reply · copy a passage</summary>
              <textarea
                aria-label="Original reply source"
                value={captureReply.content}
                readOnly
                rows={12}
              />
            </details>
            <label>
              Exact source passage
              <textarea
                value={captureQuote}
                onChange={(e) => setCaptureQuote(e.target.value)}
                maxLength={6000}
                rows={9}
              />
            </label>
            <ResearchText>{captureQuote}</ResearchText>
            {captureQuote.trim() && !captureReply.content.includes(captureQuote.trim()) && (
              <p role="alert">Copy an exact passage from the original reply.</p>
            )}
            <button
              className="button primary"
              disabled={
                busy ||
                captureQuote.trim().length < 3 ||
                !captureReply.content.includes(captureQuote.trim())
              }
              onClick={saveCapture}
            >
              Create private candidate
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
