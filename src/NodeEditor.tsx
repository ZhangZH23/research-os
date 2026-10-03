import MathEditor, { MathGuide } from './MathEditor';
import ResearchText from './ResearchText';
import { researchTextLabel } from '../shared/math';
import { useState, type FormEvent } from 'react';
import {
  NODE_TYPES,
  STATUSES,
  ORIGINS,
  EDGE_TYPES,
  type ResearchNode,
  type NodeInput,
  type EdgeInput,
} from '../shared/types';
import { Modal } from './ui';
export function NodeEditor({
  node,
  preset,
  onClose,
  onSave,
}: {
  node?: ResearchNode;
  preset?: Partial<NodeInput>;
  onClose: () => void;
  onSave: (input: NodeInput, reason: string) => Promise<void>;
}) {
  const [form, setForm] = useState<NodeInput>(
    node ?? {
      title: '',
      summary: '',
      content: '',
      type: 'Claim',
      epistemicStatus: 'Unverified',
      confidence: 0.3,
      originType: 'Human',
      originName: 'Researcher',
      provenanceText: '',
      tags: [],
      links: [],
      humanVerified: false,
      ...preset,
    },
  );
  const [tags, setTags] = useState(form.tags.join(', '));
  const [links, setLinks] = useState(form.links.join('\n'));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const field = <K extends keyof NodeInput>(key: K, value: NodeInput[K]) =>
    setForm({
      ...form,
      [key]: value,
      ...(['title', 'summary', 'content'].includes(key) ? { humanVerified: false } : {}),
    });
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSave(
        {
          ...form,
          tags: tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
          links: links
            .split('\n')
            .map((t) => t.trim())
            .filter(Boolean),
        },
        reason,
      );
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={node ? 'Edit research item' : 'New research item'} onClose={onClose} wide>
      <form onSubmit={save} className="editor-form">
        <label>
          Title
          <input
            required
            maxLength={250}
            value={form.title}
            onChange={(e) => field('title', e.target.value)}
            placeholder="State the claim or question precisely"
          />
        </label>
        {form.title && (
          <div className="math-title-preview">
            <ResearchText inline>{form.title}</ResearchText>
          </div>
        )}
        <MathGuide />
        <div className="form-row">
          <label>
            Type
            <select
              value={form.type}
              onChange={(e) => field('type', e.target.value as NodeInput['type'])}
            >
              {NODE_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label>
            Epistemic status
            <select
              value={form.epistemicStatus}
              onChange={(e) =>
                field('epistemicStatus', e.target.value as NodeInput['epistemicStatus'])
              }
            >
              {STATUSES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
        </div>
        <MathEditor
          label="Short summary"
          rows={2}
          maxLength={2000}
          value={form.summary}
          onChange={(value) => field('summary', value)}
          toolbar={false}
          compact
        />
        <MathEditor
          label="Full content / argument"
          rows={10}
          maxLength={100000}
          value={form.content}
          onChange={(value) => field('content', value)}
        />
        <div className="form-row">
          <label>
            Origin
            <select
              value={form.originType}
              onChange={(e) => field('originType', e.target.value as NodeInput['originType'])}
            >
              {ORIGINS.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label>
            Author / source
            <input value={form.originName} onChange={(e) => field('originName', e.target.value)} />
          </label>
        </div>
        <div className="form-row">
          <label>
            Confidence · {Math.round(form.confidence * 100)}%
            <input
              type="range"
              min="0"
              max="1"
              step=".05"
              value={form.confidence}
              onChange={(e) => field('confidence', Number(e.target.value))}
            />
            <small>Subjective confidence; not proof verification.</small>
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={form.humanVerified}
              onChange={(e) => field('humanVerified', e.target.checked)}
            />
            Human has verified this item
          </label>
        </div>
        <MathEditor
          label="Provenance"
          rows={3}
          value={form.provenanceText}
          onChange={(value) => field('provenanceText', value)}
          toolbar={false}
          compact
        />
        <label>
          Tags <span className="muted">(comma separated)</span>
          <input value={tags} onChange={(e) => setTags(e.target.value)} />
        </label>
        <label>
          External URLs or absolute file paths <span className="muted">(one per line)</span>
          <textarea rows={2} value={links} onChange={(e) => setLinks(e.target.value)} />
        </label>
        {node && (
          <MathEditor
            label="Reason / evidence for this change"
            rows={2}
            value={reason}
            onChange={setReason}
            toolbar={false}
            compact
            required={node.epistemicStatus !== form.epistemicStatus}
            placeholder="Required when changing status"
          />
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
          <button
            className="button primary"
            disabled={
              busy ||
              Boolean(node && node.epistemicStatus !== form.epistemicStatus && !reason.trim())
            }
          >
            {busy ? 'Saving…' : node ? 'Save changes' : 'Create item'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function EdgeEditor({
  nodes,
  preset,
  onClose,
  onSave,
}: {
  nodes: ResearchNode[];
  preset?: Partial<EdgeInput>;
  onClose: () => void;
  onSave: (input: EdgeInput) => Promise<void>;
}) {
  const [form, setForm] = useState<EdgeInput>({
    sourceNodeId: nodes[0]?.id ?? '',
    targetNodeId: nodes[1]?.id ?? '',
    edgeType: 'depends_on',
    explanation: '',
    ...preset,
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await onSave(form);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Connect research items" onClose={onClose} wide>
      <form className="editor-form" onSubmit={save}>
        <label>
          From
          <select
            value={form.sourceNodeId}
            onChange={(e) => setForm({ ...form, sourceNodeId: e.target.value })}
          >
            {nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {researchTextLabel(n.title)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Relationship
          <select
            value={form.edgeType}
            onChange={(e) =>
              setForm({ ...form, edgeType: e.target.value as EdgeInput['edgeType'] })
            }
          >
            {EDGE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <label>
          To
          <select
            value={form.targetNodeId}
            onChange={(e) => setForm({ ...form, targetNodeId: e.target.value })}
          >
            {nodes
              .filter((n) => n.id !== form.sourceNodeId)
              .map((n) => (
                <option key={n.id} value={n.id}>
                  {researchTextLabel(n.title)}
                </option>
              ))}
          </select>
        </label>
        <div className="hint">
          <strong>
            <ResearchText inline>
              {nodes.find((n) => n.id === form.sourceNodeId)?.title ?? ''}
            </ResearchText>
          </strong>{' '}
          {form.edgeType.replaceAll('_', ' ')}{' '}
          <strong>
            <ResearchText inline>
              {nodes.find((n) => n.id === form.targetNodeId)?.title ?? ''}
            </ResearchText>
          </strong>
          .
        </div>
        <MathEditor
          label="Explanation"
          rows={4}
          value={form.explanation}
          onChange={(value) => setForm({ ...form, explanation: value })}
        />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-footer">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={busy || form.sourceNodeId === form.targetNodeId}
          >
            {busy ? 'Saving…' : 'Add relationship'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
