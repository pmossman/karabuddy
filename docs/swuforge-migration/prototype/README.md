# Migration demo — files

Deployable in-app demo of the karabuddy → SWU Forge team migration (faked data,
no backend — for gathering UX feedback, not a real feature).

## The deployable demo (canonical)

**`app/migrate-demo/page.tsx`** → route **`/migrate-demo`**. A React client
component built on **karabuddy's real design system**: `Panel`, `LedToggle`,
`Segmented`, `LeaderBasePair` (real leader/base card art), `TacticalHeading`,
`glowButtonStyle`/`btnGhost`, and `tokens` — wrapped in `KaraBuddyThemeProvider`.
It lives OUTSIDE the `(app)` group so it renders full-screen without the sidebar
app shell (the wizard has its own chrome). `noindex`, public.

- The **left progress rail is jump-clickable** — hop to any section.
- The aesthetic shifts per step from karabuddy (cyan/cold) toward a merged
  karabuddy×Forge look (ember/warm): the karabuddy components stay constant as
  the through-line while the Forge branding + a phase accent fade in. The one
  non-token colour is the `FORGE` ember (partner brand), noted in the file.
- Real card art resolves from karabuddy's own `/card-art/...`. Demo deck IDs must
  be printings whose art is synced locally (base-set numbers, not hyperspace
  variants) — verified: Cad Bane ASH_011, Wedge JTL_008, Vader JTL_006, Ezra
  ASH_013, Obi-Wan TWI_003; bases SOR_021/SOR_020/ASH_023/SHD_023/JTL_030.

Typecheck-clean (the deploy pipeline runs `typecheck`). Verified in-browser across
steps.

## The original standalone prototype (design reference)

**`migration-tool.html`** (this folder) — the earlier self-contained HTML
prototype (bespoke CSS, not the design system). Kept as the design-exploration
reference and still published as an Artifact. The React page above superseded it
as the thing to deploy; edits should now go to `app/migrate-demo/page.tsx`.

## Turning this into a real feature (future)

Move it under `(app)` (or keep the standalone route), wire it to the real
team-scoped deck derivation (`lib/sideboardGuides` + `prototype-user-deck-export`),
the replay converter (`prototype-replay-to-swuforge`), and Andy's ingest. See
`../ux-design.md` and `../open-questions.md`.
