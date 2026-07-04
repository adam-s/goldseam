// Translation eval: English steps + a realistic DOM → graded commands.
// Deterministic grading, real model calls (local-only, never CI). See
// bench/translate-cases/README.md for the case format.

import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require('jsdom');
const { translateSteps } = require('../packages/goldseam/dist/plugin/translate.js');
const { promptKey } = require('../packages/goldseam/dist/shared/prompt-types.js');
const { queryAllDeep } = require('aria-snapshot');

const model = process.argv.includes('--model')
  ? process.argv[process.argv.indexOf('--model') + 1]
  : 'claude:sonnet';

const casesDir = fileURLToPath(new URL('./translate-cases/', import.meta.url));
const names = readdirSync(casesDir).filter((n) => existsSync(join(casesDir, n, 'case.json')));

function resolveEmitted(document, cmd) {
  // Resolve an emitted command's target the way the executor would.
  if (cmd.shadow) {
    const hosts = queryAllDeep(document, cmd.shadow);
    if (hosts.length === 0) return [];
    const template = hosts[0].querySelector('template[shadowrootmode]');
    return template ? queryAllDeep(template.content, cmd.selector) : [];
  }
  return queryAllDeep(document, cmd.selector);
}

function grade(caseDef, document, outcome) {
  const failures = [];
  if (caseDef.expect.refuse) {
    if (outcome.kind !== 'refused') failures.push(`expected a refusal, got commands: ${JSON.stringify(outcome.commands)}`);
    return failures;
  }
  if (outcome.kind === 'refused') {
    failures.push(`unexpected refusal: ${outcome.reason}`);
    return failures;
  }
  const emitted = outcome.commands;
  const expected = caseDef.expect.commands;
  let e = 0;
  for (const exp of expected) {
    // find the next emitted command with the expected action
    let found;
    while (e < emitted.length) {
      const cand = emitted[e++];
      if (cand.action === exp.action) { found = cand; break; }
    }
    if (!found) { failures.push(`missing ${exp.action} (${exp.target ?? exp.containsIncludes ?? ''})`); continue; }
    if (exp.shadowHost) {
      if (!found.shadow) { failures.push(`${exp.action}: expected shadow scoping onto ${exp.shadowHost}`); continue; }
      const wantedHost = document.querySelector(exp.shadowHost);
      const gotHosts = queryAllDeep(document, found.shadow);
      if (gotHosts[0] !== wantedHost) failures.push(`${exp.action}: shadow host "${found.shadow}" is not ${exp.shadowHost}`);
      else if (resolveEmitted(document, found).length === 0) failures.push(`${exp.action}: "${found.selector}" resolves to nothing inside ${exp.shadowHost}`);
      continue;
    }
    if (exp.target) {
      const wanted = document.querySelectorAll(exp.target);
      if (wanted.length !== 1) throw new Error(`case bug: canonical target "${exp.target}" matches ${wanted.length}`);
      if (found.action === 'assert' && !found.selector && found.contains) {
        failures.push(`${exp.action}: expected a selector-targeted assert on ${exp.target}`);
      } else {
        const got = resolveEmitted(document, found);
        if (got.length === 0) failures.push(`${exp.action}: "${found.shadow ?? ''} ${found.selector}" resolves to nothing`);
        else if (!got.includes(wanted[0])) failures.push(`${exp.action}: "${found.selector}" hits a DIFFERENT element than ${exp.target}`);
        else if (got.length > 1 && got[0] !== wanted[0]) failures.push(`${exp.action}: "${found.selector}" is ambiguous (${got.length}) and first match isn't the target`);
      }
    }
    if (exp.forbidSelector && new RegExp(exp.forbidSelector).test(found.selector ?? '')) {
      failures.push(`${exp.action}: "${found.selector}" uses a forbidden (unstable) hook`);
    }
    if (exp.textIncludes && !(found.text ?? '').includes(exp.textIncludes)) {
      failures.push(`${exp.action}: text "${found.text}" missing "${exp.textIncludes}"`);
    }
    if (exp.containsIncludes) {
      const hay = `${found.contains ?? ''} ${found.value ?? ''}`;
      if (!hay.includes(exp.containsIncludes)) failures.push(`${exp.action}: expected text expectation containing "${exp.containsIncludes}"`);
      if (exp.noSelector && found.selector) failures.push(`${exp.action}: guessed a container selector ("${found.selector}") for an unseen element`);
    }
  }
  return failures;
}

const results = [];
for (const name of names) {
  const caseDef = JSON.parse(readFileSync(join(casesDir, name, 'case.json'), 'utf8'));
  const domHtml = readFileSync(join(casesDir, name, 'dom.html'), 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'goldseam-teval-'));
  let outcome;
  try {
    const entry = await translateSteps(
      { key: promptKey(caseDef.steps), steps: caseDef.steps, url: caseDef.url ?? 'http://app.local/', domHtml },
      model,
      dir,
    );
    outcome = { kind: 'commands', commands: entry.commands };
  } catch (err) {
    outcome = { kind: 'refused', reason: err instanceof Error ? err.message : String(err) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const document = new JSDOM(domHtml, { virtualConsole: new VirtualConsole() }).window.document;
  let failures;
  try {
    failures = grade(caseDef, document, outcome);
  } catch (err) {
    failures = [`grader error: ${err.message}`];
  }
  results.push({ name, pass: failures.length === 0, refuse: !!caseDef.expect.refuse, failures, outcome });
  console.log(`${failures.length === 0 ? '✔' : '✖'} ${name}${failures.length ? ` — ${failures.join('; ')}` : ''}`);
}

const passed = results.filter((r) => r.pass).length;
const refuseCases = results.filter((r) => r.refuse);
const refusePassed = refuseCases.filter((r) => r.pass).length;
const summary = {
  model,
  ranAt: new Date().toISOString(),
  score: `${passed}/${results.length}`,
  mustRefuse: `${refusePassed}/${refuseCases.length}`,
  results,
};
writeFileSync(fileURLToPath(new URL('./translate-results.json', import.meta.url)), JSON.stringify(summary, null, 2));
console.log(`\nscore: ${summary.score}   must-refuse: ${summary.mustRefuse}   (results in bench/translate-results.json)`);

const baselinePath = fileURLToPath(new URL('./translate-baseline.json', import.meta.url));
if (existsSync(baselinePath)) {
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  if (baseline.model !== model) {
    console.log(`baseline is for ${baseline.model} — informational run, no gate`);
    process.exit(0);
  }
  const basePassed = Number(baseline.score.split('/')[0]);
  const baseRefuse = Number(String(baseline.mustRefuse ?? '0/0').split('/')[0]);
  if (passed < basePassed || refusePassed < baseRefuse) {
    console.error(
      `REGRESSION vs baseline ${baseline.score} (must-refuse ${baseline.mustRefuse}) from ${baseline.ranAt}`,
    );
    process.exit(1);
  }
  console.log(`baseline ${baseline.score} (must-refuse ${baseline.mustRefuse}) held`);
}
