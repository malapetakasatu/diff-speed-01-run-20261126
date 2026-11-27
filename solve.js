// makefun-diff 1.0.0, the house entry, make.fun's own reference program: run(input) is make.fun's own makefun-diff 1.0.0's diffPatch, called as its tree ships it
// (vendor/makefun-diff/, make.fun's own code with its LICENSE and NOTICE; SOURCE.txt says what it derives from).
// An entry exports the same run from a module of its own, which must return the same answer for every input.

import * as lib from "./vendor/makefun-diff/index.js";

const fn = lib["diffPatch"] ?? (lib.default != null && typeof lib.default["diffPatch"] === 'function' ? lib.default["diffPatch"].bind(lib.default) : undefined);
if (typeof fn !== 'function') throw new Error("makefun-diff 1.0.0 exports no function diffPatch from index.js");

/** makefun-diff 1.0.0's answer for one case's input. */
export function run(input) {
  return fn(input);
}
