import { describe, expect, it } from 'vitest';
import {
  InvalidScene,
  parseScene,
  renderImportedSpec,
  sceneToCommands,
  type SceneBeat,
} from '../src/cli/import';
import { renderCommand } from '../src/cli/eject';
import { validateCommands } from '../src/shared/prompt-types';

// A small journey in the recorded beat vocabulary — every mappable kind plus
// staging/pacing beats that must be dropped, and a performer terminal `type`.
const fixture = {
  base: 'https://shop.example',
  beats: [
    { do: 'say', text: 'welcome to the demo' }, // narration → dropped
    { do: 'goto', url: '/login' }, // relative → resolved against base
    { do: 'type', sel: '#username', text: 'tomsmith' },
    { do: 'type', text: 'ls -la' }, // terminal type, no sel → dropped
    { do: 'hover', sel: '.menu' },
    { do: 'wait', ms: 500 }, // pacing → dropped
    {
      do: 'click',
      sel: 'button[type="submit"]',
      done: { sel: '.flash.success', state: 'visible' },
    },
    { do: 'scroll', to: 'bottom' },
    { do: 'scroll', to: 640 }, // pixel scroll → dropped
    { do: 'backdrop', text: 'fade' }, // staging → dropped
  ] as SceneBeat[],
};

describe('sceneToCommands — beat → StepCommand mapping', () => {
  it('maps each interactive beat kind to the right command', () => {
    const { commands } = sceneToCommands(fixture);
    expect(commands).toEqual([
      { action: 'visit', url: 'https://shop.example/login' },
      { action: 'type', selector: '#username', text: 'tomsmith' },
      { action: 'trigger', selector: '.menu', event: 'mouseover' },
      { action: 'click', selector: 'button[type="submit"]' },
      { action: 'assert', selector: '.flash.success', should: 'be.visible' },
      { action: 'scrollTo', position: 'bottom' },
    ]);
  });

  it('resolves relative goto urls against opts.base over scene.base', () => {
    const { commands } = sceneToCommands({ beats: [{ do: 'goto', url: '/x' }] }, { base: 'https://a.test/' });
    expect(commands[0]).toEqual({ action: 'visit', url: 'https://a.test/x' });
  });

  it('leaves absolute urls untouched', () => {
    const { commands } = sceneToCommands([{ do: 'goto', url: 'http://other.test/y' }]);
    expect(commands[0]).toEqual({ action: 'visit', url: 'http://other.test/y' });
  });

  it('maps performer chrome{url} the same as goto', () => {
    const { commands } = sceneToCommands([{ do: 'chrome', url: 'http://x.test' }]);
    expect(commands[0]).toEqual({ action: 'visit', url: 'http://x.test' });
  });

  it('maps done states: visible→be.visible, hidden/detached→not.exist, attached→exist', () => {
    const states: Array<[string, string]> = [
      ['visible', 'be.visible'],
      ['hidden', 'not.exist'],
      ['detached', 'not.exist'],
      ['attached', 'exist'],
    ];
    for (const [state, should] of states) {
      const { commands } = sceneToCommands([
        { do: 'click', sel: '#b', done: { sel: '#t', state } },
      ]);
      expect(commands[1]).toEqual({ action: 'assert', selector: '#t', should });
    }
  });

  it('keeps a done postcondition on a non-mapping beat (reload{done})', () => {
    const { commands } = sceneToCommands([
      { do: 'reload', done: { sel: '#ready', state: 'visible' } },
    ]);
    expect(commands).toEqual([{ action: 'assert', selector: '#ready', should: 'be.visible' }]);
  });

  it('maps select/check/uncheck/dblclick', () => {
    const { commands } = sceneToCommands([
      { do: 'select', sel: '#country', text: 'US' },
      { do: 'check', sel: '#agree' },
      { do: 'uncheck', sel: '#news' },
      { do: 'dblclick', sel: '#cell' },
    ]);
    expect(commands).toEqual([
      { action: 'select', selector: '#country', value: 'US' },
      { action: 'check', selector: '#agree' },
      { action: 'uncheck', selector: '#news' },
      { action: 'dblclick', selector: '#cell' },
    ]);
  });
});

describe('sceneToCommands — honest drops', () => {
  it('drops staging/narration/pacing beats and records each with a reason', () => {
    const { unmapped } = sceneToCommands(fixture);
    const byDo = Object.fromEntries(unmapped.map((u) => [u.do, u.why]));
    expect(byDo.say).toMatch(/staging|camera|narration/);
    expect(byDo.wait).toMatch(/pacing/);
    expect(byDo.backdrop).toMatch(/staging|camera|narration/);
    // Every drop names its beat index so the report is traceable.
    for (const u of unmapped) expect(typeof u.index).toBe('number');
  });

  it('records exactly the non-interactive beats as dropped', () => {
    const { unmapped } = sceneToCommands(fixture);
    // say, terminal-type, wait, pixel-scroll, backdrop — five dropped.
    expect(unmapped.map((u) => u.do)).toEqual(['say', 'type', 'wait', 'scroll', 'backdrop']);
  });

  it('drops a performer terminal type (text but no page selector)', () => {
    const { commands, unmapped } = sceneToCommands([{ do: 'type', text: 'ls -la' }]);
    expect(commands).toEqual([]);
    expect(unmapped[0].why).toMatch(/terminal|page selector/);
  });

  it('drops a pixel/cosmetic scroll but maps a keyword scroll', () => {
    const { commands, unmapped } = sceneToCommands([
      { do: 'scroll', to: 640 },
      { do: 'scroll', to: 'top' },
    ]);
    expect(commands).toEqual([{ action: 'scrollTo', position: 'top' }]);
    expect(unmapped[0].why).toMatch(/pixel|cosmetic/);
  });
});

describe('sceneToCommands — product gate', () => {
  it('compiles commands that pass validateCommands', () => {
    const { commands } = sceneToCommands(fixture);
    expect(() => validateCommands(commands)).not.toThrow();
  });

  it('returns an empty command list (not a throw) for an all-dropped scene', () => {
    const { commands, unmapped } = sceneToCommands([{ do: 'say', text: 'hi' }, { do: 'wait', ms: 1 }]);
    expect(commands).toEqual([]);
    expect(unmapped).toHaveLength(2);
  });
});

describe('parseScene — guarded loader', () => {
  it('accepts an array, {beats}, and {steps}', () => {
    expect(parseScene('[{"do":"goto","url":"http://x"}]')).toBeInstanceOf(Array);
    expect(parseScene('{"beats":[]}')).toEqual({ beats: [] });
    expect(parseScene('{"steps":[]}')).toEqual({ steps: [] });
  });

  it('throws InvalidScene on bad JSON', () => {
    expect(() => parseScene('{not json')).toThrow(InvalidScene);
  });

  it('throws InvalidScene on a shape with no beats/steps array', () => {
    expect(() => parseScene('{"foo":1}')).toThrow(InvalidScene);
    expect(() => parseScene('42')).toThrow(InvalidScene);
  });
});

describe('renderImportedSpec — renders valid Cypress', () => {
  it('wraps the commands in a describe/it and lists dropped beats in the header', () => {
    const compiled = sceneToCommands(fixture);
    const spec = renderImportedSpec(compiled, 'journey.json', renderCommand);
    expect(spec).toContain("describe('imported journey'");
    expect(spec).toContain("cy.visit('https://shop.example/login');");
    expect(spec).toContain("cy.get('#username').type('tomsmith');");
    expect(spec).toContain("cy.get('.menu').trigger('mouseover');");
    expect(spec).toContain("cy.get('.flash.success').should('be.visible');");
    expect(spec).toContain("cy.scrollTo('bottom');");
    // Header honestly names a dropped beat.
    expect(spec).toMatch(/beat \d+\] (say|wait|backdrop) —/);
    // Every emitted command line appears in the body.
    for (const cmd of compiled.commands) expect(spec).toContain(renderCommand(cmd));
  });
});
