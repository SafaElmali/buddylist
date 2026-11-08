import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTitle } from '../src/shared/plan-title.js';

test('a plan is called after its first heading', () => {
  assert.equal(planTitle('## Add a dark theme\n\n1. Add color tokens'), 'Add a dark theme');
  assert.equal(planTitle('Some context first.\n\n# Move the cache\n\nSteps'), 'Move the cache');
  assert.equal(planTitle('\n\n### Third level ###\n'), 'Third level');
});

test('without a heading, a plan is called after its first line', () => {
  assert.equal(
    planTitle('Rename the helper, then update its callers.\n\nMore.'),
    'Rename the helper, then update its callers.'
  );
  assert.equal(planTitle('1. Add color tokens\n2. Switch them'), 'Add color tokens');
  assert.equal(planTitle('- Add color tokens'), 'Add color tokens');
});

test('the Markdown around a title is left out', () => {
  assert.equal(
    planTitle('# **Fix** the `retry_count` in [the queue](https://example.com/q)'),
    'Fix the retry_count in the queue'
  );
  assert.equal(planTitle('## ~~Old~~ *New* plan'), 'Old New plan');
});

test('a title does not say again that it is a plan', () => {
  assert.equal(planTitle('# Plan: Add a dark theme'), 'Add a dark theme');
  assert.equal(planTitle('# Implementation Plan — Add a dark theme'), 'Add a dark theme');
  assert.equal(planTitle('# Plan - Add a dark theme'), 'Add a dark theme');
  assert.equal(
    planTitle('# Planning the migration'),
    'Planning the migration',
    'a word that only starts with it stays'
  );
  assert.equal(planTitle('# Implementation plan'), 'Implementation plan', 'and a heading that is nothing else');
});

test('a "# comment" in a code block is no heading', () => {
  assert.equal(planTitle('```sh\n# install it\nnpm i\n```\n\n## Set up the linter'), 'Set up the linter');
  assert.equal(planTitle('~~~\n# only code\n~~~'), 'Plan');
});

test('a plan with nothing to call it after is a Plan', () => {
  assert.equal(planTitle(''), 'Plan');
  assert.equal(planTitle(undefined), 'Plan');
  assert.equal(planTitle('   \n\n'), 'Plan');
  assert.equal(planTitle('#\n'), 'Plan');
});

test('a long title is cut short', () => {
  const title = planTitle(`# ${'word '.repeat(30)}`);
  assert.equal(title.length <= 60, true);
  assert.match(title, /word…$/);
});
