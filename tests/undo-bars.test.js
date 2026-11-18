import test from 'node:test';
import assert from 'node:assert/strict';
import { createUndoBars } from '../extension/lib/undo-bars.js';

function fixture(start = 100_000) {
  let time = start,
    next = 0;
  const timers = new Map(),
    restores = [];
  class Element {
    constructor(tag) {
      Object.assign(this, {
        tag,
        children: [],
        style: {},
        attributes: {},
        listeners: {},
        textContent: '',
      });
    }
    append(...nodes) {
      for (const node of nodes) {
        node.parent = this;
        this.children.push(node);
      }
    }
    prepend(node) {
      node.parent = this;
      this.children.unshift(node);
    }
    remove() {
      this.parent.children = this.parent.children.filter((item) => item !== this);
    }
    replaceWith(node) {
      node.parent = this.parent;
      this.parent.children.splice(this.parent.children.indexOf(this), 1, node);
    }
    cloneNode() {
      const copy = new Element(this.tag);
      copy.className = this.className;
      copy.attributes = { ...this.attributes };
      return copy;
    }
    setAttribute(key, value) {
      this.attributes[key] = value;
    }
    addEventListener(key, fn) {
      this.listeners[key] = fn;
    }
  }
  const container = new Element('div');
  const bars = createUndoBars(container, {
    document: { createElement: (tag) => new Element(tag) },
    restore: (id) => restores.push(id),
    now: () => time,
    schedule: (fn, delay) => {
      const id = ++next;
      timers.set(id, { fn, at: time + delay });
      return id;
    },
    cancel: (id) => timers.delete(id),
  });
  const advance = (ms) => {
    const until = time + ms;
    while (true) {
      const [entry] = [...timers]
        .filter(([, timer]) => timer.at <= until)
        .sort((a, b) => a[1].at - b[1].at);
      if (!entry) break;
      const [id, timer] = entry;
      time = timer.at;
      timers.delete(id);
      timer.fn();
    }
    time = until;
  };
  const buttons = () => container.children.map((row) => row.children[2]);
  return { bars, container, buttons, restores, advance, timers };
}
const first = { id: 'five', at: 100_000, expiresAt: 160_000, count: 5 };
const second = { id: 'two', at: 120_000, expiresAt: 180_000, count: 2 };

test('every action has an independent Restore button, newest first, with only one expiration timeout', () => {
  const f = fixture(120_000);
  f.bars.set([first, second]);
  assert.deepEqual(
    f.buttons().map((button) => button.textContent),
    ['Restore 2 tabs', 'Restore 5 tabs'],
  );
  f.buttons()[1].listeners.click();
  assert.deepEqual(f.restores, ['five']);
  assert.equal(f.timers.size, 1);
  assert.equal(f.container.children[1].children[0].style.animationDelay, '-20000ms');
  f.advance(40_001);
  assert.deepEqual(
    f.buttons().map((button) => button.textContent),
    ['Restore 2 tabs'],
  );
  f.advance(20_000);
  assert.equal(f.container.hidden, true);
  assert.equal(f.timers.size, 0);
});
test('rerenders retain focus targets and clocks; reopening uses the remaining time', () => {
  const f = fixture();
  f.bars.set([first]);
  const button = f.buttons()[0],
    progress = f.container.children[0].children[0];
  f.advance(20_000);
  f.bars.set([first], { disabled: true });
  assert.equal(f.buttons()[0], button);
  assert.equal(f.container.children[0].children[0], progress);
  button.listeners.click();
  assert.deepEqual(f.restores, []);
  f.bars.set([first]);
  button.listeners.click();
  assert.deepEqual(f.restores, ['five']);
  const reopened = fixture(145_000);
  reopened.bars.set([first]);
  assert.equal(reopened.container.children[0].children[0].style.animationDelay, '-45000ms');
  reopened.advance(15_001);
  assert.equal(reopened.container.hidden, true);
});
test('successful undo removes only its action; a partial restore renews only its remaining tabs', () => {
  const f = fixture(120_000);
  f.bars.set([first, second]);
  const secondButton = f.buttons()[0];
  f.bars.set([second]);
  assert.equal(f.buttons()[0], secondButton);
  const progress = f.container.children[0].children[0];
  f.advance(30_000);
  f.bars.set([{ ...second, count: 1, expiresAt: 210_000 }]);
  assert.equal(f.buttons()[0], secondButton);
  assert.equal(secondButton.textContent, 'Restore 1 tab');
  assert.notEqual(f.container.children[0].children[0], progress);
  f.advance(30_001);
  assert.equal(f.container.hidden, false);
  f.advance(30_000);
  assert.equal(f.container.hidden, true);
});
