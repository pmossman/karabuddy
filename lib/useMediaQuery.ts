import { useEffect, useState } from 'react';

// SSR-safe matchMedia subscription. Returns false during server render and
// the first client tick to avoid hydration mismatch; flips to the real value
// in a layout-effect-equivalent useEffect on mount.
//
// Single argument is a CSS media query string, e.g. '(max-width: 767px)'.
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    update();
    // Safari < 14 doesn't have addEventListener on MediaQueryList; fall back.
    if (mql.addEventListener) {
      mql.addEventListener('change', update);
      return () => mql.removeEventListener('change', update);
    } else {
      mql.addListener(update);
      return () => mql.removeListener(update);
    }
  }, [query]);
  return matches;
}
