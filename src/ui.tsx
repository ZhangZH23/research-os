import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import {
  X,
  FileText,
  CircleHelp,
  FlaskConical,
  Lightbulb,
  GitBranch,
  BookOpen,
  Bot,
  ShieldCheck,
  TriangleAlert,
  Network,
} from 'lucide-react';
import type { NodeType, Status } from '../shared/types';
export function statusClass(status: string) {
  return status.toLowerCase().replaceAll(' ', '-');
}
export function Badge({ status }: { status: Status }) {
  return (
    <span className={`badge ${statusClass(status)}`}>
      <i />
      {status}
    </span>
  );
}
export function TypeIcon({ type, size = 16 }: { type: NodeType; size?: number }) {
  const Icon = {
    Claim: FileText,
    Conjecture: Lightbulb,
    Lemma: GitBranch,
    Theorem: ShieldCheck,
    'Open Question': CircleHelp,
    Approach: Network,
    Experiment: FlaskConical,
    Evidence: FileText,
    Counterexample: TriangleAlert,
    'Source / Paper': BookOpen,
    'Agent Run': Bot,
    Note: FileText,
  }[type];
  return <Icon size={size} />;
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prior = document.activeElement as HTMLElement;
    const el = ref.current;
    (
      el?.querySelector<HTMLElement>('input,select,textarea') ??
      el?.querySelector<HTMLElement>('button')
    )?.focus();
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        closeRef.current();
      }
      if (e.key === 'Tab') {
        const a = Array.from(
          el?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input,select,textarea,a[href]',
          ) ?? [],
        );
        if (e.shiftKey && document.activeElement === a[0]) {
          e.preventDefault();
          a.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === a.at(-1)) {
          e.preventDefault();
          a[0]?.focus();
        }
      }
    };
    document.addEventListener('keydown', handle);
    return () => {
      document.removeEventListener('keydown', handle);
      prior?.focus();
    };
  }, []);
  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close dialog">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export const dateLabel = (date: string) =>
  new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
export const timeLabel = (date: string) => new Date(date).toLocaleString();
