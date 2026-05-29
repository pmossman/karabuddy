'use client';

// B55c: textarea wrapper with `@`-mention autocomplete.
//
// Detection: looks for `@<prefix>` immediately before the cursor (no
// intervening whitespace). When matched, opens a popover below the
// textarea showing matching teams + team members. Keyboard nav: ↓↑
// to select, Enter to confirm, Esc to dismiss. Mouse click selects too.
//
// Selection inserts `@<handle>` or `@team:<slug>` into the text AND
// notifies the parent of the chosen mention (parent maintains the
// structured `{userIds, teamSlugs}` for tag submit).
//
// Caller is responsible for fetching mentionData (from
// /api/me/teams-mention-data) and managing the structured mentions
// alongside the comment text. This component is purely the textarea +
// popover.

import { useEffect, useRef, useState } from 'react';

export interface MentionMember {
  userId: string;
  handle: string; // what to insert after `@`
  displayName: string;
  image: string | null;
  teamSlugs: string[];
}

export interface MentionTeam {
  slug: string;
  name: string;
}

export interface MentionData {
  teams: MentionTeam[];
  members: MentionMember[];
}

type Suggestion =
  | { kind: 'user'; userId: string; handle: string; displayName: string; image: string | null }
  | { kind: 'team'; slug: string; name: string };

const MAX_SUGGESTIONS = 6;

// Build the suggestion list filtered by what the user typed after `@`.
function buildSuggestions(data: MentionData, prefix: string): Suggestion[] {
  const p = prefix.toLowerCase();
  // Teams have a `team:` literal prefix in the mention syntax. If the
  // user has typed `team:`, filter only teams; otherwise show both.
  if (p.startsWith('team:')) {
    const teamPrefix = p.slice('team:'.length);
    return data.teams
      .filter((t) => t.name.toLowerCase().startsWith(teamPrefix) || t.slug.toLowerCase().startsWith(teamPrefix))
      .map((t) => ({ kind: 'team' as const, slug: t.slug, name: t.name }))
      .slice(0, MAX_SUGGESTIONS);
  }
  const members = data.members
    .filter((m) => m.handle.toLowerCase().startsWith(p) || m.displayName.toLowerCase().startsWith(p))
    .map((m) => ({ kind: 'user' as const, userId: m.userId, handle: m.handle, displayName: m.displayName, image: m.image }));
  const teams = data.teams
    .filter((t) => t.name.toLowerCase().startsWith(p) || t.slug.toLowerCase().startsWith(p))
    .map((t) => ({ kind: 'team' as const, slug: t.slug, name: t.name }));
  return [...members, ...teams].slice(0, MAX_SUGGESTIONS);
}

export function MentionInput({
  value,
  onChange,
  onMention,
  mentionData,
  placeholder,
  autoFocus,
  rows = 2,
  onSubmit,
  onCancel,
  textareaStyle,
  textareaProps,
}: {
  value: string;
  onChange: (next: string) => void;
  onMention: (kind: 'user' | 'team', id: string) => void;
  mentionData: MentionData | null;
  placeholder?: string;
  autoFocus?: boolean;
  rows?: number;
  onSubmit?: () => void;
  onCancel?: () => void;
  textareaStyle?: React.CSSProperties;
  textareaProps?: React.TextareaHTMLAttributes<HTMLTextAreaElement>;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [popover, setPopover] = useState<{ prefix: string; suggestions: Suggestion[]; activeIndex: number } | null>(null);

  // Detect `@prefix` immediately before the cursor. Returns prefix string
  // (after the `@`) if the @ has no whitespace between it and the cursor,
  // else null.
  const detectMentionContext = (text: string, cursor: number): string | null => {
    let i = cursor - 1;
    while (i >= 0) {
      const ch = text[i];
      if (ch === '@') {
        // Ensure the @ is at start of string OR preceded by whitespace.
        if (i === 0 || /\s/.test(text[i - 1])) {
          return text.slice(i + 1, cursor);
        }
        return null;
      }
      if (/\s/.test(ch)) return null;
      i--;
    }
    return null;
  };

  const recomputePopover = (text: string, cursor: number) => {
    if (!mentionData) {
      setPopover(null);
      return;
    }
    const ctx = detectMentionContext(text, cursor);
    if (ctx === null) {
      setPopover(null);
      return;
    }
    const suggestions = buildSuggestions(mentionData, ctx);
    if (suggestions.length === 0) {
      setPopover(null);
      return;
    }
    setPopover((prev) => ({
      prefix: ctx,
      suggestions,
      // Preserve activeIndex if still in range; reset to 0 otherwise.
      activeIndex: prev && prev.activeIndex < suggestions.length ? prev.activeIndex : 0,
    }));
  };

  const handleChange: React.ChangeEventHandler<HTMLTextAreaElement> = (e) => {
    onChange(e.target.value);
    recomputePopover(e.target.value, e.target.selectionStart || 0);
  };

  const handleKeyUp: React.KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    // Arrow keys + clicks move the cursor without an onChange — re-detect.
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Click'].includes(e.key)) {
      recomputePopover((e.target as HTMLTextAreaElement).value, (e.target as HTMLTextAreaElement).selectionStart || 0);
    }
  };

  const handleClick: React.MouseEventHandler<HTMLTextAreaElement> = (e) => {
    const ta = e.currentTarget;
    recomputePopover(ta.value, ta.selectionStart || 0);
  };

  const insertSuggestion = (sugg: Suggestion) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const cursor = ta.selectionStart || 0;
    // Find the `@` we're completing.
    let atIndex = -1;
    for (let i = cursor - 1; i >= 0; i--) {
      if (value[i] === '@') {
        atIndex = i;
        break;
      }
      if (/\s/.test(value[i])) break;
    }
    if (atIndex === -1) return;

    const insertText = sugg.kind === 'user' ? `@${sugg.handle} ` : `@team:${sugg.slug} `;
    const next = value.slice(0, atIndex) + insertText + value.slice(cursor);
    onChange(next);
    if (sugg.kind === 'user') onMention('user', sugg.userId);
    else onMention('team', sugg.slug);
    setPopover(null);
    // Restore cursor at end of the inserted text.
    requestAnimationFrame(() => {
      const pos = atIndex + insertText.length;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    });
  };

  const handleKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    if (popover) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setPopover((p) => p && { ...p, activeIndex: (p.activeIndex + 1) % p.suggestions.length });
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setPopover((p) => p && { ...p, activeIndex: (p.activeIndex - 1 + p.suggestions.length) % p.suggestions.length });
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertSuggestion(popover.suggestions[popover.activeIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setPopover(null);
        return;
      }
    }
    // Pass-through for caller's submit/cancel shortcuts.
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      onSubmit?.();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel?.();
    }
  };

  // Close popover on outside click.
  useEffect(() => {
    if (!popover) return;
    const handler = (e: MouseEvent) => {
      const ta = textareaRef.current;
      if (!ta) return;
      if (ta.contains(e.target as Node)) return;
      // Also keep open if click is inside the popover itself.
      const target = e.target as HTMLElement | null;
      if (target && target.closest('[data-mention-popover]')) return;
      setPopover(null);
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [popover]);

  return (
    <div style={{ position: 'relative' }}>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onClick={handleClick}
        placeholder={placeholder}
        rows={rows}
        autoFocus={autoFocus}
        style={textareaStyle}
        {...textareaProps}
      />
      {popover && popover.suggestions.length > 0 && (
        <div
          data-mention-popover=""
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 4,
            background: 'rgba(17, 20, 26, 0.98)',
            border: '1px solid rgba(74, 124, 255, 0.4)',
            borderRadius: 6,
            padding: 4,
            zIndex: 50,
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.5)',
            maxHeight: 240,
            overflowY: 'auto',
          }}
        >
          {popover.suggestions.map((s, i) => (
            <button
              key={s.kind === 'user' ? `u:${s.userId}` : `t:${s.slug}`}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                insertSuggestion(s);
              }}
              onMouseEnter={() => setPopover((p) => p && { ...p, activeIndex: i })}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                padding: '6px 8px',
                background: i === popover.activeIndex ? 'rgba(74, 124, 255, 0.18)' : 'transparent',
                border: 0,
                borderRadius: 4,
                color: '#e6e6e6',
                fontSize: 12,
                fontFamily: 'inherit',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              {s.kind === 'user' ? (
                <>
                  {s.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.image} alt="" style={{ width: 18, height: 18, borderRadius: '50%' }} />
                  ) : (
                    <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#2e333c' }} />
                  )}
                  <span style={{ color: '#5da9ff', fontWeight: 600 }}>@{s.handle}</span>
                  {s.displayName !== s.handle && (
                    <span style={{ color: '#6c7588', fontSize: 11 }}>{s.displayName}</span>
                  )}
                </>
              ) : (
                <>
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 18,
                    height: 18,
                    borderRadius: 4,
                    background: 'rgba(107, 217, 104, 0.15)',
                    color: '#6bd968',
                    fontSize: 9,
                    fontWeight: 700,
                  }}>
                    T
                  </span>
                  <span style={{ color: '#6bd968', fontWeight: 600 }}>@team:{s.slug}</span>
                  <span style={{ color: '#6c7588', fontSize: 11 }}>{s.name}</span>
                </>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// B55c: render a comment string with `@handle` / `@team:slug` substrings
// highlighted as colored chips. Used by tag rows in the viewer. Doesn't
// link to anything (TBD when we have user profiles); the visual lift
// alone makes mentioned-in-this-comment scannable.
export function MentionedComment({ text }: { text: string }) {
  // Token scan: split on whitespace boundaries, transform @-prefixed tokens.
  // Preserve whitespace exactly.
  const parts: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < text.length) {
    if (text[i] === '@' && (i === 0 || /\s/.test(text[i - 1]))) {
      // Consume up to next whitespace or end.
      let j = i + 1;
      while (j < text.length && !/\s/.test(text[j])) j++;
      const token = text.slice(i, j); // includes the @
      const isTeam = token.startsWith('@team:');
      parts.push(
        <span
          key={key++}
          style={{
            color: isTeam ? '#6bd968' : '#5da9ff',
            fontWeight: 600,
            background: isTeam ? 'rgba(107, 217, 104, 0.10)' : 'rgba(74, 124, 255, 0.10)',
            padding: '0 4px',
            borderRadius: 3,
          }}
        >
          {token}
        </span>
      );
      i = j;
    } else {
      // Consume up to next @ (or end).
      let j = i + 1;
      while (j < text.length && text[j] !== '@') j++;
      parts.push(<span key={key++}>{text.slice(i, j)}</span>);
      i = j;
    }
  }
  return <>{parts}</>;
}
