/**
 * The bridge between an app-owned dialog and the forty-odd places that used to
 * call `Alert.alert` (A66).
 *
 * ## Why a provider and a promise
 *
 * `Alert.alert` is imperative: a handler calls it, hands it callbacks, and
 * carries on. `Popup` and `Sheet` are declarative: a screen holds a `visible`
 * flag and renders the surface itself. Bridging those at the call site means
 * every screen that asks a question grows a `useState`, a second piece of state
 * for whatever the answer applies to, and a block of JSX at the bottom of its
 * tree. Across forty-nine sites that is not a refactor, it is a rewrite of
 * twenty-four screens into overlay hosts — and the noise would land in exactly
 * the screens that are already the busiest.
 *
 * So the surface is mounted once, at the root, and handed out as a promise:
 *
 * ```ts
 * if (await confirm({ title, body, confirmLabel, tone: 'danger' })) remove();
 * ```
 *
 * which is shorter than the `Alert.alert` it replaced, works from an event
 * handler and from a `catch` block alike, and — because the surface lives above
 * the navigation stack — survives the screen that asked being popped. It is the
 * same reasoning that already puts `ToastProvider` at the root, one step
 * further: a question, like a confirmation, can outlive its screen.
 *
 * ## The contract
 *
 * - **Every request settles, exactly once.** A door, a scrim tap, Android's
 *   back gesture, a refusal from a full queue, or the provider going away: all
 *   five resolve. A dialog dismissed without a choice resolves `null`, which
 *   `confirm` reads as no. Nothing here can leave a caller `await`ing forever —
 *   including through a render error, where the boundary swaps the tree out
 *   from under an open dialog and `dispose` settles what it was holding.
 * - **One at a time, the first one wins.** A second question raised while one
 *   is being read waits behind it rather than replacing it — a question that
 *   swapped itself out mid-read is how somebody taps "Delete" meaning "Cancel".
 *   Past `MAX_WAITING_DIALOGS` waiting, the newest is refused and resolved
 *   `DIALOG_UNASKED`, so a failing loop cannot build a wall of dialogs. A
 *   `notify` is exempt: it is a report, not a question, and rationing a report
 *   loses the only word somebody gets. The rules and their tests are in
 *   `lib/dialogQueue`.
 * - **Never asked is not the same as no.** `confirm` reads a refusal as false,
 *   because a question nobody saw is certainly not a yes. A caller that *acts*
 *   on the no — `friends/merge` navigates away when its invite prompt is
 *   declined — must ask through `ask` and check `isUnasked`, or it will move
 *   somebody on the strength of a question they were never shown.
 * - **One question hands over to the next.** Promoting a queued dialog closes
 *   the one on screen first and opens the next after it, rather than swapping
 *   the words inside a surface already under somebody's finger.
 * - **The caller may be gone.** Resolving reaches whoever is awaiting; if that
 *   screen has unmounted, its `await` simply never continues past a `router`
 *   call that no longer matters. This is the same hazard `Alert.alert`'s
 *   callbacks had, and needs the same care at the call site: nothing else.
 *
 * ## What is *not* a dialog
 *
 * A message with one door and nothing to decide is a `Toast`, not this. Taking
 * the screen to say "could not save" and then demanding a tap to give it back
 * is a small tax charged for a failure that was not the person's fault.
 *
 * With one limit, and it is a hard one: **the toast host is an in-tree view and
 * a `Modal` is its own native window**, so a toast raised while a modal is
 * presented is painted underneath it and nobody ever sees it. `Alert.alert` was
 * a native alert and always won; a toast cannot. A failure raised from inside a
 * presented modal — a comment composer, a receipt viewer, the annotator — has
 * to be said *in that modal*, as an inline `Callout`, and those five sites do.
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

import { AppDialog } from '@/components/AppDialog';
import { useStrings } from '@/i18n';
import {
  createDialogHub,
  DIALOG_CANCEL,
  DIALOG_CONFIRM,
  DIALOG_UNASKED,
  EMPTY_DIALOG_QUEUE,
  isConfirmed,
  isUnasked,
  type DialogChoice,
  type DialogHub,
  type DialogQueue,
  type DialogRequest,
  type DialogRow,
  type DialogTone,
} from '@/lib/dialogQueue';

/**
 * How long the screen is left without a dialog between one question and the
 * next, so the first plays its exit and the second plays its entrance.
 *
 * A shade past `Overlay`'s own close (160 ms), because the point is that the
 * surface has fully gone: a promoted dialog that simply swapped its words would
 * arrive with no motion, no announcement, and a finger already over the button
 * — which is the exact swap the queue exists to prevent.
 */
const HANDOFF_MS = 190;

/** A two-door decision. The affirmative label always names what it will do. */
export interface ConfirmOptions {
  readonly title: string;
  readonly body?: string;
  /** Consequences worth showing as a list — see {@link DialogRow}. */
  readonly rows?: readonly DialogRow[];
  /** "and 3 more", when `rows` is a truncated view of something longer. */
  readonly moreRows?: string;
  /** The last word before the doors, drawn as a callout. */
  readonly note?: string;
  /** What the affirmative door says. Never "OK" — name the thing it does. */
  readonly confirmLabel: string;
  /** Defaults to the app's "Cancel". */
  readonly cancelLabel?: string;
  readonly tone?: DialogTone;
}

/** One door and nothing to decide — but more than a sentence's worth to say. */
export interface NotifyOptions {
  readonly title: string;
  readonly body?: string;
  readonly okLabel?: string;
  readonly tone?: DialogTone;
}

export interface ChooseOption {
  readonly id: string;
  readonly label: string;
  /** Marks the one that takes something away, so it is not drawn as a peer. */
  readonly tone?: 'danger';
}

/** More than two ways forward — an action list, drawn as a bottom sheet. */
export interface ChooseOptions {
  readonly title: string;
  readonly body?: string;
  readonly options: readonly ChooseOption[];
  readonly cancelLabel?: string;
}

/**
 * The prefix a caller's option id wears while it is inside the dialog.
 *
 * `choose` maps its cancel door to `null`, so an option whose own id happened
 * to be "cancel" would come back as a dismissal — the caller's branch for it
 * silently never running. Namespacing means a caller can name its options
 * whatever it likes, including the words this file uses for its own doors.
 */
const OPTION_PREFIX = 'option:';

interface DialogValue {
  /**
   * The general form, and the only one that can tell a refusal from an answer.
   * Reach for it when the *no* branch does something a person would notice.
   */
  readonly ask: (request: DialogRequest) => Promise<DialogChoice>;
  readonly confirm: (options: ConfirmOptions) => Promise<boolean>;
  readonly notify: (options: NotifyOptions) => Promise<void>;
  /** The chosen option's id, or null if it was cancelled or dismissed. */
  readonly choose: (options: ChooseOptions) => Promise<string | null>;
}

const DialogContext = createContext<DialogValue | null>(null);

export function DialogProvider({ children }: { children: ReactNode }) {
  const { t } = useStrings();
  const [queue, setQueue] = useState<DialogQueue>(EMPTY_DIALOG_QUEUE);
  // True for the moment between one dialog closing and the next opening. The
  // queue has already promoted; this keeps the surface hidden long enough for
  // the handover to be seen and heard.
  const [handingOver, setHandingOver] = useState(false);
  const handoff = useRef<ReturnType<typeof setTimeout> | null>(null);

  // All of the queue, the promises and the settling rules live in the hub, so
  // they can be tested without a component tree. Built by a lazy initialiser
  // rather than held in a ref: it is created exactly once either way, and a ref
  // read during render is the thing that makes a component miss an update.
  // `setQueue` is stable, so the hub never needs rebuilding.
  const [hub] = useState<DialogHub>(() => createDialogHub(setQueue));

  useEffect(
    () => () => {
      if (handoff.current !== null) clearTimeout(handoff.current);
      // Everything still open resolves as never-asked rather than hanging: a
      // render error, or a Fast Refresh, must not strand a `finally`.
      hub.dispose();
    },
    [hub],
  );

  const ask = useCallback((request: DialogRequest) => hub.ask(request), [hub]);

  /**
   * The one way a dialog ends.
   *
   * Every route out — a button, the scrim, the back gesture — comes through
   * here with the id of the dialog *it was drawn for*, and the hub refuses
   * anything that is not the one on screen. That is what makes a double tap on
   * the scrim, and a close arriving after the surface has moved on, harmless
   * rather than an answer given on behalf of the next question.
   */
  const respond = useCallback(
    (id: number, choice: DialogChoice): void => {
      hub.respond(id, choice);
      if (hub.queue().current === null) return;
      // Something was promoted. Blank the surface for a beat so the answered
      // dialog leaves and the next one arrives, instead of the words changing
      // under a finger that is already down.
      setHandingOver(true);
      if (handoff.current !== null) clearTimeout(handoff.current);
      handoff.current = setTimeout(() => {
        handoff.current = null;
        setHandingOver(false);
      }, HANDOFF_MS);
    },
    [hub],
  );

  const value = useMemo<DialogValue>(() => {
    const confirm = async (options: ConfirmOptions): Promise<boolean> =>
      isConfirmed(
        await ask({
          title: options.title,
          body: options.body,
          rows: options.rows,
          moreRows: options.moreRows,
          note: options.note,
          tone: options.tone,
          actions: [
            {
              id: DIALOG_CONFIRM,
              label: options.confirmLabel,
              tone: options.tone === 'danger' ? 'danger' : 'primary',
            },
            { id: DIALOG_CANCEL, label: options.cancelLabel ?? t.common.cancel, tone: 'quiet' },
          ],
        }),
      );

    const notify = async (options: NotifyOptions): Promise<void> => {
      await ask({
        title: options.title,
        body: options.body,
        tone: options.tone,
        // One door, and it is the way out — so it is drawn quietly. A single
        // filled primary button on a notice reads as a decision being asked
        // for, which is the one thing a notice is not.
        actions: [{ id: DIALOG_CANCEL, label: options.okLabel ?? t.common.ok, tone: 'quiet' }],
        // A report, not a question: never rationed away by the depth cap.
        mustBeSeen: true,
      });
    };

    const choose = async (options: ChooseOptions): Promise<string | null> => {
      const choice = await ask({
        title: options.title,
        body: options.body,
        // Peers, drawn as peers: soft rows of equal weight, the one that takes
        // something away in red on the same soft ground, and the way out with
        // no weight at all. A filled brand button on the top row would make a
        // menu into a recommendation.
        actions: [
          ...options.options.map((option) => ({
            id: `${OPTION_PREFIX}${option.id}`,
            label: option.label,
            tone: option.tone === 'danger' ? ('dangerQuiet' as const) : ('quiet' as const),
          })),
          { id: DIALOG_CANCEL, label: options.cancelLabel ?? t.common.cancel, tone: 'ghost' },
        ],
      });
      // Cancel, a dismissal and a refusal are the same answer to a menu, and a
      // caller checking for one should never have to also check for the others.
      return choice !== null && choice.startsWith(OPTION_PREFIX)
        ? choice.slice(OPTION_PREFIX.length)
        : null;
    };

    return { ask, confirm, notify, choose };
  }, [ask, t.common.cancel, t.common.ok]);

  // `AppDialog` keeps the last request drawn on each of its two surfaces, so
  // nothing here has to remember anything past the answer: handing it the
  // current slot and `visible` is enough for a dialog to play its exit.
  const current = queue.current;

  return (
    <DialogContext.Provider value={value}>
      {children}
      <AppDialog slot={current} visible={current !== null && !handingOver} onChoose={respond} />
    </DialogContext.Provider>
  );
}

/**
 * Ask something, from anywhere under the provider.
 *
 * Outside it — a screen rendered alone in a test, or anything the root
 * `ErrorBoundary` puts up in place of the app — every call answers as though
 * the question was never asked, rather than throwing: a missing dialog host
 * should not be the thing that breaks a screen, and refusing a destructive
 * action is the safe direction to fail in. It is still a bug, so development
 * builds say so out loud; in production a destructive button that quietly does
 * nothing is better than a crash on a screen that is already an error screen.
 */
export function useDialog(): DialogValue {
  const value = useContext(DialogContext);
  if (value === null && __DEV__) {
    console.warn(
      'useDialog() outside DialogProvider: every question will answer as unasked. ' +
        'Mount DialogProvider above this tree, or expect confirm() to be false.',
    );
  }
  return value ?? NO_DIALOG;
}

const NO_DIALOG: DialogValue = {
  ask: () => Promise.resolve(DIALOG_UNASKED),
  confirm: () => Promise.resolve(false),
  notify: () => Promise.resolve(),
  choose: () => Promise.resolve(null),
};

/** Re-exported so a caller can tell a decline from a question never shown. */
export { isUnasked };
