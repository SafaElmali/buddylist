import { test } from 'node:test';
import assert from 'node:assert/strict';
import { button, toggle } from '../src/renderer/settings/controls.js';

// Capture the template given to the DOM and use real click events for its handler.
function page(t, look = 'messenger') {
  const previous = globalThis.document;
  const templates = [];
  globalThis.document = {
    documentElement: { dataset: { look } },
    createElement(tag) {
      assert.equal(tag, 'template');
      const node = new EventTarget();
      const input = new EventTarget();
      node.querySelector = (selector) => {
        assert.equal(selector, 'input');
        return input;
      };
      const template = { content: { firstElementChild: node } };
      templates.push(template);
      return template;
    },
  };
  t.after(() => {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  });
  return templates;
}

for (const [kind, classes] of [
  [undefined, 'btn'],
  ['primary', 'btn default'],
  ['danger', 'btn danger'],
]) {
  test(`Settings ${kind || 'plain'} buttons keep their action and use ${classes}`, (t) => {
    const templates = page(t);
    let clicks = 0;
    const node = button('Use <account>', () => clicks++, kind ? { kind } : undefined);
    assert.equal(templates[0].innerHTML, `<button class="${classes}" type="button">Use &lt;account&gt;</button>`);
    assert.equal(clicks, 0);
    node.dispatchEvent(new Event('click'));
    assert.equal(clicks, 1);
  });
}

test('empty button options keep the plain style', (t) => {
  const templates = page(t);
  button('Cancel', () => {}, {});
  assert.equal(templates[0].innerHTML, '<button class="btn" type="button">Cancel</button>');
});

for (const look of ['messenger', 'professional']) {
  for (const checked of [false, true]) {
    test(`Settings ${look} toggle starts ${checked ? 'on' : 'off'} and saves only changes`, (t) => {
      const templates = page(t, look);
      const changes = [];
      const node = toggle({
        label: 'Start conversations',
        hint: 'When a contact asks.',
        warning: 'Changes files <without asking>.',
        checked,
        onChange: (value) => changes.push(value),
      });
      const role = look === 'professional' ? 'switch' : 'checkbox';
      assert.ok(templates[0].innerHTML.includes(`<input type="checkbox" role="${role}" />`));
      assert.ok(templates[0].innerHTML.includes('class="st-warning">Changes files &lt;without asking&gt;.'));
      const input = node.querySelector('input');
      assert.equal(input.checked, checked);
      assert.deepEqual(changes, []);
      input.checked = !checked;
      input.dispatchEvent(new Event('change'));
      assert.deepEqual(changes, [!checked]);
    });
  }
}
