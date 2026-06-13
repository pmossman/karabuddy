// B138: ONE source of truth for replay/clip playback choreography timing.
//
// Two consumers must agree or animations get clipped:
//   - FrameAnimator  — RUNS the card-movement animations (fixed ms durations,
//     not scaled by playback speed; they always play at their natural pace).
//   - computeFrameDwells (frameDwell.ts) — decides how long autoplay / a clip
//     reel SITS on each frame before advancing.
//
// If a frame's dwell is shorter than the animation it triggers, the animation
// gets cut off (this is exactly what happened: a unit play animates 700ms but
// its hand-tuned dwell was 720ms — 20ms of slack, so any jitter clipped it).
// Deriving the dwell as `animation total + READ_BUFFER_MS` from the SAME
// constants the animator uses guarantees the frame always outlasts its
// animation at 1× — identically for replays and clips.

// A plain step with no choreography, and the scrub threshold (faster than this
// between frames = the user is flying through, so we snap instead of animate).
export const PLAYBACK_TICK_MS = 300;
export const RAPID_STEP_MS = 110;

// Raw animation durations (ms) — owned here, imported by the FrameAnimator.
export const DURATION = 300;        // generic FLIP move (enter / reposition)
export const LUNGE_MS = 440;        // attacker lunge
export const TRACER_MS = 300;       // attack tracer streak
export const PLAY_MOVE_MS = 420;    // a card flying out of hand to the board
export const PLAY_FLIP_MS = 280;    // …then flipping face-up on arrival
export const EVENT_TOTAL_MS = 1500; // event: fly out → present → discard
export const EVENT_FLIP_MS = 260;
export const EVENT_FLIP_DELAY = 130;
export const UPGRADE_TOTAL_MS = 1350; // upgrade: present above unit → tuck under
export const RESOURCE_RISE_MS = 340;
export const RESOURCE_HOLD_MS = 425;  // the face-up read pause
export const RESOURCE_DROP_MS = 520;
export const RESOURCE_TOTAL_MS = RESOURCE_RISE_MS + RESOURCE_HOLD_MS + RESOURCE_DROP_MS; // 1285
export const LEADER_DEPLOY_RISE_MS = 400;
export const LEADER_DEPLOY_HOLD_MS = 450;
export const LEADER_DEPLOY_DESCEND_MS = 480;
export const LEADER_DEPLOY_TOTAL = LEADER_DEPLOY_RISE_MS + LEADER_DEPLOY_HOLD_MS + LEADER_DEPLOY_DESCEND_MS; // 1330
export const VIGNETTE_LINGER_MS = 380; // deploy spotlight tail past the landing

// Full end-to-end durations of each choreography (incl. trailing flourishes) —
// what the dwell must cover.
export const UNIT_PLAY_TOTAL_MS = PLAY_MOVE_MS + PLAY_FLIP_MS;                  // 700
export const ATTACK_TOTAL_MS = TRACER_MS + LUNGE_MS;                            // 740
export const AMBUSH_TOTAL_MS = UNIT_PLAY_TOTAL_MS + LUNGE_MS;                   // 1140 (play, then lunge)
export const LEADER_DEPLOY_FULL_MS = LEADER_DEPLOY_TOTAL + VIGNETTE_LINGER_MS;  // 1710

// A reading pause held after each animated beat finishes, before autoplay moves
// on — so a beat lands and registers instead of advancing the instant it ends.
export const READ_BUFFER_MS = 260;

// The dwell for an animated beat = its animation length + the read pause.
export const dwellFor = (animationTotalMs: number): number => animationTotalMs + READ_BUFFER_MS;
