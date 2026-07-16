# Migration prototype — files & how it's deployed

Interactive click-through demo of the karabuddy → SWU Forge team migration
(faked data, no backend). Aesthetic transitions from karabuddy to a merged
SWU Forge look as you advance the wizard.

## Two copies (keep in sync)

- **`migration-tool.html`** (this folder) — the **source**. An Artifact-style
  fragment (`<title>` + `<style>` + markup + `<script>`, no `<html>`/`<head>`).
  Edit here. Also published as an Artifact.
- **`public/demos/swuforge-migration.html`** (repo root) — the **deployed copy**,
  a full standalone HTML document. Served statically and embedded full-screen by
  the route `app/migrate-demo/page.tsx` at **`/migrate-demo`**.

The route lives OUTSIDE the `(app)` group so it doesn't get the sidebar app shell
(the wizard has its own chrome). It's `noindex`, public, faked — a demo to gather
feedback, not a real feature.

## Regenerate the deployed copy after editing the source

```sh
node -e '
const fs=require("fs");
const src=fs.readFileSync("docs/swuforge-migration/prototype/migration-tool.html","utf8");
const i=src.indexOf("<div class=\"app\">");
const doc=`<!doctype html>\n<html lang="en" style="background:#0a0c10">\n<head>\n`
 +`<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n`
 +`<meta name="robots" content="noindex">\n`+src.slice(0,i).trim()+`\n</head>\n<body>\n`
 +src.slice(i).trim()+`\n</body>\n</html>`;
fs.mkdirSync("public/demos",{recursive:true});
fs.writeFileSync("public/demos/swuforge-migration.html",doc);
console.log("regenerated public/demos/swuforge-migration.html");
'
```

## Turning this into a real feature (future)

For a shipped feature this would be ported to a React/TSX page under `(app)`
(idiomatic, wired to real derivation + Andy's ingest). The embed is deliberate for
the demo phase — it keeps the deployed page byte-identical to the reviewed
prototype with zero port risk. See `../ux-design.md`.
