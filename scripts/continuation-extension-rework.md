# Continuation prompt: extension rework bundle (B17 + B18 + B19)

Paste this prompt at the start of a fresh Claude Code session to pick up
where the previous one left off, focused specifically on stripping the
KaraBuddy chrome extension down to "background recorder + mid-game tag
panel + toast notifications + karabuddy redirect."

---

You're picking up an in-flight project at `~/code/karabuddy` (the hosted
companion site for karabast.net, our Star Wars Unlimited replay /
testing tool). The chrome extension that captures replays now lives in
this same monorepo at `~/code/karabuddy/extension/` (B9 brought it in).

**Read these files first for context:**

- `~/code/karabuddy/CLAUDE.md` — project overview, stack, related repos
- `~/code/karabuddy/BACKLOG.md` — Done list shows everything we've
  shipped. `## Backlog` has the work for THIS session.
- `~/code/karabuddy/scripts/autonomous-loop-prompt.md` — the proven
  parallel-worktree-subagent pattern for working through the backlog

**Where things stand**

The webapp (`~/code/karabuddy/app/`) is mature: replay upload + Vercel
Blob storage, viewer at `/r/[slug]` using a forked-and-stripped
forceteki gameboard renderer, full tag CRUD with green/yellow author
colors, `/replays?tab=mine|public` browser, `/settings` karabast-username
claim, Auth.js v5 with Discord + Google, draggable launcher in the
extension, share-by-link, etc. All previous backlog items B1-B16 are
done — see BACKLOG.md's `## Done` for one-liners.

The chrome extension at `~/code/karabuddy/extension/` still carries a
lot of legacy surface from before the webapp existed: replays browser,
playback UI, account-link section, popup deck library. The webapp now
owns all of that. The extension's true job going forward is narrow:

1. Record karabast.net matches in the background (transparent)
2. Show the recording indicator on the floating launcher button
3. Offer a focused tag-the-current-frame UI mid-game
4. Pop toast notifications from the launcher for status changes
5. Upload finalized replays to karabuddy.com (already works)
6. Solo testing (still extension-only; leave intact for now)

**Your bundle: B17, B18, B19** (in `BACKLOG.md`)

- **B17** strips the sidebar down to its idle / recording / solo states
  with simplified layouts. Deletes the chrome-extension://-hosted
  replays.html|css|js page.
- **B18** adds a toast notification system that pops from the floating
  launcher button — fires on recording start, tag added, upload
  success/failure, replay saved.
- **B19** rewrites the toolbar action popup as a tiny launcher to
  karabuddy.com routes + the existing solo-options page.

The three are largely independent and parallelizable via the
worktree-subagent pattern. Some overlap risk on `extension/replays/05-footer.js`
(B17 strips sections; B18 may touch the launcher inside it). Spawn in
parallel; resolve any conflicts at merge time.

**How to execute**

1. Read CLAUDE.md and BACKLOG.md fully.
2. Spawn one Agent per task with `isolation: "worktree"` and
   `run_in_background: true`. Per-agent prompt template is in
   `scripts/autonomous-loop-prompt.md` — use it verbatim with the
   specific task block from BACKLOG copied in.
3. Wait for completion notifications (no polling).
4. From `~/code/karabuddy` on main:
   - For each agent's branch, cherry-pick its commit. Smaller / more
     isolated tasks first (likely B19 → B18 → B17 since B17 is the
     biggest sidebar surgery).
   - Resolve `extension/replays/05-footer.js` conflicts manually by
     reading both sides and combining — additions usually merge cleanly.
   - Run `npm run build` after each cherry-pick to confirm the webapp
     still compiles. The extension has no build step; `node -c
     extension/<file>.js` syntax-checks the JS.
5. After all merges, update `BACKLOG.md`: move B17/B18/B19 to `## Done`
   with a `_completed: <YYYY-MM-DD> by <name>_` line and a one-line
   summary of what shipped. Commit BACKLOG separately.
6. Brief the user with what shipped + anything punted.

**Constraints / context the agents need**

- The webapp uses `var(--font-barlow)` everywhere; the extension
  embeds the same brand styling inline (it injects into karabast.net's
  page world). Don't load external CSS into karabast.net pages.
- The launcher is draggable (B16) and position-persisted to
  `chrome.storage.local.karabuddyLauncherPos`. New toasts must anchor
  to the launcher's current bounding rect, not a fixed corner.
- `karabuddyEndpoint` is read via `chrome.storage.local`, falling back
  to `http://localhost:3000`. Helper in `extension/background.js`.
- The bridge content script at `extension/karabuddy-bridge.js` runs on
  karabuddy.com / *.vercel.app / localhost:3000 and exposes the
  install token via `window.postMessage`. Leave it intact.
- Don't touch `extension/options.html` (deck library + solo setup) —
  solo is staying extension-driven for this bundle.

**What to NOT do**

- Don't add commits to BACKLOG.md from inside subagent worktrees —
  the orchestrator (you) batches the BACKLOG update after all merges,
  same as previous batches.
- Don't push to a git remote (the repo isn't published yet).
- Don't run `npm run dev` — Parker has the server running on :3000.
  Use `npm run build` for verification.
- Don't try to update Chrome's installed extension automatically — the
  user reloads from chrome://extensions after each change.

Once you've read CLAUDE.md and BACKLOG.md, kick off the agents.
