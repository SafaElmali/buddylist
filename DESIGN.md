---
name: buddylist PR stack extension
description: A scoped record of the existing Professional and Messenger styles used by the read-only PR stack pane.
colors:
  professional-light-pane: '#fbfcfd'
  professional-light-text: '#1a2130'
  professional-light-text-dim: '#5f6b82'
  professional-light-pane-border: '#dfe4ec'
  professional-light-pane-border-soft: '#e7ebf1'
  professional-light-select-soft: '#e5eefc'
  professional-light-link: '#1f63d6'
  professional-light-ok: '#227a35'
  professional-light-violet: '#5d3fc4'
  professional-light-danger: '#c8322f'
  professional-dark-pane: '#10141b'
  professional-dark-text: '#dfe5ef'
  professional-dark-text-dim: '#8f9ab0'
  professional-dark-pane-border: '#263042'
  professional-dark-pane-border-soft: '#212a3a'
  professional-dark-select-soft: '#1a2a48'
  professional-dark-link: '#79a7f7'
  professional-dark-ok: '#5fd07a'
  professional-dark-violet: '#ab98f8'
  professional-dark-danger: '#f27b78'
  messenger-light-pane: '#fff'
  messenger-light-text: '#000'
  messenger-light-text-dim: '#5a6a82'
  messenger-light-pane-border: '#7f9db9'
  messenger-light-pane-border-soft: '#b8cbe6'
  messenger-light-select-soft: '#d6e5f9'
  messenger-light-link: '#0645ad'
  messenger-light-ok: '#1e6b28'
  messenger-light-violet: '#6a3cb5'
  messenger-light-danger: '#b3261e'
  messenger-dark-pane: '#0f1b33'
  messenger-dark-text: '#dce6f7'
  messenger-dark-text-dim: '#93a5c8'
  messenger-dark-pane-border: '#3d5788'
  messenger-dark-pane-border-soft: '#2c416f'
  messenger-dark-select-soft: '#223d74'
  messenger-dark-link: '#8ab8ff'
  messenger-dark-ok: '#7fdc8c'
  messenger-dark-violet: '#c6adff'
  messenger-dark-danger: '#ff8f85'
typography:
  professional-body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', system-ui, sans-serif"
    fontSize: '12px'
    lineHeight: 1.5
  messenger-body:
    fontFamily: "Tahoma, 'Segoe UI', Geneva, Verdana, sans-serif"
    fontSize: '12px'
    lineHeight: 1.5
  branch:
    fontFamily: 'var(--font-mono)'
    fontSize: '10.5px'
  label:
    fontSize: '11px'
    lineHeight: 1.5
rounded:
  professional-control: '6px'
  messenger-control: '3px'
  row: '6px'
---

# Design System: buddylist PR stack extension

## Overview

This records the PR stack pane implemented in [pr-stack.js](src/renderer/chat/pr-stack.js) and [pr-stack.css](src/renderer/styles/pr-stack.css), redesigned on November 2, 2026. It preserves the incumbent visual system described in [The professional look](docs/professional-look.md) and [The MSN look](docs/msn-look.md). It is a scoped extension record. Application registration in `chat/main.js` uses the existing PR/View/Code menus, pane picker, restoration and pin lifecycle; the incumbent design system remains authoritative.

Professional uses flat panes, system type, and line icons over slate or ink. Messenger retains Luna chrome, Tahoma, and the existing illustrated icons. Both present the same compact, read-only stack. The [surface contract](.impeccable/surfaces/pr-stack.md) owns the task-specific direction; existing theme stylesheets remain the source of truth for colors and type. The frontmatter records the default light/dark values consumed here, without defining new CSS tokens. Other palettes continue to supply their existing role values.

**Key characteristics:**

- A sticky header naming the stack, its count and how many PRs are merged, with Refresh, and for a GitHub stack a bar of its steps.
- A vertical rail, top of the stack first, with a node per PR and the base branch as its end node, as GitHub's own stack popover reads.
- One row per PR: number and title on a line, state and short head branch below, then its step (“5 of 7”) where GitHub confirmed the order. State is an icon, a color and a word.
- The current PR is the selection fill plus a visible Current label; no accent edge.
- Existing controls and theme roles, with no new fonts, dependencies, colors or shipping raster assets.

**Order.** The stack reads top first. What a PR builds on is below it, ending at the branch the stack goes into, as on GitHub. The active work (usually the conversation's PR and what is left to merge) sits next to the header, while merged history settles towards the base.

## Colors

The pane uses the existing neutral surfaces, the blue selection fill and the status roles the app already gives pull request tags. All values in the frontmatter come from [theme.css](src/renderer/styles/theme.css) and [pro-theme.css](src/renderer/styles/pro-theme.css); Messenger's light values are the existing fallbacks shared with the contact list's PR tags.

| Existing role        | Use in this pane                                                        |
| -------------------- | ----------------------------------------------------------------------- |
| `--pane`             | Content background, opaque sticky header, open node fill, filled glyphs |
| `--text`             | Titles, numbers, base branch name                                       |
| `--text-dim`         | Count, progress, branches, captions, notices, draft state               |
| `--pane-border`      | The rail, and steps beyond the PRs shown                                |
| `--pane-border-soft` | Header divider and notice box                                           |
| `--select-soft`      | Current PR row                                                          |
| `--link`             | Current label, the current step's ring and candidate-parent links       |
| `--ok`               | Open                                                                    |
| `--violet`           | Merged, and the merged glyph in the header's progress                   |
| `--danger`           | Closed, and the error heading                                           |

Merged and closed nodes are filled with their state color; open nodes are outlined; draft nodes are dashed, as the draft glyph is. Each state also has its own glyph (the PR tag glyphs from `tagIcon`) and its word, so meaning never depends on color alone.

**The existing-role rule.** Keep the pane bound to these theme roles so both looks and alternate palettes remain coherent. Fallbacks reuse the most common existing fallback for each role, so the palette build is unchanged. Do not copy the recorded default values into component CSS.

## Typography

The pane inherits `--font-ui` for its active look. Numbers and the header's name are bold; titles are regular body text. State words are bold at the label size. Head branches use the look's existing `--font-mono` at 10.5px, so they read as branch names and stay narrow. PR numbers use tabular numerals.

## Layout

The pane fills its available height and scrolls internally. Its header stays at the top with a single divider and compact padding (8px by 10px). Its first line is the stack's name and count; the second is the merged progress; a GitHub stack whose order is confirmed adds a 6px step bar, one segment per PR from the bottom (left) to the top (right), 2px apart, the current one ringed. The module requests a pane room of 340px; actual sizing remains the SidePane's responsibility.

Rows are a two-column grid: a 22px node column and the text. A row's step sits at the end of its second line in tabular numerals, so the steps form a column; the branch gives way before it does. The rail is a 2px line through the node column, from the first node's center to the end node's center. Titles, branches and the Current label stay on one line; titles and branches end in an ellipsis, with the full title and both branches in the row's tooltip. Branch names drop the prefix every head branch in the view shares, up to its last slash (`…/5-read-new-table`).

When one PR has several dependents, each gets its own chain, set in by 22px under a “Depends on #” caption, with a short connector into the parent's rail. A single dependent stays on the same rail, so a long linear stack never indents. Checked at 320px and 560px in both looks, light and dark: no horizontal scrolling.

## Elevation & Depth

The list is flat: the rail and node rings carry structure, and the existing selection fill marks the current PR. The sticky header uses an opaque pane background. Rows add no shadows. Notices sit in a plain 1px bordered box.

Refresh inherits the existing button finish. While a read is in flight its arrow turns, as the Checks tab's does, and stays still with reduced motion.

## Shapes

Rows and their hover/selection fills have a 6px radius. Nodes are 22px circles; the base and uncertain end nodes are 6px-rounded squares. Refresh keeps a 28px by 28px target with a 14px icon.

## Components

### PR rows

Each row is one link to its PR: node, number, title and (for the conversation's PR) Current on the first line; state word and short head branch on the second. Its step in a GitHub stack (“3 of 7”, 1 at the bottom) ends the second line; the rail node keeps the state glyph. `aria-current="true"` marks the current PR. Pointed at, the row takes the hover fill and underlines its title. The row is a single Tab stop.

### Chain ends

A chain ends in its base branch (branch glyph, branch name, “Base branch”). A chain found by branch whose root has no confirmed parent ends dashed instead, showing the branch the root targets and why: multiple possible parents (with candidate links), a parent that could not be confirmed, a base GitHub changed, or a parent beyond the lookup limit. A bounded GitHub stack ends in “N pull requests above/below, not shown” markers. A GitHub stack whose order could not be confirmed shows its rows unconnected.

### Header, notices and links

The header says `Stack #N` for a GitHub stack (plain text: GitHub has no page per stack), `Stacked by branch` otherwise, or the count alone for one PR, then “3 of 7 merged”, then for a confirmed GitHub stack the step bar (`aria-hidden`: each row says its own step and state; each segment's tooltip names its PR). Incomplete-data notices appear before the list in a status box. Links and buttons keep a visible keyboard outline; Professional retains its shared focus treatment. The results region uses polite live announcements.

### Result states

| State                       | Presentation                                                                              |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| Loading                     | “Loading PR relationships...” with Refresh disabled and turning                           |
| No associated PR            | Plain explanation that the conversation's branch has no associated pull request yet       |
| Standalone PR               | One row and its base branch, under “Standalone pull request. No parent or dependent…”     |
| Merged, alone               | One row and its base, noting dependents may have been retargeted when it merged           |
| GitHub stack                | Header with stack number, progress and step bar; rows top first with steps; base end node |
| Stacked by branch           | The same rail; several dependents of one PR get their own set-in chains                   |
| Ambiguous or unknown parent | Dashed end node with the targeted branch, the reason and candidate links                  |
| Retargeted                  | Dashed end node at the new base, saying the PR it was stacked on could not be confirmed   |
| Error                       | Alert with a danger-colored heading, the error text and “Refresh to try again”            |

## Do's and Don'ts

- **Do** preserve Professional and Messenger independently through the existing look and theme mechanisms.
- **Do** keep state as glyph, color and word, and the current PR as fill plus label.
- **Do** keep long metadata on one line with ellipses and full text in the tooltip.
- **Don't** add an accent stripe to a row or card edge to mark the current PR.
- **Don't** infer dependency from sibling order or present candidate parents as confirmed relationships.
- **Don't** connect rows whose order GitHub did not confirm.

## Evidence

[check-pr-stack-ui.js](scripts/check-pr-stack-ui.js) exercises the production SidePane and a minified isolated PR stack module in Electron in both looks, light and dark. Its `ui-results.json` reports secondary-text contrast from 5.2:1 to 6.9:1, zero refresh-icon center offset, keyboard link activation, retry, stale-response protection and escaped content.

[check-pr-stack-app-ui.js](scripts/check-pr-stack-app-ui.js) launches the production bundle with a temporary profile, one real Git checkout per scenario and a local `gh` fixture. It covers the PR menu and pane picker, reloads, pins, restart, archive and a missing checkout; then every state above in Professional and Messenger, light and dark, at 320px and 560px (88 captures), asserting text, row order, the current row and no horizontal overflow; then records opening the stack from the PR menu and clicking a row. This establishes local macOS behavior with fixture GitHub metadata; it does not establish live GitHub stacks, Windows/Linux UI behavior, alternate palettes or screen-reader output.
