/**
 * T-2-01's standing guard: every server action authenticates, and authenticates FIRST.
 *
 * 🔴 WHY A STATIC TEST AND NOT A REVIEW. `src/proxy.ts` carries no authorization by design —
 * Next 16 renamed middleware partly in response to CVE-2025-29927, and Vercel's guidance is
 * that the proxy is for routing — while Clerk's own note is that Server Functions are POSTs
 * to the page's route. So a server action reached directly, with no page ever rendered, is a
 * real unauthenticated entry point until the action itself checks. There is nothing in
 * `tsc`, `eslint` or `next build` that can see a missing check, and the seventh action
 * somebody adds in Phase 4 will be written from the shape of the sixth.
 *
 * 🔴 AND WHY THE ORDER IS ASSERTED TOO. An action that queries and then authenticates has
 * already read the row by the time it refuses. `withOrg` binds the caller's claims into the
 * transaction, so a call made before `requireOrg()` would be made with claims nobody
 * validated. The second assertion is the one that catches a refactor rather than an omission.
 *
 * 🔴 AND WHY THE EXPORT SHAPE IS ASSERTED. Next refuses any non-async export from a module
 * carrying the server directive — but only when the module is actually COMPILED, and nothing
 * under `src/app/` imports these yet (the screens are plans 02-10 and 02-11). `pnpm build`
 * is therefore green today on a violation that would break the first page to import it.
 *
 * This file lives under `tests/` and the walk covers only `src/server/actions/`, so it may
 * spell every token it hunts for. The modules it guards may not — the same arrangement
 * `tests/unit/no-google-credential.test.ts` and `tests/unit/ui-maps.test.ts` describe.
 */
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import { describe, expect, it } from 'vitest';

const ACTIONS_DIR = nodePath.join('src', 'server', 'actions');

/**
 * Every action module. `_`-prefixed files are deliberately excluded and are not actions: a
 * module carrying the server directive may export nothing but async functions, so the shared
 * result union and the SQLSTATE helpers have to live beside them rather than inside one.
 */
function actionFiles(): string[] {
  return nodeFs
    .readdirSync(ACTIONS_DIR)
    .filter((f) => f.endsWith('.ts') && !f.startsWith('_'))
    .sort();
}

/**
 * The floor for the two-sided walk: six from plan 02-09, plus plan 03-15's two. A lower
 * count means the walk lost files, not that the codebase lost actions.
 */
const MIN_ACTIONS = 8;

/**
 * Named, not just counted: the two spine actions plan 03-15 adds. A count alone would stay
 * green if one of these were renamed away and some unrelated action were added in its place.
 */
const PHASE3_ACTIONS = ['record-review-decision.ts', 'unmerge-business.ts'];

/**
 * The text just inside the opening brace of `export async function name(...): Promise<...> {`.
 * Scans characters rather than lines because the return type spans lines in some actions and
 * contains its own braces (`Promise<ActionResult<{ remaining: number }>>`): the body brace is
 * the first `{` at paren depth 0 AND angle depth 0 (`=>` is an arrow, not a closing angle).
 */
function bodiesOf(source: string): Array<{ name: string; body: string }> {
  const out: Array<{ name: string; body: string }> = [];
  const head = /export\s+async\s+function\s+(\w+)/g;
  for (let m = head.exec(source); m !== null; m = head.exec(source)) {
    let paren = 0;
    let angle = 0;
    for (let i = m.index + m[0].length; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === '(') paren += 1;
      else if (ch === ')') paren -= 1;
      else if (ch === '<') angle += 1;
      else if (ch === '>' && source[i - 1] !== '=') angle -= 1;
      else if (ch === '{' && paren === 0 && angle === 0) {
        out.push({ name: m[1] ?? '', body: source.slice(i + 1) });
        break;
      }
    }
  }
  return out;
}

function read(file: string): string {
  return nodeFs.readFileSync(nodePath.join(ACTIONS_DIR, file), 'utf8');
}

/** The first line that is not blank, not a `//` comment and not inside a `/* *\/` block. */
function firstCodeLine(source: string): string {
  let inBlock = false;
  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (inBlock) {
      if (line.includes('*/')) inBlock = false;
      continue;
    }
    if (line === '' || line.startsWith('//')) continue;
    if (line.startsWith('/*')) {
      if (!line.includes('*/')) inBlock = true;
      continue;
    }
    return line;
  }
  return '';
}

describe('server actions', () => {
  it('every server action declares use server', () => {
    const files = actionFiles();

    // 🔴 TWO-SIDED. A wrong glob, a renamed directory or a future move to `src/actions/`
    // would leave this walking nothing, and a loop over an empty list passes every
    // assertion inside it. Six shipped in plan 02-09; 03-15 adds two.
    expect(files.length, `walked ${ACTIONS_DIR} and found ${files.join(', ')}`).toBeGreaterThanOrEqual(MIN_ACTIONS);

    const offenders = files.filter((file) => {
      const first = firstCodeLine(read(file));
      return first !== "'use server';" && first !== '"use server";';
    });
    expect(offenders, 'these modules are reachable as POST endpoints').toEqual([]);
  });

  it('every server action calls requireOrg', () => {
    const files = actionFiles();
    expect(files.length).toBeGreaterThanOrEqual(MIN_ACTIONS);

    const missing: string[] = [];
    const outOfOrder: string[] = [];

    for (const file of files) {
      const source = read(file);
      const authAt = source.indexOf('requireOrg(');
      if (authAt < 0) {
        missing.push(file);
        continue;
      }
      // `withOrg(` with the paren, so the import line — `import { withOrg, type OrgClaims }`
      // — is not what gets compared. An action that opens a transaction before it knows who
      // is calling has already bound unvalidated claims into it.
      const queryAt = source.indexOf('withOrg(');
      if (queryAt >= 0 && queryAt < authAt) outOfOrder.push(file);
    }

    expect(missing, 'these actions never authenticate (T-2-01)').toEqual([]);
    expect(outOfOrder, 'these actions query before they authenticate (T-2-01)').toEqual([]);
    for (const named of PHASE3_ACTIONS) expect(files).toContain(named);
  });

  it('every server action calls requireOrg as its first statement', () => {
    // 🔴 T-2-01 / T-3-10, the stricter half. "Before withOrg" (above) still lets an action
    // parse input, read a cookie or call a third party before it knows who is calling. The
    // first statement of every exported action body is the auth call, with or without a
    // destructuring binding — nothing else, not even a validation.
    const files = actionFiles();
    expect(files.length).toBeGreaterThanOrEqual(MIN_ACTIONS);

    const offenders: string[] = [];
    let checked = 0;
    for (const file of files) {
      const bodies = bodiesOf(read(file));
      if (bodies.length === 0) offenders.push(`${file}: no exported async function found`);
      for (const { name, body } of bodies) {
        checked += 1;
        const first = firstCodeLine(body);
        if (!/^(const \{[^}]*\} = )?await requireOrg\(\);$/.test(first)) {
          offenders.push(`${file} ${name}: first statement is ${JSON.stringify(first)}`);
        }
      }
    }
    // Two-sided: every file contributes at least one function body.
    expect(checked).toBeGreaterThanOrEqual(MIN_ACTIONS);
    expect(offenders, 'these actions do something before they authenticate').toEqual([]);
  });

  it('every server action exports only async functions', () => {
    const files = actionFiles();
    expect(files.length).toBeGreaterThanOrEqual(MIN_ACTIONS);

    const offenders: string[] = [];
    for (const file of files) {
      for (const raw of read(file).split('\n')) {
        const line = raw.trim();
        if (!line.startsWith('export ')) continue;
        // Types are erased before the server-actions transform ever runs, so they are fine.
        if (/^export\s+(type|interface)\b/.test(line)) continue;
        if (/^export\s+async\s+function\b/.test(line)) continue;
        offenders.push(`${file}: ${line}`);
      }
    }
    expect(offenders, 'Next refuses a non-async export from a server module').toEqual([]);
  });

  it('no server action takes a price from the client', () => {
    const files = actionFiles();
    expect(files.length).toBeGreaterThanOrEqual(MIN_ACTIONS);

    // 🔴 WR-05. `savePresetVersion` accepted `estimateSnapshot` in its input schema and
    // stored it verbatim as "what the estimator quoted for this version". Two defects in one
    // field: the browser sent a figure that could belong to a DIFFERENT selection (the live
    // hook marks a key settled on its error branch, so the form's `busy` guard was false
    // while the panel showed the previous spec's price), and the figure was client-authored
    // data recorded as the product's own quote — `estimateRangeSchema` checked its shape and
    // nothing else, so any browser could name any price.
    //
    // A money value that a caller supplies and the product then attributes to itself is the
    // shape, not the field name, so this walks the whole directory rather than one file: the
    // next action to store a cost — Phase 4's settle path is the obvious one — is the reason
    // this test exists rather than a one-line assertion about the schema that was fixed.
    // Prices are DERIVED, from the seed and the meter, inside the transaction that writes them.
    const forbidden = [
      'estimateSnapshot:',
      'costMicroUsd:',
      'microUsd:',
      'capMicroUsd:',
      'actualMicroUsd:',
    ];
    const offenders: string[] = [];
    for (const file of files) {
      const source = read(file);
      // Only the INPUT contract. An action may compute, name and return these freely; what it
      // may not do is let a caller hand one in. The schemas are the `z.strictObject({...})`
      // literals, and every action in this directory declares exactly one.
      for (const match of source.matchAll(/z\.strictObject\(\{([\s\S]*?)\}\)/g)) {
        const shape = match[1] ?? '';
        for (const token of forbidden) {
          if (shape.includes(token)) offenders.push(`${file}: ${token}`);
        }
      }
    }
    expect(offenders, 'a price a caller supplies is not a price the product measured').toEqual([]);
  });

  it('no server action reads a Google credential', () => {
    const files = actionFiles();
    expect(files.length).toBeGreaterThanOrEqual(MIN_ACTIONS);

    // Redundant with `tests/unit/no-google-credential.test.ts`'s repo-wide walk ON PURPOSE:
    // this one names the directory a Places caller will be written in, in Phase 4, by
    // somebody reading these six files as the template.
    const forbidden = ['GOOGLE', 'X-Goog-', 'maps.googleapis.com'];
    const offenders: string[] = [];
    for (const file of files) {
      const source = read(file);
      for (const token of forbidden) {
        if (source.includes(token)) offenders.push(`${file}: ${token}`);
      }
    }
    expect(offenders, 'the Places key does not exist and must not be read here').toEqual([]);
  });
});
