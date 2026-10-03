import MathEditor, { MathGuide } from './MathEditor';
import ResearchText from './ResearchText';
import { researchTextLabel } from '../shared/math';
import { useEffect, useState } from 'react';
import { FileInput, Plus, ShieldCheck, Save, Check, Link2 } from 'lucide-react';
import {
  NODE_TYPES,
  EDGE_TYPES,
  type ResearchState,
  type IngestionDraft,
  type ReviewItem,
  type Proposal,
} from '../shared/types';
import { useProjectApi } from './ProjectScope';
import { Badge, dateLabel } from './ui';
const sample = `Conjecture: Collision constraints have full generic rank when evaluation sites are distinct. We have only checked the smallest field so far.\n\nExperiment: Enumerate repeated-site collision matrices over $\\mathbb{F}_5$ and compare their ranks with the distinct-site cases.\n\nFailed approach: Treat every collision equation as independent. This fails when sites coincide because the equations can be linearly dependent.\n\nOpen question: Which site patterns cause a rank defect?`;
export default function Ingest({
  state,
  onRefresh,
  notify,
  onSelect,
}: {
  state: ResearchState;
  onRefresh: () => Promise<void>;
  notify: (s: string) => void;
  onSelect: (id: string) => void;
}) {
  const api = useProjectApi();
  const [transcript, setTranscript] = useState('');
  const [sourceName, setSourceName] = useState('Research session');
  const [mode, setMode] = useState<'manual' | 'openai'>('manual');
  const [draft, setDraft] = useState<IngestionDraft | null>(null);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [edges, setEdges] = useState<Proposal['edges']>([]);
  const [drafts, setDrafts] = useState<IngestionDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    api<IngestionDraft[]>('/drafts')
      .then(setDrafts)
      .catch((e) => setError(e.message));
  }, []);
  function open(d: IngestionDraft) {
    setDraft(d);
    setItems(d.items.map((i) => ({ ...i, decision: (i as ReviewItem).decision || 'create' })));
    setEdges(d.edges);
    setTranscript(d.transcript);
    setSourceName(d.sourceName);
    setMode(d.mode);
    setError('');
  }
  async function extract() {
    setBusy(true);
    setError('');
    try {
      const d = await api<IngestionDraft>('/ingest/extract', 'POST', {
        transcript,
        sourceName,
        mode,
      });
      open(d);
      setDrafts([...drafts, d]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function update(index: number, patch: Partial<ReviewItem>) {
    setItems(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }
  async function save() {
    if (!draft) return;
    setBusy(true);
    setError('');
    try {
      await api(`/drafts/${draft.id}`, 'PUT', { items, edges });
      const updated = { ...draft, items, edges };
      setDraft(updated);
      setDrafts(drafts.map((d) => (d.id === draft.id ? updated : d)));
      notify('Review draft saved locally');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function commit() {
    if (!draft) return;
    setBusy(true);
    setError('');
    try {
      const result = await api<{ sessionId: string }>(`/ingest/${draft.id}/commit`, 'POST', {
        items,
        edges,
      });
      await onRefresh();
      setDrafts(drafts.filter((d) => d.id !== draft.id));
      setDraft(null);
      setTranscript('');
      notify('Reviewed items added to the graph as Unverified');
      onSelect(result.sessionId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const selected = items.filter((i) => i.decision !== 'discard');
  return (
    <div className="ingest-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">RESEARCH MEMORY</span>
          <h1>Ingest Research Session</h1>
          <p>Turn a working conversation into research you can inspect.</p>
        </div>
        <span className="step-label">{draft ? '02 / REVIEW' : '01 / EXTRACT'}</span>
      </div>
      <div className="ingest-steps">
        <span className={!draft ? 'active' : ''}>
          1 <b>Paste a session</b>
        </span>
        <i />
        <span className={draft ? 'active' : ''}>
          2 <b>Review proposed items</b>
        </span>
        <i />
        <span>
          3 <b>Commit to graph</b>
        </span>
      </div>
      {!draft ? (
        <div className="ingest-layout">
          <section className="panel paste-panel">
            <div className="panel-title">
              <h2>
                <FileInput size={18} />
                Session source
              </h2>
              <button
                className="text-button"
                onClick={() => {
                  setTranscript(sample);
                  setSourceName('Collision-rank exploration');
                }}
              >
                Use an example
              </button>
            </div>
            <div className="editor-form">
              <label>
                Session name
                <input
                  value={sourceName}
                  maxLength={150}
                  onChange={(e) => setSourceName(e.target.value)}
                />
              </label>
              <MathGuide />
              <MathEditor
                label="Transcript or research notes"
                rows={15}
                maxLength={100000}
                value={transcript}
                onChange={setTranscript}
                defaultMode="source"
                placeholder="Paste a conversation or research notes. LaTeX formulas and Markdown are supported."
              />
              <div className="extract-footer">
                <span className="small muted">
                  {transcript.length.toLocaleString()} / 100,000 characters
                </span>
                <select
                  aria-label="Extraction method"
                  value={mode}
                  onChange={(e) => setMode(e.target.value as 'manual' | 'openai')}
                >
                  <option value="manual">Local extraction · no API</option>
                  <option value="openai" disabled={!state.llmEnabled}>
                    OpenAI extraction{state.llmEnabled ? '' : ' · not configured'}
                  </option>
                </select>
              </div>
              {mode === 'openai' && (
                <div className="hint">
                  This action sends this transcript to OpenAI for extraction. The API key stays on
                  your local server.
                </div>
              )}
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <button
                className="button primary"
                onClick={extract}
                disabled={busy || !transcript.trim() || !sourceName.trim()}
              >
                {busy ? 'Extracting proposed items…' : 'Extract for review'}
              </button>
            </div>
          </section>
          <aside className="ingest-aside">
            <div className="guardrail">
              <ShieldCheck size={24} />
              <h3>Your judgment stays in the loop.</h3>
              <p>
                Every extracted item starts as <strong>Unverified</strong>. Review the wording,
                provenance, and connections before it becomes part of your research graph.
              </p>
              <p>
                Local extraction proposes up to 40 paragraphs and suggests types. The full
                transcript is preserved. Add missing items and correct relationships during review.
              </p>
            </div>
            {drafts.length > 0 && (
              <section className="panel">
                <div className="panel-title">
                  <h3>Saved reviews</h3>
                  <span>{drafts.length}</span>
                </div>
                {drafts.map((d) => (
                  <button className="draft-row" key={d.id} onClick={() => open(d)}>
                    <strong>
                      <ResearchText inline>{d.sourceName}</ResearchText>
                    </strong>
                    <span>
                      {d.items.length} proposed items · {dateLabel(d.createdAt)}
                    </span>
                  </button>
                ))}
              </section>
            )}
          </aside>
        </div>
      ) : (
        <>
          <div className="review-summary">
            <div>
              <h2>
                <ResearchText inline>{draft.sourceName}</ResearchText>
              </h2>
              <p>
                {selected.length} selected · {items.filter((i) => i.decision === 'merge').length}{' '}
                merges · {items.filter((i) => i.decision === 'discard').length} discarded
              </p>
            </div>
            <Badge status="Unverified" />
            <button className="button secondary" disabled={busy} onClick={save}>
              <Save size={15} />
              Save review
            </button>
          </div>
          <div className="hint">
            Approval adds material to the graph; it does not verify its truth. Merges append
            unverified content, retain the existing status, and clear the target’s
            human-verification flag.
          </div>
          <div className="review-items">
            {items.map((item, i) => (
              <article
                className={`panel review-item ${item.decision === 'discard' ? 'discarded' : ''}`}
                key={item.tempId}
              >
                <div className="review-item-heading">
                  <span className="eyebrow">
                    ITEM {String(i + 1).padStart(2, '0')} · AI-EXTRACTED
                  </span>
                  <select
                    aria-label={`Decision for item ${i + 1}`}
                    value={item.decision}
                    onChange={(e) =>
                      update(i, { decision: e.target.value as ReviewItem['decision'] })
                    }
                  >
                    <option value="create">Create new item</option>
                    <option value="merge">Merge into existing</option>
                    <option value="discard">Discard</option>
                  </select>
                </div>
                <div className="editor-form">
                  <div className="form-row title-type">
                    <label>
                      Title
                      <input
                        value={item.title}
                        onChange={(e) => update(i, { title: e.target.value })}
                      />
                    </label>
                    <label>
                      Type
                      <select
                        value={item.type}
                        onChange={(e) => update(i, { type: e.target.value as ReviewItem['type'] })}
                      >
                        {NODE_TYPES.map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {item.title && (
                    <div className="math-title-preview">
                      <ResearchText inline>{item.title}</ResearchText>
                    </div>
                  )}
                  {item.decision === 'merge' && (
                    <label>
                      Merge target
                      <select
                        value={item.mergeNodeId || ''}
                        onChange={(e) => update(i, { mergeNodeId: e.target.value })}
                      >
                        <option value="">Choose existing item…</option>
                        {state.nodes.map((n) => (
                          <option key={n.id} value={n.id}>
                            {researchTextLabel(n.title)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <MathEditor
                    label={`Summary for item ${i + 1}`}
                    rows={2}
                    maxLength={2000}
                    value={item.summary}
                    onChange={(value) => update(i, { summary: value })}
                    toolbar={false}
                    compact
                  />
                  <MathEditor
                    label={`Content for item ${i + 1}`}
                    rows={7}
                    maxLength={100000}
                    value={item.content}
                    onChange={(value) => update(i, { content: value })}
                  />
                  <label>
                    Tags
                    <input
                      value={item.tags.join(', ')}
                      onChange={(e) =>
                        update(i, {
                          tags: e.target.value
                            .split(',')
                            .map((t) => t.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  </label>
                  <details>
                    <summary>Provenance and source excerpt</summary>
                    <MathEditor
                      label={`Provenance for item ${i + 1}`}
                      rows={3}
                      value={item.provenanceText}
                      onChange={(value) => update(i, { provenanceText: value })}
                      toolbar={false}
                    />
                  </details>
                </div>
              </article>
            ))}
          </div>
          <button
            className="button secondary"
            onClick={() =>
              setItems([
                ...items,
                {
                  tempId: crypto.randomUUID(),
                  title: '',
                  summary: '',
                  content: '',
                  type: 'Claim',
                  tags: [],
                  provenanceText: 'Manually added during review of an extracted session.',
                  decision: 'create',
                },
              ])
            }
          >
            <Plus size={16} />
            Add proposed item
          </button>
          <section className="panel proposal-edges">
            <div className="panel-title">
              <h2>
                <Link2 size={17} />
                Proposed relationships
              </h2>
              <button
                className="text-button"
                disabled={selected.length < 2}
                onClick={() =>
                  setEdges([
                    ...edges,
                    {
                      sourceTempId: selected[0].tempId,
                      targetTempId: selected[1].tempId,
                      edgeType: 'depends_on',
                      explanation: '',
                    },
                  ])
                }
              >
                Add relationship
              </button>
            </div>
            {!edges.length && (
              <p className="empty-inline">
                No relationships proposed. Add dependencies or supporting connections where
                justified.
              </p>
            )}
            {edges.map((e, i) => (
              <div className="proposal-edge" key={i}>
                <select
                  aria-label={`Relationship ${i + 1} source`}
                  value={e.sourceTempId}
                  onChange={(ev) =>
                    setEdges(
                      edges.map((x, j) => (j === i ? { ...x, sourceTempId: ev.target.value } : x)),
                    )
                  }
                >
                  {items.map((n) => (
                    <option key={n.tempId} value={n.tempId}>
                      {researchTextLabel(n.title) || 'Untitled'}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={`Relationship ${i + 1} type`}
                  value={e.edgeType}
                  onChange={(ev) =>
                    setEdges(
                      edges.map((x, j) =>
                        j === i ? { ...x, edgeType: ev.target.value as typeof e.edgeType } : x,
                      ),
                    )
                  }
                >
                  {EDGE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.replaceAll('_', ' ')}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={`Relationship ${i + 1} target`}
                  value={e.targetTempId}
                  onChange={(ev) =>
                    setEdges(
                      edges.map((x, j) => (j === i ? { ...x, targetTempId: ev.target.value } : x)),
                    )
                  }
                >
                  {items.map((n) => (
                    <option key={n.tempId} value={n.tempId}>
                      {researchTextLabel(n.title) || 'Untitled'}
                    </option>
                  ))}
                </select>
                <MathEditor
                  label={`Relationship ${i + 1} explanation`}
                  rows={2}
                  value={e.explanation}
                  onChange={(value) =>
                    setEdges(edges.map((x, j) => (j === i ? { ...x, explanation: value } : x)))
                  }
                  toolbar={false}
                  compact
                />
                <button
                  className="text-button"
                  onClick={() => setEdges(edges.filter((_, j) => j !== i))}
                >
                  Remove
                </button>
              </div>
            ))}
          </section>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="review-commit">
            <button className="button secondary" onClick={() => setDraft(null)}>
              Back to sessions
            </button>
            <p>Discarded items and their connections will be excluded.</p>
            <button
              className="button primary"
              disabled={
                busy ||
                !selected.length ||
                selected.some((i) => !i.title.trim() || (i.decision === 'merge' && !i.mergeNodeId))
              }
              onClick={commit}
            >
              <Check size={16} />
              {busy ? 'Committing…' : `Commit ${selected.length} reviewed items`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
