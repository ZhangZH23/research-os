import { ResearchEngine } from './research-engine';
/** Shared transport adapter; semantics live in ResearchEngine for Worker and local tools. */
export async function engineRoute(
  engine: ResearchEngine,
  path: string,
  method: string,
  body: () => Promise<any>,
  url: URL,
) {
  if (path === '/api/engine/state' && method === 'GET') return engine.state();
  if (path === '/api/engine/migration')
    return method === 'GET'
      ? engine.migrationReport()
      : method === 'POST'
        ? engine.migrate(await body())
        : undefined;
  if (path === '/api/engine/sources' && method === 'POST') return engine.source(await body());
  if (path === '/api/engine/proposals' && method === 'POST') return engine.propose(await body());
  let m = path.match(/^\/api\/engine\/proposals\/([^/]+)$/);
  if (m && method === 'PATCH') {
    const { revision, ...input } = await body();
    return engine.reviseProposal(m[1], input, revision);
  }
  m = path.match(/^\/api\/engine\/proposals\/([^/]+)\/(check|review|commit)$/);
  if (m && method === 'POST')
    return m[2] === 'check'
      ? engine.check(m[1])
      : m[2] === 'review'
        ? engine.reviewProposal(m[1], await body())
        : engine.commit(m[1], await body());
  if (path === '/api/engine/reviews' && method === 'POST') return engine.review(await body());
  if (path === '/api/engine/context' && method === 'POST') return engine.context(await body());
  if (path === '/api/engine/runs/import' && method === 'POST')
    return engine.importRun(await body());
  if (path === '/api/engine/checks/rank' && method === 'POST')
    return engine.rankCheck(await body());
  if (path === '/api/engine/publications/preview' && method === 'POST')
    return engine.publicationPreview(await body());
  if (path === '/api/engine/publications' && method === 'POST') return engine.publish(await body());
  m = path.match(/^\/api\/engine\/publications\/([^/]+)\/retract$/);
  if (m && method === 'POST') return engine.retractPublication(m[1], await body());
  if (path === '/api/engine/export' && method === 'GET') return engine.export();
  if (path === '/api/engine/import' && method === 'POST') return engine.importProject(await body());
  if (path === '/api/engine/diff' && method === 'GET')
    return engine.diff(
      url.searchParams.get('from') ?? undefined,
      url.searchParams.get('to') ?? undefined,
      url.searchParams.get('runId') ?? undefined,
    );
  return undefined;
}
