#!/usr/bin/env node
// `goldseam` CLI — the after-the-run half of the pipeline. The heal ladder
// (propose → rerun-test → rerun-spec → oracle → deliver-pr) lands here;
// stages are config, verdicts are artifacts.

const USAGE = `goldseam — self-healing for the Cypress suites you already have

Usage:
  goldseam heal      read failure artifacts, propose + verify selector fixes
  goldseam pr        open PR(s) from verified heals
  goldseam report    summarize captures + heals (md/json)
`;

const command = process.argv[2];

switch (command) {
  case 'heal':
  case 'pr':
  case 'report':
    console.error(`goldseam ${command}: not implemented yet (see docs/plan.md, M3+)`);
    process.exit(1);
    break;
  default:
    console.log(USAGE);
    process.exit(command === undefined || command === 'help' ? 0 : 1);
}
