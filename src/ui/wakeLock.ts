/**
 * Keeps the screen from dimming/locking while the app is open, via the Screen Wake
 * Lock API -- without this, a phone left sitting through a scripted maneuver (or just
 * being read off the canal/eye view) blanks mid-way through. Not supported on all
 * browsers (notably iOS Safari before 16.4) -- feature-detected, silently a no-op
 * where unavailable rather than throwing.
 *
 * The OS releases the lock automatically whenever the tab/app is backgrounded (tab
 * switch, screen lock, app switch on mobile) -- this re-acquires it on the next
 * visibilitychange back to visible, since the lock does not resume on its own.
 */
export function keepScreenAwake(): void {
  if (!('wakeLock' in navigator)) return;

  let currentLock: WakeLockSentinel | null = null;

  async function acquire(): Promise<void> {
    if (document.visibilityState !== 'visible') return;
    try {
      currentLock = await navigator.wakeLock.request('screen');
      currentLock.addEventListener('release', () => {
        currentLock = null;
      });
    } catch {
      // Common non-error cases (low battery, permissions policy, no active tab focus
      // yet) -- nothing actionable for the user, just leave the screen able to dim.
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && currentLock === null) {
      void acquire();
    }
  });

  void acquire();
}
