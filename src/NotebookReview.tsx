import { useState } from 'react';
import { ArrowUpRight, Check, ShieldCheck } from 'lucide-react';
import {
  RESULT_KINDS,
  REVIEW_DECISIONS,
  type Candidate,
  type CandidateDraft,
} from '../shared/workbench';
import { CONTRIBUTION_CLASSIFICATIONS } from '../shared/program';
import type { ResearchState } from '../shared/types';
import ResearchText from './ResearchText';
import MathEditor from './MathEditor';
const fields: {
  key: keyof Pick<
    CandidateDraft,
    'statement' | 'baseline' | 'gain' | 'mechanism' | 'evidence' | 'gap' | 'nextCheck'
  >;
  label: string;
}[] = [
  { key: 'statement', label: 'Exact statement and assumptions' },
  { key: 'baseline', label: 'Before: what was already known' },
  { key: 'gain', label: 'After: what this actually adds' },
  { key: 'mechanism', label: 'Mechanism: why the gain follows' },
  { key: 'evidence', label: 'Argument or evidence in the reply' },
  { key: 'gap', label: 'Remaining gap / proof obligations' },
  { key: 'nextCheck', label: 'Next decisive check' },
];
export default function NotebookReview({
  candidate,
  state,
  busy,
  onSave,
  onIntegrate,
  onCheck,
  onSelect,
  onSource,
}: {
  candidate: Candidate;
  state: ResearchState;
  busy: boolean;
  onSave: (body: unknown) => Promise<void>;
  onIntegrate: () => void;
  onCheck: (text: string) => void;
  onSelect: (id: string) => void;
  onSource: () => void;
}) {
  const [draft, setDraft] = useState<CandidateDraft>(candidate),
    [decision, setDecision] = useState(candidate.decision),
    [reason, setReason] = useState(candidate.reason),
    [verification, setVerification] = useState(candidate.verification),
    [refreshBasis, setRefreshBasis] = useState(false),
    [editing, setEditing] = useState(candidate.decision === 'Unreviewed'),
    [consent, setConsent] = useState(false),
    [dirty, setDirty] = useState(false);
  const locked = !!candidate.integratedNodeId;
  const field = (key: keyof CandidateDraft, value: unknown) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setDirty(true);
  };
  const checkPrompt = `Check this candidate rigorously; do not rephrase it.\n\nTarget claim:\n${draft.statement}\n\nBaseline:\n${draft.baseline}\n\nClaimed gain:\n${draft.gain}\n\nProposed mechanism:\n${draft.mechanism}\n\nRecorded argument:\n${draft.evidence}\n\nRemaining gap:\n${draft.gap}\n\nNext decisive check:\n${draft.nextCheck}\n\nTry a minimal counterexample, verify quantifiers and assumptions, and show the exact missing derivation. If it is equivalent to the goal or follows routinely, say so. Give independently checkable evidence.`;
  return (
    <div className="nb-candidate-review">
      <div className="nb-panel-heading">
        <span>
          RESULT REVIEW · {candidate.origin === 'model' ? 'GPT suggestion' : 'Researcher capture'}
        </span>
        <button className="text-button" onClick={onSource}>
          Source reply <ArrowUpRight size={13} />
        </button>
      </div>
      <h3>
        <ResearchText inline>{candidate.title}</ResearchText>
      </h3>
      <div className="nb-status-row">
        <span className={`nb-chip ${candidate.decision === 'Advance' ? 'green' : ''}`}>
          {candidate.decision}
        </span>
        <span className="nb-chip">{locked ? 'In project · unverified' : 'Private candidate'}</span>
      </div>
      {candidate.stale && (
        <p className="nb-warning">
          The goal, a premise, or the integrated result changed. This review is excluded from
          current accepted advances.
        </p>
      )}
      {candidate.duplicateOf && (
        <p className="nb-warning">
          This exact statement is already in the project.{' '}
          <button className="text-button" onClick={() => onSelect(candidate.duplicateOf!)}>
            Inspect existing result
          </button>
        </p>
      )}
      <details className="nb-source">
        <summary>Exact passage from the reply</summary>
        <ResearchText>{candidate.sourceQuote}</ResearchText>
      </details>
      {!locked && (
        <button className="text-button" onClick={() => setEditing(!editing)}>
          {editing ? 'Read typeset review' : 'Edit the mathematical comparison'}
        </button>
      )}
      {editing && !locked ? (
        <div className="nb-review-fields">
          <label>
            Result title
            <input
              value={draft.title}
              maxLength={250}
              onChange={(e) => field('title', e.target.value)}
            />
          </label>
          <div className="nb-field-pair">
            <label>
              Kind
              <select value={draft.kind} onChange={(e) => field('kind', e.target.value)}>
                {RESULT_KINDS.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
            <label>
              Contribution class
              <select
                value={draft.classification}
                onChange={(e) => field('classification', e.target.value)}
              >
                {CONTRIBUTION_CLASSIFICATIONS.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
          </div>
          {fields.map((f) => (
            <MathEditor
              key={f.key}
              label={f.label}
              value={draft[f.key]}
              onChange={(v) => field(f.key, v)}
              rows={3}
              maxLength={f.key === 'evidence' || f.key === 'statement' ? 12000 : 8000}
              compact
              toolbar={false}
              defaultMode="source"
            />
          ))}
          <details>
            <summary>Related context (not logical premises)</summary>
            {state.nodes.map((n) => (
              <label className="nb-checkbox" key={n.id}>
                <input
                  type="checkbox"
                  checked={draft.relatedNodeIds.includes(n.id)}
                  onChange={(e) =>
                    field(
                      'relatedNodeIds',
                      e.target.checked
                        ? [...draft.relatedNodeIds, n.id].slice(0, 12)
                        : draft.relatedNodeIds.filter((id) => id !== n.id),
                    )
                  }
                />
                <ResearchText inline>{n.title}</ResearchText>
              </label>
            ))}
          </details>
          <details>
            <summary>Explicit logical premises</summary>
            <p className="nb-caption">
              Select only actual prerequisites. This records a prerequisite assertion; it does not
              validate the inference or create proof support.
            </p>
            {state.nodes.map((n) => (
              <label className="nb-checkbox" key={n.id}>
                <input
                  type="checkbox"
                  checked={(draft.premiseNodeIds ?? []).includes(n.id)}
                  onChange={(e) =>
                    field(
                      'premiseNodeIds',
                      e.target.checked
                        ? [...(draft.premiseNodeIds ?? []), n.id].slice(0, 12)
                        : (draft.premiseNodeIds ?? []).filter((id) => id !== n.id),
                    )
                  }
                />
                <ResearchText inline>{n.title}</ResearchText>
              </label>
            ))}
          </details>
        </div>
      ) : (
        <dl className="nb-comparison">
          {fields.map((f) => (
            <div key={f.key}>
              <dt>{f.label}</dt>
              <dd>
                <ResearchText>
                  {draft[f.key] || 'Not supplied — do not assume this step is established.'}
                </ResearchText>
              </dd>
            </div>
          ))}
        </dl>
      )}
      {locked ? (
        <div className="nb-decision">
          <strong>Recorded researcher decision</strong>
          <ResearchText>{candidate.reason}</ResearchText>
          <ResearchText>{candidate.verification || 'No independent check recorded.'}</ResearchText>
          <button
            className="button secondary"
            onClick={() => onSelect(candidate.integratedNodeId!)}
          >
            Inspect project result <ArrowUpRight size={14} />
          </button>
        </div>
      ) : (
        <div className="nb-decision">
          <label>
            Your judgment
            <select
              value={decision}
              onChange={(e) => {
                setDecision(e.target.value as Candidate['decision']);
                setDirty(true);
              }}
            >
              {REVIEW_DECISIONS.map((d) => (
                <option key={d} value={d}>
                  {d === 'Advance' ? 'Nontrivial advance — researcher judgment' : d}
                </option>
              ))}
            </select>
          </label>
          <label>
            Why this judgment?
            <textarea
              value={reason}
              maxLength={8000}
              rows={3}
              placeholder="Name the actual gain, restriction, or equivalence. A new name is not a new result."
              onChange={(e) => {
                setReason(e.target.value);
                setDirty(true);
              }}
            />
          </label>
          <label>
            Your independent check / evidence
            <textarea
              value={verification}
              maxLength={12000}
              rows={3}
              placeholder="Record the derivation you checked, a worked example, or a counterexample and its scope."
              onChange={(e) => {
                setVerification(e.target.value);
                setDirty(true);
              }}
            />
          </label>
          {candidate.stale && (
            <label className="nb-checkbox">
              <input
                type="checkbox"
                checked={refreshBasis}
                onChange={(e) => {
                  setRefreshBasis(e.target.checked);
                  setDirty(true);
                }}
              />
              <span>I compared this candidate against the current target and premises.</span>
            </label>
          )}
          <button
            className="button primary"
            disabled={busy}
            onClick={() =>
              onSave({
                revision: candidate.revision,
                draft: Object.fromEntries(
                  [
                    'title',
                    'kind',
                    'classification',
                    'statement',
                    'sourceQuote',
                    'baseline',
                    'gain',
                    'mechanism',
                    'evidence',
                    'gap',
                    'nextCheck',
                    'relatedNodeIds',
                    'premiseNodeIds',
                  ].map((k) => [k, draft[k as keyof CandidateDraft]]),
                ),
                decision,
                reason,
                verification,
                refreshBasis,
              })
            }
          >
            <Check size={14} /> Save private review
          </button>
          {!dirty &&
            ['Advance', 'Useful partial result', 'Reformulation'].includes(candidate.decision) &&
            !candidate.stale &&
            !candidate.duplicateOf && (
              <div className="nb-integrate">
                <strong>Proposed project change</strong>
                <p>
                  Add one unverified result{candidate.goalId ? ' and link it to its goal' : ''}.
                  This does not prove a theorem or complete the goal.
                </p>
                <label className="nb-checkbox">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                  />
                  <span>Admit this reviewed result to my private research project.</span>
                </label>
                <button
                  className="button secondary"
                  disabled={!consent || busy}
                  onClick={onIntegrate}
                >
                  Admit privately <ArrowUpRight size={14} />
                </button>
              </div>
            )}
        </div>
      )}
      <button
        className="button secondary nb-check"
        disabled={busy}
        onClick={() => onCheck(checkPrompt)}
      >
        <ShieldCheck size={14} /> Draft a rigorous follow-up
      </button>
      <details className="nb-review-history">
        <summary>Review history · {candidate.history.length}</summary>
        {candidate.history.map((h, i) => (
          <p key={i}>
            <strong>{h.action}</strong> · {new Date(h.at).toLocaleString()}
            <br />
            {h.reason}
          </p>
        ))}
      </details>
      <p className="nb-caption">
        A contribution judgment is separate from mathematical proof and literature novelty.
      </p>
    </div>
  );
}
