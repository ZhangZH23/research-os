type ResearchTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute(input: unknown): Promise<unknown>;
};

/** Exposes only the same research program already visible to the visitor. */
export function registerResearchTools(projectId?: string) {
  const context = (
    document as Document & {
      modelContext?: {
        registerTool(tool: ResearchTool, options: { signal: AbortSignal }): void | Promise<void>;
      };
    }
  ).modelContext;
  if (!context?.registerTool) return;
  const lifecycle = new AbortController();
  const tool: ResearchTool = {
    name: 'get_research_program',
    title: 'Read research goals and contribution assessments',
    description:
      'Read the current research program, including goals, links and contribution assessments. This does not verify mathematical claims or change the workspace.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    async execute(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length)
        throw new Error('Expected an empty object.');
      const response = await fetch('/api/program', {
        credentials: 'same-origin',
        headers: projectId ? { 'x-research-project': projectId } : {},
      });
      if (!response.ok)
        throw new Error('Could not read the research program. Check that you are signed in.');
      return response.json();
    },
  };
  try {
    Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => {});
  } catch {
    /* The visible research workspace remains usable if registration is unavailable. */
  }
  const stop = () => lifecycle.abort();
  window.addEventListener('pagehide', stop, { once: true });
  return () => {
    stop();
    window.removeEventListener('pagehide', stop);
  };
}
