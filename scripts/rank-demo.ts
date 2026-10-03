// Exact arithmetic for the finite demo. This does not prove a general rank hypothesis.
const p = 5;
const mod = (x: number) => ((x % p) + p) % p;
function rank(matrix: number[][]) {
  const a = matrix.map((row) => row.map(mod));
  let r = 0;
  for (let c = 0; c < a[0].length && r < a.length; c++) {
    const pivot = a.findIndex((row, i) => i >= r && row[c] !== 0);
    if (pivot < 0) continue;
    [a[r], a[pivot]] = [a[pivot], a[r]];
    const inverse = [1, 2, 3, 4].find((v) => mod(a[r][c] * v) === 1)!;
    a[r] = a[r].map((v) => mod(v * inverse));
    for (let i = 0; i < a.length; i++)
      if (i !== r) {
        const factor = a[i][c];
        a[i] = a[i].map((v, j) => mod(v - factor * a[r][j]));
      }
    r++;
  }
  return r;
}
function matrix(a: number, b: number, c: number) {
  const rows: number[][] = [];
  for (const [site, left, right] of [
    [a, 0, 1],
    [b, 1, 2],
    [c, 2, 0],
  ]) {
    for (const jet of [
      [1, site, site ** 2, site ** 3],
      [0, 1, 2 * site, 3 * site ** 2],
    ]) {
      const row = Array<number>(12).fill(0);
      for (let j = 0; j < 4; j++) {
        row[left * 4 + j] = jet[j];
        row[right * 4 + j] = -jet[j];
      }
      rows.push(row);
    }
  }
  return rows;
}
const distinct: Record<number, number> = {},
  repeated: Record<number, number> = {};
for (let a = 0; a < p; a++)
  for (let b = 0; b < p; b++)
    for (let c = 0; c < p; c++) {
      const r = rank(matrix(a, b, c));
      const histogram = new Set([a, b, c]).size === 3 ? distinct : repeated;
      histogram[r] = (histogram[r] ?? 0) + 1;
    }
console.log(
  JSON.stringify(
    {
      field: 'F5',
      distinctSiteRankHistogram: distinct,
      repeatedSiteRankHistogram: repeated,
      scope: 'Finite exact calculation only; no general expansion theorem is established.',
    },
    null,
    2,
  ),
);
if (distinct[6] !== 60)
  throw new Error('The expected 60 rank-six distinct-site cases were not reproduced');
