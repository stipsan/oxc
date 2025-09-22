import { assertIs } from './utils.js';

import { assert } from 'vitest';
import type { Node } from './types.js';

const { prototype: ArrayPrototype, from: ArrayFrom } = Array,
  { getPrototypeOf, hasOwn, keys: ObjectKeys } = Object,
  IteratorSymbol = Symbol.iterator;

// Currently we only support `Node`s, but will add support for `Token`s later.
type NodeOrToken = Node;

type Range = [number, number];

export type Fix = { range: Range; text: string };

// Return value of `fix` function passed to `Context#report()`.
export type Fixes = Fix | Array<Fix | null> | IterableIterator<Fix | null> | null;

// `Fixer` class, passed as argument to `fix` function passed to `Context#report()`.
export class Fixer {
  insertTextAfter(nodeOrToken: NodeOrToken, text: string): Fix {
    const { end } = nodeOrToken;
    return { range: [end, end], text };
  }

  insertTextAfterRange(range: Range, text: string): Fix {
    const end = range[1];
    return { range: [end, end], text };
  }

  insertTextBefore(nodeOrToken: NodeOrToken, text: string): Fix {
    const { start } = nodeOrToken;
    return { range: [start, start], text };
  }

  insertTextBeforeRange(range: Range, text: string): Fix {
    const start = range[0];
    return { range: [start, start], text };
  }

  remove(nodeOrToken: NodeOrToken): Fix {
    return { range: [nodeOrToken.start, nodeOrToken.end], text: '' };
  }

  removeRange(range: Range): Fix {
    return { range, text: '' };
  }

  replaceText(nodeOrToken: NodeOrToken, text: string): Fix {
    return { range: [nodeOrToken.start, nodeOrToken.end], text };
  }

  replaceTextRange(range: Range, text: string): Fix {
    return { range, text };
  }
}

// `Fixer` is stateless, so reuse a single instance for all fixes
export const fixer = new Fixer();
Object.freeze(fixer);

// Where `fix` function returns a single `Fix` object, `processFixes` converts it to an array.
// Avoid creating a new array each time by reusing this single-element array.
const singleFixArray: Fix[] = [null as Fix];

/**
 * Convert the return value of `fix` function passed to `Context#report()` into an array of `Fix` objects.
 *
 * Returns `null` if:
 * - `fixes` is falsy.
 * - `fixes` is an empty array or empty iterator.
 * - `fixes` contains only falsy values.
 *
 * Otherwise, returns an array of `Fix` objects. Does not mutate the `fixes` input, but avoids cloning if possible.
 *
 * If `fixes` is a single `Fix`, returns an array containing that `Fix`. That array is reused for subsequent calls.
 *
 * Testing for falsy values, rather than a tighter check for `null` or `undefined`, follows ESLint.
 *
 * @param fixes - Fixes returned by `fix` function passed to `Context#report()`
 * @returns Array of `Fix` objects, or `null`
 */
export function processFixes(fixes: Fixes): Fix[] | null {
  if (!fixes) return null;

  // TODO: Tests for `fixes` being an iterator, not array e.g. `fixes = (function*() { yield fix; })()`
  if (IteratorSymbol in fixes) {
    let isCloned = false;
    // Check prototype instead of `Array.isArray()`, to ensure it is a native `Array`,
    // not a subclass which may have overridden `toJSON()` in a way which could make `JSON.stringify()` throw
    if (getPrototypeOf(fixes) !== ArrayPrototype || hasOwn(fixes, 'toJSON')) {
      fixes = ArrayFrom(fixes as IterableIterator<Fix>);
      isCloned = true;
    }
    assertIs<Array<Fix | null>>(fixes);

    if (fixes.length === 0) return null;

    for (let i = 0, len = fixes.length; i < len; i++) {
      const fix = fixes[i];
      if (!fix) {
        fixes = fixes.filter(Boolean);
        if (fixes.length === 0) return null;
        isCloned = true;
        i--;
        continue;
      }
      const conformedFix = validateAndConformFix(fix);
      if (conformedFix !== null) {
        if (!isCloned) {
          fixes = [...fixes];
          isCloned = true;
        }
        fixes[i] = conformedFix;
      }
    }

    return fixes;
  }

  const conformedFix = validateAndConformFix(fixes);
  singleFixArray[0] = conformedFix === null ? fixes as Fix : conformedFix;
  return singleFixArray;
}

/**
 * Validate that a `Fix` object is well-formed, and conform it to expected shape.
 *
 * - Convert `text` to string if needed.
 * - Shorten `range` to 2 elements if it has extra elements.
 * - Remove any additional properties on the object.
 *
 * Purpose is to ensure any input which ESLint accepts does not cause an error in `JSON.stringify()`,
 * or in deserializing on Rust side.
 *
 * @param fix - Fix object to validate
 * @returns `null` if `fix` is already well-formed, or a new conformed `Fix` object
 */
function validateAndConformFix(fix: unknown): Fix | null {
  assertIs<Fix>(fix);
  let { range, text } = fix;

  // These checks follow ESLint, which throws if `range` is missing or invalid
  if (!range || typeof range[0] !== 'number' || typeof range[1] !== 'number') {
    throw new Error(`Fix has invalid range: ${JSON.stringify(fix, null, 2)}`);
  }

  // Converting `text` to string follows ESLint, which does that implicitly
  if (
    getPrototypeOf(range) !== ArrayPrototype || hasOwn(range, 'toJSON') || range.length !== 2 ||
    typeof text !== 'string' ||
    ObjectKeys(fix).length !== 2 || 'toJSON' in fix
  ) {
    return { range: [range[0], range[1]], text: String(text) };
  }
  return null;
}
