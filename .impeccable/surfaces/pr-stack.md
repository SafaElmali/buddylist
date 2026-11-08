# PR stack pane

Mode: Operate. This extends buddylist's existing Professional and Messenger pane system. Product purpose and design direction come from the explicit task; no new visual world or product interview is needed.

## Direction contract

THESIS: Make confirmed PR dependencies and uncertainty easy to scan while the conversation remains available.

OWN-WORLD: Existing pane, text, selection, border, status (ok, violet, danger), button and icon tokens in both looks and light/dark. No new colors, fonts, assets or dependencies.

STORY: Identify the current PR, follow the rail down through what it builds on to the base branch, see at a glance which PRs are open, draft, merged or closed, and open a PR on GitHub. Uncertain parents end the rail dashed, with separate candidates.

FIRST VIEWPORT: A header with the stack's name, count and merged progress, and Refresh, above a rail read top first, as GitHub's stack popover is. Each row is a node (state glyph and color), number and title, then state word and short head branch. The current row uses the established selection fill and a visible label, never an accent edge. A seven-PR stack fits one screen.

FORM: A local pane extension. Metadata-backed chains; a single dependent continues its parent's rail and several get their own set-in rails, so sibling ordering never implies a dependency. Loading, error/retry, no-PR, standalone and ambiguous states are explicit. No animation is necessary for reading.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

For this ordinary extension, the existing system is documented in `docs/professional-look.md`, `docs/msn-look.md` and the theme stylesheets; preserve these files. No shipping rasters are introduced. PR-stack-specific registration in `chat/main.js` uses the existing menu, pane restoration, pins and unavailable placeholders. Final review covers normal application entry and the four look/theme captures, with fixture metadata clearly identified.
