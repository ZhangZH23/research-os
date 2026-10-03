import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../server/store';
import { ProgramStore } from '../server/program-store';
import { ConnectionManager } from '../server/connection';
import { ChatStore, type ChatResearchHooks } from '../server/chat';
import { ResearchEngine } from '../server/research-engine';
const reply = (status = 'completed', content = 'A visible synthetic response with $x^2$.') =>
  new Response(
    JSON.stringify({
      status,
      output: [
        {
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({ content, proposal: null, candidates: [] }),
            },
          ],
        },
      ],
    }),
  );
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'engine-chat-'));
  const path = join(directory, 'research.sqlite');
  const store = new Store(path, false);
  const program = new ProgramStore(store);
  const connection = new ConnectionManager({
    filePath: join(directory, 'connection.json'),
    environment: {},
  });
  store.db.exec('CREATE TABLE synthetic_chat_runs(id TEXT PRIMARY KEY,data TEXT NOT NULL)');
  const runs = () =>
    store.db
      .prepare('SELECT data FROM synthetic_chat_runs')
      .all()
      .map((r) => JSON.parse(r.data));
  const hooks: ChatResearchHooks = {
    context: (input) => ({
      text: JSON.stringify({
        revision: 'claim@7',
        contract: { inputGuarantee: 'arbitrary', meaning: 'input bit length' },
        failedAttempt: 'Old rank route failed at epsilon-dependent exponent',
        openObligation: 'Remove random-input assumption',
      }),
      manifest: {
        projectId: input.projectId,
        selectedRevisionIds: ['claim@7'],
        sourceIds: ['source@2'],
        omittedIds: ['unrelated@3'],
        reasons: { 'claim@7': 'selected target' },
        tokenEstimate: 80,
        generatedAt: '2026-01-01T00:00:00.000Z',
        limitations: ['Synthetic deterministic context'],
      },
      baseCommitId: 'commit@4',
      readSet: [{ objectId: 'claim', revisionId: 'claim@7', hash: 'exact-hash' }],
    }),
    beginRun: (input) => {
      assert.equal(
        store.db.prepare('SELECT id FROM chat_messages WHERE id=?').get(input.userMessageId)?.id,
        input.userMessageId,
      );
      store.db
        .prepare('INSERT INTO synthetic_chat_runs VALUES(?,?)')
        .run(input.id, JSON.stringify({ ...input, state: 'running', requestOutcome: 'pending' }));
    },
    completeRun: (input) => {
      const prior = runs().find((r) => r.id === input.id);
      assert.ok(prior);
      assert.equal(prior.projectId, input.projectId);
      store.db
        .prepare('UPDATE synthetic_chat_runs SET data=? WHERE id=?')
        .run(
          JSON.stringify({
            ...prior,
            state: input.message.error
              ? 'failed'
              : input.message.provider === 'local'
                ? 'completed'
                : 'awaiting_review',
            requestOutcome: input.message.requestOutcome,
            output: input.message,
          }),
          input.id,
        );
    },
  };
  return {
    directory,
    path,
    store,
    program,
    connection,
    hooks,
    runs,
    close() {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
test('GPT receives exact engine context and run intent is durably saved before the paid request', async () => {
  const f = fixture();
  try {
    f.connection.update({ apiKey: 'synthetic-test-token', model: 'synthetic-test-model' });
    let paidCalls = 0,
      persisted = false;
    const request = (async (_url, options) => {
      paidCalls++;
      assert.equal(persisted, true);
      const stored = f.runs()[0];
      assert.equal(stored.state, 'running');
      assert.equal(stored.requestOutcome, 'pending');
      const second = new Store(f.path, false);
      try {
        assert.equal(
          JSON.parse(
            second.db.prepare('SELECT data FROM synthetic_chat_runs WHERE id=?').get(stored.id)!
              .data,
          ).question,
          'Find the next precise gap',
        );
      } finally {
        second.close();
      }
      const body = JSON.parse(String(options?.body));
      const developer = body.input.find((m: any) => m.role === 'developer').content;
      assert.match(developer, /claim@7/);
      assert.match(developer, /input bit length/);
      assert.match(developer, /Old rank route failed/);
      assert.match(developer, /Remove random-input assumption/);
      return reply();
    }) as typeof fetch;
    const chat = new ChatStore(
      f.store,
      f.program,
      f.connection,
      request,
      {
        save: async () => {
          persisted = true;
        },
        reload: async () => {},
      },
      f.hooks,
    );
    const session = chat.createSession();
    const result = await chat.send(session.id, {
      content: 'Find the next precise gap',
      notebook: true,
      progressCriterion: 'Remove the extra assumption',
    });
    assert.equal(paidCalls, 1);
    assert.equal(result.userMessage.researchRunId, result.assistantMessage.researchRunId);
    assert.equal(result.assistantMessage.context.engineManifest?.selectedRevisionIds[0], 'claim@7');
    assert.equal(result.assistantMessage.context.truncated, true);
    assert.equal(f.runs()[0].state, 'awaiting_review');
    assert.equal(f.runs()[0].output.replyToId, result.userMessage.id);
    assert.ok(!JSON.stringify(f.runs()).includes('synthetic-test-token'));
    assert.equal(f.store.state().nodes.length, 0);
  } finally {
    f.close();
  }
});
test('Ambiguous provider failures preserve the exact run/question and never automatically resend', async () => {
  const f = fixture();
  try {
    f.connection.update({ apiKey: 'synthetic-test-token', model: 'synthetic-test-model' });
    let calls = 0;
    const request = (async () => {
      calls++;
      throw new Error('Synthetic transport disconnected after request submission');
    }) as typeof fetch;
    const chat = new ChatStore(f.store, f.program, f.connection, request, undefined, f.hooks);
    const session = chat.createSession();
    const result = await chat.send(session.id, { content: 'Test the rank obstruction' });
    assert.equal(calls, 1);
    assert.equal(result.assistantMessage.requestOutcome, 'ambiguous');
    assert.equal(f.runs()[0].requestOutcome, 'ambiguous');
    assert.equal(f.runs()[0].question, 'Test the rank obstruction');
    assert.equal(chat.messages(session.id).length, 2);
    assert.equal(f.store.state().nodes.length, 0);
  } finally {
    f.close();
  }
});
test('Incomplete visible output remains in the failed run, with no accepted state change', async () => {
  const f = fixture();
  try {
    f.connection.update({ apiKey: 'synthetic-test-token', model: 'synthetic-test-model' });
    const chat = new ChatStore(
      f.store,
      f.program,
      f.connection,
      (async () => reply('incomplete', 'A partial argument: 😀 $A\\implies B$.')) as typeof fetch,
      undefined,
      f.hooks,
    );
    const session = chat.createSession();
    const result = await chat.send(session.id, { content: 'Inspect partial proof' });
    assert.equal(result.assistantMessage.requestOutcome, 'incomplete');
    assert.equal(f.runs()[0].requestOutcome, 'incomplete');
    assert.equal(f.runs()[0].output.content, 'A partial argument: 😀 $A\\implies B$.');
    assert.ok(f.runs()[0].output.visibleProviderOutput);
    assert.equal(f.store.state().nodes.length, 0);
  } finally {
    f.close();
  }
});
test('No-key runs record a local worksheet rather than pretending GPT executed', async () => {
  const f = fixture();
  try {
    let calls = 0;
    const chat = new ChatStore(
      f.store,
      f.program,
      f.connection,
      (async () => {
        calls++;
        return reply();
      }) as typeof fetch,
      undefined,
      f.hooks,
    );
    const session = chat.createSession();
    await chat.send(session.id, { content: 'Record my next observation' });
    assert.equal(calls, 0);
    assert.equal(f.runs()[0].provider, 'local');
    assert.equal(f.runs()[0].model, null);
    assert.equal(f.runs()[0].state, 'completed');
    assert.match(f.runs()[0].output.content, /no GPT model was called/);
  } finally {
    f.close();
  }
});
test('A run-start write failure rolls back the prompt and prevents any model call', async () => {
  const f = fixture();
  try {
    f.connection.update({ apiKey: 'synthetic-test-token' });
    let calls = 0;
    f.hooks.beginRun = () => {
      throw new Error('Synthetic run write failure');
    };
    const chat = new ChatStore(
      f.store,
      f.program,
      f.connection,
      (async () => {
        calls++;
        return reply();
      }) as typeof fetch,
      undefined,
      f.hooks,
    );
    const session = chat.createSession();
    await assert.rejects(() => chat.send(session.id, { content: 'Question' }), /run write failure/);
    assert.equal(calls, 0);
    assert.equal(chat.messages(session.id).length, 0);
  } finally {
    f.close();
  }
});
test('A failed run completion does not erase the already obtained visible mathematical answer', async () => {
  const f = fixture();
  try {
    f.connection.update({ apiKey: 'synthetic-test-token' });
    let calls = 0,
      completions = 0;
    const finish = f.hooks.completeRun;
    f.hooks.completeRun = (input) => {
      if (++completions === 1) throw new Error('Synthetic first journal write failed');
      finish(input);
    };
    const chat = new ChatStore(
      f.store,
      f.program,
      f.connection,
      (async () => {
        calls++;
        return reply();
      }) as typeof fetch,
      undefined,
      f.hooks,
    );
    const session = chat.createSession();
    const result = await chat.send(session.id, { content: 'Question' });
    assert.equal(calls, 1);
    assert.match(result.assistantMessage.content, /visible synthetic response/);
    assert.match(result.assistantMessage.error ?? '', /journal write failed/);
    assert.equal(result.assistantMessage.requestOutcome, 'completed');
    assert.equal(chat.messages(session.id).length, 2);
  } finally {
    f.close();
  }
});
test('Cross-project context manifests are rejected before a model call or research mutation', async () => {
  const f = fixture();
  try {
    const original = f.hooks.context;
    f.hooks.context = (input) => {
      const packet = original(input);
      packet.manifest.projectId = 'other-private-project';
      return packet;
    };
    let calls = 0;
    const chat = new ChatStore(
      f.store,
      f.program,
      f.connection,
      (async () => {
        calls++;
        return reply();
      }) as typeof fetch,
      undefined,
      f.hooks,
    );
    const session = chat.createSession();
    await assert.rejects(() => chat.send(session.id, { content: 'Question' }), /different project/);
    assert.equal(calls, 0);
    assert.equal(f.runs().length, 0);
  } finally {
    f.close();
  }
});
test('Actual engine hooks retain prior failure context and durable run/source records across reopening', async () => {
  const f = fixture();
  let scoped: Store | undefined;
  try {
    const root = new ResearchEngine(f.store, f.program);
    const project = root.createProject({ title: 'Synthetic persistent GPT continuity' });
    scoped = new Store(f.path, false, project.id);
    const program = new ProgramStore(scoped);
    const engine = new ResearchEngine(scoped, program);
    const source = engine.source({
      kind: 'human_note',
      text: 'Old rank approach failed because its exponent depends on epsilon.',
      attribution: 'Synthetic researcher',
    });
    const span = {
      sourceId: source.id,
      sourceHash: source.hash,
      start: 0,
      end: source.text.length,
      quote: source.text,
    };
    const proposal = engine.propose({
      title: 'Retain the scoped failed approach',
      baseCommitId: null,
      operations: [
        {
          type: 'record_failed_attempt',
          tempId: 'failure',
          kind: 'failed_attempt',
          title: 'Older rank obstruction',
          statement: source.text,
          contract: {},
          sources: [span],
          methodScope: 'This specific rank approach',
          failureReason: 'The exponent depends on epsilon.',
        },
      ],
    });
    engine.check(proposal.id);
    engine.reviewProposal(proposal.id, {
      revision: proposal.revision,
      decision: 'approve',
      reason: 'Retain this failed route as a scoped observation without refuting the goal.',
    });
    engine.commit(proposal.id, {
      revision: proposal.revision,
      idempotencyKey: 'synthetic-first-failure',
    });
    f.connection.update({ apiKey: 'synthetic-test-token', model: 'synthetic-test-model' });
    let calls = 0;
    const chat = new ChatStore(
      scoped,
      program,
      f.connection,
      (async (_url, options) => {
        calls++;
        assert.match(String(options?.body), /Old rank approach failed/);
        const run = engine.data().runs[0];
        assert.equal(run.state, 'running');
        assert.ok(run.contextManifest?.selectedRevisionIds.length);
        return reply();
      }) as typeof fetch,
      undefined,
      engine.chatHooks(),
    );
    const session = chat.createSession();
    const result = await chat.send(session.id, {
      content: 'Continue the rank approach and avoid the earlier epsilon issue',
      notebook: true,
    });
    assert.equal(calls, 1);
    const run = engine.data().runs[0];
    assert.equal(run.id, result.userMessage.researchRunId);
    assert.equal(run.state, 'awaiting_review');
    assert.equal(run.checkpointIds?.length, 1);
    assert.equal(run.sourceIds.length, 1);
    assert.equal(
      engine.data().sources.find((s) => s.id === run.sourceIds[0])?.text,
      result.assistantMessage.content,
    );
    assert.equal(engine.data().commits.length, 1, 'Generation must not admit a research change');
    const restored = new Store(f.path, false, project.id);
    try {
      const recovered = new ResearchEngine(restored, new ProgramStore(restored));
      assert.deepEqual(recovered.data().runs, engine.data().runs);
      assert.equal(
        recovered.data().sources.find((s) => s.id === run.sourceIds[0])?.hash,
        engine.data().sources.find((s) => s.id === run.sourceIds[0])?.hash,
      );
      assert.ok(recovered.export().legacy.messages.some((m: any) => m.researchRunId === run.id));
    } finally {
      restored.close();
    }
  } finally {
    scoped?.close();
    f.close();
  }
});
