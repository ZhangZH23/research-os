import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ResearchText from '../src/ResearchText';
import { normalizeMathMarkdown, researchTextLabel } from '../shared/math';
import { seedNodes } from '../server/seed';

const render = (children: string, inline = false) =>
  renderToStaticMarkup(createElement(ResearchText, { children, inline }));
const formulas = (html: string) => (html.match(/class="katex"/g) ?? []).length;

test('inline and display TeX delimiters typeset fractions, fields, sums, and matrices', () => {
  const source = String.raw`Let $x^2$ and \(\mathbb{F}_5\) satisfy
$$\frac{1}{2} = 0.5$$
\[\sum_{i=1}^{n} i = \frac{n(n+1)}{2}\]`;
  const html = render(source);
  assert.equal(formulas(html), 4);
  assert.equal((html.match(/class="katex-display"/g) ?? []).length, 2);
  assert.match(html, /<math/);
  assert.match(html, /<mfrac>/);
  assert.equal(source.includes('\\['), true, 'rendering never replaces the stored source');
});

test('standalone display environments and nested cases render without extra math wrappers', () => {
  for (const environment of [
    'equation',
    'equation*',
    'align',
    'align*',
    'gather',
    'gather*',
    'aligned',
    'cases',
  ]) {
    const source = `\\begin{${environment}}x = 1\\end{${environment}}`;
    const html = render(source);
    assert.equal(formulas(html), 1, environment);
    assert.match(html, /katex-display/, environment);
    assert.doesNotMatch(html, /katex-error/, environment);
  }
  const nested = render(
    String.raw`\begin{equation}f(x)=\begin{cases}x & x>0 \\ 0 & x\leq 0\end{cases}\end{equation}`,
  );
  assert.equal(formulas(nested), 1);
  assert.doesNotMatch(nested, /katex-error/);
});

test('theorem and proof environments become readable labelled blocks with math', () => {
  const html = render(String.raw`\begin{theorem}[Finite bound]
For $n\geq 1$, \(a_n \leq n^2\).
\end{theorem}
\begin{proof}By induction.
\[a_{n+1} \leq (n+1)^2\]
\end{proof}`);
  assert.match(html, /<blockquote>/);
  assert.match(html, /Theorem \(Finite bound\)/);
  assert.match(html, /Proof\./);
  assert.match(html, /∎/);
  assert.equal(formulas(html), 3);
});

test('escaped dollars, inline code, fenced code, and indented code stay literal', () => {
  const source =
    String.raw`Cost: \$5. Show ` +
    '`\\(x\\)`' +
    String.raw` as source.

~~~latex
\[y^2\]
\begin{align}a&=b\end{align}
~~~

    \(indented\)

Now \(z^2\).`;
  const html = render(source);
  assert.equal(formulas(html), 1);
  assert.match(html, /Cost: \$5/);
  assert.match(html, /<code>\\\(x\\\)<\/code>/);
  assert.match(html, /\\begin\{align\}/);
  assert.match(html, /\\\(indented\\\)/);
  assert.equal(normalizeMathMarkdown('```latex\n\\[x\\]'), '```latex\n\\[x\\]');
});

test('malformed formulas remain visible without crashing the surrounding content', () => {
  const html = render(String.raw`Before $\frac{1}{$ after. Unclosed \(x^2.`);
  assert.match(html, /Before/);
  assert.match(html, /after/);
  assert.match(html, /katex-error/);
  assert.match(html, /frac/);
  assert.match(html, /Unclosed/);
});

test('raw HTML, unsafe Markdown URLs and trusted-only TeX features cannot inject active content', () => {
  const html = render(String.raw`<script>alert(1)</script>

<img src=x onerror=alert(1)>

[click](javascript:alert%281%29)

$\href{javascript:alert(1)}{click}$

$\htmlClass{hostile}{x}$

$\includegraphics{https://example.com/tracker.png}$

![remote](https://example.com/another-tracker.png)`);
  assert.equal(
    formulas(html),
    3,
    'the malicious TeX examples were parsed, not hidden by an HTML block',
  );
  assert.doesNotMatch(html, /<(?:script|img)\b/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.doesNotMatch(html, /class="hostile"/);
  assert.doesNotMatch(html, /src="https:\/\/example.com/);
});

test('compact titles only contain phrasing content and do not create nested interactive elements', () => {
  const html = render(
    '# Title $x^2$\n\n[link](https://example.com)\n\n- item\n\n$$x=1$$\n\n- [x] checked',
    true,
  );
  assert.match(html, /^<span class="research-text research-text-inline">/);
  assert.doesNotMatch(html, /<(?:div|p|h[1-6]|pre|ul|ol|li|table|tr|td|th|blockquote|a|input)\b/);
  assert.equal(formulas(html), 2);
});

test('plain option and search labels project math to readable Unicode without HTML or source annotations', () => {
  assert.equal(
    researchTextLabel(String.raw`Bound in $\mathbb{F}_5$ for \(x^2\)`),
    'Bound in F5 for x2',
  );
  assert.equal(researchTextLabel(String.raw`$a < b$`), 'a<b');
  assert.equal(researchTextLabel(String.raw`$\unknowncommand{x}$`), String.raw`\unknowncommand{x}`);
  assert.equal(researchTextLabel(String.raw`Cost \$5 and $x$`), 'Cost $5 and x');
  assert.doesNotMatch(researchTextLabel(String.raw`$\frac{1}{2}$`), /<[^>]*>|annotation|frac/);
});

test('every demonstration node renders mathematical text without a KaTeX error', () => {
  let renderedFormulas = 0;
  for (const node of seedNodes) {
    for (const field of ['title', 'summary', 'content', 'provenanceText'] as const) {
      const value = node[field];
      if (!value) continue;
      const html = render(value, field === 'title' || field === 'summary');
      assert.doesNotMatch(html, /katex-error/, `${node.id}.${field}`);
      renderedFormulas += formulas(html);
    }
  }
  assert.ok(renderedFormulas > 0, 'the demo includes rendered equations');
});
