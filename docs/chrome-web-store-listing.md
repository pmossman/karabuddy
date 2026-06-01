# Chrome Web Store listing — paste-ready copy

Paste-ready text for the Chrome Web Store developer dashboard listing of the KaraBuddy extension. Field labels match the Chrome Web Store developer console (as of 2026).

---

## Item summary

**Name**
```
KaraBuddy
```

**Short description** (≤132 chars; this is the line shown in store search results)
```
Records your karabast.net Star Wars Unlimited matches automatically. Tag key moments mid-game. Review replays on karabuddy.app.
```

**Category**
```
Productivity
```
(Productivity reviews faster than Games for content-script-heavy extensions that hook a third-party domain.)

**Language**
```
English (United States)
```

---

## Detailed description

```
KaraBuddy captures every Star Wars Unlimited match you play on karabast.net, lets you drop tags on key moments while you're playing, and uploads finished replays to karabuddy.app for review and sharing.

Designed to stay out of your way during a match and be useful afterward.

— What it does —

• Background recording. Every karabast.net match is captured automatically — no buttons to remember. A small floating launcher on the page shows when capture is live with a pulsing REC indicator and event count.

• Mid-match tagging. Click the floating launcher to expand it into a tag panel. Drop a labeled bookmark on the current frame with an optional note. Comes in handy for "I want to remember this hand" or "review this play later".

• Auto-upload. When a match ends the replay is uploaded to karabuddy.app. Long matches also push periodic snapshots in case the tab is closed mid-game — your recording survives.

• Floating, draggable. The launcher button is small, sits in the corner, and stays out of the way. Drag it anywhere on the page. It expands in place into a small panel when clicked; collapses on outside click.

• Single-click toolbar. Click the KaraBuddy icon in your toolbar to open your replay library on karabuddy.app.

— Why karabuddy.app? —

karabuddy.app is the companion site this extension uploads to. Free to use; sign-in is optional. The webapp handles replay browsing, frame-by-frame playback, tag editing, sharing replays with a link, and (eventually) public replay search. Visit karabuddy.app/install for the install walkthrough and karabuddy.app/privacy for the privacy policy.

— Privacy —

KaraBuddy only records and uploads matches you play on karabast.net. It never reads your karabast account credentials, never reads other tabs, and never embeds analytics or tracking scripts. Each install generates an opaque random identifier so uploads can be attributed to you without requiring sign-in. See karabuddy.app/privacy for the full data-collection breakdown.

— Fan project —

KaraBuddy is unaffiliated with karabast.net, Fantasy Flight Games, Asmodee, and Lucasfilm. Star Wars: Unlimited is © Fantasy Flight Games / Asmodee. We're fans building tools for fellow players.

— Source —

Open source at github.com/pmossman/karabuddy. Issues and contributions welcome.
```

---

## Single-purpose statement

(Required field in the developer dashboard. Chrome Web Store enforces a single-purpose policy.)

```
Record and tag Star Wars Unlimited matches played on karabast.net so the player can review them on karabuddy.app.
```

---

## Permissions justifications

(Required for each declared permission and host_permission. One-paragraph "why we need this" each.)

### `storage`
```
The extension stores three small values in chrome.storage.local: an opaque install token (an unguessable random ID generated once per install, used to attribute uploaded replays to this browser), the floating launcher's user-dragged position (so it stays where you put it across sessions), and a small in-progress recording snapshot (so a mid-match page refresh doesn't lose the partial recording before upload). No browsing history, no cross-site data, no third-party data.
```

### `tabs`
```
Used to open karabuddy.app routes in new browser tabs when the user clicks the KaraBuddy toolbar icon (opens their replay library) or a link in the extension's floating panel ("Open this replay on karabuddy" after a match uploads, or links into the replay library when no match is active). The extension also reuses an existing karabuddy.app tab via chrome.tabs.query+update instead of stacking duplicates. We do not read tab URLs or titles beyond the karabuddy.app domain itself.
```

### Host permission: `https://karabast.net/*`
```
The extension's primary job is recording Star Wars Unlimited matches that the user plays on karabast.net. To do this it intercepts the karabast.net WebSocket frames (game state updates) via a content script that runs in the page world. It also injects a small floating launcher UI onto karabast.net pages so the user has a tag-this-moment affordance during a match. Without this host permission the extension cannot fulfill its single purpose.
```

### Host permission: `https://karabuddy.app/*` and `https://*.karabuddy.app/*`
```
A small bridge content script (karabuddy-bridge.js, ~30 lines) runs on karabuddy.app to support the "claim your extension" flow: when the user is signed in on karabuddy.app and visits the /claim page, the page asks the bridge for this install's token via window.postMessage. The bridge replies, and the page links the extension's anonymous uploads to the user's account. The bridge only responds to messages from the same origin (karabuddy.app pages), and only ever returns the install token — no other data is exposed.
```

---

## Privacy practices disclosures

(Chrome Web Store now requires checkbox disclosures for what data your extension handles.)

**Personally identifiable information** — ☐ does not collect  
*(Install token is an opaque random ID, not PII. Sign-in is optional and happens on karabuddy.app, not in the extension.)*

**Health information** — ☐ does not collect

**Financial and payment information** — ☐ does not collect

**Authentication information** — ☐ does not collect  
*(The extension never reads karabast.net or any other site's credentials or session cookies. Sign-in to karabuddy.app is browser-session-based and not seen by the extension.)*

**Personal communications** — ☑ collects, in the sense that match-time chat messages between players on karabast.net are part of the recorded WebSocket frame history and are uploaded as part of the replay payload. Disclosed in our privacy policy.

**Location** — ☐ does not collect

**Web history** — ☐ does not collect

**User activity** — ☑ collects, in the sense that the game-action sequence of a Star Wars Unlimited match (cards played, attacks made, etc.) is part of the recorded replay payload. Disclosed in our privacy policy.

**Website content** — ☑ collects, in the sense that karabast.net match data is recorded and uploaded. Limited to karabast.net match WebSocket frames; no other sites' content is read.

**Certification** statements:
- ☑ I do not sell or transfer user data to third parties, outside of the approved use cases
- ☑ I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- ☑ I do not use or transfer user data to determine creditworthiness or for lending purposes

---

## Privacy policy URL

```
https://karabuddy.app/privacy
```

---

## Homepage URL

```
https://karabuddy.app
```

---

## Support URL / email

```
swutrade@gmail.com
```

(Or any GitHub issues URL once we have one.)

---

## Listing assets checklist

Store icon + promo tiles are generated by `scripts/generate-icons.sh` (headless
Chrome renders `extension/icons/source.html` + `promo-source.html`):

- ☑ Store icon — 128×128 PNG (`assets/store/store-icon-128.png`) — **required**
- ☐ Small promo tile — 440×280 PNG (`assets/store/promo-440x280.png`) — optional (run generate-icons.sh)
- ☐ Large promo tile — 920×680 PNG (`assets/store/promo-920x680.png`) — optional
- ☐ Marquee promo tile — 1400×560 PNG (`assets/store/promo-1400x560.png`) — optional (featured placement only)

Screenshots are captured by hand against the live app via agent-browser at the
CWS size (there is no generator script):

- ☑ Screenshots — at least 1, up to 5; 1280×800 each (`assets/store/screenshot-*.png`)

Verify all of the above (+ the permission justifications, against the packaged
manifest) with `node .claude/skills/publish-extension/validate-release.mjs`
after `npm run package:extension`.

---

## Pre-submission checklist

- ☐ Chrome Web Store developer account created ($5 one-time fee + identity verification at https://chrome.google.com/webstore/devconsole)
- ☐ Privacy policy live at https://karabuddy.app/privacy ← **shipped, verify after deploy**
- ☐ Single-purpose statement pasted above ← **drafted, paste at submission**
- ☐ Permission justifications pasted per-permission ← **drafted, paste at submission**
- ☐ Promo tile + screenshots uploaded ← **assets generated, upload at submission**
- ☐ Detailed description pasted ← **drafted**
- ☐ Distribution: Public (or Unlisted while we burn-in)
- ☐ Visibility: All regions, or US-only first

After clicking Submit, Chrome's review window is typically 1-3 business days for first submission. Subsequent versions are typically hours.
