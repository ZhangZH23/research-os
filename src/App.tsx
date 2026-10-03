import Program, { programNodeIds } from './Program';
import ContributionEditor from './ContributionEditor';
import ResearchChat from './ResearchChat';
import Workbench from './Workbench';
import type { ProgramState } from '../shared/program';
import HistoryMathematics from './HistoryMathematics';
import ResearchText from './ResearchText';
import { researchTextLabel } from '../shared/math';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  MessagesSquare,
  Flag,
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Command,
  Database,
  FlaskConical,
  GitBranch,
  LayoutDashboard,
  Lightbulb,
  Menu,
  Network,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  TriangleAlert,
  Upload,
  X,
  CircleHelp,
  FileText,
  Check,
  Link2,
  Clock3,
} from 'lucide-react';
import {
  CLAIM_TYPES,
  NODE_TYPES,
  STATUSES,
  ORIGINS,
  type ResearchState,
  type ResearchNode,
  type NodeInput,
  type EdgeInput,
  type ActivityEvent,
} from '../shared/types';
import { belief, frontier } from '../shared/epistemics';
import { api } from './api';
import { Badge, TypeIcon, dateLabel, timeLabel } from './ui';
import Graph from './Graph';
import Inspector from './Inspector';
import Ingest from './Ingest';
import { NodeEditor, EdgeEditor } from './NodeEditor';
const navigation = [
  { id: 'workbench', name: 'Research Notebook', icon: BookOpen },
  { id: 'program', name: 'Research Program', icon: Flag },
  { id: 'chat', name: 'Research Chat', icon: MessagesSquare },
  { id: 'overview', name: 'Overview', icon: LayoutDashboard },
  { id: 'graph', name: 'Research Graph', icon: Network },
  { id: 'claims', name: 'Claims', icon: FileText },
  { id: 'questions', name: 'Open Questions', icon: CircleHelp },
  { id: 'experiments', name: 'Experiments', icon: FlaskConical },
  { id: 'frontier', name: 'Research Frontier', icon: Target },
  { id: 'ingest', name: 'Ingest Session', icon: Upload },
  { id: 'activity', name: 'Activity', icon: Activity },
];
const initialPage = () => {
  const hash = location.hash.slice(1);
  return navigation.some((n) => n.id === hash) ? hash : 'workbench';
};
type EditState = { node?: ResearchNode; preset?: Partial<NodeInput>; link?: Partial<EdgeInput> };
export default function App() {
  const [state, setState] = useState<ResearchState | null>(null);
  const canEdit = state?.canEdit === true;
  const [program, setProgram] = useState<ProgramState>({ goals: [], assessments: [] });
  const [assessing, setAssessing] = useState<ResearchNode | null>(null);
  const [goalFilter, setGoalFilter] = useState('');
  const [chatIntent, setChatIntent] = useState<{
    prompt: string;
    goalId?: string;
    nodeIds?: string[];
  } | null>(null);
  const [loadError, setLoadError] = useState('');
  const [page, setPage] = useState(initialPage);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [edge, setEdge] = useState<Partial<EdgeInput> | null>(null);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [origin, setOrigin] = useState('');
  const [tag, setTag] = useState('');
  const [dependency, setDependency] = useState('');
  const [filters, setFilters] = useState(false);
  const [toast, setToast] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const [briefing, setBriefing] = useState('');
  const [briefBusy, setBriefBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const refresh = useCallback(async () => {
    const [data, programData] = await Promise.all([
      api<ResearchState>('/state'),
      api<ProgramState>('/program'),
    ]);
    setState(data);
    setProgram(programData);
    setLoadError('');
  }, []);
  useEffect(() => {
    refresh().catch((e) => setLoadError(e.message));
  }, [refresh]);
  const notify = useCallback((message: string) => setToast(message), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  const navigate = useCallback((p: string) => {
    setPage(p);
    location.hash = p;
    setSearch('');
    setType('');
    setStatus('');
    setOrigin('');
    setTag('');
    setDependency('');
    setGoalFilter('');
    setMobileNav(false);
    setSelected(null);
  }, []);
  useEffect(() => {
    const handler = () => setPage(initialPage());
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === 'Escape') {
        setSelected(null);
        setMobileNav(false);
      }
      if (
        canEdit &&
        e.key === 'n' &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement) &&
        !(e.target instanceof HTMLSelectElement) &&
        !e.metaKey &&
        !e.ctrlKey
      ) {
        setEditing({});
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [canEdit]);
  useEffect(() => {
    if (state && !canEdit && ['workbench', 'chat', 'ingest', 'activity'].includes(page))
      navigate('program');
  }, [state, canEdit, page, navigate]);
  const ranked = useMemo(() => (state ? frontier(state.nodes, state.edges) : []), [state]);
  const searchIndex = useMemo(
    () =>
      new Map(
        state?.nodes.map((n) => [
          n.id,
          [
            n.title,
            n.summary,
            n.content,
            ...n.tags,
            researchTextLabel(n.title),
            researchTextLabel(n.summary),
            researchTextLabel(n.content),
          ]
            .join(' ')
            .toLowerCase(),
        ]) ?? [],
      ),
    [state?.nodes],
  );
  const focusedNodeIds = useMemo(
    () => (goalFilter && state ? programNodeIds(goalFilter, program, state) : null),
    [goalFilter, program, state],
  );
  const visible = useMemo(() => {
    if (!state) return [];
    return state.nodes.filter((n) => {
      if (!search && page === 'graph' && focusedNodeIds && !focusedNodeIds.has(n.id)) return false;
      if (search) {
        const terms = search.toLowerCase().split(/\s+/);
        if (!terms.every((t) => searchIndex.get(n.id)?.includes(t))) return false;
      }
      if (
        (type && n.type !== type) ||
        (status && n.epistemicStatus !== status) ||
        (origin && n.originType !== origin) ||
        (tag && !n.tags.includes(tag))
      )
        return false;
      if (
        dependency &&
        !state.edges.some(
          (e) =>
            e.sourceNodeId === n.id && e.targetNodeId === dependency && e.edgeType === 'depends_on',
        )
      )
        return false;
      if (!search && page === 'claims' && !CLAIM_TYPES.includes(n.type)) return false;
      if (!search && page === 'questions' && n.type !== 'Open Question') return false;
      if (!search && page === 'experiments' && n.type !== 'Experiment') return false;
      return true;
    });
  }, [state, searchIndex, focusedNodeIds, search, type, status, origin, tag, dependency, page]);
  const closeEditor = useCallback(() => setEditing(null), []);
  const closeEdge = useCallback(() => setEdge(null), []);
  async function saveNode(input: NodeInput, reason: string) {
    if (editing?.node) {
      await api(`/nodes/${editing.node.id}`, 'PATCH', { ...input, reason });
    } else {
      const result = editing?.link
        ? await api<ResearchNode>('/nodes-with-relationship', 'POST', {
            node: input,
            link: { ...editing.link, explanation: 'Added from the research item inspector' },
          })
        : await api<ResearchNode>('/nodes', 'POST', input);
      setSelected(result.id);
    }
    await refresh();
    notify(editing?.node ? 'Research item updated' : 'Research item created');
  }
  const discuss = (prompt: string, goalId?: string, nodeIds?: string[]) => {
    if (!canEdit) return;
    navigate('workbench');
    setChatIntent({ prompt, goalId, nodeIds });
  };
  const exploreGoal = (id: string) => {
    navigate('graph');
    setGoalFilter(id);
  };
  if (!state)
    return (
      <div className="loading-screen">
        <div className="brand-mark">
          R<span>·</span>
        </div>
        <h1>Research OS</h1>
        {loadError ? (
          <>
            <p role="alert">{loadError}</p>
            <p className="small muted">
              Check your internet connection and that you are signed in, then retry.
            </p>
            <button
              className="button primary"
              onClick={() => refresh().catch((e) => setLoadError(e.message))}
            >
              Retry connection
            </button>
          </>
        ) : (
          <p>Opening your research workspace…</p>
        )}
      </div>
    );
  const nodes = state.nodes;
  const claims = nodes.filter((n) => CLAIM_TYPES.includes(n.type));
  const proofCount = claims.filter((n) => n.epistemicStatus === 'Proved').length;
  const warnings = nodes.filter(
    (n) => CLAIM_TYPES.includes(n.type) && belief(n.id, nodes, state.edges).warnings.length,
  );
  const mainBlockers = ranked.filter((r) => r.downstream > 0);
  const approaches = nodes.filter(
    (n) =>
      n.type === 'Approach' &&
      !['Abandoned', 'Disproved', 'Superseded'].includes(n.epistemicStatus),
  );
  const selectNode = (id: string) => setSelected(id);
  const nodeRows = (list: ResearchNode[]) =>
    list.length ? (
      <div className="table-scroll">
        <table className="research-table">
          <thead>
            <tr>
              <th>Research item</th>
              <th>Status</th>
              <th>Origin</th>
              <th>Updated</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((n) => (
              <tr key={n.id} onClick={() => setSelected(n.id)}>
                <td>
                  <button
                    className="table-title"
                    aria-label={researchTextLabel(n.title)}
                    onClick={() => setSelected(n.id)}
                  >
                    <TypeIcon type={n.type} />
                    <div>
                      <strong>
                        <ResearchText inline>{n.title}</ResearchText>
                      </strong>
                      <span>
                        {n.type}{' '}
                        {n.tags
                          .slice(0, 2)
                          .map((t) => ` · #${t}`)
                          .join('')}
                      </span>
                    </div>
                  </button>
                </td>
                <td>
                  <Badge status={n.epistemicStatus} />
                </td>
                <td>
                  <span className={`origin-label ${n.originType.startsWith('AI') ? 'ai' : ''}`}>
                    {n.originType}
                  </span>
                </td>
                <td className="muted small">{dateLabel(n.updatedAt)}</td>
                <td>
                  <ChevronRight size={16} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <div className="empty-state">
        <Search size={28} />
        <h3>No matching research items</h3>
        <p>Try a broader search or clear the filters.</p>
      </div>
    );
  const eventRows = (events: ActivityEvent[], compact = false) => (
    <div className={`activity-list ${compact ? 'compact' : ''}`}>
      {[...events]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((e) => {
          const prev = e.previousValue ? JSON.parse(e.previousValue) : null;
          const next = e.newValue ? JSON.parse(e.newValue) : null;
          return (
            <article key={e.id}>
              <div className={`event-icon ${e.eventType === 'status_changed' ? 'changed' : ''}`}>
                {e.eventType === 'status_changed' ? (
                  <GitBranch size={15} />
                ) : e.eventType === 'edge_created' ? (
                  <Link2 size={15} />
                ) : (
                  <Plus size={15} />
                )}
              </div>
              <div className="event-body">
                <button
                  onClick={() =>
                    e.nodeId && nodes.some((n) => n.id === e.nodeId)
                      ? setSelected(e.nodeId)
                      : notify('This item was deleted. Its event snapshots remain available below.')
                  }
                >
                  <strong>
                    <ResearchText inline>{e.nodeTitle}</ResearchText>
                  </strong>
                </button>
                <p>{e.eventType.replaceAll('_', ' ')}</p>
                {!compact && <ResearchText className="research-summary">{e.reason}</ResearchText>}
                {e.eventType === 'status_changed' && (
                  <div className="history-status">
                    <Badge status={prev.epistemicStatus} />
                    <span>→</span>
                    <Badge status={next.epistemicStatus} />
                  </div>
                )}
                {!compact && <HistoryMathematics before={prev} after={next} />}
                {!compact && (
                  <details>
                    <summary>Inspect event</summary>
                    <pre>
                      {JSON.stringify({ reason: e.reason, before: prev, after: next }, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
              <time title={timeLabel(e.createdAt)}>{dateLabel(e.createdAt)}</time>
            </article>
          );
        })}
      {!events.length && <p className="empty-inline">No activity recorded.</p>}
    </div>
  );
  const filterBar = (
    <div className="filters-bar">
      <div className="filter-main">
        <SlidersHorizontal size={15} />
        <select aria-label="Filter by type" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          {NODE_TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <select
          aria-label="Filter by status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          {STATUSES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <select
          aria-label="Filter by origin"
          value={origin}
          onChange={(e) => setOrigin(e.target.value)}
        >
          <option value="">All origins</option>
          {ORIGINS.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <button className="text-button" onClick={() => setFilters(!filters)}>
          {filters ? 'Fewer filters' : 'More filters'}
        </button>
        {(type || status || origin || tag || dependency) && (
          <button
            className="text-button"
            onClick={() => {
              setType('');
              setStatus('');
              setOrigin('');
              setTag('');
              setDependency('');
            }}
          >
            Clear
          </button>
        )}
        <span className="filter-count">{visible.length} items</span>
      </div>
      {filters && (
        <div className="extra-filters">
          <select aria-label="Filter by tag" value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">All tags</option>
            {[...new Set(nodes.flatMap((n) => n.tags))].sort().map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <select
            aria-label="Depending on"
            value={dependency}
            onChange={(e) => setDependency(e.target.value)}
          >
            <option value="">Depending on any item</option>
            {nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {researchTextLabel(n.title)}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
  return (
    <div className={`app-shell ${canEdit ? 'owner-view' : 'public-view'}`}>
      {mobileNav && <div className="nav-shade" onClick={() => setMobileNav(false)} />}
      <aside className={`sidebar ${mobileNav ? 'open' : ''}`}>
        <button className="brand" onClick={() => navigate('overview')}>
          <span className="brand-mark">
            R<span>·</span>
          </span>
          <span>
            Research OS<small>YOUR RESEARCH, IN CONTEXT</small>
          </span>
        </button>
        <div className="workspace-switch">
          <div className="workspace-avatar">
            <GitBranch size={19} />
          </div>
          <div>
            <strong>Hidden Derivatives</strong>
            <span>Research workspace</span>
          </div>
          <ChevronDown size={15} />
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav>
          {navigation
            .filter((n) => canEdit || !['workbench', 'chat', 'ingest', 'activity'].includes(n.id))
            .map((n) => (
              <button
                key={n.id}
                className={page === n.id && !search ? 'active' : ''}
                onClick={() => navigate(n.id)}
              >
                <n.icon size={18} />
                <span>{n.name}</span>
                {n.id === 'questions' && (
                  <small>{nodes.filter((n) => n.type === 'Open Question').length}</small>
                )}
                {n.id === 'frontier' && <span className="nav-dot" />}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-mode">
            <Database size={16} />
            <div>
              <strong>Public research workspace</strong>
              <span>{canEdit ? 'Owner editing access' : 'Browse the research'}</span>
            </div>
            <i />
          </div>
          <div className="user-row">
            <span className="user-avatar">R</span>
            <div>
              <strong>Researcher</strong>
              <span>{canEdit ? 'Workspace owner' : 'Public visitor'}</span>
            </div>
            <span className="version">v0.3</span>
          </div>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobileNav(!mobileNav)}
            >
              <Menu size={20} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{search ? 'Search' : navigation.find((n) => n.id === page)?.name}</strong>
          </div>
          <div className="global-search">
            <Search size={16} />
            <input
              ref={searchRef}
              aria-label="Search research"
              placeholder="Search research…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search ? (
              <button
                className="icon-button"
                aria-label="Clear search"
                onClick={() => setSearch('')}
              >
                <X size={14} />
              </button>
            ) : (
              <kbd>⌘ K</kbd>
            )}
          </div>
          <button
            data-owner-control
            aria-label="New item"
            className="button primary new-item"
            onClick={() => setEditing({})}
          >
            <Plus size={16} />
            <span>New item</span>
          </button>
        </header>
        <div className="public-access-banner">
          <span>
            {canEdit
              ? 'Your research graph and goals are public. Editing and conversations are private to you.'
              : 'Public research · read-only. Explore the graph, goals, and contribution assessments.'}
          </span>
          {!canEdit && (
            <a href="/signin-with-chatgpt?return_to=%2F" target="_top">
              Owner sign in
            </a>
          )}
        </div>
        <main className={`main-content ${page === 'graph' && !search ? 'graph-page' : ''}`}>
          {search ? (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">ACROSS YOUR RESEARCH</span>
                  <h1>Search results</h1>
                  <p>Matching titles, summaries, content, and tags for “{search}”.</p>
                </div>
              </div>
              <section className="panel">
                {filterBar}
                {nodeRows(visible)}
              </section>
            </>
          ) : page === 'workbench' && canEdit ? (
            <Workbench
              state={state}
              program={program}
              onRefresh={refresh}
              onSelect={selectNode}
              notify={notify}
              initialPrompt={chatIntent?.prompt}
              initialGoalId={chatIntent?.goalId}
              initialNodeIds={chatIntent?.nodeIds}
              onPromptConsumed={() => setChatIntent(null)}
            />
          ) : page === 'program' ? (
            <Program
              state={state}
              program={program}
              onRefresh={refresh}
              onSelect={selectNode}
              onDiscuss={discuss}
              onAssess={setAssessing}
              onGraph={exploreGoal}
            />
          ) : page === 'chat' && canEdit ? (
            <ResearchChat
              state={state}
              program={program}
              onRefresh={refresh}
              onSelect={selectNode}
              notify={notify}
              initialPrompt={chatIntent?.prompt}
              initialGoalId={chatIntent?.goalId}
              initialNodeIds={chatIntent?.nodeIds}
              onPromptConsumed={() => setChatIntent(null)}
            />
          ) : page === 'overview' ? (
            <>
              <div className="page-heading overview-heading">
                <div>
                  <div className="project-kicker">
                    <span className="eyebrow">PROJECT OVERVIEW</span>
                    <span className="project-tag">THEORETICAL COMPUTER SCIENCE</span>
                  </div>
                  <h1>Hidden derivatives</h1>
                  <ResearchText className="research-summary">{state.project.title}</ResearchText>
                </div>
                <button className="button secondary" onClick={() => navigate('graph')}>
                  <Network size={16} />
                  Explore graph
                </button>
              </div>
              <div className="demo-note">
                <BookOpen size={14} />
                <span>
                  Illustrative research project. Elementary proofs, speculative extensions, and a
                  deliberately flagged AI argument.
                </span>
                <span className="demo-pill">DEMO</span>
              </div>
              <div className="stat-grid">
                {[
                  {
                    label: 'Research items',
                    value: nodes.length,
                    sub: `${state.edges.length} connections`,
                    icon: Network,
                    cls: '',
                  },
                  {
                    label: 'Claims & results',
                    value: claims.length,
                    sub: `${proofCount} marked proved`,
                    icon: FileText,
                    cls: '',
                  },
                  {
                    label: 'Unverified',
                    value: nodes.filter((n) => n.epistemicStatus === 'Unverified').length,
                    sub: 'Awaiting investigation',
                    icon: CircleHelp,
                    cls: 'amber',
                  },
                  {
                    label: 'Disproved',
                    value: nodes.filter((n) => n.epistemicStatus === 'Disproved').length,
                    sub: 'Knowledge, not lost work',
                    icon: ShieldCheck,
                    cls: 'rose',
                  },
                  {
                    label: 'Open questions',
                    value: nodes.filter((n) => n.type === 'Open Question').length,
                    sub: `${approaches.length} active approach`,
                    icon: Lightbulb,
                    cls: 'green',
                  },
                ].map((s) => (
                  <div className="stat" key={s.label}>
                    <span className="stat-label">
                      {s.label}
                      <s.icon size={16} />
                    </span>
                    <strong className={s.cls}>{s.value.toString().padStart(2, '0')}</strong>
                    <small>{s.sub}</small>
                  </div>
                ))}
              </div>
              <div className="overview-grid">
                <section className="panel frontier-preview">
                  <div className="panel-title">
                    <h2>
                      <Target size={19} />
                      At the frontier
                    </h2>
                    <button className="text-button" onClick={() => navigate('frontier')}>
                      View frontier <ChevronRight size={14} />
                    </button>
                  </div>
                  <p className="panel-description">
                    The questions most likely to move this project forward.
                  </p>
                  <div className="frontier-list">
                    {ranked.slice(0, 3).map((r, i) => (
                      <button
                        key={r.node.id}
                        className="frontier-row"
                        onClick={() => setSelected(r.node.id)}
                      >
                        <span className={`rank rank-${i}`}>{String(i + 1).padStart(2, '0')}</span>
                        <div>
                          <div className="frontier-item-meta">
                            <span>{r.node.type}</span>
                            <span>{r.downstream} downstream</span>
                          </div>
                          <strong>
                            <ResearchText inline>{r.node.title}</ResearchText>
                          </strong>
                          <ResearchText className="research-summary">
                            {r.reasons[0]?.replace(/ \(\+\d+\)/, '') ?? ''}
                          </ResearchText>
                        </div>
                        <ChevronRight size={17} />
                      </button>
                    ))}
                  </div>
                  <div className="frontier-foot">
                    <span className="tiny-dot" />
                    Ranked by dependencies, uncertainty, and evidence
                  </div>
                </section>
                <section className="panel integrity-panel">
                  <div className="panel-title">
                    <h2>
                      <ShieldCheck size={18} />
                      Epistemic health
                    </h2>
                    <span className="small muted">{claims.length} claims</span>
                  </div>
                  <div className="health-bar">
                    {STATUSES.filter((s) => claims.some((n) => n.epistemicStatus === s)).map(
                      (s) => (
                        <span
                          key={s}
                          className={`health-${s.toLowerCase().replaceAll(' ', '-')}`}
                          style={{ flex: claims.filter((n) => n.epistemicStatus === s).length }}
                          title={`${s}: ${claims.filter((n) => n.epistemicStatus === s).length}`}
                        />
                      ),
                    )}
                  </div>
                  <div className="health-legend">
                    {STATUSES.filter((s) => claims.some((n) => n.epistemicStatus === s)).map(
                      (s) => (
                        <span key={s}>
                          <i className={`health-${s.toLowerCase().replaceAll(' ', '-')}`} />
                          {s}
                          <b>{claims.filter((n) => n.epistemicStatus === s).length}</b>
                        </span>
                      ),
                    )}
                  </div>
                  <div className="integrity-alert">
                    <TriangleAlert size={18} />
                    <div>
                      <strong>{warnings.length} claims need a closer look</strong>
                      <p>A proof label can still hide unverified assumptions.</p>
                      <button
                        className="text-button"
                        onClick={() =>
                          setSelected(
                            nodes.find((n) => n.id === 'draft-proof')?.id ??
                              warnings[0]?.id ??
                              null,
                          )
                        }
                      >
                        Inspect belief audit <ChevronRight size={14} />
                      </button>
                    </div>
                  </div>
                  <p className="health-note">
                    Statuses are research judgments. They are never automatic proof certificates.
                  </p>
                </section>
              </div>
              <div className="overview-lower">
                <section className="panel graph-preview-panel">
                  <div className="panel-title">
                    <h2>
                      <Network size={18} />
                      The research in context
                    </h2>
                    <button className="text-button" onClick={() => navigate('graph')}>
                      Open graph <ChevronRight size={14} />
                    </button>
                  </div>
                  <Graph
                    nodes={nodes.filter((n) =>
                      [
                        'main-conjecture',
                        'interpolation',
                        'pairwise-bound',
                        'conditional-theorem',
                        'rank-hypothesis',
                        'root-barrier',
                        'numerical-experiment',
                        'active-approach',
                        'draft-proof',
                      ].includes(n.id),
                    )}
                    edges={state.edges}
                    onSelect={selectNode}
                    readOnly={!canEdit}
                    onConnect={(c) =>
                      canEdit && setEdge({ sourceNodeId: c.source!, targetNodeId: c.target! })
                    }
                    compact
                  />
                  <div className="graph-caption">
                    <span>
                      <i className="line-sample dashed" />
                      Dependency
                    </span>
                    <span>
                      <i className="line-sample" />
                      Supporting relationship
                    </span>
                    <span>Click any node to inspect</span>
                  </div>
                </section>
                <section data-owner-control className="panel recent-panel">
                  <div className="panel-title">
                    <h2>
                      <Clock3 size={17} />
                      Recent activity
                    </h2>
                    <button className="text-button" onClick={() => navigate('activity')}>
                      View all
                    </button>
                  </div>
                  {eventRows(
                    state.events
                      .filter(
                        (e) =>
                          e.eventType === 'status_changed' ||
                          e.eventType === 'session_ingested' ||
                          e.eventType === 'node_updated',
                      )
                      .slice(0, 4),
                    true,
                  )}
                </section>
              </div>
            </>
          ) : page === 'graph' ? (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">THE STRUCTURE OF YOUR RESEARCH</span>
                  <h1>Research Graph</h1>
                  <p>Follow an argument from its assumptions to its evidence.</p>
                </div>
                <button data-owner-control className="button secondary" onClick={() => setEdge({})}>
                  <Link2 size={16} />
                  Add relationship
                </button>
              </div>
              <div className="graph-goal-focus">
                <Target size={17} />
                <label htmlFor="graph-goal">Goal context</label>
                <select
                  id="graph-goal"
                  value={goalFilter}
                  onChange={(e) => setGoalFilter(e.target.value)}
                >
                  <option value="">Whole research program</option>
                  {program.goals.map((g) => (
                    <option key={g.id} value={g.id}>
                      {researchTextLabel(g.title)}
                    </option>
                  ))}
                </select>
                <span>Includes milestones, prerequisites, and attack history</span>
              </div>
              <section className="panel full-graph">
                {filterBar}
                <Graph
                  nodes={visible}
                  assessments={program.assessments}
                  edges={state.edges}
                  onSelect={selectNode}
                  readOnly={!canEdit}
                  onConnect={(c) =>
                    canEdit && setEdge({ sourceNodeId: c.source!, targetNodeId: c.target! })
                  }
                />
                <div className="graph-caption">
                  <span>
                    <i className="line-sample dashed" />
                    depends on
                  </span>
                  <span>
                    <i className="line-sample" />
                    supports / derived from
                  </span>
                  <span>
                    <i className="line-sample red" />
                    contradicts / disproves
                  </span>
                  <span>
                    {canEdit
                      ? 'Drag between node handles to connect'
                      : 'Select any research item to inspect it'}
                  </span>
                </div>
              </section>
            </>
          ) : ['claims', 'questions', 'experiments'].includes(page) ? (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">STRUCTURED RESEARCH STATE</span>
                  <h1>{navigation.find((n) => n.id === page)?.name}</h1>
                  <p>
                    {page === 'claims'
                      ? 'Claims, conjectures, lemmas, and theorems—with their uncertainty intact.'
                      : page === 'questions'
                        ? 'Unresolved questions are the starting points of the next argument.'
                        : 'Distinguish planned tests from observations and from proof.'}
                  </p>
                </div>
                <button
                  data-owner-control
                  className="button secondary"
                  onClick={() =>
                    setEditing({
                      preset: {
                        type:
                          page === 'questions'
                            ? 'Open Question'
                            : page === 'experiments'
                              ? 'Experiment'
                              : 'Claim',
                      },
                    })
                  }
                >
                  <Plus size={16} />
                  Add{' '}
                  {page === 'questions'
                    ? 'question'
                    : page === 'experiments'
                      ? 'experiment'
                      : 'claim'}
                </button>
              </div>
              <section className="panel">
                {filterBar}
                {nodeRows(visible)}
              </section>
            </>
          ) : page === 'frontier' ? (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">WHAT TO INVESTIGATE NEXT</span>
                  <h1>Research Frontier</h1>
                  <p>A transparent ranking of uncertainty, dependencies, and opportunity.</p>
                </div>
                <button
                  data-owner-control
                  className="button secondary"
                  disabled={!state.llmEnabled || briefBusy}
                  title={
                    state.llmEnabled
                      ? 'Sends structured project data to OpenAI'
                      : 'Configure OPENAI_API_KEY to enable'
                  }
                  onClick={async () => {
                    setBriefBusy(true);
                    try {
                      const r = await api<{ briefing: string }>('/frontier/synthesize', 'POST', {});
                      setBriefing(r.briefing);
                    } catch (e) {
                      notify((e as Error).message);
                    } finally {
                      setBriefBusy(false);
                    }
                  }}
                >
                  <Sparkles size={16} />
                  {briefBusy ? 'Writing briefing…' : 'AI briefing'}
                </button>
              </div>
              {state.llmEnabled && (
                <p className="small muted">
                  AI briefing sends structured project data to OpenAI. Rankings below are computed
                  locally.
                </p>
              )}
              {briefing && (
                <section className="panel briefing">
                  <span className="eyebrow">AI-GENERATED · REVIEW AGAINST THE GRAPH</span>
                  <ResearchText className="prose">{briefing}</ResearchText>
                </section>
              )}
              <div className="frontier-metrics">
                <div>
                  <strong>{mainBlockers.length}</strong>
                  <span>Unresolved bottlenecks</span>
                </div>
                <div>
                  <strong>{ranked.filter((r) => r.stale).length}</strong>
                  <span>Stale active items</span>
                </div>
                <div>
                  <strong>
                    {
                      state.events.filter(
                        (e) => Date.now() - Date.parse(e.createdAt) < 7 * 86400000,
                      ).length
                    }
                  </strong>
                  <span>Changes in the last 7 days</span>
                </div>
              </div>
              <div className="frontier-columns">
                <section className="panel ranked-panel">
                  <div className="panel-title">
                    <h2>Priority queue</h2>
                    <span className="small muted">Deterministic ranking</span>
                  </div>
                  {ranked.map((r, i) => (
                    <article className="priority-item" key={r.node.id}>
                      <div className="priority-top">
                        <span className="rank">{String(i + 1).padStart(2, '0')}</span>
                        <button onClick={() => setSelected(r.node.id)}>
                          <span className="eyebrow">{r.node.type}</span>
                          <strong>
                            <ResearchText inline>{r.node.title}</ResearchText>
                          </strong>
                        </button>
                        <div className="score">
                          <strong>{r.score}</strong>
                          <span>PRIORITY</span>
                        </div>
                      </div>
                      <div className="priority-body">
                        <Badge status={r.node.epistemicStatus} />
                        <ResearchText className="research-summary">{r.node.summary}</ResearchText>
                        <details open={i < 3}>
                          <summary>Why this rank?</summary>
                          <ul>
                            {r.reasons.map((reason) => (
                              <li key={reason}>
                                <ResearchText inline>{reason}</ResearchText>
                              </li>
                            ))}
                          </ul>
                        </details>
                      </div>
                    </article>
                  ))}
                </section>
                <div className="frontier-right">
                  {[
                    { title: 'Promising approaches', icon: Lightbulb, list: approaches },
                    {
                      title: 'Next experiments',
                      icon: FlaskConical,
                      list: nodes.filter(
                        (n) => n.type === 'Experiment' && n.epistemicStatus === 'Unverified',
                      ),
                    },
                    {
                      title: 'Failed & closed directions',
                      icon: GitBranch,
                      list: nodes
                        .filter((n) =>
                          ['Disproved', 'Abandoned', 'Superseded'].includes(n.epistemicStatus),
                        )
                        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
                    },
                    {
                      title: 'Needs revisiting',
                      icon: Clock3,
                      list: ranked.filter((r) => r.stale).map((r) => r.node),
                    },
                  ].map((section) => (
                    <section className="panel mini-section" key={section.title}>
                      <div className="panel-title">
                        <h3>
                          <section.icon size={16} />
                          {section.title}
                        </h3>
                      </div>
                      {section.list.length ? (
                        section.list.map((n) => (
                          <button
                            key={n.id}
                            className="mini-node"
                            onClick={() => setSelected(n.id)}
                          >
                            <strong>
                              <ResearchText inline>{n.title}</ResearchText>
                            </strong>
                            <ResearchText inline className="research-summary">
                              {n.summary}
                            </ResearchText>
                            <Badge status={n.epistemicStatus} />
                          </button>
                        ))
                      ) : (
                        <p className="empty-inline">No items in this category.</p>
                      )}
                    </section>
                  ))}
                </div>
              </div>
            </>
          ) : page === 'ingest' && canEdit ? (
            <Ingest state={state} onRefresh={refresh} notify={notify} onSelect={selectNode} />
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">PERSISTENT RESEARCH MEMORY</span>
                  <h1>Activity</h1>
                  <p>Every change has a before, an after, and a reason.</p>
                </div>
                <span className="small muted">{state.events.length} recorded events</span>
              </div>
              <section className="panel activity-panel">{eventRows(state.events)}</section>
            </>
          )}
          <footer className="workspace-footer">
            <span>
              Research OS <i> / </i> A living research state
            </span>
            <span>
              <Database size={12} />
              Public research · cloud persistence
            </span>
          </footer>
        </main>
      </div>
      {selected && (
        <Inspector
          id={selected}
          state={state}
          onClose={() => setSelected(null)}
          onSelect={selectNode}
          onEdit={(node) => setEditing({ node })}
          onAdd={(preset, link) => setEditing({ preset, link })}
          onEdge={(preset) => setEdge(preset)}
          onRefresh={refresh}
          notify={notify}
          assessment={program.assessments.find((a) => a.nodeId === selected)}
          onAssess={() => setAssessing(state.nodes.find((n) => n.id === selected) ?? null)}
          onDiscuss={() =>
            discuss(
              `Investigate “${state.nodes.find((n) => n.id === selected)?.title}”. State its role in the target, compare with the known baseline, and propose a rigorous next step.`,
              undefined,
              [selected],
            )
          }
        />
      )}
      {canEdit && assessing && (
        <ContributionEditor
          node={assessing}
          assessment={program.assessments.find((a) => a.nodeId === assessing.id)}
          onClose={() => setAssessing(null)}
          onSaved={refresh}
          onDiscuss={(prompt, nodeIds) => discuss(prompt, undefined, nodeIds)}
        />
      )}
      {canEdit && editing && (
        <NodeEditor
          node={editing.node}
          preset={editing.preset}
          onClose={closeEditor}
          onSave={saveNode}
        />
      )}{' '}
      {canEdit && edge && (
        <EdgeEditor
          nodes={nodes}
          preset={edge}
          onClose={closeEdge}
          onSave={async (input) => {
            await api('/edges', 'POST', input);
            await refresh();
            notify('Relationship added');
          }}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast('')}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
