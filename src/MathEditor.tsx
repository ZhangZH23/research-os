import { useDeferredValue, useId, useRef, useState } from 'react';
import { Code2, Columns2, Eye, Sigma } from 'lucide-react';
import ResearchText from './ResearchText';

type ViewMode = 'source' | 'preview' | 'split';
const snippets = [
  { label: 'Inline math', source: String.raw`$x^2 + y^2 = z^2$` },
  {
    label: 'Equation',
    source: String.raw`\[\n\sum_{i=1}^{n} a_i = S_n\n\]`.replaceAll('\\n', '\n'),
  },
  {
    label: 'Aligned derivation',
    source: String.raw`\begin{align*}
|N(S)| &\ge q|S| - \binom{|S|}{2} \\
       &\ge (1-\varepsilon)q|S|.
\end{align*}`,
  },
  {
    label: 'Matrix',
    source: String.raw`$$
A = \begin{pmatrix} a & b \\ c & d \end{pmatrix}
$$`,
  },
  {
    label: 'Proof',
    source: String.raw`\begin{proof}
Let $h=f-g$. Suppose that $h(a)=h'(a)=0$.
Then $(x-a)^2\mid h(x)$.
\end{proof}`,
  },
];

export function MathGuide() {
  return (
    <details className="math-guide">
      <summary>
        <Sigma size={15} /> LaTeX syntax guide
      </summary>
      <div className="math-guide-grid">
        <code>{String.raw`$\mathbb{F}_q$ or \(\mathbb{F}_q\)`}</code>
        <ResearchText inline>{String.raw`$\mathbb{F}_q$`}</ResearchText>
        <code>{String.raw`$$\frac{a}{b}$$ or \[\frac{a}{b}\]`}</code>
        <ResearchText inline>{String.raw`$\displaystyle\frac{a}{b}$`}</ResearchText>
        <code>{String.raw`\begin{align*} ... \end{align*}`}</code>
        <span>Aligned equations; use &amp; and \\ between rows.</span>
        <code>{String.raw`\begin{proof} ... \end{proof}`}</code>
        <span>Theorems, lemmas, definitions, and proofs with inline math.</span>
      </div>
      <p>
        Combine LaTeX mathematics with Markdown paragraphs, headings, lists, and tables. Code blocks
        remain literal. The original source is saved; rendering does not change a claim’s
        verification.
      </p>
    </details>
  );
}

export default function MathEditor({
  label,
  value,
  onChange,
  rows = 6,
  maxLength,
  placeholder,
  defaultMode = 'split',
  toolbar = true,
  compact = false,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
  defaultMode?: ViewMode;
  toolbar?: boolean;
  compact?: boolean;
  required?: boolean;
}) {
  const id = useId();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<ViewMode>(defaultMode);
  const preview = useDeferredValue(value);
  function insert(source: string) {
    const field = textarea.current;
    const start = field?.selectionStart ?? value.length;
    const end = field?.selectionEnd ?? value.length;
    const block = source.includes('\n');
    const text = (block && start > 0 ? '\n\n' : '') + source + (block ? '\n' : '');
    const next = value.slice(0, start) + text + value.slice(end);
    if (maxLength && next.length > maxLength) return;
    onChange(next);
    if (mode === 'preview') setMode('split');
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(start + text.length, start + text.length);
    });
  }
  return (
    <div className={`math-editor ${compact ? 'compact-editor' : ''}`}>
      <div className="math-editor-heading">
        <label htmlFor={id}>{label}</label>
        <div className="math-view-switch" role="group" aria-label={`${label} view`}>
          {(
            [
              { id: 'source', label: 'Source', Icon: Code2 },
              { id: 'split', label: 'Split', Icon: Columns2 },
              { id: 'preview', label: 'Preview', Icon: Eye },
            ] as const
          ).map((view) => (
            <button
              key={view.id}
              type="button"
              aria-label={`${label}: ${view.label}`}
              aria-pressed={mode === view.id}
              onClick={() => setMode(view.id)}
            >
              <view.Icon size={13} />
              {view.label}
            </button>
          ))}
        </div>
      </div>
      {toolbar && (
        <div className="math-insert-toolbar" role="group" aria-label={`Insert LaTeX into ${label}`}>
          <Sigma size={14} />
          {snippets.map((snippet) => (
            <button type="button" key={snippet.label} onClick={() => insert(snippet.source)}>
              {snippet.label}
            </button>
          ))}
        </div>
      )}
      <div className={`math-editor-panes view-${mode}`}>
        {mode !== 'preview' && (
          <textarea
            id={id}
            ref={textarea}
            aria-label={label}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={rows}
            required={required}
            maxLength={maxLength}
            placeholder={
              placeholder ??
              String.raw`Write research notes with $inline math$, \[display equations\], or \begin{proof}…\end{proof}.`
            }
            spellCheck={false}
          />
        )}
        {mode !== 'source' && (
          <div
            className="math-live-preview"
            role="region"
            aria-label={`${label} rendered preview`}
            aria-busy={preview !== value}
          >
            {preview.trim() ? (
              <ResearchText>{preview}</ResearchText>
            ) : (
              <p className="math-preview-empty">
                Your typeset mathematics will appear here as you write.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
