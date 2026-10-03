import { useState, type FormEvent } from 'react';
import { Scale, ArrowRight, Sparkles } from 'lucide-react';
import {
  CONTRIBUTION_CLASSIFICATIONS,
  CONTRIBUTION_VERDICTS,
  type ContributionAssessment,
  type ContributionInput,
} from '../shared/program';
import type { ResearchNode } from '../shared/types';
import ResearchText from './ResearchText';
import MathEditor from './MathEditor';
import { Modal } from './ui';
import { api } from './api';

export function ContributionSummary({
  assessment,
  onReview,
}: {
  assessment?: ContributionAssessment;
  onReview: () => void;
}) {
  return (
    <section className="contribution-summary">
      <div className="program-section-heading">
        <h3>
          <Scale size={16} /> Mathematical contribution
        </h3>
        <button className="text-button" onClick={onReview}>
          {assessment ? 'Review assessment' : 'Assess this step'}
        </button>
      </div>
      <div className="contribution-badges">
        <span
          className={`depth-badge depth-${assessment?.classification === 'Restatement' ? 'restatement' : assessment?.classification === 'Routine consequence' ? 'routine' : 'candidate'}`}
        >
          {assessment?.classification ?? 'Unassessed'}
        </span>
        <span className="review-verdict">
          {assessment?.stale
            ? 'Needs re-review · item changed'
            : (assessment?.verdict ?? 'Unreviewed')}
        </span>
      </div>
      {assessment ? (
        <>
          <div className="contribution-delta">
            <div>
              <small>BEFORE</small>
              <ResearchText>{assessment.before || 'No baseline recorded.'}</ResearchText>
            </div>
            <ArrowRight size={16} />
            <div>
              <small>AFTER</small>
              <ResearchText>{assessment.after || 'No advance recorded.'}</ResearchText>
            </div>
          </div>
          <p className="program-caption">
            Contribution assessment is separate from proof status and literature novelty.
          </p>
        </>
      ) : (
        <p className="program-caption">
          Record the baseline, the exact gain, and the argument that connects them.
        </p>
      )}
    </section>
  );
}

export default function ContributionEditor({
  node,
  assessment,
  onClose,
  onSaved,
  onDiscuss,
}: {
  node: ResearchNode;
  assessment?: ContributionAssessment;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onDiscuss: (prompt: string, nodeIds?: string[]) => void;
}) {
  const [form, setForm] = useState<ContributionInput>(
    assessment ?? {
      classification: 'Unassessed',
      before: '',
      after: '',
      mechanism: '',
      check: '',
      verdict: 'Unreviewed',
      reviewer: 'Researcher',
    },
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const field = <K extends keyof ContributionInput>(key: K, value: ContributionInput[K]) =>
    setForm({ ...form, [key]: value });
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(`/program/assessments/${node.id}`, 'PUT', form);
      await onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Assess the mathematical contribution" onClose={onClose} wide>
      <form className="editor-form" onSubmit={save}>
        <div className="assessment-intro">
          <Scale size={22} />
          <div>
            <h3>
              <ResearchText inline>{node.title}</ResearchText>
            </h3>
            <p>
              Explain what becomes possible that was not possible before. Correctness, usefulness,
              and novelty are separate judgments.
            </p>
          </div>
        </div>
        <div className="form-row">
          <label>
            Kind of contribution
            <select
              value={form.classification}
              onChange={(e) =>
                field('classification', e.target.value as ContributionInput['classification'])
              }
            >
              {CONTRIBUTION_CLASSIFICATIONS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            Review decision
            <select
              value={form.verdict}
              onChange={(e) => field('verdict', e.target.value as ContributionInput['verdict'])}
            >
              {CONTRIBUTION_VERDICTS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>
        <MathEditor
          label="Before · strongest available baseline"
          value={form.before}
          onChange={(v) => field('before', v)}
          rows={3}
          maxLength={10000}
          toolbar={false}
          placeholder="What follows already from definitions, known lemmas, or standard bounds?"
        />
        <MathEditor
          label="After · exact mathematical gain"
          value={form.after}
          onChange={(v) => field('after', v)}
          rows={3}
          maxLength={10000}
          toolbar={false}
          placeholder="State the improved parameter range, eliminated assumption, new reduction, or explicit obstruction. If none, say so."
        />
        <MathEditor
          label="Mechanism · the step doing the work"
          value={form.mechanism}
          onChange={(v) => field('mechanism', v)}
          rows={4}
          maxLength={10000}
          placeholder="Identify the non-obvious step. Explain why this is not a restatement or a circular use of the target."
        />
        <MathEditor
          label="Verification · how to check or refute it"
          value={form.check}
          onChange={(v) => field('check', v)}
          rows={3}
          maxLength={10000}
          toolbar={false}
          placeholder="What proof obligation, adversarial example, or exact calculation would settle this step?"
        />
        <label>
          Reviewer
          <input
            value={form.reviewer}
            onChange={(e) => field('reviewer', e.target.value)}
            maxLength={200}
          />
        </label>
        <p className="program-caption">
          Accepting this assessment records your judgment of the contribution; it does not mark the
          lemma proved.
        </p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="modal-footer">
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              onClose();
              onDiscuss(
                `Audit the mathematical contribution of “${node.title}”. Compare its strongest existing baseline with the exact new consequence. Identify restatements, circularity, hidden assumptions, and the one non-obvious step if any. Give a concrete proof or falsification task. Do not infer novelty from unfamiliar wording.`,
                [node.id],
              );
            }}
          >
            <Sparkles size={15} /> Ask research chat
          </button>
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save assessment'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
