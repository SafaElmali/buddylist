import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planFileOf } from '../src/renderer/chat/plans.js';

const FOLDER = '/Users/me/.buddylist/worktrees/swarm/swarm-20';
const write = (path) => ({ kind: 'write', path, changes: [] });
const edit = (path) => ({ kind: 'edit', path, changes: [] });

test('a Markdown file named for a plan, written or changed in the folder, is a plan', () => {
  assert.equal(planFileOf(write(`${FOLDER}/COM-630-plan.md`), FOLDER), 'COM-630-plan.md');
  assert.equal(planFileOf(edit(`${FOLDER}/COM-630-plan.md`), FOLDER), 'COM-630-plan.md');
  assert.equal(planFileOf(write(`${FOLDER}/PLAN.md`), FOLDER), 'PLAN.md');
  assert.equal(planFileOf(write(`${FOLDER}/implementation_plan.markdown`), FOLDER), 'implementation_plan.markdown');
  assert.equal(planFileOf(write(`${FOLDER}/plans.md`), FOLDER), 'plans.md');
  assert.equal(planFileOf(write(`${FOLDER}/planning-notes.md`), FOLDER), 'planning-notes.md');
  assert.equal(planFileOf(write(`${FOLDER}/plan.v2.md`), FOLDER), 'plan.v2.md');
});

test('so is any Markdown file in a folder named for plans', () => {
  assert.equal(planFileOf(write(`${FOLDER}/docs/plans/2026-10-20-auth.md`), FOLDER), 'docs/plans/2026-10-20-auth.md');
  assert.equal(planFileOf(edit(`${FOLDER}/plan/next.md`), FOLDER), 'plan/next.md');
});

test('a word with "plan" inside it does not make a plan', () => {
  for (const name of ['explain.md', 'planet.md', 'airplane.md', 'planner.md', 'README.md', 'CHANGELOG.md']) {
    assert.equal(planFileOf(write(`${FOLDER}/${name}`), FOLDER), null, name);
  }
});

test('only Markdown is a plan: not a plan in code, nor a file with no ending', () => {
  for (const name of ['plan.rb', 'plan.ts', 'plan', 'plans/run.sh', 'plan.md.bak']) {
    assert.equal(planFileOf(write(`${FOLDER}/${name}`), FOLDER), null, name);
  }
});

test('only a plan written in the folder: plan mode keeps its own elsewhere, and asks about it', () => {
  assert.equal(planFileOf(write('/Users/me/.claude/plans/plan-for-auth.md'), FOLDER), null);
  assert.equal(planFileOf(write(`${FOLDER}-2/COM-630-plan.md`), FOLDER), null, 'a folder that only starts the same');
});

test('only a call that wrote to it: reading a plan is no new plan', () => {
  const path = `${FOLDER}/COM-630-plan.md`;
  for (const kind of ['read', 'search', 'command', 'plan']) {
    assert.equal(planFileOf({ kind, path }, FOLDER), null, kind);
  }
  assert.equal(planFileOf({ kind: 'edit' }, FOLDER), null, 'a call that names no file');
});

test('a Windows folder: its paths are compared as Windows compares them', () => {
  assert.equal(
    planFileOf(edit('C:\\Users\\me\\app\\docs\\plans\\auth.md'), 'C:\\Users\\me\\app'),
    'docs\\plans\\auth.md'
  );
  assert.equal(planFileOf(edit('c:\\users\\me\\app\\PLAN.md'), 'C:\\Users\\me\\app'), 'PLAN.md');
});
