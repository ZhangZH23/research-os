import { ContributionSummary } from './ContributionEditor';
import type { ContributionAssessment } from '../shared/program';
import HistoryMathematics from './HistoryMathematics';
import ResearchText from './ResearchText';
import { researchTextLabel } from '../shared/math';
import MathEditor from './MathEditor';
import { useState, useEffect } from 'react';
import {
  X,
  Pencil,
  Trash2,
  ShieldQuestion,
  GitBranch,
  Plus,
  Check,
  CircleX,
  AlertTriangle,
  ExternalLink,
  Bot,
  UserRound,
  History,
  Maximize2,
  Minimize2,
  Code2,
  BookOpen,
} from 'lucide-react';
import type { ResearchNode, ResearchState, NodeInput, EdgeInput, Status } from '../shared/types';
import { STATUSES } from '../shared/types';
import { belief } from '../shared/epistemics';
import { Badge, TypeIcon, Modal, timeLabel } from './ui';
import { useProjectApi } from './ProjectScope';
export default function Inspector({
  id,
  state,
  onClose,
  onSelect,
  onEdit,
  onAdd,
  onEdge,
  onRefresh,
  notify,
  assessment,
  onAssess,
  onDiscuss,
}: {
  id: string;
  state: ResearchState;
  onClose: () => void;
  onSelect: (id: string) => void;
  onEdit: (n: ResearchNode) => void;
  onAdd: (preset: Partial<NodeInput>, link?: Partial<EdgeInput>) => void;
  onEdge: (preset: Partial<EdgeInput>) => void;
  onRefresh: () => Promise<void>;
  notify: (s: string) => void;
  assessment?: ContributionAssessment;
  onAssess: () => void;
  onDiscuss: () => void;
}) {
  const api = useProjectApi();
  const [tab, setTab] = useState<'details' | 'belief' | 'history'>('details');
  const [expanded, setExpanded] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [reason, setReason] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setTab('details');
    setShowSource(false);
    setError('');
  }, [id]);
  const node = state.nodes.find((n) => n.id === id);
  if (!node) return null;
  const info = belief(id, state.nodes, state.edges);
  const history = state.events
    .filter((e) => e.nodeId === id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const nodeList = (title: string, list: ResearchNode[], empty: string) => (
    <section className="detail-section">
      <h3>
        {title}
        <span>{list.length}</span>
      </h3>
      {list.length ? (
        list.map((n) => (
          <button key={n.id} className="related-node" onClick={() => onSelect(n.id)}>
            <div>
              <TypeIcon type={n.type} />
              <strong>
                <ResearchText inline>{n.title}</ResearchText>
              </strong>
            </div>
            <Badge status={n.epistemicStatus} />
            <small className="related-origin">
              {n.originType} · {n.humanVerified ? 'Human-verified' : 'Not human-verified'}
            </small>
          </button>
        ))
      ) : (
        <p className="muted small">{empty}</p>
      )}
    </section>
  );
  async function changeStatus() {
    if (!node) return;
    setBusy(true);
    setError('');
    try {
      await api(`/nodes/${id}`, 'PATCH', { epistemicStatus: status, reason });
      await onRefresh();
      setStatus(null);
      setReason('');
      notify('Status changed · history preserved');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      await api(`/nodes/${id}`, 'DELETE', {});
      await onRefresh();
      onClose();
      notify('Item deleted · audit history retained');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="inspector-shade" onClick={onClose} />
      <aside
        className={`inspector ${expanded ? 'inspector-expanded' : ''}`}
        aria-label="Research item inspector"
      >
        <div className="inspector-top">
          <span>
            <TypeIcon type={node.type} />
            {node.type}
          </span>
          <div>
            <button
              className="icon-button"
              title={expanded ? 'Collapse reading view' : 'Expand reading view'}
              aria-label={expanded ? 'Collapse reading view' : 'Expand reading view'}
              aria-pressed={expanded}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
            </button>
            <button
              data-owner-control
              className="icon-button"
              title="Edit item"
              aria-label="Edit item"
              onClick={() => onEdit(node)}
            >
              <Pencil size={17} />
            </button>
            <button
              data-owner-control
              className="icon-button"
              title="Delete item"
              aria-label="Delete item"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 size={17} />
            </button>
            <button className="icon-button" aria-label="Close inspector" onClick={onClose}>
              <X size={21} />
            </button>
          </div>
        </div>
        <div className="inspector-title">
          <span className="eyebrow">RESEARCH ITEM · {node.id.slice(0, 8)}</span>
          <h2>
            <ResearchText inline>{node.title}</ResearchText>
          </h2>
          <div className="status-line">
            <Badge status={node.epistemicStatus} />
            <span className="small muted">{Math.round(node.confidence * 100)}% confidence</span>
          </div>
          <ResearchText className="research-summary">{node.summary}</ResearchText>
          <button
            className={`belief-button ${tab === 'belief' ? 'selected' : ''}`}
            onClick={() => setTab('belief')}
          >
            <ShieldQuestion size={19} />
            Why do we believe this?
          </button>
          <button
            data-owner-control
            className="button secondary inspector-research-chat"
            onClick={onDiscuss}
          >
            <Bot size={16} /> Work on this in research chat
          </button>
        </div>
        <div className="detail-tabs">
          {(['details', 'belief', 'history'] as const).map((t) => (
            <button
              hidden={!state.canEdit && t === 'history'}
              key={t}
              className={tab === t ? 'active' : ''}
              onClick={() => setTab(t)}
            >
              {t === 'belief' ? 'Belief audit' : t === 'history' ? 'History' : 'Details'}
              {t === 'history' && <span>{history.length}</span>}
            </button>
          ))}
        </div>
        <div className="inspector-content">
          {info.warnings.length > 0 && (
            <div className="warning-stack">
              {info.warnings.map((w) => (
                <div className="warning" key={w}>
                  <AlertTriangle size={16} />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}
          {tab === 'details' && (
            <>
              <section className="detail-section">
                <div className="argument-heading">
                  <h3>Argument &amp; context</h3>
                  <button
                    className="text-button"
                    aria-pressed={showSource}
                    onClick={() => setShowSource(!showSource)}
                  >
                    {showSource ? <BookOpen size={14} /> : <Code2 size={14} />}{' '}
                    {showSource ? 'Read mathematics' : 'View LaTeX source'}
                  </button>
                </div>
                {showSource ? (
                  <pre className="math-source">
                    <code>{node.content || 'No full argument recorded yet.'}</code>
                  </pre>
                ) : (
                  <ResearchText className="prose research-argument">
                    {node.content || 'No full argument recorded yet.'}
                  </ResearchText>
                )}
              </section>
              <section className="detail-section">
                <ContributionSummary assessment={assessment} onReview={onAssess} />
                <h3 data-owner-control>Actions</h3>
                <div data-owner-control className="action-grid">
                  <button
                    data-owner-control
                    onClick={() => {
                      setStatus(node.epistemicStatus);
                      setError('');
                    }}
                  >
                    Change status
                  </button>
                  <button
                    data-owner-control
                    onClick={() =>
                      onAdd({ type: 'Evidence' }, { targetNodeId: id, edgeType: 'supports' })
                    }
                  >
                    <Plus size={14} />
                    Add evidence
                  </button>
                  <button
                    data-owner-control
                    onClick={() => onEdge({ sourceNodeId: id, edgeType: 'depends_on' })}
                  >
                    <GitBranch size={14} />
                    Add dependency
                  </button>
                  <button
                    data-owner-control
                    onClick={() =>
                      onAdd(
                        { type: 'Counterexample' },
                        { targetNodeId: id, edgeType: 'contradicts' },
                      )
                    }
                  >
                    Add contradiction
                  </button>
                  <button data-owner-control onClick={() => setStatus('Proved')}>
                    <Check size={14} />
                    Mark proved
                  </button>
                  <button data-owner-control onClick={() => setStatus('Disproved')}>
                    <CircleX size={14} />
                    Mark disproved
                  </button>
                  <button
                    data-owner-control
                    onClick={() =>
                      onAdd({ type: 'Note' }, { targetNodeId: id, edgeType: 'related_to' })
                    }
                  >
                    <Plus size={14} />
                    Add note
                  </button>
                </div>
              </section>
              {nodeList('Dependencies', info.dependencies, 'No direct dependencies recorded.')}
              <section className="detail-section">
                <h3>
                  Relationships<span>{info.incoming.length + info.outgoing.length}</span>
                </h3>
                {[...info.outgoing, ...info.incoming].map((e) => {
                  const out = e.sourceNodeId === id;
                  const related = state.nodes.find(
                    (n) => n.id === (out ? e.targetNodeId : e.sourceNodeId),
                  );
                  return (
                    <div className="relationship" key={e.id}>
                      <button onClick={() => related && onSelect(related.id)}>
                        <span className="eyebrow">
                          {out ? 'OUTGOING' : 'INCOMING'} · {e.edgeType.replaceAll('_', ' ')}
                        </span>
                        <strong>
                          <ResearchText inline>{related?.title ?? ''}</ResearchText>
                        </strong>
                        <small>
                          <ResearchText inline>{e.explanation}</ResearchText>
                        </small>
                      </button>
                      <button
                        data-owner-control
                        className="icon-button"
                        aria-label={`Remove relationship to ${researchTextLabel(related?.title ?? '')}`}
                        onClick={async () => {
                          try {
                            await api(`/edges/${e.id}`, 'DELETE', {});
                            await onRefresh();
                            notify('Relationship removed');
                          } catch (e) {
                            notify((e as Error).message);
                          }
                        }}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  );
                })}
                {!info.incoming.length && !info.outgoing.length && (
                  <p className="muted small">No relationships yet.</p>
                )}
              </section>
            </>
          )}
          {tab === 'belief' && (
            <>
              <div
                className={`verification ${info.allDependenciesVerified ? 'verified' : 'unresolved'}`}
              >
                <ShieldQuestion size={20} />
                <div>
                  <strong>
                    {info.allDependenciesVerified
                      ? 'No unresolved recorded dependencies'
                      : 'The argument has unresolved dependencies'}
                  </strong>
                  <p>
                    {info.dependencies.length === 0
                      ? 'No prerequisites have been recorded. Absence of dependencies is not proof.'
                      : `${info.unresolved.length} unresolved items across the full dependency chain.`}
                  </p>
                </div>
              </div>
              {nodeList(
                'Supporting evidence & arguments',
                info.support,
                'No supporting evidence recorded.',
              )}
              {nodeList(
                'Direct dependencies',
                info.dependencies,
                'No direct dependencies recorded.',
              )}
              {nodeList(
                'Unresolved assumptions · full chain',
                info.unresolved,
                'All recorded prerequisites are proved and human-verified, unless a cycle warning appears above.',
              )}
              {nodeList(
                'Related experiments',
                info.experiments,
                'No experiments linked. A test relationship alone does not imply support.',
              )}
              {nodeList(
                'Counterevidence',
                info.counterevidence,
                'No counterevidence recorded. This does not establish correctness.',
              )}
            </>
          )}
          {tab === 'history' && (
            <section className="detail-section">
              <h3>
                <History size={16} />
                Event history
              </h3>
              <div className="timeline">
                {history.map((e) => {
                  const prev = e.previousValue ? JSON.parse(e.previousValue) : null;
                  const next = e.newValue ? JSON.parse(e.newValue) : null;
                  return (
                    <article key={e.id}>
                      <span className="timeline-dot" />
                      <span className="eyebrow">{timeLabel(e.createdAt)}</span>
                      <strong>{e.eventType.replaceAll('_', ' ')}</strong>
                      {e.eventType === 'status_changed' && (
                        <div className="history-status">
                          <Badge status={prev.epistemicStatus} />
                          <span>→</span>
                          <Badge status={next.epistemicStatus} />
                        </div>
                      )}
                      <ResearchText className="research-summary">{e.reason}</ResearchText>
                      <HistoryMathematics before={prev} after={next} />
                      <details>
                        <summary>Inspect stored event</summary>
                        <pre>{JSON.stringify({ before: prev, after: next }, null, 2)}</pre>
                      </details>
                    </article>
                  );
                })}
              </div>
            </section>
          )}
          <section className="detail-section provenance">
            <h3>Provenance</h3>
            <div className="origin-line">
              {node.originType.startsWith('AI') ? <Bot size={17} /> : <UserRound size={17} />}
              <strong>{node.originType}</strong>
              <span>{node.originName}</span>
            </div>
            <ResearchText className="prose small">
              {node.provenanceText || 'No additional provenance recorded.'}
            </ResearchText>
            <div className="review-state">
              {node.humanVerified ? (
                <>
                  <Check size={15} />
                  Human-verified
                </>
              ) : (
                <>
                  <CircleX size={15} />
                  Not human-verified
                </>
              )}
            </div>
            <dl>
              <dt>Created</dt>
              <dd>{timeLabel(node.createdAt)}</dd>
              <dt>Updated</dt>
              <dd>{timeLabel(node.updatedAt)}</dd>
            </dl>
            {node.tags.length > 0 && (
              <div className="tags">
                {node.tags.map((t) => (
                  <span key={t}>#{t}</span>
                ))}
              </div>
            )}
            {node.links.map((link) =>
              /^https?:\/\//.test(link) ? (
                <a
                  className="external-link"
                  key={link}
                  href={link}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink size={14} />
                  {link}
                </a>
              ) : (
                <code className="file-path" key={link}>
                  {link}
                </code>
              ),
            )}
          </section>
        </div>
      </aside>
      {status && (
        <Modal title="Change epistemic status" onClose={() => setStatus(null)} wide>
          <div className="editor-form">
            <p className="muted">
              Status records your assessment. Proof and dependency warnings are evaluated
              separately.
            </p>
            <label>
              New status
              <select value={status} onChange={(e) => setStatus(e.target.value as Status)}>
                {STATUSES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <MathEditor label="Reason and evidence" rows={4} value={reason} onChange={setReason} />
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="modal-footer">
              <button
                data-owner-control
                className="button secondary"
                onClick={() => setStatus(null)}
              >
                Cancel
              </button>
              <button
                className="button primary"
                disabled={!reason.trim() || busy}
                onClick={changeStatus}
              >
                {busy ? 'Saving…' : 'Record status change'}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {confirmDelete && (
        <Modal title="Delete this research item?" onClose={() => setConfirmDelete(false)}>
          <div className="editor-form">
            <p>
              “<ResearchText inline>{node.title}</ResearchText>” and its relationships will be
              removed. Their snapshots remain in the activity log.
            </p>
            {error && <p className="error">{error}</p>}
            <div className="modal-footer">
              <button
                data-owner-control
                className="button secondary"
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </button>
              <button className="button danger" disabled={busy} onClick={remove}>
                Delete item
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
