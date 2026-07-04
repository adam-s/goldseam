// jsdom does not implement pseudo-element getComputedStyle; the aria walk
// tolerates the gap (no ::before/::after content), but jsdom logs an
// error PER CALL — and iframe tests spawn per-frame windows, so patching
// one window can't cover them. Filter the one known-benign message at
// the console boundary; everything else passes through untouched.
const originalError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  if (String(args[0]).includes('Not implemented: window.getComputedStyle')) return;
  originalError(...args);
};
