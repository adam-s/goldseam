// End-to-end heal test, model-free via the cmd: stub:
//   1. a spec with a drifted selector fails → capture artifact
//   2. `goldseam heal` proposes, applies, and verifies through the full
//      ladder (triage → propose → resolve → oracle → rerun-test → rerun-spec)
//   3. the spec file is edited, the heal artifact records the ladder
//   4. an unhealable capture produces a clean, reported give-up
//
// The real-model path is the same CLI with --model claude (Sonnet).

import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import cypress from 'cypress';
import { check, finish, healableSpec, runCli, startServer } from './lib/harness.mjs';

// The prompt slimmer, straight from dist — asserts the windowing behavior on a
// REAL local capture (no third-party site, no model) as part of the ladder.
const { windowDom, deboilerplateDom } = createRequire(import.meta.url)(
  '../packages/goldseam/dist/heal/dom-window.js',
);

const TMP_SPEC = 'cypress/system/tmp-healable.cy.ts';
const BROKEN = healableSpec('[data-testid="buy-now-5"]');
const WINDOW_SPEC = 'cypress/system/tmp-window.cy.ts';
const HEAVY = 'demo/heavy.generated.html';

const server = await startServer('demo', 4173);

try {
  rmSync('.goldseam', { recursive: true, force: true });

  console.log('\n— break: drifted selector fails and captures —');
  writeFileSync(TMP_SPEC, BROKEN);
  const red = await cypress.run({ quiet: true, config: { specPattern: TMP_SPEC } });
  check(red.totalFailed === 1, 'drifted spec fails');
  check(existsSync('.goldseam/failures') && readdirSync('.goldseam/failures').length === 1, 'capture written');

  console.log('\n— heal: full ladder with the stub model —');
  const heal = runCli(['heal', '--model', 'cmd:node scripts/stub-model.mjs fix']);
  process.stdout.write(heal.stdout);
  check(heal.status === 0, 'heal CLI exits 0');

  const healedSpec = readFileSync(TMP_SPEC, 'utf8');
  check(healedSpec.includes('add-to-cart-5'), 'spec selector was edited');
  check(!healedSpec.includes('buy-now-5'), 'old selector is gone');
  check(healedSpec.includes(`should('have.text', '1')`), 'assertion untouched');

  const healFiles = readdirSync('.goldseam/heals');
  check(healFiles.length === 1, 'heal artifact written');
  const healArtifact = JSON.parse(readFileSync(`.goldseam/heals/${healFiles[0]}`, 'utf8'));
  check(healArtifact.verdict === 'healed', 'verdict: healed');
  const rungs = healArtifact.attempts.at(-1).ladder.map((r) => `${r.stage}:${r.verdict}`);
  check(
    JSON.stringify(rungs) ===
      JSON.stringify([
        'triage:pass', 'propose:pass', 'resolve:pass', 'oracle:pass',
        'rerun-test:pass', 'rerun-spec:pass',
      ]),
    `full ladder recorded (${rungs.join(' → ')})`,
  );
  check(healArtifact.tier === 'model' && healArtifact.model.startsWith('cmd:'), 'tier + model recorded');
  // The test asserts cart-count text downstream — behaviorally constrained,
  // so the weak-assertion flag must NOT fire.
  check(healArtifact.reviewFlags === undefined, 'no review flags on a strongly-asserted heal');

  console.log('\n— healed spec actually passes —');
  const green = await cypress.run({ quiet: true, config: { specPattern: TMP_SPEC } });
  check(green.totalFailed === 0 && green.totalPassed === 1, 'healed spec is green');

  console.log('\n— report joins captures with heals —');
  const reportMd = runCli(['report']);
  check(reportMd.status === 0 && reportMd.stdout.includes('**1 healed**'), 'md report shows the heal');
  check(reportMd.stdout.includes('adds a mug to the cart'), 'md report maps to the test title');
  const reportJson = runCli(['report', '--format', 'json']);
  const parsed = JSON.parse(reportJson.stdout);
  check(parsed.totals.healed === 1 && parsed.rows[0].verdict === 'healed', 'json report is structured');

  console.log('\n— heal memory: the same break heals from cache, zero model calls —');
  rmSync('.goldseam/failures', { recursive: true, force: true });
  rmSync('.goldseam/heals', { recursive: true, force: true });
  writeFileSync(TMP_SPEC, BROKEN);
  await cypress.run({ quiet: true, config: { specPattern: TMP_SPEC } });
  // The give-up stub refuses every request — if this heals, the cache did it.
  const cached = runCli(['heal', '--model', 'cmd:node scripts/stub-model.mjs giveup']);
  check(cached.status === 0 && cached.stdout.includes('cache hit'), 'cache tier proposed with no model call');
  const cachedArtifact = JSON.parse(
    readFileSync(`.goldseam/heals/${readdirSync('.goldseam/heals')[0]}`, 'utf8'),
  );
  check(cachedArtifact.verdict === 'healed' && cachedArtifact.tier === 'cache', 'healed from cache, ladder-verified');
  check(readFileSync(TMP_SPEC, 'utf8').includes('add-to-cart-5'), 'cached replacement applied');

  console.log('\n— multi-occurrence: repeated broken selector heals with one edit per site —');
  rmSync('.goldseam/failures', { recursive: true, force: true });
  rmSync('.goldseam/heals', { recursive: true, force: true });
  writeFileSync(
    TMP_SPEC,
    healableSpec('[data-testid="buy-now-5"]', {
      extra: `cy.get('[data-testid="buy-now-5"]').should('not.be.disabled');`,
    }),
  );
  await cypress.run({ quiet: true, config: { specPattern: TMP_SPEC } });
  // The selector appears twice, so the cache tier (which requires a unique
  // occurrence) must miss, and the model must supply per-occurrence edits.
  const multi = runCli(['heal', '--model', 'cmd:node scripts/stub-model.mjs multi']);
  check(multi.status === 0 && multi.stdout.includes('[healed]'), 'multi-edit heal succeeds');
  check(multi.stdout.includes('2 edit(s)'), 'two edits proposed and validated');
  const multiSpec = readFileSync(TMP_SPEC, 'utf8');
  check(!multiSpec.includes('buy-now-5'), 'every occurrence was healed');
  const multiArtifact = JSON.parse(
    readFileSync(`.goldseam/heals/${readdirSync('.goldseam/heals')[0]}`, 'utf8'),
  );
  check(multiArtifact.verdict === 'healed' && multiArtifact.finalEdits.length === 2, 'both edits in the artifact');
  check(multiArtifact.tier === 'model', 'cache correctly missed on the ambiguous selector');

  console.log('\n— ladder teeth: a hallucinated selector is rejected OFFLINE by resolve —');
  rmSync('.goldseam', { recursive: true, force: true });
  writeFileSync(TMP_SPEC, BROKEN);
  await cypress.run({ quiet: true, config: { specPattern: TMP_SPEC } });
  const beforeWrong = readFileSync(TMP_SPEC, 'utf8');
  const wrong = runCli(['heal', '--model', 'cmd:node scripts/stub-model.mjs wrong', '--max-attempts', '2']);
  check(wrong.status === 0 && wrong.stdout.includes('[failed]'), 'wrong edit ends in a failed verdict, exit 0');
  check(readFileSync(TMP_SPEC, 'utf8') === beforeWrong, 'spec untouched after the ladder rejected the edit');
  const wrongArtifact = JSON.parse(
    readFileSync(`.goldseam/heals/${readdirSync('.goldseam/heals')[0]}`, 'utf8'),
  );
  check(wrongArtifact.verdict === 'failed' && wrongArtifact.attempts.length === 2, 'attempt cap honored');
  const wrongRungs = wrongArtifact.attempts[0].ladder.map((r) => `${r.stage}:${r.verdict}`);
  check(
    JSON.stringify(wrongRungs) === JSON.stringify(['triage:pass', 'propose:pass', 'resolve:fail']),
    `resolve rung rejected it offline, no rerun spent (${wrongRungs.join(' → ')})`,
  );
  check(wrongArtifact.finalEdits === undefined, 'no finalEdits recorded on a failed heal');

  console.log('\n— ladder teeth: an existing-but-wrong element (impostor) is rejected by rerun —');
  rmSync('.goldseam', { recursive: true, force: true });
  writeFileSync(TMP_SPEC, BROKEN);
  await cypress.run({ quiet: true, config: { specPattern: TMP_SPEC } });
  const beforeImpostor = readFileSync(TMP_SPEC, 'utf8');
  const impostor = runCli(['heal', '--model', 'cmd:node scripts/stub-model.mjs impostor', '--max-attempts', '1']);
  check(impostor.status === 0 && impostor.stdout.includes('[failed]'), 'impostor edit ends in a failed verdict');
  check(readFileSync(TMP_SPEC, 'utf8') === beforeImpostor, 'spec reverted after rerun rejected the impostor');
  const impostorArtifact = JSON.parse(
    readFileSync(`.goldseam/heals/${readdirSync('.goldseam/heals')[0]}`, 'utf8'),
  );
  const impostorRungs = impostorArtifact.attempts[0].ladder.map((r) => `${r.stage}:${r.verdict}`);
  check(
    JSON.stringify(impostorRungs) ===
      JSON.stringify(['triage:pass', 'propose:pass', 'resolve:pass', 'oracle:pass', 'rerun-test:fail']),
    `resolve+oracle passed (element exists, no identity on file) but rerun caught the behavior (${impostorRungs.join(' → ')})`,
  );

  console.log('\n— oracle teeth: with a known-good identity, the impostor dies OFFLINE —');
  rmSync('.goldseam', { recursive: true, force: true });
  writeFileSync(TMP_SPEC, BROKEN);
  await cypress.run({ quiet: true, config: { specPattern: TMP_SPEC } });
  writeFileSync(
    '.goldseam/oracle.json',
    JSON.stringify([
      {
        specPath: TMP_SPEC,
        title: 'healable adds a mug to the cart',
        role: 'button',
        name: 'Add to cart',
      },
    ]),
  );
  const oracleImpostor = runCli(['heal', '--model', 'cmd:node scripts/stub-model.mjs impostor', '--max-attempts', '1']);
  check(oracleImpostor.status === 0 && oracleImpostor.stdout.includes('[failed]'), 'impostor fails with oracle on file');
  const oracleImpostorArtifact = JSON.parse(
    readFileSync(`.goldseam/heals/${readdirSync('.goldseam/heals')[0]}`, 'utf8'),
  );
  const oracleImpostorRungs = oracleImpostorArtifact.attempts[0].ladder.map((r) => `${r.stage}:${r.verdict}`);
  check(
    JSON.stringify(oracleImpostorRungs) ===
      JSON.stringify(['triage:pass', 'propose:pass', 'resolve:pass', 'oracle:fail']),
    `oracle rejected the impostor offline, no rerun spent (${oracleImpostorRungs.join(' → ')})`,
  );
  // Same capture, honest proposal: the oracle should CONFIRM identity.
  const oracleFix = runCli(['heal', '--model', 'cmd:node scripts/stub-model.mjs fix']);
  check(oracleFix.status === 0 && oracleFix.stdout.includes('[healed]'), 'honest heal passes with oracle on file');
  check(
    oracleFix.stdout.includes('targets the known-good button "Add to cart"'),
    'oracle confirmed the identity, not just existence',
  );
  const oracleFixArtifact = JSON.parse(
    readFileSync(`.goldseam/heals/${readdirSync('.goldseam/heals')[0]}`, 'utf8'),
  );
  const oracleFixRungs = oracleFixArtifact.attempts.at(-1).ladder.map((r) => `${r.stage}:${r.verdict}`);
  check(
    JSON.stringify(oracleFixRungs) ===
      JSON.stringify([
        'triage:pass', 'propose:pass', 'resolve:pass', 'oracle:pass',
        'rerun-test:pass', 'rerun-spec:pass',
      ]),
    `oracle-pass ladder recorded in the artifact (${oracleFixRungs.join(' → ')})`,
  );

  console.log('\n— green-run manifest: harvest on green, oracle consumes it after real drift —');
  rmSync('.goldseam', { recursive: true, force: true });
  // A private app copy so the APP can drift while the spec stays put —
  // the real-world direction (the E2E's other legs invert it). A fresh
  // temp dir per run: concurrent runs must not clobber each other's copy.
  const DRIFT_DIR = mkdtempSync(join(tmpdir(), 'goldseam-e2e-demo-'));
  cpSync('demo', DRIFT_DIR, { recursive: true });
  const server2 = await startServer(DRIFT_DIR, 4179);
  const ORACLE_CONFIG = 'cypress.tmp-oracle.config.ts';
  writeFileSync(
    ORACLE_CONFIG,
    `import { defineConfig } from 'cypress';
import goldseam from 'goldseam/plugin';
export default defineConfig({
  e2e: {
    baseUrl: 'http://127.0.0.1:4179',
    supportFile: 'cypress/support/e2e.ts',
    specPattern: '${TMP_SPEC}',
    video: false,
    setupNodeEvents(on, config) { return goldseam(on, config); },
  },
});
`,
  );
  try {
    writeFileSync(TMP_SPEC, healableSpec('[data-testid="add-to-cart-5"]'));
    const green = await cypress.run({
      quiet: true,
      configFile: ORACLE_CONFIG,
      env: { goldseam: { recordOracles: true } },
    });
    check(green.totalFailed === 0, 'green run stays green with recordOracles on');
    const manifest = JSON.parse(readFileSync('.goldseam/oracle.json', 'utf8'));
    const harvested = manifest.find((e) => e.selector === '[data-testid="add-to-cart-5"]');
    check(!!harvested && harvested.role === 'button' && /add to cart/i.test(harvested.name ?? ''), 'manifest harvested the selector→identity map');
    check(!existsSync('.goldseam/failures'), 'recordOracles wrote ONLY the manifest — no captures on green');

    // The APP drifts; the spec (and thus failedSelector) stays put.
    const shop = `${DRIFT_DIR}/js/shop.js`;
    writeFileSync(shop, readFileSync(shop, 'utf8').replaceAll('add-to-cart', 'buy-btn'));
    const red2 = await cypress.run({ quiet: true, configFile: ORACLE_CONFIG });
    check(red2.totalFailed === 1, 'app drift breaks the unchanged spec');

    const impostor2 = runCli([
      'heal', '--model', 'cmd:node scripts/stub-model.mjs oracle-impostor',
      '--max-attempts', '1', '--config-file', ORACLE_CONFIG,
    ]);
    check(/oracle: fail/.test(impostor2.stdout) && /impostor guard/.test(impostor2.stdout), 'HARVESTED identity rejects an impostor offline');

    const healed2 = runCli([
      'heal', '--model', 'cmd:node scripts/stub-model.mjs oracle-fix', '--config-file', ORACLE_CONFIG,
    ]);
    if (!healed2.stdout.includes('[healed]')) process.stdout.write(healed2.stdout + healed2.stderr);
    check(healed2.status === 0 && healed2.stdout.includes('[healed]'), 'honest heal passes against the drifted app');
    check(/targets the known-good button "Add to cart/i.test(healed2.stdout), 'oracle verified identity from the HARVESTED manifest — no hand-written file');
  } finally {
    server2.stop();
    rmSync(DRIFT_DIR, { recursive: true, force: true });
    rmSync(ORACLE_CONFIG, { force: true });
  }

  console.log('\n— give-up: unhealable capture reported, nothing touched —');
  rmSync('.goldseam', { recursive: true, force: true });
  writeFileSync(TMP_SPEC, healableSpec('[data-testid="buy-now-5"]', { assert: false }));
  await cypress.run({ quiet: true, config: { specPattern: TMP_SPEC } });
  const before = readFileSync(TMP_SPEC, 'utf8');
  const giveup = runCli(['heal', '--model', 'cmd:node scripts/stub-model.mjs giveup']);
  check(giveup.status === 0 && giveup.stdout.includes('[gave-up]'), 'give-up reported, exit 0');
  check(readFileSync(TMP_SPEC, 'utf8') === before, 'spec untouched on give-up');
  const giveupArtifact = JSON.parse(
    readFileSync(`.goldseam/heals/${readdirSync('.goldseam/heals')[0]}`, 'utf8'),
  );
  check(giveupArtifact.verdict === 'gave-up', 'give-up recorded as first-class verdict');

  console.log('\n— exclude: a directive-excluded capture is never healed (reported give-up, spec untouched) —');
  rmSync('.goldseam', { recursive: true, force: true });
  writeFileSync(TMP_SPEC, BROKEN);
  await cypress.run({ quiet: true, config: { specPattern: TMP_SPEC } });
  const beforeExcl = readFileSync(TMP_SPEC, 'utf8');
  // --exclude matches the test title; the model is never consulted (the giveup
  // stub would refuse anyway, so a healed/edited outcome could only come from
  // the model actually running — it must not).
  const excl = runCli(['heal', '--exclude', 'adds a mug', '--model', 'cmd:node scripts/stub-model.mjs giveup']);
  check(excl.status === 0 && excl.stdout.includes('[gave-up]'), 'excluded capture reports a give-up, exit 0');
  check(readFileSync(TMP_SPEC, 'utf8') === beforeExcl, 'excluded spec is byte-for-byte untouched');
  const exclArtifact = JSON.parse(readFileSync(`.goldseam/heals/${readdirSync('.goldseam/heals')[0]}`, 'utf8'));
  check(
    exclArtifact.verdict === 'gave-up' && exclArtifact.tier === 'excluded',
    `excluded verdict=gave-up tier=excluded (got ${exclArtifact.verdict}/${exclArtifact.tier})`,
  );
  check(
    exclArtifact.attempts[0].ladder[0].evidence.includes('excluded by directive'),
    'the exclusion reason is recorded in the ladder',
  );

  console.log('\n— windowing: a large local capture is windowed so a deep target heals —');
  rmSync('.goldseam', { recursive: true, force: true });
  // A heavy page (no third-party site): front-loaded inline CSS (which the
  // slimmer empties) PLUS >40K of real markup, then the "Recent Articles"
  // section — so even after de-boilerplating, the target card sits far past
  // the prompt budget and only the anchored neighborhood window rescues it.
  // Generated (not committed) so the sizes are exact; served from demo/.
  const bigStyle = `<style>${'.row{padding:2px;margin:1px;color:#334}'.repeat(900)}</style>`;
  const filler = Array.from({ length: 800 }, (_, i) =>
    `<section class="row"><span>filler content line ${i} — lorem ipsum dolor sit amet consectetur</span></section>`,
  ).join('');
  const cards = [5, 6, 7, 8]
    .map(
      (n) =>
        `<article data-testid="item-${n}" class="card"><h2>${['Fifth', 'Sixth', 'Seventh', 'Eighth'][n - 5]} Article Headline on Wellness</h2><a href="/a/${n}">Read</a></article>`,
    )
    .join('');
  writeFileSync(
    HEAVY,
    `<!doctype html><html><head><title>Blog</title>${bigStyle}</head><body><nav>menu</nav>${filler}<main><h1>Recent Articles</h1>${cards}</main></body></html>`,
  );
  // The redesign renamed data-testid post-7 → item-7; the spec still uses post-7.
  writeFileSync(
    WINDOW_SPEC,
    `describe('blog', () => {\n  it('shows the seventh article', () => {\n    cy.visit('/heavy.generated.html');\n    cy.contains('Seventh Article Headline on Wellness');\n    cy.get('[data-testid="post-7"]').should('exist');\n  });\n});\n`,
  );
  const redWin = await cypress.run({ quiet: true, config: { specPattern: WINDOW_SPEC } });
  check(redWin.totalFailed === 1, 'windowing: drifted deep selector fails and captures');
  const winCap = JSON.parse(
    readFileSync(`.goldseam/failures/${readdirSync('.goldseam/failures')[0]}`, 'utf8'),
  );
  check(winCap.domHtml.length > 40_000, `windowing: captured DOM is large (${winCap.domHtml.length} chars)`);

  // The windowing behavior, on THIS real local capture: a head-first slice
  // would miss the deep target, and the slimmer must window instead.
  const winSpecSrc = readFileSync(WINDOW_SPEC, 'utf8');
  const win = windowDom(winCap.domHtml, {
    failedSelector: winCap.failedSelector,
    specSource: winSpecSrc,
    budget: 40_000,
  });
  check(
    deboilerplateDom(winCap.domHtml).slice(0, 40_000).indexOf('item-7') === -1,
    'windowing: a head-first slice WOULD miss the deep target',
  );
  check(win.strategy === 'windowed', `windowing: engaged (strategy=${win.strategy}, anchor=${win.anchor})`);
  check(win.html.includes('item-7'), 'windowing: the deep target is delivered into the prompt');

  // And the full pipeline heals the large-DOM capture (stub emits post-7 → item-7).
  const winHeal = runCli(['heal', '--model', 'cmd:node scripts/stub-model.mjs window-fix']);
  process.stdout.write(winHeal.stdout);
  check(winHeal.status === 0 && winHeal.stdout.includes('[healed]'), 'windowing: large-DOM capture heals full-ladder');
  const winHealed = readFileSync(WINDOW_SPEC, 'utf8');
  check(winHealed.includes('item-7') && !winHealed.includes('post-7'), 'windowing: the deep selector was edited');
} finally {
  server.stop();
  rmSync(TMP_SPEC, { force: true });
  rmSync(WINDOW_SPEC, { force: true });
  rmSync(HEAVY, { force: true });
  rmSync('.goldseam', { recursive: true, force: true });
}

finish('HEAL E2E');
