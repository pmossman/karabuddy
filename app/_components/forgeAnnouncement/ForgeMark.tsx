import { tokens } from '@/app/_theme/karabuddyTokens';

const f = tokens.forge;

// SWU Forge's logo mark, copied from swu-deck-visualizer static/favicon.svg.
export function ForgeMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0, display: 'block' }}>
      <circle cx="12" cy="12" r="3.5" fill={f.markCore} />
      <path d="M12 2.5C6.75 2.5 2.5 6.75 2.5 12s4.25 9.5 9.5 9.5 9.5-4.25 9.5-9.5S17.25 2.5 12 2.5zm0 17c-4.14 0-7.5-3.36-7.5-7.5S7.86 4.5 12 4.5s7.5 3.36 7.5 7.5-3.36 7.5-7.5 7.5z" fill={f.markRing} />
      <path d="M12 0l-2.2 4.2h4.4L12 0z" fill={f.markBlue} />
      <path d="M12 24l-2.2-4.2h4.4L12 24z" fill={f.markBlue} />
      <path d="M0 12l4.2-2.2v4.4L0 12z" fill={f.markOrange} />
      <path d="M24 12l-4.2-2.2v4.4L24 12z" fill={f.markOrange} />
    </svg>
  );
}
