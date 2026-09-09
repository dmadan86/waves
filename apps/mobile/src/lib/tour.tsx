/**
 * The product tour — a few coach-marks over the Home screen, shown once.
 *
 * A dimmed scrim drops over the app with a bright hole punched around the one
 * thing each step is about (the balance deck, the add buttons), and a small
 * card explains it: a numbered step, Next/Done, and an X to leave early. It runs
 * the first time somebody lands on Home with something to see, and can be
 * replayed from the Home overflow menu.
 *
 * How the spotlight finds its target: any element wrapped in `TourTarget`
 * measures itself in window coordinates and registers that rectangle under an
 * id. The overlay reads the rectangle for the current step's anchor and lays
 * the hole and the card out against it. A step with no anchor (or one whose
 * target has not measured yet) is shown centred, as a plain card.
 *
 * State lives here so the overlay, the Home autostart and the replay item all
 * read the same thing; the "seen" flag is the only thing that persists, and it
 * persists per account rather than per handset (see `lib/onboardingSeen`).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { View, type ViewStyle } from 'react-native';

import type { UiStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { rememberTourSeen, tourSeen } from '@/lib/onboardingSeen';

/** A measured target, in window (screen) coordinates. */
export interface TourRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A step's copy and what it points at. `anchor` is a `TourTarget` id; leave it
 * out for a centred card (the intro and the sign-off). The strings are resolved
 * from `t.tour` at render, so the step list stays language-agnostic.
 */
export interface TourStep {
  key: string;
  anchor?: string;
  title: (t: UiStrings) => string;
  body: (t: UiStrings) => string;
}

export const TOUR_STEPS: readonly TourStep[] = [
  {
    key: 'intro',
    title: (t) => t.tour.introTitle,
    body: (t) => t.tour.introBody,
  },
  {
    key: 'balance',
    anchor: 'hero',
    title: (t) => t.tour.balanceTitle,
    body: (t) => t.tour.balanceBody,
  },
  {
    key: 'group',
    anchor: 'addGroup',
    title: (t) => t.tour.groupTitle,
    body: (t) => t.tour.groupBody,
  },
  {
    key: 'expense',
    anchor: 'addExpense',
    title: (t) => t.tour.expenseTitle,
    body: (t) => t.tour.expenseBody,
  },
  {
    key: 'done',
    title: (t) => t.tour.doneTitle,
    body: (t) => t.tour.doneBody,
  },
];

interface TourValue {
  active: boolean;
  step: number;
  total: number;
  /** Register (or clear, with `null`) a measured target under an id. */
  register: (id: string, rect: TourRect | null) => void;
  rectFor: (id: string | undefined) => TourRect | undefined;
  start: () => void;
  next: () => void;
  /** Step back one; a no-op on the first step. */
  prev: () => void;
  /** Finish or dismiss — both remember the tour as seen. */
  finish: () => void;
  /** True until the stored "seen" flag has been read, so autostart can wait. */
  ready: boolean;
  seen: boolean;
}

const TourContext = createContext<TourValue | null>(null);

export function TourProvider({ children }: { children: ReactNode }) {
  // Whose coach-marks these are. The "seen" flag used to be one device-wide key,
  // so the first person to finish the tour on a handset silently cancelled it
  // for every account that signed in there afterwards — the same bug the intro
  // cards had, one line further on (`lib/onboardingSeen` tells the whole story).
  const { session } = useAuth();
  const ownerId = session?.user.id ?? null;
  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);
  // Bumped when a target re-measures while the tour is up, so the overlay
  // re-renders and reads the fresh rectangle (see `register`). Carried in the
  // value's deps so the context identity changes and consumers re-render.
  const [tick, setTick] = useState(0);
  // Rectangles change on scroll and layout, not just on step — a ref keeps them
  // out of render so a measure does not re-run the whole tree.
  const rects = useRef<Map<string, TourRect>>(new Map());
  // A mirror of `active` readable inside the stable `register` callback without
  // making it depend on (and change with) the active flag.
  const activeRef = useRef(false);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  // The answer is held *with the account it is about*, the way the profile is,
  // rather than as a bare boolean an account change has to reset: an answer left
  // behind by whoever was signed in before must not start (or suppress) this
  // person's tour, and clearing it from the effect body is a cascading render.
  // So `ready` and `seen` are derived, and a sign-in stands them back down until
  // storage has answered for the new account.
  const [answer, setAnswer] = useState<{ owner: string; seen: boolean } | null>(null);
  useEffect(() => {
    if (!ownerId) return;
    let live = true;
    // Never rejects; a phone that cannot answer reports "not seen", so the worst
    // case is a dismissable overlay rather than a tour nobody can ever get.
    void tourSeen(ownerId).then((value) => {
      if (live) setAnswer({ owner: ownerId, seen: value });
    });
    return () => {
      live = false;
    };
  }, [ownerId]);
  const current = answer && answer.owner === ownerId ? answer : null;
  const ready = current !== null;
  const seen = current?.seen ?? false;

  const register = useCallback((id: string, rect: TourRect | null) => {
    if (rect) rects.current.set(id, rect);
    else rects.current.delete(id);
    // While the tour is up, a re-measure must reach the overlay — the hero
    // swapping in for its skeleton reflows the buttons below it, and their old
    // rectangles would otherwise spotlight the wrong patch of screen.
    if (activeRef.current) setTick((v) => v + 1);
  }, []);

  const rectFor = useCallback(
    (id: string | undefined) => (id ? rects.current.get(id) : undefined),
    [],
  );

  const start = useCallback(() => {
    setStep(0);
    setActive(true);
  }, []);

  const remember = useCallback(() => {
    // Signed out there is nobody to remember it for — and nobody can be looking
    // at the tour either, since Home is behind the door.
    if (!ownerId) return;
    setAnswer({ owner: ownerId, seen: true });
    void rememberTourSeen(ownerId);
  }, [ownerId]);

  const finish = useCallback(() => {
    setActive(false);
    remember();
  }, [remember]);

  const next = useCallback(() => {
    // Decide the terminal step before touching state so the setStep updater
    // stays pure — no setActive/remember side effects inside it, which React
    // may run more than once.
    if (step >= TOUR_STEPS.length - 1) {
      setActive(false);
      remember();
      return;
    }
    setStep((current) => Math.min(current + 1, TOUR_STEPS.length - 1));
  }, [step, remember]);

  const prev = useCallback(() => setStep((current) => Math.max(0, current - 1)), []);

  const value = useMemo<TourValue>(
    () => ({
      active,
      step,
      total: TOUR_STEPS.length,
      register,
      rectFor,
      start,
      next,
      prev,
      finish,
      ready,
      seen,
    }),
    // `tick` is deliberately here though the body does not read it: bumping it
    // is how a re-measure changes the value identity and re-renders the overlay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, step, register, rectFor, start, next, prev, finish, ready, seen, tick],
  );

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
}

export function useTour(): TourValue {
  const value = useContext(TourContext);
  if (!value) throw new Error('useTour must be used inside TourProvider');
  return value;
}

/**
 * Wraps a target so the tour can point at it. Measures itself in window
 * coordinates on layout and registers the rectangle under `id`; clears it on
 * unmount so a stale rectangle never spotlights an empty patch of screen.
 */
export function TourTarget({
  id,
  children,
  style,
}: {
  id: string;
  children: ReactNode;
  style?: ViewStyle;
}) {
  const { register } = useTour();
  const ref = useRef<View>(null);

  const measure = useCallback(() => {
    ref.current?.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) register(id, { x, y, width, height });
    });
  }, [id, register]);

  useEffect(() => {
    return () => register(id, null);
  }, [id, register]);

  return (
    <View ref={ref} collapsable={false} onLayout={measure} style={style}>
      {children}
    </View>
  );
}
