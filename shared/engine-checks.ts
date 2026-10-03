import type {
  CheckFinding,
  Expression,
  ResearchContract,
  SourceArtifact,
  SourceSpan,
} from './engine';
import { stableSerialize } from './engine';
export const CHECKER_VERSION = '1.0.0';
const finding = (
  rule: string,
  outcome: CheckFinding['outcome'],
  explanation: string,
  scope: string,
  references: string[] = [],
  targetRevisionIds: string[] = [],
): CheckFinding => ({
  rule,
  version: CHECKER_VERSION,
  outcome,
  severity: outcome === 'fail' ? 'warning' : outcome === 'unknown' ? 'info' : 'info',
  explanation,
  scope,
  references,
  targetRevisionIds,
  limitations: [
    'This check compares explicitly recorded structure; it is not a proof or a general decision procedure for implication.',
  ],
});
/** Textual repetition only; retain case, braces, grouping, operator order and quantifier binding. */
export const normalizeExactStatement = (text: string) =>
  text.normalize('NFC').trim().replace(/\s+/gu, ' ');
export function checkTextualRepetition(
  statement: string,
  prior: string,
  hasNewEvidence = false,
): CheckFinding {
  const same = normalizeExactStatement(statement) === normalizeExactStatement(prior);
  return finding(
    'textual-repetition',
    same ? 'pass' : 'unknown',
    same
      ? hasNewEvidence
        ? 'The statement repeats existing text. Additional evidence may be a real evidence update; it is not a new statement.'
        : 'The statement repeats existing text. No additional knowledge gain is established by repetition.'
      : 'The strings differ after conservative whitespace normalization; mathematical equivalence and novelty remain unknown.',
    'Conservative text comparison',
    ['statement'],
  );
}
export function validateSourceSpan(
  source: SourceArtifact | undefined,
  span: SourceSpan,
  projectId?: string,
): CheckFinding {
  let error = '';
  if (!source) error = 'Source artifact is missing.';
  else if (projectId && source.projectId !== projectId)
    error = 'Source artifact is outside this project.';
  else if (span.sourceId !== source.id || span.sourceHash !== source.hash)
    error = 'Source ID or immutable source hash does not match.';
  else if (
    !Number.isSafeInteger(span.start) ||
    !Number.isSafeInteger(span.end) ||
    span.start < 0 ||
    span.end <= span.start ||
    span.end > source.text.length
  )
    error = 'Source span is outside the original UTF-16 code-unit range or empty.';
  else if (source.text.slice(span.start, span.end) !== span.quote)
    error =
      'Quoted text does not exactly match the original source at the supplied UTF-16 offsets.';
  // Reject splitting a surrogate pair, although JavaScript slice technically permits this.
  else if (
    [span.start, span.end].some(
      (p) =>
        p > 0 &&
        p < source.text.length &&
        /[\uD800-\uDBFF]/.test(source.text[p - 1]) &&
        /[\uDC00-\uDFFF]/.test(source.text[p]),
    )
  )
    error = 'Source span splits a Unicode surrogate pair.';
  const result = finding(
    'source-span',
    error ? 'fail' : 'pass',
    error ||
      'The exact quote matches the immutable source using UTF-16 code-unit offsets, including original line endings.',
    'Provenance integrity only',
    [span.sourceId],
  );
  result.limitations = [
    'A matching quote establishes provenance, not correctness or authenticated authorship of imported speakers.',
  ];
  return result;
}
function deps(
  expression: Expression,
  variables: NonNullable<ResearchContract['variables']>,
  visiting = new Set<string>(),
  depth = 0,
): { known: boolean; names: Set<string> } {
  if (depth > 40) return { known: false, names: new Set() };
  if (expression.kind === 'constant') return { known: true, names: new Set() };
  if (expression.kind === 'variable') {
    if (visiting.has(expression.name)) return { known: false, names: new Set([expression.name]) };
    const v = variables.find((v) => v.name === expression.name);
    if (!v) return { known: false, names: new Set([expression.name]) };
    const next = new Set(visiting);
    next.add(v.name);
    const names = new Set([v.name, ...(v.dependsOn ?? [])]);
    let known = v.dependsOn !== undefined;
    for (const name of v.dependsOn ?? []) {
      const other = variables.find((v) => v.name === name);
      if (other?.dependsOn?.length) {
        const sub = deps({ kind: 'variable', name }, variables, next, depth + 1);
        sub.names.forEach((n) => names.add(n));
        known &&= sub.known;
      }
    }
    if (v.definition) {
      const sub = deps(v.definition, variables, next, depth + 1);
      sub.names.forEach((n) => names.add(n));
      known = sub.known && (v.dependsOn === undefined || known);
    }
    return { known, names };
  }
  const children: Expression[] =
    'terms' in expression
      ? expression.terms
      : expression.kind === 'power'
        ? [expression.base, expression.exponent]
        : [expression.argument];
  const all = children.map((child) => deps(child, variables, visiting, depth + 1));
  return { known: all.every((a) => a.known), names: new Set(all.flatMap((a) => [...a.names])) };
}
export const expressionDependencies = (expression: Expression, contract: ResearchContract) => {
  const result = deps(expression, contract.variables ?? []);
  return { known: result.known, dependencies: [...result.names].sort() };
};
const specified = (c: ResearchContract, field: string) => c.fieldStates?.[field] !== 'unknown';
/** Supported declarations only. Unknown fields never receive invented quantifiers or domains. */
export function checkContractCompatibility(
  target: ResearchContract,
  reported: ResearchContract,
  targetRevisionIds: string[] = [],
): CheckFinding[] {
  const out: CheckFinding[] = [];
  const add = (
    rule: string,
    result: CheckFinding['outcome'],
    explanation: string,
    refs: string[] = [],
  ) =>
    out.push(
      finding(
        rule,
        result,
        explanation,
        'Compatibility of declared contracts only',
        refs,
        targetRevisionIds,
      ),
    );
  const comparableVariables = target.variables && reported.variables;
  const unknownVariables: string[] = [];
  const mismatchedMeanings: string[] = [];
  if (comparableVariables)
    for (const tv of target.variables!) {
      const rv = reported.variables!.find((v) => v.name === tv.name);
      if (!rv || !tv.meaning || !rv.meaning || !tv.domain || !rv.domain)
        unknownVariables.push(tv.name);
      else if (tv.meaning !== rv.meaning || tv.domain !== rv.domain)
        mismatchedMeanings.push(tv.name);
    }
  add(
    'variable-meaning',
    !comparableVariables || unknownVariables.length || mismatchedMeanings.length
      ? 'unknown'
      : 'pass',
    !comparableVariables
      ? 'Variable meanings and domains are not fully declared.'
      : mismatchedMeanings.length
        ? `Meanings or parameter domains differ for ${mismatchedMeanings.join(', ')}; names alone cannot be aligned.`
        : unknownVariables.length
          ? `Missing meanings or domains for ${unknownVariables.join(', ')}.`
          : 'Shared variable names have identical declared meanings and domains.',
    ['variables'],
  );
  if (
    !target.inputGuarantee ||
    !reported.inputGuarantee ||
    target.inputGuarantee === 'unknown' ||
    reported.inputGuarantee === 'unknown' ||
    !specified(target, 'inputGuarantee') ||
    !specified(reported, 'inputGuarantee')
  )
    add('input-scope', 'unknown', 'The input guarantee is missing or recorded as unknown.', [
      'inputGuarantee',
    ]);
  else if (target.inputGuarantee === reported.inputGuarantee)
    add('input-scope', 'pass', 'The declared input-guarantee categories match.', [
      'inputGuarantee',
    ]);
  else if (
    (target.inputGuarantee === 'arbitrary' && reported.inputGuarantee === 'random') ||
    (target.inputGuarantee === 'flat_sources' && reported.inputGuarantee === 'linear_subspaces') ||
    reported.inputGuarantee === 'finite_enumeration'
  )
    add(
      'input-scope',
      'fail',
      `The result has scope ${reported.inputGuarantee}, while the target requires ${target.inputGuarantee}. Admit a restricted result with the original target left open.`,
      ['inputGuarantee'],
    );
  else
    add(
      'input-scope',
      'unknown',
      `The recorded input guarantees differ (${target.inputGuarantee} versus ${reported.inputGuarantee}); implication between these categories is not implemented.`,
      ['inputGuarantee'],
    );
  if (
    !target.inputDomain ||
    !reported.inputDomain ||
    !specified(target, 'inputDomain') ||
    !specified(reported, 'inputDomain')
  )
    add('input-domain', 'unknown', 'Exact input domains are not both declared.', ['inputDomain']);
  else
    add(
      'input-domain',
      target.inputDomain === reported.inputDomain ? 'pass' : 'unknown',
      target.inputDomain === reported.inputDomain
        ? 'The declared input domains match.'
        : 'The input-domain descriptions differ. This checker cannot infer set containment from prose.',
      ['inputDomain'],
    );
  if (
    !target.quantifiers ||
    !reported.quantifiers ||
    !specified(target, 'quantifiers') ||
    !specified(reported, 'quantifiers')
  )
    add('quantifier-binding', 'unknown', 'Quantifier order and binding are not both declared.', [
      'quantifiers',
    ]);
  else if (mismatchedMeanings.length)
    add(
      'quantifier-binding',
      'unknown',
      'Variable meanings differ; quantifier alignment requires researcher review.',
      ['quantifiers', 'variables'],
    );
  else if (stableSerialize(target.quantifiers) === stableSerialize(reported.quantifiers))
    add('quantifier-binding', 'pass', 'The declared ordered quantifier bindings match.', [
      'quantifiers',
    ]);
  else {
    const changed = Array.from(
      { length: Math.max(target.quantifiers.length, reported.quantifiers.length) },
      (_, i) => i,
    ).filter(
      (i) => stableSerialize(target.quantifiers![i]) !== stableSerialize(reported.quantifiers![i]),
    );
    add(
      'quantifier-binding',
      'fail',
      `Ordered quantifier bindings changed at positions ${changed.map((i) => i + 1).join(', ')}. This is a contract change, not a proof of non-implication.`,
      changed.map((i) => `quantifiers.${i}`),
    );
  }
  if (
    !target.construction ||
    !reported.construction ||
    target.construction === 'unknown' ||
    reported.construction === 'unknown' ||
    !specified(target, 'construction') ||
    !specified(reported, 'construction')
  )
    add('construction', 'unknown', 'Constructiveness is missing or unknown.', ['construction']);
  else if (target.construction === 'explicit' && reported.construction === 'existential')
    add(
      'construction',
      'fail',
      'An existential guarantee does not supply the explicit construction required by this target.',
      ['construction'],
    );
  else
    add(
      'construction',
      'pass',
      'The recorded constructiveness requirement is not weakened. This does not verify the claimed algorithm.',
      ['construction'],
    );
  if (
    !target.assumptions ||
    !reported.assumptions ||
    !specified(target, 'assumptions') ||
    !specified(reported, 'assumptions')
  )
    add(
      'assumptions',
      'unknown',
      'Assumptions are not both explicitly declared; an absent list is not an empty list.',
      ['assumptions'],
    );
  else {
    const added = reported.assumptions.filter((a) => !target.assumptions!.includes(a));
    const removed = target.assumptions.filter((a) => !reported.assumptions!.includes(a));
    add(
      'assumptions',
      added.length ? 'fail' : removed.length ? 'unknown' : 'pass',
      added.length
        ? `Added assumptions restrict this result: ${added.join('; ')}. Removing them remains an obligation.`
        : removed.length
          ? `Removed assumptions require review of the stronger claim: ${removed.join('; ')}.`
          : 'The exact declared assumptions match.',
      ['assumptions'],
    );
  }
  const independent = target.runtime?.exponentIndependentOf;
  if (!independent?.length)
    add(
      'runtime-exponent',
      'not_applicable',
      'No uniform-exponent requirement is explicitly declared.',
      ['runtime'],
    );
  else if (!reported.runtime?.exponent)
    add('runtime-exponent', 'unknown', 'A runtime exponent expression is not recorded.', [
      'runtime.exponent',
    ]);
  else if (mismatchedMeanings.length || unknownVariables.length || !comparableVariables)
    add(
      'runtime-exponent',
      'unknown',
      'The runtime variables require matching meanings and domains before comparing parameter dependence.',
      ['variables', 'runtime'],
    );
  else {
    const d = expressionDependencies(reported.runtime.exponent, reported);
    const violation = independent.filter((x) => d.dependencies.includes(x));
    add(
      'runtime-exponent',
      violation.length ? 'fail' : !d.known ? 'unknown' : 'pass',
      violation.length
        ? `The reported exponent depends on ${violation.join(', ')}, so the supplied bound does not establish the target's independent exponent. This is not a runtime lower bound and does not rule out a better algorithm or analysis.`
        : !d.known
          ? 'Some exponent dependencies are undeclared or circular; uniformity remains unknown.'
          : 'The declared exponent expression has no dependency on the forbidden parameters within this supported expression fragment. This does not verify the runtime bound.',
      ['runtime.exponent', 'runtime.exponentIndependentOf', 'variables'],
    );
  }
  return out;
}
export function checkExperimentalScope(
  contract: ResearchContract,
  experiment: {
    domain: string;
    exhaustive: boolean;
    executionSucceeded: boolean;
    arithmeticModel?: string;
    enumerationCount?: number;
  },
): CheckFinding {
  if (!experiment.executionSucceeded)
    return finding(
      'experimental-scope',
      'unknown',
      'The test harness failed. This is an execution error, not a mathematical refutation.',
      'Declared experiment scope',
    );
  if (!experiment.arithmeticModel)
    return finding(
      'experimental-scope',
      'unknown',
      'The arithmetic model is not specified.',
      'Declared experiment scope',
    );
  if (!contract.finiteDomain)
    return finding(
      'experimental-scope',
      'fail',
      'Finite testing does not establish an unrestricted or parameterized theorem. Preserve the empirical evidence within its tested domain.',
      'Declared experiment scope',
    );
  if (!experiment.exhaustive)
    return finding(
      'experimental-scope',
      'unknown',
      'The search is not exhaustive, so absence of a counterexample remains empirical evidence only.',
      'Declared experiment scope',
    );
  if (contract.finiteDomain.description !== experiment.domain)
    return finding(
      'experimental-scope',
      'unknown',
      'The finite experiment domain does not exactly match the finite claim domain.',
      'Declared experiment scope',
    );
  if (
    contract.finiteDomain.cardinality !== undefined &&
    experiment.enumerationCount !== contract.finiteDomain.cardinality
  )
    return finding(
      'experimental-scope',
      'fail',
      'The reported enumeration count does not cover the declared finite domain cardinality.',
      'Declared experiment scope',
    );
  return finding(
    'experimental-scope',
    'pass',
    'The declared exhaustive experiment has the same finite scope. Executable correctness and theorem-specific premises still require a checker or review.',
    'Exact declared finite domain only',
  );
}
export function checkCounterexample(
  contract: ResearchContract,
  witness: {
    premiseChecks: { premise: string; satisfied: 'yes' | 'no' | 'unknown' }[];
    conclusionViolated: 'yes' | 'no' | 'unknown';
  },
): CheckFinding {
  if (witness.premiseChecks.some((p) => p.satisfied === 'no'))
    return finding(
      'counterexample-premises',
      'fail',
      'The alleged witness violates a premise and is inapplicable as a counterexample to this revision. Retain it as an attempted witness.',
      'Declared witness premise consistency',
    );
  if (
    !contract.assumptions ||
    contract.assumptions.some(
      (a) => !witness.premiseChecks.some((p) => p.premise === a && p.satisfied === 'yes'),
    ) ||
    witness.premiseChecks.some((p) => p.satisfied === 'unknown') ||
    witness.conclusionViolated === 'unknown'
  )
    return finding(
      'counterexample-premises',
      'unknown',
      'Premise coverage or conclusion violation is unresolved. The claim is not refuted.',
      'Declared witness premise consistency',
    );
  if (witness.conclusionViolated === 'no')
    return finding(
      'counterexample-premises',
      'fail',
      'The supplied witness does not violate the conclusion.',
      'Declared witness premise consistency',
    );
  return finding(
    'counterexample-premises',
    'pass',
    'The declared checks cover the assumptions and assert conclusion violation. These declarations still need independent verification; this consistency check is not a counterexample certificate.',
    'Declared witness premise consistency',
  );
}
export interface PrimeFieldRankResult {
  checkerId: 'prime-field-rank';
  checkerVersion: string;
  modulus: number;
  rows: number;
  columns: number;
  rank: number;
  pivotColumns: number[];
  reducedMatrix: number[][];
  input: number[][];
  scope: string;
  limitations: string[];
}
/** Bounded exact Gaussian elimination. No code execution, extension fields, or theorem inference. */
export function checkPrimeFieldRank(input: unknown): PrimeFieldRankResult {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Supply { modulus, matrix } for a prime field.');
  const obj = input as { modulus?: unknown; matrix?: unknown };
  if (Object.keys(obj).some((k) => !['modulus', 'matrix'].includes(k)))
    throw new Error(
      'Only modulus and matrix are supported; field extensions and executable inputs are unsupported.',
    );
  const p = obj.modulus;
  if (typeof p !== 'number' || !Number.isSafeInteger(p) || p < 2 || p > 1_000_000)
    throw new Error('Prime modulus must be an integer from 2 through 1,000,000.');
  for (let d = 2; d * d <= p; d++)
    if (p % d === 0)
      throw new Error(
        'The modulus must be prime; composite rings and extension fields are unsupported.',
      );
  if (
    !Array.isArray(obj.matrix) ||
    !obj.matrix.length ||
    obj.matrix.length > 32 ||
    !Array.isArray(obj.matrix[0]) ||
    !obj.matrix[0].length ||
    obj.matrix[0].length > 32
  )
    throw new Error('Supply a nonempty matrix with at most 32 rows and 32 columns.');
  const cols = obj.matrix[0].length;
  if (
    obj.matrix.some(
      (row) =>
        !Array.isArray(row) ||
        row.length !== cols ||
        row.some((x) => typeof x !== 'number' || !Number.isSafeInteger(x)),
    )
  )
    throw new Error('Matrix rows must be rectangular and contain safe integers.');
  const original = (obj.matrix as number[][]).map((row) => [...row]);
  const a = original.map((row) => row.map((x) => ((x % p) + p) % p));
  const pow = (b: number, n: number) => {
    let ans = 1;
    while (n) {
      if (n % 2) ans = (ans * b) % p;
      b = (b * b) % p;
      n = Math.floor(n / 2);
    }
    return ans;
  };
  const pivots: number[] = [];
  let row = 0;
  for (let col = 0; col < cols && row < a.length; col++) {
    let pivot = row;
    while (pivot < a.length && a[pivot][col] === 0) pivot++;
    if (pivot === a.length) continue;
    [a[row], a[pivot]] = [a[pivot], a[row]];
    const inverse = pow(a[row][col], p - 2);
    for (let j = 0; j < cols; j++) a[row][j] = (a[row][j] * inverse) % p;
    for (let i = 0; i < a.length; i++)
      if (i !== row) {
        const factor = a[i][col];
        for (let j = 0; j < cols; j++) a[i][j] = (((a[i][j] - factor * a[row][j]) % p) + p) % p;
      }
    pivots.push(col);
    row++;
  }
  return {
    checkerId: 'prime-field-rank',
    checkerVersion: CHECKER_VERSION,
    modulus: p,
    rows: a.length,
    columns: cols,
    rank: row,
    pivotColumns: pivots,
    reducedMatrix: a,
    input: original,
    scope: `Exact rank of this ${a.length}×${cols} matrix over the prime field F_${p}.`,
    limitations: [
      'At most 32×32 matrices and primes ≤1,000,000; safe-integer inputs only.',
      'Products are below 10^12, within exact IEEE-754 integer arithmetic.',
      'A rank result is not itself a counterexample or a proof of a parameterized theorem.',
    ],
  };
}
