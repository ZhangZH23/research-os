import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArrowRight,
  BookOpen,
  Check,
  ClipboardList,
  FilePlus2,
  GitBranch,
  History,
  LockKeyhole,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import type {
  ChangeSetInput,
  EngineData,
  ResearchChangeSet,
  ResearchContract,
  ResearchOperation,
  ResearchRevision,
  SourceArtifact,
  SourceSpan,
  ContextManifest,
  PublicationSnapshot,
  ReviewRecord,
} from '../shared/engine';
import { evidenceKinds, objectKinds } from '../shared/engine';
import { useProjectApi, useProjectScope } from './ProjectScope';
import ResearchText from './ResearchText';
import MathEditor from './MathEditor';
import { Modal, dateLabel } from './ui';
import './engine.css';

type EngineState = EngineData & {
  support?: unknown;
  goalSatisfaction?: { objectId: string; revisionId: string; status: string; limitation: string }[];
  migration?: { ready: boolean; remaining: number; total: number; policy?: string };
};
type Tab = 'inbox' | 'record' | 'sources' | 'diff' | 'context' | 'publication';
const tabs: { id: Tab; label: string }[] = [
  { id: 'inbox', label: 'Review inbox' },
  { id: 'record', label: 'Research record' },
  { id: 'sources', label: 'Sources' },
  { id: 'diff', label: 'Research diff' },
  { id: 'context', label: 'Resume & runs' },
  { id: 'publication', label: 'Publication' },
];
const lines = (s: string) =>
  s
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);
const label = (s: string) => s.replaceAll('_', ' ');
const short = (s: string) => (s.length > 100 ? s.slice(0, 100) + '…' : s);
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const span = (
  source: SourceArtifact,
  quote = source.text,
  start = source.text.indexOf(quote),
): SourceSpan => ({
  sourceId: source.id,
  sourceHash: source.hash,
  start,
  end: start + quote.length,
  quote,
});
function saveJson(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function EngineWorkbench({
  onLegacyRefresh,
  notify,
  initialSourceId,
  onSourceConsumed,
}: {
  onLegacyRefresh: () => Promise<void>;
  notify: (message: string) => void;
  initialSourceId?: string;
  onSourceConsumed?: () => void;
}) {
  const api = useProjectApi(),
    { reload: reloadProjects } = useProjectScope();
  const [data, setData] = useState<EngineState | null>(null),
    [tab, setTab] = useState<Tab>('inbox'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [compose, setCompose] = useState<{
      type?: string;
      revisionId?: string;
      sourceId?: string;
    } | null>(initialSourceId ? { sourceId: initialSourceId } : null),
    [sourceOpen, setSourceOpen] = useState(false),
    [selectedProposal, setSelectedProposal] = useState(''),
    [selectedRevision, setSelectedRevision] = useState('');
  useEffect(() => {
    if (initialSourceId) onSourceConsumed?.();
  }, []);
  const reload = useCallback(async () => {
    const next = await api<EngineState>('/engine/state');
    setData(next);
    return next;
  }, [api]);
  useEffect(() => {
    let alive = true;
    api<EngineState>('/engine/state')
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [api]);
  async function act(work: () => Promise<unknown>, message?: string) {
    setBusy(true);
    setError('');
    try {
      await work();
      await reload();
      await onLegacyRefresh();
      await reloadProjects();
      if (message) notify(message);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  if (!data)
    return (
      <section className="panel engine-empty">
        <h2>Research state</h2>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button className="button" onClick={() => reload().catch((e) => setError(e.message))}>
              Retry
            </button>
          </>
        ) : (
          <p>Loading the project record…</p>
        )}
      </section>
    );
  const pending = data.changeSets.filter((p) => p.state === 'pending');
  const proposal =
    data.changeSets.find((p) => p.id === selectedProposal) ?? pending[0] ?? data.changeSets.at(-1);
  const rev = data.revisions.find((r) => r.id === selectedRevision);
  const migrating = data.migration && !data.migration.ready;
  return (
    <div className="engine-workbench">
      <div className="page-heading">
        <div>
          <span className="eyebrow">REVISION-AWARE RESEARCH</span>
          <h1>Research state</h1>
          <p>Keep sources, review the change, and preserve what each conclusion depends on.</p>
        </div>
        <div className="engine-actions">
          <button
            className="button"
            onClick={() => setSourceOpen(true)}
            disabled={busy || !!migrating}
          >
            <BookOpen size={16} /> Capture source
          </button>
          <button
            className="button primary"
            onClick={() => setCompose({})}
            disabled={busy || !!migrating || data.project.archived}
          >
            <Plus size={16} /> Propose change
          </button>
        </div>
      </div>
      <div className="engine-trust">
        <LockKeyhole size={16} />
        <span>
          Private admission · attributed human review · explicit publication. A saved or admitted
          claim is not a proof.
        </span>
      </div>
      {error && (
        <div className="error-message" role="alert">
          {error}
        </div>
      )}
      {data.project.archived && (
        <div className="engine-warning">
          This project is archived. Restore it in project settings before changing research records.
        </div>
      )}
      {migrating && (
        <section className="panel engine-migration">
          <h2>Preserve the existing research record</h2>
          <p>
            {data.migration!.remaining} of {data.migration!.total} legacy records remain to be
            imported as attributed historical assertions. Legacy proof labels remain historical
            assertions; migration does not certify them. Existing publication is preserved
            independently.
          </p>
          <div className="engine-actions">
            <button
              className="button"
              onClick={() =>
                act(async () =>
                  saveJson(
                    await api('/engine/export'),
                    `${data.project.title}-before-migration.json`,
                  ),
                )
              }
            >
              Download private backup
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={() =>
                act(async () => {
                  for (let n = 0; n < 200; n++) {
                    const report = await api<{ ready: boolean }>('/engine/migration', 'POST', {
                      confirm: true,
                    });
                    if (report.ready) return;
                  }
                  throw new Error(
                    'Migration preserved completed batches but is not finished. Retry to continue from the saved checkpoint.',
                  );
                }, 'Legacy research retained as versioned historical records')
              }
            >
              {busy ? 'Preserving records…' : 'Migrate this project'}
            </button>
          </div>
        </section>
      )}
      <div className="engine-metrics">
        <span>
          <strong>{data.objects.length}</strong> research objects
        </span>
        <span>
          <strong>{pending.length}</strong> proposed changes
        </span>
        <span>
          <strong>{data.obligations.filter((o) => !o.resolutionRevisionId).length}</strong>{' '}
          unresolved obligations
        </span>
        <span>
          <strong>{data.commits.length}</strong> committed changes
        </span>
      </div>
      <div className="engine-tabs" role="tablist" aria-label="Research state views">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'active' : ''}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === 'inbox' && pending.length > 0 && <small>{pending.length}</small>}
          </button>
        ))}
      </div>
      {tab === 'inbox' && (
        <div className="engine-inbox">
          <section className="panel engine-list">
            <h2>Proposed changes</h2>
            {data.changeSets.length ? (
              [...data.changeSets].reverse().map((p) => (
                <button
                  key={p.id}
                  className={proposal?.id === p.id ? 'selected' : ''}
                  onClick={() => setSelectedProposal(p.id)}
                >
                  <strong>{p.title}</strong>
                  <span>
                    {p.state} · proposal revision {p.revision} · {p.operations.length} operations
                  </span>
                  <small>{dateLabel(p.createdAt)}</small>
                </button>
              ))
            ) : (
              <div className="engine-empty">
                <ClipboardList size={28} />
                <h3>No proposed research changes</h3>
                <p>
                  Capture a human observation or conversation. Then propose a specific,
                  source-grounded addition or revision.
                </p>
                <button className="button" onClick={() => setSourceOpen(true)}>
                  Capture first source
                </button>
              </div>
            )}
          </section>
          {proposal ? (
            <ProposalReview
              key={proposal.id + ':' + proposal.revision}
              data={data}
              proposal={proposal}
              busy={busy}
              act={act}
              onRevision={(id) => {
                setSelectedRevision(id);
                setTab('record');
              }}
              onEdit={() => setCompose({ type: 'revise_proposal:' + proposal.id })}
            />
          ) : (
            <section className="panel engine-empty">
              <GitBranch size={32} />
              <h2>Source → proposal → checks → review → commit</h2>
              <p>
                Each step leaves a record. Restatements and failed attempts can be retained without
                inventing an established result.
              </p>
              <p className="muted">Manual capture and review work without an API key.</p>
            </section>
          )}
        </div>
      )}
      {tab === 'sources' && (
        <Sources
          data={data}
          onCapture={() => setSourceOpen(true)}
          onPropose={(id) => setCompose({ sourceId: id })}
        />
      )}
      {tab === 'record' && (
        <ResearchRecord
          data={data}
          selected={rev}
          onSelect={setSelectedRevision}
          onCompose={(type, revisionId) => setCompose({ type, revisionId })}
          act={act}
          busy={busy}
        />
      )}
      {tab === 'diff' && (
        <DiffView
          data={data}
          onRevision={(id) => {
            setSelectedRevision(id);
            setTab('record');
          }}
        />
      )}
      {tab === 'context' && <Continuity data={data} act={act} busy={busy} />}
      {tab === 'publication' && <Publication data={data} act={act} busy={busy} />}
      {sourceOpen && (
        <SourceCapture
          onClose={() => setSourceOpen(false)}
          onSaved={async (source) => {
            await reload();
            setSourceOpen(false);
            setCompose({ sourceId: source.id });
            notify('Private immutable source saved');
          }}
        />
      )}
      {compose && (
        <Compose
          key={JSON.stringify(compose)}
          data={data}
          initial={compose}
          onClose={() => setCompose(null)}
          onSaved={async (p) => {
            await reload();
            setSelectedProposal(p.id);
            setCompose(null);
            setTab('inbox');
            notify('Proposal saved for checks and review');
          }}
        />
      )}
    </div>
  );
}

function SourceCapture({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (s: SourceArtifact) => Promise<void>;
}) {
  const api = useProjectApi();
  const [kind, setKind] = useState<SourceArtifact['kind']>('human_note'),
    [text, setText] = useState(''),
    [attribution, setAttribution] = useState('Researcher'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <Modal wide title="Capture a private research source" onClose={onClose}>
      <form
        className="engine-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onSaved(
              await api<SourceArtifact>('/engine/sources', 'POST', { kind, text, attribution }),
            );
          } catch (err) {
            setError(errorText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Source kind
          <select value={kind} onChange={(e) => setKind(e.target.value as SourceArtifact['kind'])}>
            {[
              'human_note',
              'conversation',
              'model_response',
              'code',
              'external_run',
              'experiment',
            ].map((k) => (
              <option key={k} value={k}>
                {label(k)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Attributed author or origin
          <input required value={attribution} onChange={(e) => setAttribution(e.target.value)} />
        </label>
        <MathEditor
          label="Original source text"
          value={text}
          onChange={setText}
          rows={12}
          required
          maxLength={100000}
        />
        <p className="muted">
          The original text is immutable. Imported speaker names are supplied attribution, not
          verified authorship. Saving a source does not establish its claims.
        </p>
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <button className="button primary" disabled={busy || !text.trim()}>
          {busy ? 'Saving…' : 'Save private source'}
        </button>
      </form>
    </Modal>
  );
}

function Sources({
  data,
  onCapture,
  onPropose,
}: {
  data: EngineData;
  onCapture: () => void;
  onPropose: (id: string) => void;
}) {
  const [query, setQuery] = useState(''),
    [selected, setSelected] = useState('');
  const source = data.sources.find((s) => s.id === selected) ?? data.sources.at(-1);
  return (
    <div className="engine-inbox">
      <section className="panel engine-list">
        <div className="engine-section-heading">
          <h2>Immutable sources</h2>
          <button className="icon-button" aria-label="Capture source" onClick={onCapture}>
            <Plus size={16} />
          </button>
        </div>
        <input
          aria-label="Search source text"
          placeholder="Search source text or attribution…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {[...data.sources]
          .reverse()
          .filter((s) => `${s.text} ${s.attribution}`.toLowerCase().includes(query.toLowerCase()))
          .map((s) => (
            <button
              key={s.id}
              className={s.id === source?.id ? 'selected' : ''}
              onClick={() => setSelected(s.id)}
            >
              <strong>{short(s.text.split('\n')[0]) || label(s.kind)}</strong>
              <span>
                {label(s.kind)} · {s.attribution}
              </span>
              <small>Imported {dateLabel(s.createdAt)}</small>
            </button>
          ))}
        {!data.sources.length && <p className="muted">No source captured in this project.</p>}
      </section>
      <section className="panel engine-detail">
        {source ? (
          <>
            <div className="engine-section-heading">
              <div>
                <span className="eyebrow">{label(source.kind)}</span>
                <h2>{source.attribution}</h2>
              </div>
              <button className="button" onClick={() => onPropose(source.id)}>
                Propose from this source
              </button>
            </div>
            <ResearchText>{source.text}</ResearchText>
            <details>
              <summary>Exact source and provenance</summary>
              <p>
                UTF-16 code-unit offsets refer to this exact text. Line endings and Unicode remain
                unchanged.
              </p>
              <pre>{source.text}</pre>
              <p>
                Hash: <code>{source.hash}</code>
              </p>
              <p>
                Imported: {source.createdAt}
                {source.originalTimestamp
                  ? ` · Original timestamp: ${source.originalTimestamp}`
                  : ' · Original timestamp not supplied'}
              </p>
            </details>
          </>
        ) : (
          <div className="engine-empty">
            <h2>Human notes are first-class sources</h2>
            <p>
              Preserve an observation, conversation, argument, or experiment before extracting
              changes.
            </p>
            <button className="button primary" onClick={onCapture}>
              Capture source
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function SourceQuote({ reference, data }: { reference: SourceSpan; data: EngineData }) {
  const source = data.sources.find((s) => s.id === reference.sourceId);
  return (
    <figure className="engine-source-quote">
      <figcaption>
        {source?.attribution ?? 'Source'} · UTF-16 [{reference.start}, {reference.end})
      </figcaption>
      <ResearchText>{reference.quote}</ResearchText>
      <details>
        <summary>Inspect exact source span</summary>
        <pre>{reference.quote}</pre>
        <code>{reference.sourceHash}</code>
      </details>
    </figure>
  );
}
function RevisionLabel({ id, data }: { id: string; data: EngineData }) {
  const rev = data.revisions.find((r) => r.id === id);
  const object = data.objects.find((o) => o.id === rev?.objectId);
  return (
    <>
      {object?.title ?? id} <span className="muted">@{id.slice(-6)}</span>
    </>
  );
}
function RefSelect({
  label: title,
  value,
  onChange,
  data,
  filter,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  data: EngineData;
  filter?: string;
}) {
  return (
    <label>
      {title}
      <select required value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose an exact revision…</option>
        {data.objects
          .filter((o) => !filter || o.kind === filter)
          .map((o) => (
            <optgroup key={o.id} label={o.title}>
              {data.revisions
                .filter((r) => r.objectId === o.id)
                .map((r) => (
                  <option key={r.id} value={r.id} disabled={r.id !== o.currentRevisionId}>
                    {o.title} @{r.id.slice(-6)}
                    {r.id === o.currentRevisionId ? ' · current' : ' · historical'}
                  </option>
                ))}
            </optgroup>
          ))}
      </select>
    </label>
  );
}
function RevisionChecks({
  title,
  data,
  values,
  onChange,
  filter,
}: {
  title: string;
  data: EngineData;
  values: string[];
  onChange: (v: string[]) => void;
  filter?: string;
}) {
  return (
    <fieldset className="engine-checklist">
      <legend>{title}</legend>
      {data.objects
        .filter((o) => !filter || o.kind === filter)
        .map((o) => (
          <label key={o.id}>
            <input
              type="checkbox"
              checked={values.includes(o.currentRevisionId)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...values, o.currentRevisionId]
                    : values.filter((id) => id !== o.currentRevisionId),
                )
              }
            />
            <span>
              {o.title} <small>@{o.currentRevisionId.slice(-6)}</small>
            </span>
          </label>
        ))}
      {!data.objects.length && <p className="muted">No admitted revisions yet.</p>}
    </fieldset>
  );
}

const operationOptions = [
  ['add_claim', 'Add a statement, definition, or goal'],
  ['propose_claim_revision', 'Revise an existing statement'],
  ['add_evidence', 'Attach evidence to an existing revision'],
  ['add_argument_or_route', 'Add a proof route (AND premises)'],
  ['add_obligation', 'Open a proof obligation'],
  ['propose_obligation_resolution', 'Propose an obligation resolution'],
  ['record_failed_attempt', 'Retain a failed attempt or barrier'],
  ['propose_relationship', 'Add a descriptive relationship'],
  ['propose_contribution_assessment', 'Assess a methodological contribution'],
  ['propose_counterexample_link', 'Propose a counterexample link'],
] as const;
function Compose({
  data,
  initial,
  onClose,
  onSaved,
}: {
  data: EngineData;
  initial: { type?: string; revisionId?: string; sourceId?: string };
  onClose: () => void;
  onSaved: (p: ResearchChangeSet) => Promise<void>;
}) {
  const api = useProjectApi(),
    existing = data.changeSets.find((p) => initial.type === 'revise_proposal:' + p.id);
  const originalRevision = data.revisions.find((r) => r.id === initial.revisionId),
    originalObject = data.objects.find((o) => o.id === originalRevision?.objectId);
  const [type, setType] = useState(
      initial.type?.startsWith('revise_proposal:') ? 'advanced' : (initial.type ?? 'add_claim'),
    ),
    [kind, setKind] = useState('claim'),
    [title, setTitle] = useState(existing?.title ?? originalObject?.title ?? ''),
    [statement, setStatement] = useState(originalRevision?.statement ?? ''),
    [sourceId, setSourceId] = useState(
      initial.sourceId ?? existing?.sources[0]?.sourceId ?? data.sources.at(-1)?.id ?? '',
    ),
    [quote, setQuote] = useState(
      existing?.sources[0]?.quote ??
        data.sources.find((s) => s.id === initial.sourceId)?.text ??
        data.sources.at(-1)?.text ??
        '',
    ),
    [start, setStart] = useState(existing?.sources[0]?.start ?? 0),
    [target, setTarget] = useState(initial.revisionId ?? ''),
    [other, setOther] = useState(''),
    [premises, setPremises] = useState<string[]>([]),
    [definitions, setDefinitions] = useState<string[]>(
      originalRevision?.definitionRevisionIds ?? [],
    ),
    [assumptions, setAssumptions] = useState(
      originalRevision?.contract.assumptions?.join('\n') ?? '',
    ),
    [guarantee, setGuarantee] = useState(originalRevision?.contract.inputGuarantee ?? 'unknown'),
    [construction, setConstruction] = useState(
      originalRevision?.contract.construction ?? 'unknown',
    ),
    [domain, setDomain] = useState(originalRevision?.contract.inputDomain ?? ''),
    [contractText, setContractText] = useState(
      JSON.stringify(originalRevision?.contract ?? {}, null, 2),
    ),
    [advancedContract, setAdvancedContract] = useState(false),
    [evidenceKind, setEvidenceKind] = useState<string>('human_argument'),
    [evidenceId, setEvidenceId] = useState(''),
    [scope, setScope] = useState(''),
    [reason, setReason] = useState(''),
    [relation, setRelation] = useState('related_to'),
    [novelty, setNovelty] = useState('unknown'),
    [obligationId, setObligationId] = useState(''),
    [premiseChecks, setPremiseChecks] = useState('[]'),
    [violated, setViolated] = useState('unknown'),
    [operationsText, setOperationsText] = useState(
      JSON.stringify(existing?.operations ?? [], null, 2),
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const source = data.sources.find((s) => s.id === sourceId),
    exact =
      !!source && start >= 0 && source.text.slice(start, start + quote.length) === quote && !!quote;
  const isStatement = ['add_claim', 'propose_claim_revision', 'record_failed_attempt'].includes(
    type,
  );
  async function save() {
    setBusy(true);
    setError('');
    try {
      if (!exact || !source)
        throw new Error(
          'Select an exact nonempty quote from the immutable source. Check the UTF-16 start offset.',
        );
      const sources = [span(source, quote, start)],
        tempId = 'op_' + crypto.randomUUID();
      const contract: ResearchContract = advancedContract
        ? JSON.parse(contractText)
        : {
            ...(data.revisions.find((r) => r.id === target)?.contract ??
              originalRevision?.contract ??
              {}),
            inputGuarantee: guarantee,
            construction,
            ...(domain ? { inputDomain: domain } : {}),
            assumptions: lines(assumptions).length ? lines(assumptions) : undefined,
            fieldStates: {
              inputGuarantee: guarantee === 'unknown' ? 'unknown' : 'confirmed',
              construction: construction === 'unknown' ? 'unknown' : 'confirmed',
              inputDomain: domain ? 'confirmed' : 'unknown',
              assumptions: assumptions.trim() ? 'confirmed' : 'unknown',
            },
          };
      let op: unknown;
      if (type === 'add_claim')
        op = {
          type,
          tempId,
          kind,
          title,
          statement,
          contract,
          sources,
          definitionRevisionIds: definitions,
        };
      if (type === 'propose_claim_revision') {
        const parent = data.revisions.find((r) => r.id === target);
        if (!parent) throw new Error('Select the parent revision.');
        op = {
          type,
          tempId,
          objectId: parent.objectId,
          parentRevisionId: parent.id,
          statement,
          contract,
          sources,
          definitionRevisionIds: definitions,
        };
      }
      if (type === 'add_evidence')
        op = {
          type,
          tempId,
          targetRevisionId: target,
          kind: evidenceKind,
          content: statement,
          scope,
          limitations: reason,
          sources,
        };
      if (type === 'add_argument_or_route')
        op = {
          type,
          tempId,
          title,
          conclusionRevisionId: target,
          premiseRevisionIds: premises,
          localAssumptions: lines(assumptions),
          ...(evidenceId ? { evidenceId } : {}),
          sources,
        };
      if (type === 'add_obligation')
        op = {
          type,
          tempId,
          title,
          statement,
          targetRevisionId: target,
          premiseRevisionIds: premises,
          sources,
        };
      if (type === 'propose_obligation_resolution')
        op = { type, tempId, obligationId, resolutionRevisionId: target, reason, sources };
      if (type === 'record_failed_attempt')
        op = {
          type,
          tempId,
          kind: kind === 'barrier' ? 'barrier' : 'failed_attempt',
          title,
          statement,
          contract,
          definitionRevisionIds: definitions,
          methodScope: scope,
          failureReason: reason,
          sources,
        };
      if (type === 'propose_relationship')
        op = {
          type,
          tempId,
          fromRevisionId: target,
          toRevisionId: other,
          kind: relation,
          explanation: reason,
          sources,
        };
      if (type === 'propose_contribution_assessment')
        op = {
          type,
          tempId,
          targetRevisionId: target,
          projectNovelty: novelty,
          methodologicalValue: statement,
          justification: reason,
          unresolvedGaps: scope,
          sources,
        };
      if (type === 'propose_counterexample_link')
        op = {
          type,
          tempId,
          targetRevisionId: target,
          evidenceId,
          premiseChecks: JSON.parse(premiseChecks),
          conclusionViolated: violated,
          sources,
        };
      const operations = type === 'advanced' ? JSON.parse(operationsText) : [op];
      const body: ChangeSetInput = {
        title:
          title ||
          `${label(type)}: ${data.objects.find((o) => o.currentRevisionId === target)?.title ?? 'research change'}`,
        baseCommitId: data.project.headCommitId,
        readSet: data.revisions
          .filter((r) => [target, other, ...premises, ...definitions].includes(r.id))
          .map((r) => ({ objectId: r.objectId, revisionId: r.id, hash: r.hash })),
        sources,
        operations,
        ...((existing?.runId ?? data.runs.find((r) => r.sourceIds.includes(sourceId))?.id)
          ? { runId: existing?.runId ?? data.runs.find((r) => r.sourceIds.includes(sourceId))!.id }
          : {}),
      };
      const result = await api<ResearchChangeSet>(
        existing ? `/engine/proposals/${existing.id}` : '/engine/proposals',
        existing ? 'PATCH' : 'POST',
        existing ? { ...body, revision: existing.revision } : body,
      );
      await onSaved(result);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      wide
      title={existing ? 'Revise proposed changes' : 'Propose a research change'}
      onClose={onClose}
    >
      <form
        className="engine-form engine-compose"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <p className="muted">
          This saves a proposal. Sources, checks, and explicit review precede admission to the
          private research record.
        </p>
        <label>
          Change type
          <select value={type} disabled={!!existing} onChange={(e) => setType(e.target.value)}>
            {operationOptions.map(([id, text]) => (
              <option key={id} value={id}>
                {text}
              </option>
            ))}
            {existing && <option value="advanced">Revise typed operations</option>}
          </select>
        </label>
        <label>
          Proposal title
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What specific change should be reviewed?"
            maxLength={250}
            required={[
              'add_claim',
              'record_failed_attempt',
              'add_argument_or_route',
              'add_obligation',
            ].includes(type)}
          />
        </label>
        <div className="engine-compose-columns">
          <section>
            <h3>Proposed effect</h3>
            {type === 'add_claim' && (
              <label>
                Research object kind
                <select value={kind} onChange={(e) => setKind(e.target.value)}>
                  {objectKinds.map((k) => (
                    <option key={k} value={k}>
                      {label(k)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!['add_claim', 'record_failed_attempt', 'advanced'].includes(type) && (
              <RefSelect
                label={
                  type === 'add_argument_or_route'
                    ? 'Conclusion revision'
                    : type === 'propose_claim_revision'
                      ? 'Parent statement revision'
                      : 'Target revision'
                }
                value={target}
                onChange={(id) => {
                  setTarget(id);
                  if (type === 'propose_claim_revision') {
                    const r = data.revisions.find((x) => x.id === id);
                    if (r) {
                      setStatement(r.statement);
                      setContractText(JSON.stringify(r.contract, null, 2));
                      setGuarantee(r.contract.inputGuarantee ?? 'unknown');
                      setConstruction(r.contract.construction ?? 'unknown');
                      setDomain(r.contract.inputDomain ?? '');
                      setAssumptions(r.contract.assumptions?.join('\n') ?? '');
                      setDefinitions(r.definitionRevisionIds);
                    }
                  }
                }}
                data={data}
              />
            )}
            {[
              'add_claim',
              'propose_claim_revision',
              'record_failed_attempt',
              'add_obligation',
              'add_evidence',
              'propose_contribution_assessment',
            ].includes(type) && (
              <MathEditor
                label={
                  type === 'add_evidence'
                    ? 'Evidence or argument'
                    : type === 'propose_contribution_assessment'
                      ? 'Methodological value'
                      : 'Exact statement'
                }
                value={statement}
                onChange={setStatement}
                rows={7}
                required
              />
            )}
            {isStatement && (
              <>
                <label>
                  Input guarantee
                  <select
                    value={guarantee}
                    onChange={(e) => setGuarantee(e.target.value as typeof guarantee)}
                  >
                    {[
                      'unknown',
                      'arbitrary',
                      'random',
                      'flat_sources',
                      'linear_subspaces',
                      'finite_enumeration',
                    ].map((v) => (
                      <option key={v} value={v}>
                        {label(v)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Construction claim
                  <select
                    value={construction}
                    onChange={(e) => setConstruction(e.target.value as typeof construction)}
                  >
                    {['unknown', 'existential', 'explicit'].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Input domain
                  <input
                    value={domain}
                    onChange={(e) => setDomain(e.target.value)}
                    placeholder="Leave unknown if not established"
                  />
                </label>
                <label>
                  Assumptions (one per line)
                  <textarea
                    value={assumptions}
                    onChange={(e) => setAssumptions(e.target.value)}
                    rows={3}
                  />
                </label>
                <RevisionChecks
                  title="Referenced definition revisions"
                  data={data}
                  filter="definition"
                  values={definitions}
                  onChange={setDefinitions}
                />
                <details>
                  <summary>
                    Structured contract: variables, quantifiers, runtime, and goal criteria
                  </summary>
                  <p>
                    Optional strict JSON contract. Missing fields stay unknown. Only supported
                    fragments are checked.
                  </p>
                  <label className="engine-inline-label">
                    <input
                      type="checkbox"
                      checked={advancedContract}
                      onChange={(e) => setAdvancedContract(e.target.checked)}
                    />
                    Use this complete structured contract
                  </label>
                  <textarea
                    aria-label="Structured contract JSON"
                    rows={12}
                    value={contractText}
                    onChange={(e) => setContractText(e.target.value)}
                    spellCheck={false}
                  />
                  <p className="small muted">
                    For goal criteria use fields such as{' '}
                    {`{"fields":{"runtime":{"value":"polynomial in n","state":"confirmed","sources":[]}}}`}
                    . Quantifiers, variables, and runtime expressions use the documented shared
                    contract format.
                  </p>
                </details>
              </>
            )}
            {type === 'add_evidence' && (
              <label>
                Evidence kind
                <select value={evidenceKind} onChange={(e) => setEvidenceKind(e.target.value)}>
                  {evidenceKinds.map((k) => (
                    <option key={k} value={k}>
                      {label(k)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {['add_argument_or_route', 'add_obligation'].includes(type) && (
              <RevisionChecks
                title={
                  type === 'add_argument_or_route'
                    ? 'Required premises — all selected revisions (AND)'
                    : 'Relevant premise revisions'
                }
                data={data}
                values={premises}
                onChange={setPremises}
              />
            )}
            {type === 'add_argument_or_route' && (
              <>
                <label>
                  Local assumptions (one per line)
                  <textarea
                    rows={3}
                    value={assumptions}
                    onChange={(e) => setAssumptions(e.target.value)}
                  />
                </label>
                <p className="muted">
                  Each route is one conjunction. Create another route with the same conclusion for
                  an alternative (OR). An inference requires separate review; a route with open
                  assumptions remains conditional.
                </p>
              </>
            )}
            {['add_argument_or_route', 'propose_counterexample_link'].includes(type) && (
              <label>
                Argument or witness artifact
                <select
                  value={evidenceId}
                  onChange={(e) => setEvidenceId(e.target.value)}
                  required={type === 'propose_counterexample_link'}
                >
                  <option value="">No evidence selected</option>
                  {data.evidence.map((e) => (
                    <option key={e.id} value={e.id}>
                      {label(e.kind)} · {short(e.content)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {['add_evidence', 'record_failed_attempt', 'propose_contribution_assessment'].includes(
              type,
            ) && (
              <label>
                {type === 'record_failed_attempt'
                  ? 'Method class and exact attempted scope'
                  : type === 'propose_contribution_assessment'
                    ? 'Unresolved gaps'
                    : 'Exact scope of this evidence'}
                <textarea
                  rows={3}
                  value={scope}
                  onChange={(e) => setScope(e.target.value)}
                  required={type !== 'propose_contribution_assessment'}
                />
              </label>
            )}
            {type === 'record_failed_attempt' && (
              <label>
                Failure type
                <select value={kind} onChange={(e) => setKind(e.target.value)}>
                  <option value="failed_attempt">Failed attempt</option>
                  <option value="barrier">Claimed method barrier (scope required)</option>
                </select>
              </label>
            )}
            {type === 'propose_relationship' && (
              <>
                <RefSelect label="Related revision" value={other} onChange={setOther} data={data} />
                <label>
                  Descriptive relation
                  <select value={relation} onChange={(e) => setRelation(e.target.value)}>
                    {['related_to', 'motivated_by', 'tested_by', 'claimed_equivalent'].map((k) => (
                      <option key={k} value={k}>
                        {label(k)}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="muted">
                  This relation is not a logical premise and does not provide proof support.
                </p>
              </>
            )}
            {type === 'propose_obligation_resolution' && (
              <label>
                Open obligation
                <select
                  value={obligationId}
                  onChange={(e) => setObligationId(e.target.value)}
                  required
                >
                  <option value="">Choose obligation…</option>
                  {data.obligations
                    .filter((o) => !o.resolutionRevisionId)
                    .map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.title}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {type === 'propose_contribution_assessment' && (
              <label>
                Project-relative novelty
                <select value={novelty} onChange={(e) => setNovelty(e.target.value)}>
                  {['unknown', 'repetition', 'additional_evidence', 'possible_new_statement'].map(
                    (k) => (
                      <option key={k} value={k}>
                        {label(k)}
                      </option>
                    ),
                  )}
                </select>
              </label>
            )}
            {[
              'add_evidence',
              'record_failed_attempt',
              'propose_relationship',
              'propose_obligation_resolution',
              'propose_contribution_assessment',
            ].includes(type) && (
              <label>
                {type === 'add_evidence'
                  ? 'Limitations and remaining gaps'
                  : type === 'record_failed_attempt'
                    ? 'Why the attempt failed; what remains open'
                    : 'Reason and basis'}
                <textarea
                  rows={4}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required={type !== 'add_evidence'}
                />
              </label>
            )}
            {type === 'propose_counterexample_link' && (
              <>
                <label>
                  Premise checks (JSON)
                  <textarea
                    value={premiseChecks}
                    onChange={(e) => setPremiseChecks(e.target.value)}
                    rows={6}
                    placeholder={'[{"premise":"n > 0","satisfied":"yes"}]'}
                  />
                </label>
                <label>
                  Does the witness violate the exact conclusion?
                  <select value={violated} onChange={(e) => setViolated(e.target.value)}>
                    {['unknown', 'yes', 'no'].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
                <p className="muted">
                  A proposed witness is not automatically a checked refutation.
                </p>
              </>
            )}
            {type === 'advanced' && (
              <label>
                Typed operations JSON
                <textarea
                  aria-label="Typed operations JSON"
                  value={operationsText}
                  onChange={(e) => setOperationsText(e.target.value)}
                  rows={20}
                  spellCheck={false}
                />
              </label>
            )}
          </section>
          <section>
            <h3>Immutable source beside the change</h3>
            <label>
              Source artifact
              <select
                value={sourceId}
                onChange={(e) => {
                  const s = data.sources.find((x) => x.id === e.target.value);
                  setSourceId(e.target.value);
                  setQuote(s?.text ?? '');
                  setStart(0);
                }}
                required
              >
                <option value="">Select a source…</option>
                {data.sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.attribution} · {short(s.text.split('\n')[0])}
                  </option>
                ))}
              </select>
            </label>
            {!data.sources.length && (
              <p className="engine-warning">Capture a source before proposing a change.</p>
            )}
            <label>
              Exact quoted passage
              <textarea
                rows={10}
                value={quote}
                onChange={(e) => {
                  setQuote(e.target.value);
                  setStart(source?.text.indexOf(e.target.value) ?? 0);
                }}
              />
            </label>
            <label>
              Start offset (UTF-16 code units)
              <input
                type="number"
                min={0}
                value={start}
                onChange={(e) => setStart(Number(e.target.value))}
              />
            </label>
            <p className={exact ? 'engine-ok' : 'engine-warning'}>
              {exact
                ? `Exact source match · [${start}, ${start + quote.length})`
                : 'Quote does not match this exact source position.'}
            </p>
            {source && (
              <details>
                <summary>Read the complete original source</summary>
                <ResearchText>{source.text}</ResearchText>
                <pre>{source.text}</pre>
              </details>
            )}
            <p className="muted">
              The quote establishes provenance. Your statement may be an extraction or
              interpretation and still needs review.
            </p>
          </section>
        </div>
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <div className="engine-actions">
          <button className="button primary" disabled={busy || !exact}>
            {busy
              ? 'Saving proposal…'
              : existing
                ? 'Save new proposal revision'
                : 'Save proposal for review'}
          </button>
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

function OperationView({
  operation,
  data,
  onRevision,
}: {
  operation: ResearchOperation;
  data: EngineData;
  onRevision?: (id: string) => void;
}) {
  const o = operation as unknown as Record<string, unknown>;
  const targets = [
    'targetRevisionId',
    'conclusionRevisionId',
    'parentRevisionId',
    'fromRevisionId',
    'toRevisionId',
    'resolutionRevisionId',
  ].flatMap((k) => (typeof o[k] === 'string' ? [o[k] as string] : []));
  const parent =
    typeof o.parentRevisionId === 'string'
      ? data.revisions.find((r) => r.id === o.parentRevisionId)
      : undefined;
  return (
    <div className="engine-operation">
      <span className="engine-pill">{label(operation.type)}</span>
      {'title' in operation && <h3>{operation.title}</h3>}
      {targets.map((id) => (
        <button key={id} type="button" className="text-button" onClick={() => onRevision?.(id)}>
          <RevisionLabel id={id} data={data} />
        </button>
      ))}
      {parent && (
        <div className="engine-before">
          <small>BEFORE · ORIGINAL REVISION</small>
          <ResearchText>{parent.statement}</ResearchText>
        </div>
      )}
      {'statement' in operation && (
        <div>
          <small>{parent ? 'PROPOSED NEW REVISION' : 'PROPOSED STATEMENT'}</small>
          <ResearchText>{operation.statement}</ResearchText>
        </div>
      )}
      {'content' in operation && <ResearchText>{operation.content}</ResearchText>}
      {'contract' in operation && <ContractView contract={operation.contract} />}
      {'premiseRevisionIds' in operation && (
        <p>
          <strong>AND premises:</strong>{' '}
          {operation.premiseRevisionIds.length
            ? operation.premiseRevisionIds.map((id) => (
                <span key={id} className="engine-inline-ref">
                  <RevisionLabel id={id} data={data} />
                </span>
              ))
            : 'No explicit premises'}
        </p>
      )}
      {'localAssumptions' in operation && operation.localAssumptions.length > 0 && (
        <p>
          <strong>Local assumptions:</strong> {operation.localAssumptions.join('; ')}
        </p>
      )}
      {[
        'scope',
        'reason',
        'failureReason',
        'methodScope',
        'methodologicalValue',
        'justification',
        'unresolvedGaps',
        'explanation',
        'limitations',
      ].map((k) =>
        typeof o[k] === 'string' && o[k] ? (
          <div key={k}>
            <strong>{label(k.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase()))}</strong>
            <ResearchText>{o[k] as string}</ResearchText>
          </div>
        ) : null,
      )}
    </div>
  );
}
function ContractView({ contract }: { contract: ResearchContract }) {
  return (
    <div className="engine-contract">
      <dl>
        <div>
          <dt>Input guarantee</dt>
          <dd>{label(contract.inputGuarantee ?? 'unknown')}</dd>
        </div>
        <div>
          <dt>Input domain</dt>
          <dd>
            <ResearchText inline>{contract.inputDomain || 'Unknown'}</ResearchText>
          </dd>
        </div>
        <div>
          <dt>Construction</dt>
          <dd>{contract.construction ?? 'unknown'}</dd>
        </div>
        <div>
          <dt>Assumptions</dt>
          <dd>
            <ResearchText>
              {contract.assumptions?.length
                ? contract.assumptions.join('; ')
                : 'None recorded — completeness unknown'}
            </ResearchText>
          </dd>
        </div>
        {contract.quantifiers?.map((q, i) => (
          <div key={i}>
            <dt>Quantifier {i + 1}</dt>
            <dd>
              {q.kind} {q.variable} {q.domain ? `∈ ${q.domain}` : '(domain unknown)'}
            </dd>
          </div>
        ))}
        {Object.entries(contract.fields ?? {}).map(([key, value]) => (
          <div key={key}>
            <dt>
              {key} · {value.state}
            </dt>
            <dd>
              <ResearchText>{value.value}</ResearchText>
            </dd>
          </div>
        ))}
      </dl>
      <details>
        <summary>Exact structured contract</summary>
        <pre>{JSON.stringify(contract, null, 2)}</pre>
      </details>
    </div>
  );
}
function ProposalReview({
  data,
  proposal,
  busy,
  act,
  onRevision,
  onEdit,
}: {
  data: EngineData;
  proposal: ResearchChangeSet;
  busy: boolean;
  act: (fn: () => Promise<unknown>, message?: string) => Promise<void>;
  onRevision: (id: string) => void;
  onEdit: () => void;
}) {
  const api = useProjectApi(),
    [reason, setReason] = useState(''),
    [selected, setSelected] = useState(proposal.operations.map((o) => o.tempId));
  const checks = data.checks.filter(
    (c) => c.changeSetId === proposal.id && c.changeSetRevision === proposal.revision,
  );
  const reviews = data.reviews.filter((r) => r.targetId === proposal.id);
  const committed = data.commits.find(
    (c) => c.changeSetId === proposal.id && c.changeSetRevision === proposal.revision,
  );
  const pending = proposal.state === 'pending';
  return (
    <section className="panel engine-detail">
      <div className="engine-section-heading">
        <div>
          <span className="eyebrow">
            PROPOSAL REVISION {proposal.revision} · {proposal.state}
          </span>
          <h2>{proposal.title}</h2>
        </div>
        {pending && (
          <button className="button" onClick={onEdit} disabled={busy}>
            Edit proposal
          </button>
        )}
      </div>
      <p className="muted">
        Base commit: {proposal.baseCommitId?.slice(-8) ?? 'empty project'} ·{' '}
        {proposal.readSet.length} exact revision dependencies. Admission does not establish
        mathematical validity.
      </p>
      {proposal.operations.map((operation) => (
        <div key={operation.tempId} className="engine-diff-columns">
          <section>
            <label className="engine-inline-label">
              <input
                type="checkbox"
                disabled={!pending}
                checked={selected.includes(operation.tempId)}
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? [...selected, operation.tempId]
                      : selected.filter((id) => id !== operation.tempId),
                  )
                }
              />
              Include operation in commit
            </label>
            <OperationView operation={operation} data={data} onRevision={onRevision} />
          </section>
          <section>
            <h4>Source grounding</h4>
            {operation.sources.length ? (
              operation.sources.map((ref, i) => <SourceQuote key={i} reference={ref} data={data} />)
            ) : (
              <p className="engine-warning">
                This operation has no direct source span. Inspect its referenced artifacts.
              </p>
            )}
          </section>
        </div>
      ))}
      <section className="engine-check-results">
        <div className="engine-section-heading">
          <h3>Explicit checks</h3>
          {pending && (
            <button
              className="button"
              disabled={busy}
              onClick={() =>
                act(
                  () =>
                    api(`/engine/proposals/${proposal.id}/check`, 'POST', {
                      revision: proposal.revision,
                    }),
                  'Checks recorded against this proposal revision',
                )
              }
            >
              <ShieldCheck size={16} />
              Run deterministic checks
            </button>
          )}
        </div>
        {checks.length ? (
          checks.map((c) => (
            <article key={c.id}>
              <h4>
                {c.checkerId} · {c.outcome}
              </h4>
              <p className="small muted">{c.scope}</p>
              {c.findings.map((f, i) => (
                <div key={i} className={`engine-finding ${f.outcome}`}>
                  <strong>
                    {f.outcome}: {f.rule}
                  </strong>
                  <p>{f.explanation}</p>
                  <small>
                    {f.scope}
                    {f.limitations.length ? ` · ${f.limitations.join(' ')}` : ''}
                  </small>
                </div>
              ))}
            </article>
          ))
        ) : (
          <p className="muted">No checks have run against this exact proposal revision.</p>
        )}
        <p className="muted">
          Passing these checks validates their declared scope. It is not a proof certificate or a
          literature novelty finding.
        </p>
      </section>
      <section>
        <h3>Researcher review</h3>
        {reviews.map((r) => (
          <article className="engine-review" key={r.id}>
            <strong>
              {r.actor} · {r.decision} · {r.scope}
            </strong>
            <p>{r.reason}</p>
          </article>
        ))}
        {pending && (
          <>
            <label className="engine-field">
              Review reason and unresolved limitations
              <textarea
                rows={4}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Explain why this is useful to retain and what remains unproved or out of scope."
              />
            </label>
            <div className="engine-actions">
              <button
                className="button"
                disabled={busy || reason.trim().length < 10}
                onClick={() =>
                  act(
                    () =>
                      api(`/engine/proposals/${proposal.id}/review`, 'POST', {
                        decision: 'approve',
                        reason,
                        revision: proposal.revision,
                      }),
                    'Admission review recorded; no proof status changed',
                  )
                }
              >
                Approve private admission
              </button>
              <button
                className="button"
                disabled={busy || reason.trim().length < 10}
                onClick={() =>
                  act(
                    () =>
                      api(`/engine/proposals/${proposal.id}/review`, 'POST', {
                        decision: 'reject',
                        reason,
                        revision: proposal.revision,
                      }),
                    'Proposal rejected; accepted research unchanged',
                  )
                }
              >
                Reject proposal
              </button>
            </div>
            <div className="engine-commit-box">
              <p>
                <strong>Commit {selected.length} selected operations privately.</strong> The server
                revalidates scope, sources, read-set currentness, checks, and review together. A
                failed or stale commit leaves no partial research change.
              </p>
              <button
                className="button primary"
                disabled={
                  busy ||
                  !selected.length ||
                  !checks.length ||
                  !reviews.some((r) => r.decision === 'endorse')
                }
                onClick={() =>
                  act(
                    () =>
                      api(`/engine/proposals/${proposal.id}/commit`, 'POST', {
                        revision: proposal.revision,
                        idempotencyKey: `ui-${proposal.id}-${proposal.revision}`,
                        operationIds: selected,
                      }),
                    'Research change committed privately',
                  )
                }
              >
                {busy ? 'Working…' : 'Commit selected changes privately'}
              </button>
            </div>
          </>
        )}
      </section>
      {committed && (
        <div className="engine-ok">
          Committed {dateLabel(committed.createdAt)} · {committed.diff.length} recorded effects.
          Read the exact before/after revisions in Research diff.
        </div>
      )}
    </section>
  );
}

function ResearchRecord({
  data,
  selected,
  onSelect,
  onCompose,
  act,
  busy,
}: {
  data: EngineState;
  selected?: ResearchRevision;
  onSelect: (id: string) => void;
  onCompose: (type: string, revisionId?: string) => void;
  act: (f: () => Promise<unknown>, m?: string) => Promise<void>;
  busy: boolean;
}) {
  const [query, setQuery] = useState(''),
    [kind, setKind] = useState('');
  const revision =
      selected ?? data.revisions.find((r) => r.id === data.objects[0]?.currentRevisionId),
    object = data.objects.find((o) => o.id === revision?.objectId);
  const support = data.support as
    | {
        revisions?: Record<
          string,
          {
            status: string;
            explanations: string[];
            supportingRouteIds: string[];
            historicallySupported: boolean;
          }
        >;
        routes?: Record<string, { status: string; explanations: string[] }>;
      }
    | undefined;
  const summary = revision && support?.revisions?.[revision.id];
  const relatedRoutes = data.routes.filter((r) => r.conclusionRevisionId === revision?.id);
  return (
    <div className="engine-inbox">
      <section className="panel engine-list">
        <h2>Versioned objects</h2>
        <input
          aria-label="Search versioned research"
          placeholder="Search statement or title…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="Filter research object kind"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="">All kinds</option>
          {objectKinds.map((k) => (
            <option key={k} value={k}>
              {label(k)}
            </option>
          ))}
        </select>
        {data.objects
          .filter(
            (o) =>
              (!kind || o.kind === kind) &&
              `${o.title} ${data.revisions.find((r) => r.id === o.currentRevisionId)?.statement}`
                .toLowerCase()
                .includes(query.toLowerCase()),
          )
          .map((o) => (
            <button
              key={o.id}
              className={o.id === object?.id ? 'selected' : ''}
              onClick={() => onSelect(o.currentRevisionId)}
            >
              <strong>{o.title}</strong>
              <span>
                {label(o.kind)} ·{' '}
                {support?.revisions?.[o.currentRevisionId]?.status.replaceAll('_', ' ') ??
                  'Unreviewed'}
              </span>
              <small>
                {data.revisions.filter((r) => r.objectId === o.id).length} immutable revisions
              </small>
            </button>
          ))}
        {!data.objects.length && (
          <p className="muted">
            Admitted statements appear here. Capture a source and review a proposal to begin.
          </p>
        )}
      </section>
      <section className="panel engine-detail">
        {revision && object ? (
          <>
            <div className="engine-section-heading">
              <div>
                <span className="eyebrow">
                  {label(object.kind)} ·{' '}
                  {object.currentRevisionId === revision.id ? 'CURRENT' : 'HISTORICAL'} REVISION
                </span>
                <h2>{object.title}</h2>
              </div>
              <button
                className="button"
                disabled={object.currentRevisionId !== revision.id}
                onClick={() => onCompose('propose_claim_revision', revision.id)}
              >
                Propose revision
              </button>
            </div>
            <label className="engine-field">
              Revision history
              <select value={revision.id} onChange={(e) => onSelect(e.target.value)}>
                {data.revisions
                  .filter((r) => r.objectId === object.id)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      @{r.id.slice(-6)} · {dateLabel(r.createdAt)} · {r.actor}
                      {r.id === object.currentRevisionId ? ' · current' : ' · historical'}
                    </option>
                  ))}
              </select>
            </label>
            <ResearchText>{revision.statement}</ResearchText>
            <ContractView contract={revision.contract} />
            <div className="engine-support">
              <h3>Support and currentness</h3>
              <strong>{summary ? label(summary.status) : 'Support has not been evaluated'}</strong>
              <ul>
                {summary?.explanations.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
              <p className="muted">
                Admission, attributed mathematical review, and machine checking are distinct.
                Reviews remain attached to their original revisions.
              </p>
            </div>
            {revision.legacyAssertion && (
              <p className="engine-warning">
                Historical assertion: {revision.legacyAssertion.status}; human-verified flag{' '}
                {String(revision.legacyAssertion.humanVerified)}.{' '}
                {revision.legacyAssertion.attribution}. No formal artifact was invented during
                migration.
              </p>
            )}
            <div className="engine-actions">
              <button className="button" onClick={() => onCompose('add_evidence', revision.id)}>
                Attach new evidence
              </button>
              <button
                className="button"
                onClick={() => onCompose('add_argument_or_route', revision.id)}
              >
                Add alternative route
              </button>
              <button className="button" onClick={() => onCompose('add_obligation', revision.id)}>
                Open obligation
              </button>
            </div>
            {object.kind === 'goal' && (
              <div className="engine-support">
                <h3>Goal satisfaction</h3>
                <strong>
                  {label(
                    data.goalSatisfaction?.find((g) => g.revisionId === revision.id)?.status ??
                      'open',
                  )}
                </strong>
                <p>
                  Completion requires an explicit review mapping every criterion to supported result
                  revisions. A restricted result or arbitrary graph link does not satisfy the
                  general goal.
                </p>
              </div>
            )}
            <h3>Evidence attached to this exact revision</h3>
            {data.evidence
              .filter((e) => e.targetRevisionId === revision.id)
              .map((e) => (
                <article key={e.id} className="engine-artifact">
                  <h4>{label(e.kind)}</h4>
                  <ResearchText>{e.content}</ResearchText>
                  <p>
                    <strong>Scope:</strong> {e.scope}
                  </p>
                  <p>
                    <strong>Limitations:</strong> {e.limitations || 'Not supplied'}
                  </p>
                  <p className="small muted">
                    Execution trust: {e.executionTrust ?? 'imported; not server verified'}
                  </p>
                  {e.sources.map((s, i) => (
                    <SourceQuote key={i} data={data} reference={s} />
                  ))}
                </article>
              ))}
            <h3>Alternative proof routes (OR)</h3>
            {relatedRoutes.length ? (
              relatedRoutes.map((route) => (
                <article className="engine-route" key={route.id}>
                  <h4>
                    {route.title}{' '}
                    <span className="engine-pill">
                      {label(support?.routes?.[route.id]?.status ?? 'unreviewed')}
                    </span>
                  </h4>
                  <p>
                    <strong>Required premises (AND):</strong>{' '}
                    {route.premiseRevisionIds.length
                      ? route.premiseRevisionIds.map((id) => (
                          <button key={id} className="text-button" onClick={() => onSelect(id)}>
                            <RevisionLabel id={id} data={data} />
                          </button>
                        ))
                      : 'No premise revisions recorded'}
                  </p>
                  {route.localAssumptions.length > 0 && (
                    <p>Local assumptions: {route.localAssumptions.join('; ')}</p>
                  )}
                  <ul>
                    {support?.routes?.[route.id]?.explanations.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                  <ReviewForm
                    data={data}
                    targetId={route.id}
                    targetRevisionIds={[route.conclusionRevisionId, ...route.premiseRevisionIds]}
                    defaultScope="inference"
                    act={act}
                    busy={busy}
                    title="Review or retract this inference"
                  />
                </article>
              ))
            ) : (
              <p className="muted">No inference route currently targets this revision.</p>
            )}
            <h3>Open obligations and resolutions</h3>
            {data.obligations
              .filter((o) => o.targetRevisionId === revision.id)
              .map((o) => (
                <article className="engine-artifact" key={o.id}>
                  <strong>{o.title}</strong>
                  <ResearchText>{o.statement}</ResearchText>
                  <p>
                    {o.resolutionRevisionId ? (
                      <>
                        Proposed resolution:{' '}
                        <button
                          className="text-button"
                          onClick={() => onSelect(o.resolutionRevisionId!)}
                        >
                          <RevisionLabel id={o.resolutionRevisionId} data={data} />
                        </button>
                      </>
                    ) : (
                      'No resolution recorded'
                    )}
                  </p>
                  <button
                    className="text-button"
                    onClick={() => onCompose('propose_obligation_resolution', revision.id)}
                  >
                    Propose a resolution
                  </button>
                </article>
              ))}
            <ReviewForm
              key={revision.id}
              data={data}
              targetId={revision.id}
              targetRevisionIds={[revision.id]}
              defaultScope={object.kind === 'goal' ? 'goal_satisfaction' : 'mathematical'}
              act={act}
              busy={busy}
              title="Attributed review of this revision"
            />
            <h3>Descriptive relationships</h3>
            {data.relationships
              .filter((r) => r.fromRevisionId === revision.id || r.toRevisionId === revision.id)
              .map((r) => (
                <article key={r.id} className="engine-artifact">
                  <span className="engine-pill">{label(r.kind)}</span>
                  <p>
                    <button className="text-button" onClick={() => onSelect(r.fromRevisionId)}>
                      <RevisionLabel id={r.fromRevisionId} data={data} />
                    </button>{' '}
                    →{' '}
                    <button className="text-button" onClick={() => onSelect(r.toRevisionId)}>
                      <RevisionLabel id={r.toRevisionId} data={data} />
                    </button>
                  </p>
                  <ResearchText>{r.explanation}</ResearchText>
                  <small>
                    Descriptive relation; inference validity is not established by this link.
                  </small>
                </article>
              ))}
            <button
              className="text-button"
              onClick={() => onCompose('propose_relationship', revision.id)}
            >
              Propose a descriptive relation
            </button>
            <h3>Original provenance</h3>
            {revision.sources.map((ref, i) => (
              <SourceQuote key={i} reference={ref} data={data} />
            ))}
            <details>
              <summary>Immutable revision metadata</summary>
              <pre>
                {JSON.stringify(
                  {
                    id: revision.id,
                    parentRevisionId: revision.parentRevisionId,
                    actor: revision.actor,
                    createdAt: revision.createdAt,
                    hash: revision.hash,
                    definitionRevisionIds: revision.definitionRevisionIds,
                  },
                  null,
                  2,
                )}
              </pre>
            </details>
          </>
        ) : (
          <div className="engine-empty">
            <BookOpen size={32} />
            <h2>No admitted research objects</h2>
            <p>
              A project starts empty. Unproved conjectures, useful reformulations, and failed
              attempts can all be admitted with honest labels.
            </p>
            <button className="button primary" onClick={() => onCompose('add_claim')}>
              Propose the first statement
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function ReviewForm({
  data,
  targetId,
  targetRevisionIds,
  defaultScope,
  act,
  busy,
  title,
}: {
  data: EngineData;
  targetId: string;
  targetRevisionIds: string[];
  defaultScope: ReviewRecord['scope'];
  act: (f: () => Promise<unknown>, m?: string) => Promise<void>;
  busy: boolean;
  title: string;
}) {
  const api = useProjectApi(),
    [decision, setDecision] = useState<ReviewRecord['decision']>('endorse'),
    [reason, setReason] = useState(''),
    [scope, setScope] = useState(defaultScope),
    [evidenceIds, setEvidenceIds] = useState<string[]>([]),
    [supersedes, setSupersedes] = useState(''),
    [criterionMappings, setCriterionMappings] = useState<
      Record<string, { resultRevisionId: string; explanation: string }>
    >({});
  const reviews = data.reviews.filter((r) => r.targetId === targetId);
  const targetRevision = data.revisions.find((r) => r.id === targetId);
  const isGoal = data.objects.some((o) => o.id === targetRevision?.objectId && o.kind === 'goal');
  const criteria = ['statement', ...Object.keys(targetRevision?.contract.fields ?? {})];
  return (
    <details className="engine-review-form">
      <summary>{title}</summary>
      <p className="muted">
        This records an attributed human judgment with exact revision scope. It does not impersonate
        a machine proof checker.
      </p>
      {reviews.map((r) => (
        <article className="engine-review" key={r.id}>
          <strong>
            {r.actor} · {r.decision} · {r.scope}
          </strong>
          <p>{r.reason}</p>
          <small>
            {dateLabel(r.createdAt)}
            {r.supersedes ? ` · supersedes ${r.supersedes.slice(-6)}` : ''}
          </small>
        </article>
      ))}
      <form
        className="engine-form"
        onSubmit={(e) => {
          e.preventDefault();
          void act(async () => {
            await api('/engine/reviews', 'POST', {
              targetId,
              targetRevisionIds,
              decision,
              reason,
              scope,
              evidenceIds,
              ...(supersedes ? { supersedes } : {}),
              ...(scope === 'goal_satisfaction' && decision === 'endorse' && isGoal
                ? {
                    criterionMappings: criteria.map((criterion) => ({
                      criterion,
                      ...criterionMappings[criterion],
                    })),
                  }
                : {}),
            });
            setReason('');
          }, 'Attributed review recorded; historical judgments retained');
        }}
      >
        <div className="engine-two-fields">
          <label>
            Decision
            <select
              value={decision}
              onChange={(e) => setDecision(e.target.value as typeof decision)}
            >
              <option value="endorse">Endorse within stated scope</option>
              <option value="challenge">Challenge; preserve disagreement</option>
              <option value="retract">Retract support or judgment</option>
            </select>
          </label>
          <label>
            Judgment scope
            <select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
              {[
                'mathematical',
                'inference',
                'goal_satisfaction',
                'methodological',
                'admission',
              ].map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {scope === 'goal_satisfaction' && isGoal && decision === 'endorse' && (
          <fieldset className="engine-checklist engine-goal-mapping">
            <legend>Explicit satisfaction mapping for every goal criterion</legend>
            {criteria.map((criterion) => (
              <div key={criterion}>
                <p>
                  <strong>{criterion}</strong>:{' '}
                  {criterion === 'statement'
                    ? targetRevision?.statement
                    : targetRevision?.contract.fields?.[criterion]?.value}
                </p>
                <RefSelect
                  label={`Result revision for ${criterion}`}
                  data={data}
                  value={criterionMappings[criterion]?.resultRevisionId ?? ''}
                  onChange={(id) =>
                    setCriterionMappings((v) => ({
                      ...v,
                      [criterion]: {
                        ...v[criterion],
                        resultRevisionId: id,
                        explanation: v[criterion]?.explanation ?? '',
                      },
                    }))
                  }
                />
                <label>
                  {`Why this result establishes ${criterion}`}
                  <textarea
                    required
                    minLength={10}
                    value={criterionMappings[criterion]?.explanation ?? ''}
                    onChange={(e) =>
                      setCriterionMappings((v) => ({
                        ...v,
                        [criterion]: {
                          ...v[criterion],
                          resultRevisionId: v[criterion]?.resultRevisionId ?? '',
                          explanation: e.target.value,
                        },
                      }))
                    }
                    rows={3}
                  />
                </label>
              </div>
            ))}
          </fieldset>
        )}
        <label>
          Reason, exact scope, and verification performed
          <textarea
            rows={4}
            minLength={10}
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <label>
          Supersedes an earlier judgment (optional)
          <select value={supersedes} onChange={(e) => setSupersedes(e.target.value)}>
            <option value="">Keep earlier judgments separately</option>
            {reviews.map((r) => (
              <option key={r.id} value={r.id}>
                {r.actor} · {r.decision} · {short(r.reason)}
              </option>
            ))}
          </select>
        </label>
        {decision === 'endorse' &&
          ['mathematical', 'inference'].includes(scope) &&
          !evidenceIds.length && (
            <p className="engine-warning">
              A mathematical or inference endorsement must cite the exact argument evidence. Attach
              evidence first if it is not yet recorded.
            </p>
          )}
        <fieldset className="engine-checklist">
          <legend>Referenced evidence</legend>
          {data.evidence
            .filter((e) => targetRevisionIds.includes(e.targetRevisionId))
            .map((e) => (
              <label key={e.id}>
                <input
                  type="checkbox"
                  checked={evidenceIds.includes(e.id)}
                  onChange={(x) =>
                    setEvidenceIds(
                      x.target.checked
                        ? [...evidenceIds, e.id]
                        : evidenceIds.filter((id) => id !== e.id),
                    )
                  }
                />
                {label(e.kind)} · {short(e.content)}
              </label>
            ))}
        </fieldset>
        <button className="button" disabled={busy || reason.trim().length < 10}>
          Record human review
        </button>
      </form>
    </details>
  );
}

function DiffView({ data, onRevision }: { data: EngineState; onRevision: (id: string) => void }) {
  const [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [runId, setRunId] = useState('');
  const start = from ? data.commits.findIndex((c) => c.id === from) : -1,
    end = to ? data.commits.findIndex((c) => c.id === to) : data.commits.length - 1;
  const commits = data.commits.filter(
    (c, i) =>
      i > start &&
      i <= end &&
      (!runId || data.runs.find((r) => r.id === runId)?.commitIds.includes(c.id)),
  );
  return (
    <section className="panel engine-detail">
      <div className="engine-section-heading">
        <div>
          <span className="eyebrow">DETERMINISTIC COMMIT JOURNAL</span>
          <h2>What actually changed?</h2>
        </div>
        <History size={24} />
      </div>
      <p className="muted">
        This view is generated from accepted operations and exact revision references. Model output
        without an accepted commit produces no research-state change.
      </p>
      <div className="engine-three-fields">
        <label>
          After commit
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">Project beginning</option>
            {data.commits.map((c, i) => (
              <option value={c.id} key={c.id}>
                {i + 1}. {data.changeSets.find((p) => p.id === c.changeSetId)?.title ?? c.id}
              </option>
            ))}
          </select>
        </label>
        <label>
          Through commit
          <select value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Current head</option>
            {data.commits.map((c, i) => (
              <option value={c.id} key={c.id}>
                {i + 1}. {data.changeSets.find((p) => p.id === c.changeSetId)?.title ?? c.id}
              </option>
            ))}
          </select>
        </label>
        <label>
          Run filter
          <select value={runId} onChange={(e) => setRunId(e.target.value)}>
            <option value="">All runs and manual changes</option>
            {data.runs.map((r) => (
              <option key={r.id} value={r.id}>
                {short(r.question)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {end < start && (
        <p role="alert" className="engine-warning">
          Select a final commit at or after the starting commit.
        </p>
      )}
      {!commits.length && (
        <div className="engine-empty">
          <h3>No accepted research-state change</h3>
          <p>
            No commits fall in this range. Sources, conversation, and proposals may still have been
            recorded.
          </p>
        </div>
      )}
      {[...commits].reverse().map((commit) => (
        <article key={commit.id} className="engine-commit">
          <div className="engine-section-heading">
            <h3>
              {data.changeSets.find((p) => p.id === commit.changeSetId)?.title ?? 'Research commit'}
            </h3>
            <time>{dateLabel(commit.createdAt)}</time>
          </div>
          <p className="small muted">
            {commit.actor} · commit {commit.id.slice(-8)} · {commit.acceptedOperationIds.length}{' '}
            operations · {commit.reviewIds.length} admission reviews
          </p>
          {commit.diff.map((d, i) => (
            <div key={i} className="engine-diff-entry">
              <span className="engine-pill">{label(d.category)}</span>
              <p>{d.description}</p>
              <div className="engine-actions">
                {d.beforeRevisionId && (
                  <button className="text-button" onClick={() => onRevision(d.beforeRevisionId!)}>
                    Inspect before @{d.beforeRevisionId.slice(-6)}
                  </button>
                )}
                {d.afterRevisionId && (
                  <button className="text-button" onClick={() => onRevision(d.afterRevisionId!)}>
                    Inspect after @{d.afterRevisionId.slice(-6)}
                  </button>
                )}
              </div>
              {d.sources.map((s, j) => (
                <SourceQuote key={j} reference={s} data={data} />
              ))}
            </div>
          ))}
          <details>
            <summary>Read set, checks, and review records</summary>
            <div>
              {commit.reviewIds.map((id) => {
                const review = data.reviews.find((r) => r.id === id);
                return review ? (
                  <article className="engine-review" key={id}>
                    <strong>
                      {review.actor} · {review.decision} · {review.scope}
                    </strong>
                    <p>{review.reason}</p>
                  </article>
                ) : (
                  <p key={id}>{id}</p>
                );
              })}
            </div>
            <pre>
              {JSON.stringify(
                {
                  commitId: commit.id,
                  parentCommitId: commit.parentCommitId,
                  readSet: commit.readSet,
                  checkIds: commit.checkIds,
                  acceptedOperationIds: commit.acceptedOperationIds,
                },
                null,
                2,
              )}
            </pre>
          </details>
        </article>
      ))}
      <details className="engine-support">
        <summary>Current derived support and surviving alternatives</summary>
        <p>
          Derived from the current record; historical judgments are preserved on their original
          revisions.
        </p>
        <pre>{JSON.stringify(data.support, null, 2)}</pre>
      </details>
    </section>
  );
}

function Continuity({
  data,
  act,
  busy,
}: {
  data: EngineData;
  act: (fn: () => Promise<unknown>, message?: string) => Promise<void>;
  busy: boolean;
}) {
  const api = useProjectApi(),
    [query, setQuery] = useState(''),
    [goalId, setGoalId] = useState(''),
    [context, setContext] = useState<{ manifest: ContextManifest; text: string } | null>(null),
    [importOpen, setImportOpen] = useState(false),
    [question, setQuestion] = useState(''),
    [criterion, setCriterion] = useState(''),
    [provider, setProvider] = useState('External assistant'),
    [model, setModel] = useState('Not supplied'),
    [text, setText] = useState(''),
    [externalId, setExternalId] = useState<string>(crypto.randomUUID()),
    [checkpointId, setCheckpointId] = useState('checkpoint-1');
  return (
    <div className="engine-continuity">
      <section className="panel engine-detail">
        <div className="engine-section-heading">
          <div>
            <span className="eyebrow">NEXT-SESSION CONTEXT</span>
            <h2>Resume from the research record</h2>
          </div>
          <button className="button" onClick={() => setImportOpen(true)}>
            <Upload size={15} />
            Import external run
          </button>
        </div>
        <form
          className="engine-form"
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () =>
              setContext(
                await api('/engine/context', 'POST', {
                  query,
                  ...(goalId ? { goalRevisionId: goalId } : {}),
                  limit: 24,
                }),
              ),
            );
          }}
        >
          <label>
            Next research question
            <textarea
              rows={3}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="What should the next session investigate or avoid repeating?"
            />
          </label>
          <label>
            Exact goal revision (optional)
            <select value={goalId} onChange={(e) => setGoalId(e.target.value)}>
              <option value="">Across this project</option>
              {data.objects
                .filter((o) => o.kind === 'goal')
                .map((o) => (
                  <option key={o.id} value={o.currentRevisionId}>
                    {o.title} @{o.currentRevisionId.slice(-6)}
                  </option>
                ))}
            </select>
          </label>
          <button className="button primary" disabled={busy}>
            Build bounded context
          </button>
        </form>
        {context && (
          <>
            <h3>Context packet</h3>
            <ContextPacket text={context.text} />
            <button
              className="button"
              onClick={() => saveJson(context, `${data.project.title}-context.json`)}
            >
              Download context and manifest
            </button>
            <div className="engine-manifest">
              <h3>Included and omitted</h3>
              <p>
                {context.manifest.selectedRevisionIds.length} selected revisions ·{' '}
                {context.manifest.sourceIds.length} sources · approximately{' '}
                {context.manifest.tokenEstimate} tokens
              </p>
              <ul>
                {context.manifest.selectedRevisionIds.map((id) => (
                  <li key={id}>
                    <RevisionLabel id={id} data={data} /> —{' '}
                    {context.manifest.reasons[id] ?? 'Selected by retrieval'}
                  </li>
                ))}
              </ul>
              <details>
                <summary>{context.manifest.omittedIds.length} omitted records</summary>
                <ul>
                  {context.manifest.omittedIds.map((id) => (
                    <li key={id}>
                      {id} — {context.manifest.reasons[id] ?? 'Outside this bounded packet'}
                    </li>
                  ))}
                </ul>
              </details>
              {context.manifest.limitations.map((s, i) => (
                <p className="muted" key={i}>
                  {s}
                </p>
              ))}
            </div>
          </>
        )}
      </section>
      <section className="panel engine-detail">
        <h2>Runs and checkpoints</h2>
        <p className="muted">
          A run records its own project, starting state, question, budget, outputs, and errors.
          External run imports remain untrusted execution reports.
        </p>
        {data.runs.length ? (
          [...data.runs].reverse().map((run) => (
            <details className="engine-run" key={run.id}>
              <summary>
                {run.question} <span className="engine-pill">{label(run.state)}</span>
              </summary>
              <p>
                <strong>Progress criterion:</strong> {run.progressCriterion || 'Not supplied'}
              </p>
              <p>
                {run.provider} · {run.model} · {label(run.executionTrust)}
              </p>
              <p>
                {run.sourceIds.length} sources · {run.changeSetIds.length} proposals ·{' '}
                {run.commitIds.length} accepted commits
              </p>
              {!run.commitIds.length && <p>No accepted research-state change.</p>}
              {run.errors.map((e, i) => (
                <p role="alert" key={i}>
                  {e}
                </p>
              ))}
              <pre>
                {JSON.stringify(
                  {
                    contextManifest: run.contextManifest,
                    budget: run.budget,
                    baseCommitId: run.baseCommitId,
                    checkpointIds: run.checkpointIds,
                    createdAt: run.createdAt,
                    updatedAt: run.updatedAt,
                  },
                  null,
                  2,
                )}
              </pre>
            </details>
          ))
        ) : (
          <p className="engine-empty">
            No recorded runs yet. Manual source capture and reviewed proposals remain available.
          </p>
        )}
      </section>
      {importOpen && (
        <Modal title="Import an external research run" onClose={() => setImportOpen(false)}>
          <form
            className="engine-form"
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                await api('/engine/runs/import', 'POST', {
                  formatVersion: 1,
                  externalId,
                  question,
                  progressCriterion: criterion,
                  provider,
                  model,
                  checkpoints: [{ id: checkpointId, text }],
                  state: 'awaiting_review',
                });
                setImportOpen(false);
              }, 'External run preserved as an untrusted import');
            }}
          >
            <div className="engine-two-fields">
              <label>
                External run ID
                <input
                  required
                  value={externalId}
                  onChange={(e) => setExternalId(e.target.value)}
                />
              </label>
              <label>
                Checkpoint ID
                <input
                  required
                  value={checkpointId}
                  onChange={(e) => setCheckpointId(e.target.value)}
                />
              </label>
            </div>
            <p className="muted">
              Reuse the run ID with a new checkpoint ID to append checkpoints without duplicating
              earlier imports.
            </p>
            <label>
              Research question
              <input required value={question} onChange={(e) => setQuestion(e.target.value)} />
            </label>
            <label>
              Expected progress criterion
              <textarea rows={3} value={criterion} onChange={(e) => setCriterion(e.target.value)} />
            </label>
            <div className="engine-two-fields">
              <label>
                Reported provider
                <input value={provider} onChange={(e) => setProvider(e.target.value)} />
              </label>
              <label>
                Reported model
                <input value={model} onChange={(e) => setModel(e.target.value)} />
              </label>
            </div>
            <MathEditor
              label="Original external run output"
              value={text}
              onChange={setText}
              rows={10}
              required
            />
            <p className="muted">
              These names are supplied metadata. The run is imported as awaiting review. Importing
              does not create a trusted local checker result or admit any claims.
            </p>
            <button className="button primary" disabled={busy || !text.trim()}>
              Import private run
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}

function Publication({
  data,
  act,
  busy,
}: {
  data: EngineData;
  act: (fn: () => Promise<unknown>, message?: string) => Promise<void>;
  busy: boolean;
}) {
  const api = useProjectApi(),
    { change, reload: reloadProjects } = useProjectScope(),
    [selected, setSelected] = useState<string[]>([]),
    [title, setTitle] = useState(data.project.title),
    [preview, setPreview] = useState<{
      preview: Pick<PublicationSnapshot, 'title' | 'revisions'>;
      previewHash: string;
    } | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [retractId, setRetractId] = useState(''),
    [retractReason, setRetractReason] = useState(''),
    [importText, setImportText] = useState(''),
    [importConfirm, setImportConfirm] = useState(false);
  return (
    <div className="engine-continuity">
      <section className="panel engine-detail">
        <span className="eyebrow">EXPLICIT, REVISION-BOUND VISIBILITY</span>
        <h2>Publish a selected snapshot</h2>
        <p>
          Private admission never publishes a statement. Later private revisions do not update a
          published snapshot. Inspect every sentence below, including copied source material, before
          publishing.
        </p>
        <label className="engine-field">
          Snapshot title
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setPreview(null);
              setConfirmed(false);
            }}
          />
        </label>
        <RevisionChecks
          title="Select current revisions for publication"
          data={data}
          values={selected}
          onChange={(ids) => {
            setSelected(ids);
            setPreview(null);
            setConfirmed(false);
          }}
        />
        <button
          className="button"
          disabled={busy || !selected.length}
          onClick={() =>
            act(async () => {
              setPreview(
                await api('/engine/publications/preview', 'POST', { revisionIds: selected, title }),
              );
              setConfirmed(false);
            })
          }
        >
          Preview exact public content
        </button>
        {preview && (
          <div className="engine-publication-preview">
            <h3>Exact publication preview: {preview.preview.title}</h3>
            <p className="muted">
              Only the displayed snapshot content is selected. Private sources, chats, reviews,
              context, and commit history are not included.
            </p>
            {preview.preview.revisions.map((r) => (
              <article key={r.id}>
                <span className="engine-pill">{label(r.kind)}</span>
                <h3>{r.title}</h3>
                <ResearchText>{r.statement}</ResearchText>
              </article>
            ))}
            <details>
              <summary>Inspect exact public JSON</summary>
              <pre>{JSON.stringify(preview.preview, null, 2)}</pre>
            </details>
            <label className="engine-inline-label">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I reviewed every displayed statement and confirm it is intended for public sharing.
            </label>
            <div className="engine-actions">
              <button
                className="button primary"
                disabled={busy || !confirmed}
                onClick={() =>
                  act(async () => {
                    await api('/engine/publications', 'POST', {
                      revisionIds: selected,
                      title,
                      previewHash: preview.previewHash,
                      confirm: true,
                    });
                    setPreview(null);
                    setConfirmed(false);
                  }, 'Selected public snapshot saved; later edits remain private')
                }
              >
                Publish this exact snapshot
              </button>
              <button
                className="button"
                onClick={() => saveJson(preview.preview, `${title}-public-preview.json`)}
              >
                Download public-safe preview
              </button>
            </div>
          </div>
        )}
        <h3>Publication history</h3>
        {data.publications.length ? (
          [...data.publications].reverse().map((p) => (
            <article className="engine-publication-item" key={p.id}>
              <strong>{p.title}</strong>
              <p>
                {p.active ? 'Published snapshot' : 'Retracted snapshot'} · {p.revisions.length}{' '}
                selected revisions · {dateLabel(p.createdAt)}
              </p>
              <details>
                <summary>View fixed public snapshot</summary>
                {p.revisions.map((r) => (
                  <article key={r.id}>
                    <h4>{r.title}</h4>
                    <ResearchText>{r.statement}</ResearchText>
                  </article>
                ))}
              </details>
              <div className="engine-actions">
                <button
                  className="button"
                  onClick={() =>
                    saveJson({ title: p.title, revisions: p.revisions }, `${p.title}-public.json`)
                  }
                >
                  Public-safe export
                </button>
                {p.active && (
                  <button
                    className="text-button"
                    onClick={() => {
                      setRetractId(p.id);
                      setRetractReason('');
                    }}
                  >
                    Retract publication
                  </button>
                )}
              </div>
              {p.retractionReason && <p>Retraction reason: {p.retractionReason}</p>}
            </article>
          ))
        ) : (
          <p className="muted">No explicit publication snapshots in this project.</p>
        )}
      </section>
      <section className="panel engine-detail">
        <h2>Private project backup</h2>
        <p>
          Private exports include source text, review notes, revisions, and history. Keep them
          private. They do not include model credentials.
        </p>
        <button
          className="button"
          onClick={() =>
            act(async () =>
              saveJson(await api('/engine/export'), `${data.project.title}-private-backup.json`),
            )
          }
        >
          Download private project export
        </button>
        <details className="engine-import">
          <summary>Import a validated project export</summary>
          <p>
            Import validates the schema and references, then creates a new private project with
            remapped identities. Imported review and execution claims do not inherit local trust.
            Preserve the original backup.
          </p>
          <label className="engine-field">
            Export JSON
            <textarea
              rows={10}
              value={importText}
              onChange={(e) => {
                setImportText(e.target.value);
                setImportConfirm(false);
              }}
            />
          </label>
          <label className="engine-inline-label">
            <input
              type="checkbox"
              checked={importConfirm}
              onChange={(e) => setImportConfirm(e.target.checked)}
            />
            I intend to create a new private project from these exported records.
          </label>
          <button
            className="button"
            disabled={busy || !importConfirm || !importText.trim()}
            onClick={() =>
              act(async () => {
                const result = await api<{ project: { id: string } }>(
                  '/engine/import',
                  'POST',
                  JSON.parse(importText),
                );
                await reloadProjects();
                setImportText('');
                setImportConfirm(false);
                change(result.project.id);
              }, 'Project export validated and imported')
            }
          >
            Validate and import privately
          </button>
        </details>
      </section>
      {retractId && (
        <Modal title="Retract a public snapshot" onClose={() => setRetractId('')}>
          <form
            className="engine-form"
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                await api(`/engine/publications/${retractId}/retract`, 'POST', {
                  reason: retractReason,
                });
                setRetractId('');
              }, 'Publication retracted; private history retained');
            }}
          >
            <label>
              Public retraction reason
              <textarea
                rows={4}
                required
                minLength={10}
                value={retractReason}
                onChange={(e) => setRetractReason(e.target.value)}
              />
            </label>
            <button className="button primary" disabled={busy || retractReason.length < 10}>
              Retract this snapshot
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}

function ContextPacket({ text }: { text: string }) {
  const packet = useMemo(() => {
    try {
      return JSON.parse(text) as {
        research?: {
          kind: string;
          title: string;
          revision: ResearchRevision;
          support?: { status: string; explanations: string[] };
        }[];
        openObligations?: { id: string; title: string; statement: string }[];
      };
    } catch {
      return null;
    }
  }, [text]);
  if (!Array.isArray(packet?.research)) return <ResearchText>{text}</ResearchText>;
  return (
    <div className="engine-context-packet">
      {packet.research.map((item, i) => (
        <article className="engine-artifact" key={i}>
          <span className="engine-pill">
            {label(item.kind)} · {label(item.support?.status ?? 'unknown')}
          </span>
          <h3>{item.title}</h3>
          <ResearchText>{item.revision.statement}</ResearchText>
          <ContractView contract={item.revision.contract} />
          {item.support?.explanations.map((reason, j) => (
            <p className="muted" key={j}>
              {reason}
            </p>
          ))}
        </article>
      ))}
      {!!packet.openObligations?.length && (
        <>
          <h3>Remaining proof obligations</h3>
          {packet.openObligations.map((o) => (
            <article className="engine-artifact" key={o.id}>
              <strong>{o.title}</strong>
              <ResearchText>{o.statement}</ResearchText>
            </article>
          ))}
        </>
      )}
      <details>
        <summary>Exact context packet</summary>
        <pre>{text}</pre>
      </details>
    </div>
  );
}
