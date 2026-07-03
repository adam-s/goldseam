// One-line install with defaults — the adoption path:
//
//   // cypress/support/e2e.ts
//   import 'goldseam/support/register';
//
// For options, import `installGoldseam` from 'goldseam/support' instead
// (install is idempotent, so mixing both wastes nothing but the line).
import { installGoldseam } from './index';

installGoldseam();
