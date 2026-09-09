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
 *   back gesture, or a refusal from a full queue: all four resolve. A dialog
 *   dismissed without a choice resolves `null`, which `confirm` reads as no.
 *   Nothing here can leave a caller `await`ing forever.
 * - **One at a time, the first one wins.** A second question raised while one
 *   is being read waits behind it rather than replacing it — a question that
 *   swapped itself out mid-read is how somebody taps "Delete" meaning "Cancel".
 *   Past `MAX_WAITING_DIALOGS` waiting, the newest is refused and resolved as a
 *   dismissal, so a failing loop cannot build a wall of dialogs. The rules and
 *   their tests are in `lib/dialogQueue`.
 * - **The caller may be gone.** Resolving reaches whoever is awaiting; if that
 *   screen has unmounted, its `await` simply never continues past a `router`
 *   call that no longer matters. This is the same hazard `Alert.alert`'s
 *   callbacks had, and needs the same care at the call site: nothing else.
 *
 * ## What is *not* a dialog
 *
 * A message with one door and nothing to decide is a `Toast`, not this. Taking
 * the screen to say "could not save" and then demanding a tap to give it back
 * is a small tax charged for a failure that was not the person's fault. The
 * error one-liners that used to be `Alert.alert(message)` now go through
 * `useToast`; what stayed here are the notices that explain why something was
 * refused, and those carry a title and a body.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { AppDialog } from '@/components/AppDialog';
import { useStrings } from '@/i18n';
import {
  closeDialog,
  DIALOG_CANCEL,
  DIALOG_CONFIRM,
  EMPTY_DIALOG_QUEUE,
  isConfirmed,
  openDialog,
  type DialogChoice,
  type DialogQueue,
  type DialogRequest,
  type DialogRow,
  type DialogSlot,
  type DialogTone,
} from '@/lib/dialogQueue';

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

interface DialogValue {
  /** The general form. `confirm`/`notify`/`choose` are the shapes worth naming. */
  readonly ask: (request: DialogRequest) => Promise<DialogChoice>;
  readonly confirm: (options: ConfirmOptions) => Promise<boolean>;
  readonly notify: (options: NotifyOptions) => Promise<void>;
  /** The chosen option's id, or null if it was dismissed. */
  readonly choose: (options: ChooseOptions) => Promise<string | null>;
}

const DialogContext = createContext<DialogValue | null>(null);

export function DialogProvider({ children }: { children: ReactNode }) {
  const { t } = useStrings();
  const [queue, setQueue] = useState<DialogQueue>(EMPTY_DIALOG_QUEUE);

  // The queue is kept in a ref as well as in state because `ask` has to read
  // the *current* queue and decide synchronously whether the request was
  // refused — a decision that has to be made before `ask` returns, and cannot
  // be made inside a `setState` updater, which React is free to run later (and,
  // in strict mode, twice). The ref is the value; the state exists to render.
  // They are only ever written together, one line apart.
  const queueRef = useRef<DialogQueue>(EMPTY_DIALOG_QUEUE);
  const nextId = useRef(1);
  // Who is waiting on which request. Keyed by id rather than held on the slot
  // so nothing that renders can reach a resolver and call it twice.
  const waiting = useRef(new Map<number, (choice: DialogChoice) => void>());

  const ask = useCallback(
    (request: DialogRequest): Promise<DialogChoice> =>
      new Promise<DialogChoice>((resolve) => {
        const slot: DialogSlot = { id: nextId.current, request };
        nextId.current += 1;

        const step = openDialog(queueRef.current, slot);
        // A refused request is never drawn, so it is settled here and now.
        // Somebody who was never shown a question has, in effect, dismissed it.
        if (step.refused) {
          resolve(null);
          return;
        }
        waiting.current.set(slot.id, resolve);
        queueRef.current = step.queue;
        setQueue(step.queue);
      }),
    [],
  );

  /**
   * The one way a dialog ends.
   *
   * Every route out — a button, the scrim, the back gesture — comes through
   * here with the id of the dialog it belongs to, and `closeDialog` refuses
   * anything that is not the one on screen. That is what makes a double tap and
   * a late close harmless rather than a promise resolved twice.
   */
  const respond = useCallback((id: number, choice: DialogChoice): void => {
    const step = closeDialog(queueRef.current, id);
    if (step.closed === null) return;
    queueRef.current = step.queue;
    setQueue(step.queue);
    const resolve = waiting.current.get(id);
    waiting.current.delete(id);
    resolve?.(choice);
  }, []);

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
        actions: [{ id: DIALOG_CONFIRM, label: options.okLabel ?? t.common.ok, tone: 'quiet' }],
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
            id: option.id,
            label: option.label,
            tone: option.tone === 'danger' ? ('dangerQuiet' as const) : ('quiet' as const),
          })),
          { id: DIALOG_CANCEL, label: options.cancelLabel ?? t.common.cancel, tone: 'ghost' },
        ],
      });
      // Cancel and a dismissal are the same answer, and a caller checking for
      // one should never have to also check for the other.
      return choice === DIALOG_CANCEL ? null : choice;
    };

    return { ask, confirm, notify, choose };
  }, [ask, t.common.cancel, t.common.ok]);

  // `AppDialog` keeps the last request drawn on each of its two surfaces, so
  // nothing here has to remember anything past the answer: handing it the
  // current one and `visible` is enough for a dialog to play its exit.
  const current = queue.current;

  return (
    <DialogContext.Provider value={value}>
      {children}
      <AppDialog
        request={current?.request ?? null}
        visible={current !== null}
        onChoose={(choice) => {
          if (current !== null) respond(current.id, choice);
        }}
      />
    </DialogContext.Provider>
  );
}

/**
 * Ask something, from anywhere under the provider.
 *
 * Outside it — a screen rendered alone in a test — every call resolves as a
 * dismissal rather than throwing, because a missing dialog host should never be
 * the thing that breaks a screen. It does mean a confirmation outside the
 * provider is a "no", which is the safe direction for a question whose whole
 * purpose is guarding something irreversible.
 */
export function useDialog(): DialogValue {
  return useContext(DialogContext) ?? NO_DIALOG;
}

const NO_DIALOG: DialogValue = {
  ask: () => Promise.resolve(null),
  confirm: () => Promise.resolve(false),
  notify: () => Promise.resolve(),
  choose: () => Promise.resolve(null),
};
