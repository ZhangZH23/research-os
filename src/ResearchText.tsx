import { memo, type ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { normalizeMathMarkdown } from '../shared/math';

type ResearchTextProps = {
  children: string;
  inline?: boolean;
  className?: string;
};

const Span = ({ children }: { children?: ReactNode }) => <span>{children}</span>;
const inlineComponents: Components = {
  p: Span,
  h1: Span,
  h2: Span,
  h3: Span,
  h4: Span,
  h5: Span,
  h6: Span,
  blockquote: Span,
  pre: Span,
  ul: Span,
  ol: Span,
  li: Span,
  table: Span,
  thead: Span,
  tbody: Span,
  tr: Span,
  th: Span,
  td: Span,
  hr: () => <span> · </span>,
  // Compact labels commonly live inside buttons. Never nest links or inputs.
  a: Span,
  input: ({ checked }) => <span>{checked ? '☑' : '☐'}</span>,
  img: ({ alt }) => <span>{alt}</span>,
};
const blockComponents: Components = {
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  // Render the alternative text instead of loading arbitrary remote resources.
  img: ({ alt }) => <span className="research-image-label">{alt}</span>,
};

/** Safe Markdown and mathematical typesetting; the stored source is untouched. */
export const ResearchText = memo(function ResearchText({
  children,
  inline = false,
  className = '',
}: ResearchTextProps) {
  const Root = inline ? 'span' : 'div';
  return (
    <Root
      className={`research-text${inline ? ' research-text-inline' : ''}${className ? ` ${className}` : ''}`}
    >
      <Markdown
        skipHtml
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          [
            rehypeKatex,
            {
              trust: false,
              strict: 'ignore',
              throwOnError: false,
              output: 'htmlAndMathml',
              maxExpand: 1000,
              maxSize: 20,
            },
          ],
        ]}
        components={inline ? inlineComponents : blockComponents}
      >
        {normalizeMathMarkdown(children)}
      </Markdown>
    </Root>
  );
});

export default ResearchText;
