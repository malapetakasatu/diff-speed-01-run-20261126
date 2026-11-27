// makefun-diff 1.0.0: make.fun's own line diff (MIT, LICENSE), derived from jsdiff 9.0.0's Myers line diff (its
// src/diff/base.js and src/diff/line.js, BSD-3-Clause, Copyright (c) 2009-2015, Kevin Decker; NOTICE carries its
// licence word for word). diffPatch({ old, new }) returns make.fun's own patch of the two texts, a string, by the rule
// below; jsdiff's own patch and its own choice between equally short edit scripts are not this rule's.
//
// Lines. A text is cut after every "\n" (the only separator; a "\r" is part of its line), and a last line with no "\n"
// is a line too, one that ends its file without a newline. The empty text has no lines; "\n" has one, an empty line.
// Two lines are equal when they are the same code units, their "\n" (or its absence) included.
//
// The edit script. The lines both texts share at their start are kept (the longest common prefix), then the lines
// both share at their end, of the lines left (the longest common suffix). Between them, Myers's greedy search runs
// from the first lines: for d = 0, 1, 2, ... edits and each diagonal k = x - y from -d to d in steps of 2 (x old lines
// and y new lines consumed), the furthest point a path of d edits reaches on k is either one old line past the
// furthest (d-1)-point on diagonal k - 1 (a deletion) or one new line past the furthest (d-1)-point on diagonal k + 1
// (an insertion), whichever lies further into the old text, and the deletion when both reach the same point; a move
// past the end of either text is no candidate, and jsdiff's pruning of diagonals at the edges is not done. From that
// point the path keeps every line equal in both texts as far as it can. The first path to reach the ends of both
// texts is the edit script, with the path it extends (and its own history) as its history.
//
// The patch. A first line "makefun-diff/1 old=<N> new=<M> hunks=<H> deleted=<D> inserted=<I>" (the texts' line
// counts, the hunks and the deleted and inserted lines), then each hunk: a line "@ <os> <ol> <ns> <nl>", where os is
// one more than the old lines before the hunk and ol the old lines it covers (ns and nl the same in the new text),
// then one line per line it covers: "=" and the line for a kept line, "-" for a deleted one, "+" for an inserted
// one. Each run of changes between two kept lines lists its deletions, then its insertions. A hunk holds every change
// run with up to 3 kept lines before and after it, and two runs with at most 6 kept lines between them share a
// hunk, every kept line between them shown. A line that ends its file without a newline is written with one and
// followed by a line "%". Identical texts are the first line alone, hunks=0.

import { readFileSync } from 'node:fs';

const wasmBytes = readFileSync(new URL('../myers.wasm', import.meta.url));
const wasmModule = new WebAssembly.Module(wasmBytes);
const wasm = new WebAssembly.Instance(wasmModule).exports;

const memory = wasm.memory.buffer;
const wasmOldIds = new Int32Array(memory, wasm.get_old_ids_ptr(), 65536);
const wasmNewIds = new Int32Array(memory, wasm.get_new_ids_ptr(), 65536);
const wasmRunKinds = new Uint8Array(memory, wasm.get_run_kinds_ptr(), 131072);
const wasmRunCounts = new Int32Array(memory, wasm.get_run_counts_ptr(), 131072);

/** The patch's first word. */
export const FORMAT = 'makefun-diff/1';

/** The kept lines a hunk shows before and after each change run. */
export const CONTEXT = 3;

/** The op of a kept, a deleted and an inserted line, as the patch writes them. */
const KEEP = '=';
const DELETE = '-';
const INSERT = '+';

/** A text's lines, each with its "\n" (the last one without, when the text does not end in one). */
export function tokenize(text) {
  const parts = text.split('\n');
  const lines = [];
  const last = parts.length - 1;
  for (let i = 0; i < last; i++) lines.push(`${parts[i]}\n`);
  if (parts[last] !== '') lines.push(parts[last]);
  return lines;
}

// ---------------------------------------------------------------- Myers's search (after jsdiff 9.0.0 base.js)

/** The path extended by one deletion or insertion, a run of one kind growing by one line (jsdiff's addToPath). */
function addToPath(path, kind, oldPosInc) {
  const last = path.lastComponent;
  if (last !== undefined && last.kind === kind) {
    return { oldPos: path.oldPos + oldPosInc, lastComponent: { count: last.count + 1, kind, previousComponent: last.previousComponent } };
  }
  return { oldPos: path.oldPos + oldPosInc, lastComponent: { count: 1, kind, previousComponent: last } };
}

/** The path extended along its diagonal over every line equal in both (jsdiff's extractCommon); its new position. */
function extractCommon(path, newTokens, oldTokens, diagonal) {
  const newLen = newTokens.length;
  const oldLen = oldTokens.length;
  let oldPos = path.oldPos;
  let newPos = oldPos - diagonal;
  let common = 0;
  while (newPos + 1 < newLen && oldPos + 1 < oldLen && oldTokens[oldPos + 1] === newTokens[newPos + 1]) {
    newPos++;
    oldPos++;
    common++;
  }
  if (common > 0) path.lastComponent = { count: common, kind: KEEP, previousComponent: path.lastComponent };
  path.oldPos = oldPos;
  return newPos;
}

/** The runs of the edit script of oldTokens into newTokens: [{ kind, count }], in order (the header's rule). */
function editRuns(oldTokens, newTokens) {
  const oldLen = oldTokens.length;
  const newLen = newTokens.length;
  if (oldLen === 0 && newLen === 0) return [];
  if (oldLen === 0) return [{ kind: '+', count: newLen }];
  if (newLen === 0) return [{ kind: '-', count: oldLen }];

  const map = new Map();
  let nextId = 1;
  for (let i = 0; i < oldLen; i++) {
    const s = oldTokens[i];
    let id = map.get(s);
    if (id === undefined) { id = nextId++; map.set(s, id); }
    wasmOldIds[i] = id;
  }
  for (let i = 0; i < newLen; i++) {
    const s = newTokens[i];
    let id = map.get(s);
    if (id === undefined) { id = nextId++; map.set(s, id); }
    wasmNewIds[i] = id;
  }

  const numRuns = wasm.solve_myers(oldLen, newLen);
  const runs = [];
  for (let i = 0; i < numRuns; i++) {
    runs.push({ kind: String.fromCharCode(wasmRunKinds[i]), count: wasmRunCounts[i] });
  }
  return runs;
}

// ---------------------------------------------------------------- the patch

/** A line as the patch writes it: its op, the line, a newline, and "%" on a line of its own when it had none. */
function written(op, line) {
  return line.endsWith('\n') ? `${op}${line}` : `${op}${line}\n%\n`;
}

/** make.fun's own patch of input.old into input.new (the header). */
export function diffPatch(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('makefun-diff: the input is { old, new }, two strings');
  }
  const a = tokenize(input.old);
  const b = tokenize(input.new);
  const n = a.length;
  const m = b.length;
  // The common prefix, then the common suffix of what is left.
  let prefix = 0;
  while (prefix < n && prefix < m && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && a[n - 1 - suffix] === b[m - 1 - suffix]) suffix++;
  const runs = [];
  if (prefix > 0) runs.push({ kind: KEEP, count: prefix });
  runs.push(...editRuns(a.slice(prefix, n - suffix), b.slice(prefix, m - suffix)));
  if (suffix > 0) runs.push({ kind: KEEP, count: suffix });

  // The change runs: each a stretch of deletions and insertions between two kept lines, at old line o and new line p.
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (const r of runs) {
    if (r.kind === KEEP) {
      o += r.count;
      p += r.count;
      continue;
    }
    let c = changes.at(-1);
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (r.kind === DELETE) {
      c.dels += r.count;
      o += r.count;
      deleted += r.count;
    } else {
      c.ins += r.count;
      p += r.count;
      inserted += r.count;
    }
  }

  // The hunks: change runs at most 2 * CONTEXT kept lines apart share one.
  const hunks = [];
  for (const c of changes) {
    const h = hunks.at(-1);
    const prev = h?.at(-1);
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }
  const out = [`${FORMAT} old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (const h of hunks) {
    const first = h[0];
    const last = h.at(-1);
    const oldStart = Math.max(0, first.o - CONTEXT);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(CONTEXT, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (const c of h) {
      for (; at < c.o; at++) out.push(written(KEEP, a[at]));
      for (let i = 0; i < c.dels; i++) out.push(written(DELETE, a[c.o + i]));
      for (let i = 0; i < c.ins; i++) out.push(written(INSERT, b[c.p + i]));
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) out.push(written(KEEP, a[at]));
  }
  return out.join('');
}
