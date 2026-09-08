/**
 * The app's one transient confirmation — "saved", said once, wherever you land.
 *
 * It lives at the root rather than on a screen because of what it is for: the
 * kind of message that becomes true exactly as the screen that would have shown
 * it goes away. Save a spoken expense and the voice screen is finished; the
 * confirmation has to be waiting on the dashboard, and only something mounted
 * above the navigation stack can be.
 *
 * Deliberately small. There is one message at a time and the newest wins —
 * queueing confirmations would mean somebody reading "saved" about something
 * they did two screens ago. Anything that needs a decision is not this: it is a
 * Callout on the screen that owns it, or a sheet.
 *
 * The bar it must clear is not fixed, so the host asks the same rules the bar
 * itself follows (`resolveTabBar`) which of the two clearances applies.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useSegments } from 'expo-router';

import { Toast, useScreenClearance, useTabBarClearance } from '@waves/ui';

import { useAuth } from '@/lib/auth';
import { useReducedMotion } from '@/lib/reducedMotion';
import { resolveTabBar } from '@/lib/tabBar';

interface ToastValue {
  /** Show a line briefly over whatever is on screen. The newest one wins. */
  show: (message: string) => void;
}

const ToastContext = createContext<ToastValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  // The message and a serial number: showing the same words twice in a row is a
  // real thing to want ("1 expense saved", again), and without the number the
  // second one would not restart the timer.
  const [current, setCurrent] = useState<{ seq: number; message: string } | null>(null);

  const show = useCallback((message: string): void => {
    setCurrent((previous) => ({ seq: (previous?.seq ?? 0) + 1, message }));
  }, []);

  const value = useMemo<ToastValue>(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastHost current={current} onDone={() => setCurrent(null)} />
    </ToastContext.Provider>
  );
}

/**
 * Say something briefly.
 *
 * Safe to call from anywhere under the provider; outside it (a test rendering
 * one screen on its own) it is a no-op rather than a crash, because a missing
 * confirmation should never be the thing that breaks a screen.
 */
export function useToast(): ToastValue {
  const value = useContext(ToastContext);
  return value ?? NO_TOAST;
}

const NO_TOAST: ToastValue = { show: () => {} };

function ToastHost({
  current,
  onDone,
}: {
  current: { seq: number; message: string } | null;
  onDone: () => void;
}) {
  const segments = useSegments() as readonly string[];
  const { session } = useAuth();
  const reduceMotion = useReducedMotion();
  // Both are hooks, so both are asked; which one is right depends on whether the
  // bottom bar is over this screen — the same question `AppTabBar` asks.
  const overBar = useTabBarClearance();
  const overScreen = useScreenClearance();
  const { hidden } = resolveTabBar(segments, !session);

  return (
    <Toast
      // The key restarts the entrance and the timer for a repeated message.
      key={current?.seq ?? 0}
      message={current?.message ?? ''}
      visible={current !== null}
      onDone={onDone}
      bottom={hidden ? overScreen : overBar}
      animated={!reduceMotion}
    />
  );
}
