/**
 * The app's own dialog — the surface that replaced `Alert.alert` everywhere
 * (A66).
 *
 * The native alert was a different application's window borrowed for a moment:
 * a grey slab with square corners and two identical teal capitals, sitting over
 * a screen of rounded cards, brand purple and tinted danger rows. It also could
 * not be told anything but strings, which is how the delete-group warning came
 * to render four real debts — names and rupee amounts — as one undifferentiated
 * paragraph. Money in a list should look like money in a list.
 *
 * So this is built out of the parts every other surface in the app is built
 * out of: `Sheet` and `Popup` for the motion, `Button` for the doors, `Callout`
 * for the last word, `MoneyText` for the amounts. It renders what
 * {@link DialogRequest} describes and calls back with the door that was taken;
 * every decision about *which* surface, and about what happens when two
 * questions arrive at once, is in `lib/dialogQueue` where it can be tested.
 *
 * Three shape rules, each taken from what the reference apps do:
 *
 * 1. **Weight follows consequence.** The irreversible door is the filled red
 *    button and it comes first; the way out is the soft full-width one under
 *    the thumb. Nextdoor's "Delete post?", Peerspace's "Delete this board",
 *    Instacart's "Remove a member" and Lyft's "delete this family" all draw it
 *    this way, and it is the hierarchy PR #747 already set for sign-out. The
 *    native alert's two same-coloured capitals are what this exists to stop.
 * 2. **The door says what it does.** "Delete family", "Remove goal", "Yes,
 *    delete this board" — never "OK". A screen reader hears the verb and its
 *    object, which is the whole warning for somebody who cannot see the title.
 * 3. **Consequences are shown, not summarised.** Cash App's "Remove goal"
 *    lists what happens as rows; Acorns' "Close your Invest account" lists the
 *    balances with their amounts aligned. A request carrying `rows` gets the
 *    same treatment, with the amounts drawn by `MoneyText` so they keep their
 *    colour and their spoken label.
 *
 * This lives in the app rather than in `@waves/ui` because it needs the app's
 * words: the default cancel label, the scrim's close label, and the plural
 * "and 3 more" all come from `useStrings`, and a design-system component that
 * took eleven strings as props would push that decision back out to the
 * forty-odd call sites this exists to shorten. The primitives it is made of are
 * all still in the design system.
 */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ScrollView, useWindowDimensions, View } from 'react-native';

import {
  Button,
  Callout,
  iconSize,
  MoneyText,
  Popup,
  Row,
  Sheet,
  Text,
  useTheme,
  type ButtonVariant,
} from '@waves/ui';

import { useStrings } from '@/i18n';
import {
  DIALOG_CANCEL,
  presentationFor,
  type DialogAction,
  type DialogChoice,
  type DialogPresentation,
  type DialogRequest,
} from '@/lib/dialogQueue';

/**
 * How much of the window the scrolling middle may take.
 *
 * Points, never a percentage. A percentage `maxHeight` resolves against a
 * parent with no height of its own inside these surfaces and silently does
 * nothing — the bug PR #747 hit, where the sign-out sheet promised a list and
 * drew it off the bottom edge. The sheet gets more room than the centred card
 * because it is anchored to an edge and only has to leave the title and the
 * doors visible; the card has to leave a gutter at both ends.
 */
const BODY_FRACTION = { sheet: 0.46, popup: 0.38 } as const;

/**
 * The mark a destructive dialog wears — the round tinted chip this app already
 * puts at the head of a settings row and a risk line, in the negative pair.
 *
 * Only a destructive dialog gets one. Notion and Fabric draw their delete
 * dialogs bare, and they are right to: a warning icon on every dialog is a
 * warning icon nobody reads. Lyft, Cash App and Too Good To Go put one on the
 * dialogs that end something, which is the distinction worth drawing.
 */
function DialogMark() {
  const theme = useTheme();
  return (
    <View
      style={{
        width: 44,
        height: 44,
        borderRadius: theme.radius.pill,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.color.negativeSoft,
      }}
    >
      <Ionicons name="alert-circle" size={iconSize.md} color={theme.color.negative} />
    </View>
  );
}

/**
 * Which button a door is drawn as — a plain map, with no reference to where the
 * door sits in the list.
 *
 * Order used to decide it, and order is the wrong question: the top row of a
 * confirmation is the thing being asked for and should be loud, while the top
 * row of an action list is just the first of several peers. The caller names
 * the weight; this only spells it.
 */
function variantFor(action: DialogAction): ButtonVariant {
  switch (action.tone) {
    case 'danger':
      return 'danger';
    case 'dangerQuiet':
      return 'ghostDanger';
    case 'quiet':
      return 'secondary';
    case 'ghost':
      return 'ghost';
    case 'primary':
    default:
      return 'primary';
  }
}

/**
 * The dialog's content, shared by both surfaces.
 *
 * Split out so the two `visible` branches below hold no layout of their own —
 * a centred question and a bottom sheet must say exactly the same thing, and
 * the fastest way for them to stop doing that is two copies of this tree.
 */
function DialogContent({
  request,
  bodyMax,
  onChoose,
}: {
  request: DialogRequest;
  bodyMax: number;
  onChoose: (choice: DialogChoice) => void;
}) {
  const theme = useTheme();
  const { locale } = useStrings();
  const tone = request.tone ?? 'neutral';
  const rows = request.rows ?? [];

  return (
    // Announced as one thing, and named by its title: a screen reader that
    // lands here should hear what is being asked before it starts reading the
    // doors. `accessibilityViewIsModal` is already set by the surface itself,
    // so what is left is saying which kind of surface this is.
    <View accessibilityRole="alert" accessibilityLabel={request.title}>
      <Row style={{ gap: theme.spacing.md, marginBottom: theme.spacing.lg }}>
        {tone === 'danger' ? <DialogMark /> : null}
        <View style={{ flex: 1 }}>
          <Text variant="title">{request.title}</Text>
        </View>
      </Row>

      <ScrollView
        // A direct child with `flexGrow: 0` and a definite `maxHeight` in
        // points: the shape that hugs its content and stops. Left to grow it
        // measures short inside a surface that has no height of its own, which
        // is how a list the copy above points at ends up drawn past the bottom.
        style={{ flexGrow: 0, flexShrink: 1, maxHeight: bodyMax }}
        contentContainerStyle={{ gap: theme.spacing.md, paddingBottom: theme.spacing.xs }}
      >
        {request.body ? (
          <Text variant="body" tone="muted">
            {request.body}
          </Text>
        ) : null}

        {rows.length > 0 ? (
          <View style={{ gap: theme.spacing.sm }}>
            {rows.map((row) => (
              // Read as one item: the name and the amount are one fact, and
              // hearing them as two lines loses which belongs to which when
              // there are four of them.
              <Row
                key={row.key}
                accessible
                style={{
                  gap: theme.spacing.md,
                  paddingVertical: theme.spacing.xs,
                  paddingHorizontal: theme.spacing.md,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.color.surfaceMuted,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text variant="body">{row.label}</Text>
                  {row.hint ? (
                    <Text variant="caption" tone="muted">
                      {row.hint}
                    </Text>
                  ) : null}
                </View>
                {row.amount ? (
                  <MoneyText
                    amount={row.amount.minor}
                    currency={row.amount.currency}
                    locale={locale}
                    variant="subheading"
                  />
                ) : null}
              </Row>
            ))}
            {request.moreRows ? (
              <Text variant="caption" tone="muted">
                {request.moreRows}
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* The last word before the doors. A callout rather than another
            paragraph, because by this point in a warning a fourth line of grey
            body text is a line nobody reads. */}
        {request.note ? (
          <Callout tone={tone === 'danger' ? 'negative' : 'info'}>{request.note}</Callout>
        ) : null}
      </ScrollView>

      <View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.lg }}>
        {request.actions.map((action) => (
          <Button
            key={action.id}
            label={action.label}
            variant={variantFor(action)}
            fullWidth
            onPress={() => onChoose(action.id)}
          />
        ))}
      </View>
    </View>
  );
}

/**
 * Draws one request, on whichever surface its shape asks for.
 *
 * Each surface remembers the last request it drew, and keeps drawing it after
 * `request` has gone. That is what lets a dialog play its exit: `Sheet` and
 * `Popup` both hold themselves mounted through the close, and content that
 * vanished on the same frame would leave an empty card sliding away.
 *
 * They remember *separately*, and that is the interesting part. Choosing
 * "Delete" from an action sheet immediately asks for a confirmation, so a sheet
 * is sliding down while a centred card is fading in — and with one shared
 * memory the departing sheet would spend its last frames wearing the incoming
 * dialog's words. Two memories mean each surface leaves saying what it said.
 *
 * Both route their `onClose` — the scrim tap and, through `Modal`'s
 * `onRequestClose`, Android's back gesture — to the same dismissal. That is the
 * one thing `Alert.alert` gave away for free, and the one a hand-rolled overlay
 * usually forgets.
 */
export function AppDialog({
  request,
  visible,
  onChoose,
}: {
  request: DialogRequest | null;
  visible: boolean;
  onChoose: (choice: DialogChoice) => void;
}): React.JSX.Element | null {
  const { t } = useStrings();
  const { height: screenHeight } = useWindowDimensions();
  const [sheetRequest, setSheetRequest] = useState<DialogRequest | null>(null);
  const [popupRequest, setPopupRequest] = useState<DialogRequest | null>(null);

  // A state adjustment in render, the shape `Overlay`'s own mount latch uses:
  // the surface has to be showing the new request on the frame it arrives, and
  // an effect would draw the previous one once more first.
  const presentation = request === null ? null : presentationFor(request);
  if (visible && request !== null) {
    if (presentation === 'sheet' && request !== sheetRequest) setSheetRequest(request);
    if (presentation === 'popup' && request !== popupRequest) setPopupRequest(request);
  }

  if (sheetRequest === null && popupRequest === null) return null;

  const dismiss = (): void => onChoose(null);

  /**
   * The scrim's spoken label names the way out this dialog actually offers, so
   * a screen reader hears "Cancel", or "Not now", rather than a generic "Close"
   * over a question whose safe door is called something else.
   */
  const labelFor = (shown: DialogRequest): string =>
    shown.actions.find((action) => action.id === DIALOG_CANCEL)?.label ?? t.common.close;

  const body = (shown: DialogRequest, on: DialogPresentation) => (
    <DialogContent
      request={shown}
      bodyMax={Math.round(screenHeight * BODY_FRACTION[on])}
      onChoose={onChoose}
    />
  );

  return (
    <>
      {sheetRequest !== null ? (
        <Sheet
          visible={visible && presentation === 'sheet'}
          onClose={dismiss}
          closeLabel={labelFor(sheetRequest)}
          // Never taller than the window can hold with room to see what is
          // behind it — a sheet that reaches the status bar reads as a screen,
          // and this is a question about the screen underneath.
          style={{ maxHeight: Math.round(screenHeight * 0.88) }}
        >
          {body(sheetRequest, 'sheet')}
        </Sheet>
      ) : null}
      {popupRequest !== null ? (
        <Popup
          visible={visible && presentation === 'popup'}
          onClose={dismiss}
          closeLabel={labelFor(popupRequest)}
        >
          {body(popupRequest, 'popup')}
        </Popup>
      ) : null}
    </>
  );
}
