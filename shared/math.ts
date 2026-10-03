import katex from 'katex';

const mathEnvironments = new Set([
  'equation',
  'equation*',
  'align',
  'align*',
  'alignat',
  'alignat*',
  'gather',
  'gather*',
  'aligned',
  'alignedat',
  'gathered',
  'split',
  'cases',
  'dcases',
  'rcases',
  'drcases',
  'matrix',
  'pmatrix',
  'bmatrix',
  'Bmatrix',
  'vmatrix',
  'Vmatrix',
  'smallmatrix',
  'array',
]);
const proseEnvironments = new Set([
  'theorem',
  'lemma',
  'proposition',
  'corollary',
  'definition',
  'remark',
  'conjecture',
  'proof',
  'example',
  'assumption',
]);

function escaped(source: string, index: number) {
  let count = 0;
  for (let i = index - 1; i >= 0 && source[i] === '\\'; i--) count++;
  return count % 2 === 1;
}

function closingDelimiter(source: string, delimiter: string, start: number) {
  let index = source.indexOf(delimiter, start);
  while (index !== -1) {
    const sameDollarRun =
      delimiter[0] !== '$' ||
      (source[index - 1] !== '$' && source[index + delimiter.length] !== '$');
    if (!escaped(source, index) && sameDollarRun) return index;
    index = source.indexOf(delimiter, index + delimiter.length);
  }
  return -1;
}

// Protect Markdown code before interpreting TeX. In particular, examples in a
// fenced `latex` block must remain source code instead of becoming equations.
function codeEnd(source: string, index: number) {
  if (index === 0 || source[index - 1] === '\n') {
    const rest = source.slice(index);
    const fence = /^( {0,3})(`{3,}|~{3,})[^\n]*(?:\n|$)/.exec(rest);
    if (fence) {
      const marker = fence[2][0];
      const close = new RegExp(`^ {0,3}${marker}{${fence[2].length},}[ \\t]*$`, 'gm');
      close.lastIndex = index + fence[0].length;
      const match = close.exec(source);
      return match ? match.index + match[0].length : source.length;
    }
    if (/^( {4}|\t)/.test(rest)) {
      const next = source.indexOf('\n', index);
      return next === -1 ? source.length : next;
    }
  }
  if (source[index] === '`' && !escaped(source, index)) {
    let width = 1;
    while (source[index + width] === '`') width++;
    const run = '`'.repeat(width);
    let end = source.indexOf(run, index + width);
    while (end !== -1) {
      if (source[end - 1] !== '`' && source[end + width] !== '`') return end + width;
      end = source.indexOf(run, end + width);
    }
  }
  return -1;
}

function environmentEnd(source: string, name: string, start: number) {
  const begin = `\\begin{${name}}`;
  const end = `\\end{${name}}`;
  let depth = 1;
  let cursor = start;
  while (cursor < source.length) {
    const nextBegin = source.indexOf(begin, cursor);
    const nextEnd = source.indexOf(end, cursor);
    if (nextEnd === -1) return -1;
    if (nextBegin !== -1 && nextBegin < nextEnd) {
      if (!escaped(source, nextBegin)) depth++;
      cursor = nextBegin + begin.length;
    } else {
      if (!escaped(source, nextEnd)) depth--;
      if (!depth) return nextEnd;
      cursor = nextEnd + end.length;
    }
  }
  return -1;
}

const display = (formula: string) => `\n\n$$\n${formula.trim()}\n$$\n\n`;

/** Rendering-only normalization. Never persist this in place of the user's source. */
export function normalizeMathMarkdown(source: string, depth = 0): string {
  let result = '';
  let index = 0;
  while (index < source.length) {
    const protectedEnd = codeEnd(source, index);
    if (protectedEnd !== -1) {
      result += source.slice(index, protectedEnd);
      index = protectedEnd;
      continue;
    }

    const current = source[index];
    if (current === '$' && !escaped(source, index)) {
      const delimiter = source[index + 1] === '$' ? '$$' : '$';
      const end = closingDelimiter(source, delimiter, index + delimiter.length);
      if (end !== -1) {
        const formula = source.slice(index + delimiter.length, end);
        result += delimiter === '$$' ? display(formula) : `$${formula}$`;
        index = end + delimiter.length;
        continue;
      }
    }

    if (current === '\\' && !escaped(source, index)) {
      const opening = source.slice(index, index + 2);
      if (opening === '\\(' || opening === '\\[') {
        const end = closingDelimiter(source, opening === '\\(' ? '\\)' : '\\]', index + 2);
        if (end !== -1) {
          const formula = source.slice(index + 2, end);
          result += opening === '\\[' ? display(formula) : `$${formula}$`;
          index = end + 2;
          continue;
        }
      }

      const environment = /^\\begin\{([A-Za-z]+\*?)\}/.exec(source.slice(index));
      if (environment) {
        const name = environment[1];
        const proseName = name.replace(/\*$/, '');
        if (mathEnvironments.has(name) || (proseEnvironments.has(proseName) && depth < 16)) {
          const start = index + environment[0].length;
          const end = environmentEnd(source, name, start);
          if (end !== -1) {
            const endOfEnvironment = end + `\\end{${name}}`.length;
            if (mathEnvironments.has(name)) {
              result += display(source.slice(index, endOfEnvironment));
            } else {
              let body = source.slice(start, end).trim();
              const optionalTitle = /^\[([^\]\n]+)\]\s*/.exec(body);
              if (optionalTitle) body = body.slice(optionalTitle[0].length);
              const label = proseName[0].toUpperCase() + proseName.slice(1);
              const heading = `**${label}${optionalTitle ? ` (${optionalTitle[1]})` : ''}.**`;
              const normalized = normalizeMathMarkdown(body, depth + 1).trim();
              const content = `${heading}\n\n${normalized}${proseName === 'proof' ? '\n\n∎' : ''}`;
              result += `\n\n${content
                .split('\n')
                .map((line) => `> ${line}`)
                .join('\n')}\n\n`;
            }
            index = endOfEnvironment;
            continue;
          }
        }
      }

      // Preserve Markdown escapes, including literal dollars and backslashes.
      if (index + 1 < source.length) {
        result += source.slice(index, index + 2);
        index += 2;
        continue;
      }
    }
    result += current;
    index++;
  }
  return result;
}

function decodeEntities(source: string) {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  };
  return source.replace(
    /&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
    (match, entity: string) => {
      if (entity[0] !== '#') return named[entity.toLowerCase()] ?? match;
      const hex = entity[1].toLowerCase() === 'x';
      const code = parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    },
  );
}

function formulaLabel(formula: string) {
  try {
    const mathml = katex.renderToString(formula, {
      output: 'mathml',
      displayMode: true,
      trust: false,
      strict: 'ignore',
      throwOnError: true,
      maxExpand: 1000,
      maxSize: 20,
    });
    return decodeEntities(
      mathml.replace(/<annotation\b[^>]*>[\s\S]*?<\/annotation>/g, '').replace(/<[^>]*>/g, ''),
    );
  } catch {
    return formula;
  }
}

/** Plain Unicode text for native option labels, accessible labels, and search. */
export function researchTextLabel(source: string): string {
  const normalized = normalizeMathMarkdown(source);
  let result = '';
  let index = 0;
  while (index < normalized.length) {
    const protectedEnd = codeEnd(normalized, index);
    if (protectedEnd !== -1) {
      result += normalized.slice(index, protectedEnd).replace(/^`+|`+$/g, '');
      index = protectedEnd;
      continue;
    }
    if (normalized[index] === '$' && !escaped(normalized, index)) {
      const delimiter = normalized[index + 1] === '$' ? '$$' : '$';
      const end = closingDelimiter(normalized, delimiter, index + delimiter.length);
      if (end !== -1) {
        result += formulaLabel(normalized.slice(index + delimiter.length, end));
        index = end + delimiter.length;
        continue;
      }
    }
    if (normalized[index] === '\\' && normalized[index + 1] === '$') {
      result += '$';
      index += 2;
      continue;
    }
    result += normalized[index++];
  }
  return result
    .replace(/^\s*(?:>\s*|#{1,6}\s+)/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
