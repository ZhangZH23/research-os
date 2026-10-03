import { useState } from 'react';
import ResearchText from './ResearchText';

const fields = [
  ['title', 'Title'],
  ['summary', 'Summary'],
  ['content', 'Argument'],
  ['explanation', 'Relationship explanation'],
  ['provenanceText', 'Provenance'],
] as const;

function textFields(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== 'object') return [];
  const record = snapshot as Record<string, unknown>;
  return fields.flatMap(([key, label]) => {
    const value = record[key];
    return typeof value === 'string' && value.trim() ? [{ key, label, value }] : [];
  });
}

/** Render full historical arguments only when the reader opens this disclosure. */
export default function HistoryMathematics({ before, after }: { before: unknown; after: unknown }) {
  const [open, setOpen] = useState(false);
  const versions = [
    { label: 'Before', fields: textFields(before) },
    { label: 'After', fields: textFields(after) },
  ].filter((version) => version.fields.length);
  if (!versions.length) return null;
  return (
    <details
      className="history-mathematics"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Read recorded mathematics</summary>
      {open &&
        versions.map((version) => (
          <div key={version.label}>
            <h4>{version.label}</h4>
            {version.fields.map((field) => (
              <div className="history-math-field" key={field.key}>
                <span className="eyebrow">{field.label}</span>
                <ResearchText>{field.value}</ResearchText>
              </div>
            ))}
          </div>
        ))}
    </details>
  );
}
