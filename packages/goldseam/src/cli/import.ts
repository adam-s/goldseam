// `goldseam import <journey.json>` — compile a recorded browser JOURNEY into
// runnable Cypress with ZERO model calls. A recorded journey already holds
// real, reviewed selectors, so there is nothing to translate: the mapping is
// a pure, deterministic rewrite of the journey's beat vocabulary into
// goldseam's StepCommand list, then rendered through the same renderCommand
// the authoring `eject` path uses.
//
// A "scene" is a committed replay record. Two beat vocabularies exist and this
// mapper handles the union:
//   webtour Step  : goto/move/click/hover/scroll/type/highlight/wait/say
//   performer Beat: chrome/click/reload/goto/type/scroll(to)/point/inspect/…
//                   plus a done:{sel,state} postcondition on any nav beat.
//
// Only beats that describe a REPRODUCIBLE browser interaction map to a
// StepCommand. Staging/camera/narration/pacing beats have no test meaning and
// are dropped — each recorded in `unmapped` with a reason, so the import is
// honest and never silently lossy.

import { StepCommand, validateCommands } from '../shared/prompt-types';

/** One recorded beat. Loosely typed on purpose: a scene is external data, so
 * every field is optional and validated as it is read, never assumed. */
export interface SceneBeat {
  do?: string;
  url?: string;
  sel?: string;
  text?: string;
  /** webtour scroll target: a keyword (`top`/`bottom`/…) or a pixel offset. */
  to?: unknown;
  /** A postcondition on a nav/click beat: element `sel` reached `state`. */
  done?: { sel?: string; state?: string };
  [k: string]: unknown;
}

export interface Scene {
  base?: string;
  beats?: SceneBeat[];
  steps?: SceneBeat[];
}

/** A beat that produced no command, and why — the honest record of what the
 * import dropped. */
export interface UnmappedBeat {
  index: number;
  do: string;
  why: string;
}

export interface CompiledScene {
  commands: StepCommand[];
  unmapped: UnmappedBeat[];
}

// done:{sel,state} -> a goldseam assert. `visible` => be.visible; `hidden`/
// `detached` => not.exist (the element left the accessibility tree, which is
// what the journey asserted); `attached` => exist.
const DONE_SHOULD: Record<string, string> = {
  visible: 'be.visible',
  hidden: 'not.exist',
  detached: 'not.exist',
  attached: 'exist',
};

// Cypress scrollTo positions are keyword-only. A journey scroll to a keyword
// maps; a pixel/cosmetic scroll has no StepCommand vocabulary and is dropped
// (Cypress guards a raw window scrollTo, and a cosmetic scroll carries no test
// meaning) rather than guessed into a wrong keyword.
const SCROLL_POSITIONS = new Set([
  'top', 'bottom', 'left', 'right', 'center',
  'topLeft', 'topRight', 'bottomLeft', 'bottomRight',
]);

/** Map one scene into a StepCommand[] plus the list of unmapped beats.
 * @param scene   the journey: an array of beats, or `{ beats }` / `{ steps }`.
 * @param opts.base  base URL to resolve relative goto/chrome urls against
 *                   (falls back to `scene.base`).
 */
export function sceneToCommands(
  scene: Scene | SceneBeat[],
  opts: { base?: string } = {},
): CompiledScene {
  const list: SceneBeat[] = Array.isArray(scene)
    ? scene
    : scene.beats ?? scene.steps ?? [];
  const base = opts.base ?? (Array.isArray(scene) ? undefined : scene.base);
  const commands: StepCommand[] = [];
  const unmapped: UnmappedBeat[] = [];

  const resolveUrl = (url: string): string => {
    if (/^https?:\/\//i.test(url)) return url;
    if (!base) return url;
    return `${String(base).replace(/\/$/, '')}/${url.replace(/^\//, '')}`;
  };

  list.forEach((beat, index) => {
    // A scene is external data — a non-object beat (null, string, number) is
    // malformed, not a crash. Record it as dropped rather than dereferencing
    // `.do` on it (red-team finding: `[null]` threw an internal TypeError).
    if (typeof beat !== 'object' || beat === null || Array.isArray(beat)) {
      unmapped.push({ index, do: '(none)', why: 'beat is not an object' });
      return;
    }
    let dropped: string | null = null;
    switch (beat.do) {
      case 'goto':
      case 'chrome': // performer's browser-open beat carries the target url
        if (!beat.url) { dropped = 'no url'; break; }
        commands.push({ action: 'visit', url: resolveUrl(beat.url) });
        break;
      case 'click':
      case 'dblclick':
        if (!beat.sel) { dropped = 'no selector'; break; }
        commands.push({ action: beat.do, selector: beat.sel });
        break;
      case 'type':
        // A journey `type` has BOTH sel and text; performer's terminal `type`
        // has text but no sel (it types into a Terminal, not the page) — that
        // one is not a browser interaction and must not map.
        if (!beat.sel || typeof beat.text !== 'string') {
          dropped = 'type without page selector (terminal/command beat)';
          break;
        }
        commands.push({ action: 'type', selector: beat.sel, text: beat.text });
        break;
      case 'scroll': {
        // Keyword positions only; a pixel/cosmetic scroll is dropped.
        const to = beat.to;
        if (typeof to !== 'string' || !SCROLL_POSITIONS.has(to)) {
          dropped = 'pixel/cosmetic scroll (no keyword position)';
          break;
        }
        commands.push({ action: 'scrollTo', position: to });
        break;
      }
      case 'hover':
        if (!beat.sel) { dropped = 'no selector'; break; }
        // Cypress has no native hover; the journey's dwell becomes a
        // mouseover trigger — goldseam's documented hover shape.
        commands.push({ action: 'trigger', selector: beat.sel, event: 'mouseover' });
        break;
      case 'select':
        if (!beat.sel || typeof beat.text !== 'string') {
          dropped = 'select without sel/value';
          break;
        }
        commands.push({ action: 'select', selector: beat.sel, value: beat.text });
        break;
      case 'check':
      case 'uncheck':
        if (!beat.sel) { dropped = 'no selector'; break; }
        commands.push({ action: beat.do, selector: beat.sel });
        break;
      case 'wait':
        // Pure pacing — not a test assertion. Drop rather than bake in sleeps.
        dropped = 'pacing only';
        break;
      default:
        // backdrop/term/point/inspect/reload/raise/stage-ready/zed-*/wrap/
        // say/highlight/move — staging, camera, or narration. No test meaning.
        dropped = 'non-interactive staging/camera/narration beat';
    }

    if (dropped !== null) {
      unmapped.push({ index, do: beat.do ?? '(none)', why: dropped });
    }

    // A done:{sel,state} postcondition is an observable fact the journey
    // recorded — emit it as an explicit assertion whenever it is present and
    // recognized, whether or not the beat's primary action mapped (a
    // `reload{done}` keeps its postcondition; a mapped click emits its action
    // then its assertion, in order).
    const done = beat.done;
    if (done?.sel && DONE_SHOULD[done.state ?? 'visible']) {
      commands.push({
        action: 'assert',
        selector: done.sel,
        should: DONE_SHOULD[done.state ?? 'visible'],
      });
    }
  });

  // Validate the emitted commands through goldseam's OWN gate — the import is
  // only sound if the product would accept the shapes as a translation. An
  // all-dropped scene (no interactive beats) is a legitimate, reported outcome,
  // not a failed translation, so the empty case is left for the caller to
  // report rather than thrown here (validateCommands rejects an empty array).
  if (commands.length > 0) validateCommands(commands);
  return { commands, unmapped };
}

/** Guarded scene loader: a bad file must error clearly, never a raw stack. */
export class InvalidScene extends Error {}

export function parseScene(json: string): Scene | SceneBeat[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (e) {
    throw new InvalidScene(`not valid JSON — ${e instanceof Error ? e.message : e}`);
  }
  const beats = Array.isArray(data)
    ? data
    : data && typeof data === 'object'
      ? (data as Scene).beats ?? (data as Scene).steps
      : undefined;
  if (!Array.isArray(beats)) {
    throw new InvalidScene(
      'expected an array of beats, or an object with a "beats"/"steps" array',
    );
  }
  return data as Scene | SceneBeat[];
}

/** Render a compiled scene as a runnable Cypress spec, with a header that
 * names the source and honestly lists every dropped beat. `renderLine`
 * renders one StepCommand (the authoring `eject` renderCommand). */
/** Collapse newlines so a scene-derived value emitted into a `//` line cannot
 * break out of the comment. A beat's `do` (and the source path) is external
 * data; without this, `{"do":"x\nMALICIOUS\n//"}` would inject a line of code
 * at the top of the generated spec (red-team finding). */
const commentSafe = (s: string): string => String(s).replace(/\s*[\r\n]+\s*/g, ' ');

export function renderImportedSpec(
  compiled: CompiledScene,
  source: string,
  renderLine: (cmd: StepCommand) => string,
): string {
  const { commands, unmapped } = compiled;
  const header: string[] = [
    `// goldseam import — compiled from ${commentSafe(source)} with ZERO model calls.`,
    `// A recorded journey holds real, reviewed selectors; nothing was translated.`,
    `// ${commands.length} command(s) emitted; ${unmapped.length} beat(s) dropped as non-interactive:`,
  ];
  for (const u of unmapped) {
    header.push(`//   [beat ${u.index}] ${commentSafe(u.do)} — ${commentSafe(u.why)}`);
  }
  if (unmapped.length === 0) header.push('//   (none)');

  const body = commands.map((c) => `    ${renderLine(c)}`).join('\n');
  return [
    ...header,
    `describe('imported journey', () => {`,
    `  it('replays the recorded journey', () => {`,
    body,
    `  });`,
    `});`,
    '',
  ].join('\n');
}
