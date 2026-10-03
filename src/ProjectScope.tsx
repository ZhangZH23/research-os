import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api, createProjectApi, type ProjectApi } from './api';
import type { EngineProject } from '../shared/engine';
import { Modal } from './ui';
import { registerResearchTools } from './webmcp';

type Scope = {
  api: ProjectApi;
  project?: EngineProject;
  projects: EngineProject[];
  change: (id: string) => void;
  reload: () => Promise<void>;
};
const Context = createContext<Scope>({
  api,
  projects: [],
  change: () => {},
  reload: async () => {},
});
export const useProjectApi = () => useContext(Context).api;
export const useProjectScope = () => useContext(Context);
const key = 'research-os-project';

export default function ProjectScope({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<EngineProject[]>([]),
    [selected, setSelected] = useState(''),
    [ready, setReady] = useState(false),
    [error, setError] = useState(''),
    [pendingProject, setPendingProject] = useState('');
  const dirty = useRef(false);
  async function reload() {
    const result = await api<{ projects: EngineProject[] }>('/projects');
    setProjects(result.projects);
    setSelected((old) =>
      result.projects.some((p) => p.id === old)
        ? old
        : (result.projects.find((p) => !p.archived)?.id ?? result.projects[0]?.id ?? ''),
    );
  }
  useEffect(() => {
    let alive = true;
    api<{ projects: EngineProject[] }>('/projects')
      .then((result) => {
        if (!alive) return;
        setProjects(result.projects);
        const remembered = sessionStorage.getItem(key);
        setSelected(
          result.projects.find((p) => p.id === remembered && !p.archived)?.id ??
            result.projects.find((p) => !p.archived)?.id ??
            result.projects[0]?.id ??
            '',
        );
      })
      .catch((e) => {
        // Public visitors use the server's explicit public snapshot route.
        if (!/owner|sign|author|private|access|forbidden/i.test(e.message)) setError(e.message);
      })
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    const input = (event: Event) => {
      const el = event.target;
      if (
        (el instanceof HTMLTextAreaElement ||
          el instanceof HTMLInputElement ||
          el instanceof HTMLSelectElement) &&
        el.id !== 'project-choice' &&
        !/search|filter/i.test(
          el.getAttribute('aria-label') ?? el.getAttribute('placeholder') ?? '',
        )
      )
        dirty.current = true;
    };
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    document.addEventListener('input', input);
    window.addEventListener('beforeunload', unload);
    return () => {
      document.removeEventListener('input', input);
      window.removeEventListener('beforeunload', unload);
    };
  }, []);
  function applyProject(id: string) {
    dirty.current = false;
    sessionStorage.setItem(key, id);
    setPendingProject('');
    setSelected(id);
  }
  function change(id: string) {
    if (id === selected) return;
    if (dirty.current) {
      setPendingProject(id);
      return;
    }
    applyProject(id);
  }
  useEffect(() => {
    if (!ready) return;
    return registerResearchTools(selected || undefined);
  }, [ready, selected]);
  const projectApi = useMemo(() => createProjectApi(selected || undefined), [selected]);
  if (!ready)
    return (
      <div className="loading-screen">
        <h1>Research OS</h1>
        <p>Opening your projects…</p>
      </div>
    );
  if (error)
    return (
      <div className="loading-screen">
        <p role="alert">{error}</p>
        <button className="button" onClick={() => location.reload()}>
          Retry connection
        </button>
      </div>
    );
  return (
    <Context.Provider
      key={selected || 'public'}
      value={{
        api: projectApi,
        projects,
        project: projects.find((p) => p.id === selected),
        change,
        reload,
      }}
    >
      {children}
      {pendingProject && (
        <Modal title="Switch research projects?" onClose={() => setPendingProject('')}>
          <div className="engine-form">
            <p>
              This project may have unsaved form changes. Save them before switching if you want to
              keep them.
            </p>
            <p>
              Saved work and running requests stay in{' '}
              <strong>{projects.find((p) => p.id === selected)?.title}</strong>. The other project's
              records remain separate.
            </p>
            <div className="engine-actions">
              <button className="button" onClick={() => setPendingProject('')}>
                Stay in this project
              </button>
              <button className="button primary" onClick={() => applyProject(pendingProject)}>
                Switch project
              </button>
            </div>
          </div>
        </Modal>
      )}
    </Context.Provider>
  );
}

export function ProjectSelector({ readOnly = false }: { readOnly?: boolean }) {
  const { project, projects, change, reload } = useProjectScope();
  const [open, setOpen] = useState<'create' | 'edit' | null>(null),
    [title, setTitle] = useState(''),
    [description, setDescription] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  if (!project)
    return (
      <div className="workspace-switch">
        <strong>Published research</strong>
      </div>
    );
  async function save() {
    setBusy(true);
    setError('');
    try {
      const result = await api<EngineProject>(
        open === 'edit' ? `/projects/${project!.id}` : '/projects',
        open === 'edit' ? 'PATCH' : 'POST',
        { title, description },
      );
      await reload();
      setOpen(null);
      if (open === 'create') change(result.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="project-selector">
        <label htmlFor="project-choice">Research project</label>
        <select id="project-choice" value={project.id} onChange={(e) => change(e.target.value)}>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
              {p.archived ? ' · archived' : ''}
            </option>
          ))}
        </select>
        {!readOnly && (
          <div>
            <button
              className="text-button"
              onClick={() => {
                setTitle('');
                setDescription('');
                setError('');
                setOpen('create');
              }}
            >
              New project
            </button>
            <button
              className="text-button"
              onClick={() => {
                setTitle(project.title);
                setDescription(project.description);
                setError('');
                setOpen('edit');
              }}
            >
              Settings
            </button>
          </div>
        )}
      </div>
      {open && !readOnly && (
        <Modal
          title={open === 'create' ? 'Create a private project' : 'Project settings'}
          onClose={() => setOpen(null)}
        >
          <form
            className="engine-form"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <label>
              Project title
              <input
                required
                maxLength={200}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label>
              Description
              <textarea
                value={description}
                rows={4}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <p className="muted">
              New projects start empty and private. Admission and publication are separate
              decisions.
            </p>
            {error && (
              <p role="alert" className="error-message">
                {error}
              </p>
            )}
            <div className="engine-actions">
              <button className="button primary" disabled={busy}>
                {busy ? 'Saving…' : open === 'create' ? 'Create project' : 'Save settings'}
              </button>
              {open === 'edit' && (
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await api(`/projects/${project.id}`, 'PATCH', {
                        archived: !project.archived,
                      });
                      await reload();
                      setOpen(null);
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {project.archived ? 'Restore project' : 'Archive project'}
                </button>
              )}
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
