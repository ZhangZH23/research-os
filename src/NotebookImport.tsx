import { useMemo, useState } from 'react';
import type { ProgramState } from '../shared/program';
import { parseTranscript } from '../shared/workbench';
import { researchTextLabel } from '../shared/math';
import { Modal } from './ui';
export default function NotebookImport({
  program,
  busy,
  onClose,
  onImport,
}: {
  program: ProgramState;
  busy: boolean;
  onClose: () => void;
  onImport: (data: unknown) => Promise<void>;
}) {
  const [title, setTitle] = useState('Imported research session'),
    [goalId, setGoalId] = useState(program.goals[0]?.id ?? ''),
    [text, setText] = useState(''),
    [source, setSource] = useState('ChatGPT');
  const parsed = useMemo(() => {
    try {
      return { turns: parseTranscript(text), error: '' };
    } catch (e) {
      return { turns: [], error: (e as Error).message };
    }
  }, [text]);
  return (
    <Modal title="Import a research conversation" onClose={onClose}>
      <div className="nb-import">
        <p>
          Paste visible prompts and replies with User: and Assistant: labels. Check the separated
          messages below before importing.
        </p>
        <label>
          Session title
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} />
        </label>
        <label>
          Source label
          <input value={source} onChange={(e) => setSource(e.target.value)} maxLength={300} />
        </label>
        <label>
          Compare against goal
          <select value={goalId} onChange={(e) => setGoalId(e.target.value)}>
            <option value="">No selected goal</option>
            {program.goals.map((g) => (
              <option value={g.id} key={g.id}>
                {researchTextLabel(g.title)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Conversation
          <textarea
            rows={12}
            maxLength={400000}
            placeholder={
              'User: Prove the special case first.\nAssistant: Let $n=2$. ...\nUser: Which assumption is essential?\nAssistant: ...'
            }
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        {parsed.error && <p role="alert">{parsed.error}</p>}
        <div className="nb-import-preview">
          <strong>{parsed.turns.length} messages detected</strong>
          {parsed.turns.map((t, i) => (
            <p key={i}>
              <b>
                {i + 1}. {t.role === 'user' ? 'Prompt' : 'Reply'}
              </b>{' '}
              {researchTextLabel(t.content).slice(0, 130)}
            </p>
          ))}
        </div>
        <p className="nb-caption">
          Imported text stays private. Attribution is supplied by you; the app does not verify its
          original author. Review uses the project’s current baseline.
        </p>
        <button
          className="button primary"
          disabled={busy || !parsed.turns.length || !title.trim()}
          onClick={() =>
            onImport({
              title,
              source,
              goalId: goalId || null,
              turns: parsed.turns,
              originalTranscript: text,
            })
          }
        >
          Import into notebook
        </button>
      </div>
    </Modal>
  );
}
