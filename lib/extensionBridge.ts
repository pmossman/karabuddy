// Browser-side helper to ask the KaraBuddy extension (if installed) for
// its install token via window.postMessage. The content script at
// karabast-extension/karabuddy-bridge.js listens for requests and replies.
//
// Returns the token on success, or null if the extension isn't installed
// / didn't respond within `timeoutMs`.
export function requestInstallTokenFromExtension(timeoutMs = 1500): Promise<string | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const requestId = Math.random().toString(36).slice(2);
    let done = false;
    const finish = (value: string | null) => {
      if (done) return;
      done = true;
      window.removeEventListener('message', handler);
      clearTimeout(timer);
      resolve(value);
    };
    const handler = (e: MessageEvent) => {
      if (e.source !== window) return;
      const data = e.data;
      if (!data || data.type !== 'karabuddy:installTokenResponse') return;
      if (data.requestId !== requestId) return;
      finish(typeof data.token === 'string' ? data.token : null);
    };
    window.addEventListener('message', handler);
    const timer = setTimeout(() => finish(null), timeoutMs);
    window.postMessage({ type: 'karabuddy:requestInstallToken', requestId }, window.location.origin);
  });
}
