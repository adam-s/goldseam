// Dogfood wiring: this repo uses its own plugin, exactly as a target project
// would — one import, one call.
import { installGoldseam } from 'goldseam/support';

installGoldseam();
