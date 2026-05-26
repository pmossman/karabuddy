# Autonomous backlog loop — prompt for `/loop`

This is the prompt body to give `/loop` so an iteration parallelizes the
backlog via worktree subagents the same way the seed batch (B1–B8) was
shipped.

Recommended cadence: `/loop 24h <prompt-body>` to run once per day, or omit
the interval to let the agent self-pace based on how much remains in the
backlog.

---

## Prompt body

You are running an autonomous iteration of the karabuddy backlog loop.

1. **Read state.** `cat ~/code/karabuddy/BACKLOG.md`. If the `## Backlog`
   section is empty, end this iteration with a one-line note and exit.
2. **Select.** Take up to 6 tasks from the top of `## Backlog` (priority
   order). Don't try to claim more than 6 — merge-conflict resolution
   costs scale superlinearly past that.
3. **Spawn in parallel.** For each selected task, launch an Agent with
   `isolation: "worktree"` AND `run_in_background: true`. Per-agent
   prompt template:
   ```
   You're a subagent working on one backlog task in ~/code/karabuddy.
   Read CLAUDE.md and BACKLOG.md first.

   ASSIGNED TASK: [B<N>] <copy the entire task block from BACKLOG>

   Constraints:
   - Scope to just this task. Don't refactor adjacent code or fix
     other tasks even if you notice them.
   - DO NOT modify BACKLOG.md — the orchestrator updates it after
     merging all branches.
   - Don't start `npm run dev` (port 3000 may be in use). Use
     `npm run build` for verification (tsc passes is sufficient; the
     worktree won't have .env.local so Neon page-data collection
     will fail harmlessly).
   - Work IN your worktree directory, not in the main checkout.
     If you accidentally edit the main checkout, revert those changes
     and redo in the worktree.
   - ONE commit on your worktree's current branch. Message:
     `B<N>: <one-line summary>`. Include `Co-Authored-By: Claude
     Opus 4.7 <noreply@anthropic.com>` trailer via HEREDOC.

   Deliverable: under-200-word report — files changed (path + 1-line
   per file), build status, any punted items.
   ```
4. **Wait.** You'll be notified as each agent completes. Don't poll.
5. **Merge.** From `cd ~/code/karabuddy && git checkout main`:
   - Drop any stale stashes leftover from agent work: `git stash list`,
     drop any titled "concurrent-agent-wip".
   - Cherry-pick each agent's commit in this order (smallest blast radius
     first): isolated-file-only tasks → multi-file tasks → tasks editing
     TagSidebar.tsx (the most contested file). Use the agent reports
     to figure out which is which.
   - For each conflict on TagSidebar.tsx: open the file, locate the
     `<<<<<<< / ======= / >>>>>>>` markers, and combine both sides.
     The pattern is usually: each agent adds a new section or extends
     the Props interface — keep all additions, dedupe imports.
6. **Verify.** `npm run build` after every few cherry-picks. If it
   breaks, narrow which cherry-pick broke it and bisect.
7. **Update BACKLOG.md.** Move every cherry-picked task to the top of
   `## Done` with `_completed: YYYY-MM-DD by autonomous-loop_` and a
   one-line summary. Skipped tasks stay in `## Backlog`.
8. **Commit + report.** One final commit titled `BACKLOG: complete BX,
   BY, ...`. End the iteration with a short summary: tasks completed,
   any that hit blockers + why.

## Failure modes to expect

- **Locked worktrees from previous runs**: harmless cosmetic clutter.
  Skip them. Re-creating new ones via isolation: "worktree" works fine.
- **An agent makes no changes**: probably hit a blocker. Read its
  report, log the blocker as a new backlog item or skip the task.
- **Build fails after merge**: revert the offending cherry-pick, log it
  as a follow-up task (e.g., "B<N> re-attempt: clean up <thing>"),
  continue with the rest.
- **Two agents both ship the same file with structural conflicts**:
  resolve manually; if the resolution is non-obvious, leave the
  second task in `## Backlog` with a note that it depends on the
  first landing.
