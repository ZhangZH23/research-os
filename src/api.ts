export type ProjectApi = <T>(path: string, method?: string, body?: unknown) => Promise<T>;

/** Capture project scope once. Pending continuations never read a mutable selected project. */
export function createProjectApi(projectId?: string): ProjectApi {
  return async <T>(path: string, method = 'GET', body?: unknown): Promise<T> => {
    const response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(method === 'GET' ? {} : { 'Content-Type': 'application/json' }),
        ...(projectId ? { 'x-research-project': projectId } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Request failed');
    return result;
  };
}
export const api = createProjectApi();
