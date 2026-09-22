/**
 * The panel every important screen opens with.
 *
 * A group opens on a saturated gradient that runs up under the status bar,
 * carries the name of the thing you are looking at, one number that is the
 * whole point of the screen, and the actions that number invites. The
 * dashboard opens the same way. Review and Bank messages did not — they opened
 * on a plain white row with a small glyph, which is the layout of a settings
 * page, and it made two of the app's three busiest screens look like somewhere
 * you had wandered into by accident.
 *
 * So the shape is extracted rather than copied a third and fourth time. What
 * lives here is the *shell* and the two controls that sit on it:
 *
 *   - `ScreenHero` — the gradient, an optional watermark behind everything
 *     (`art`), the safe-area inset, the rounded bottom, and the top row (an
 *     optional back chevron, the identity glyph and name — the glyph pops in
 *     with a once-only spring on mount — a line of state under it, and the
 *     trailing actions: bare white glyphs, except the one marked `primary`,
 *     which gets the solid white disc a real button deserves). Everything
 *     below that is the caller's: a balance, a count, a total, a search field.
 *   - `HeroPillButton` — the white pill whose label is drawn in the gradient's
 *     own darkest stop, which is why it takes the stops rather than a colour.
 *   - `HeroActionCircle` — the dim white disc a secondary glyph sits on.
 *
 * Both controls were `GroupHero`'s and are now shared with it, so a change to
 * how a hero action looks reaches every hero rather than one of them.
 *
 * The panel is deliberately *not* a `Screen` header or a navigation option: it
 * scrolls with nothing, sits above the list, and the screens that use it pass
 * `edges={[]}` so it can run under the status bar the way the dashboard's does.
 */

import { useCallback, useEffect, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { Pressable, View, type ViewStyle } from 'react-native';
import Reanimated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  ZoomIn,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { directionalIcon, Gradient, iconSize, Row, Text, useTheme } from '@waves/ui';

import { PressableScale } from '@/lib/anim';
import { useReducedMotion } from '@/lib/reducedMotion';

/**
 * Light status-bar icons for as long as a hero screen is the one you are on.
 *
 * The panel runs up under the status bar, and the root layout sets the clock
 * and the battery to *dark* ink whenever the light theme is on — dark glyphs on
 * a deep indigo wash, which is exactly the contrast failure the hero is
 * otherwise designed around.
 *
 * Scoped to focus rather than to mount, which is the whole reason this is a
 * hook and not a `<StatusBar style="light" />` in the tree. A tab screen does
 * not unmount when you leave it: Review would go on holding the status bar
 * light after you had walked to Friends, and white glyphs on a white screen is
 * a worse bug than the one being fixed. On focus it takes the bar; on blur it
 * hands it back to whatever the theme says at rest.
 */
export function useHeroStatusBar(): void {
  const theme = useTheme();
  const resting = theme.scheme === 'dark' ? 'light' : 'dark';
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle('light');
      return () => setStatusBarStyle(resting);
    }, [resting]),
  );
}

/**
 * The 150ms ease between a hero's two faces — what it says at rest and what it
 * says once a selection is under way. Both faces stay mounted, one laid over
 * the other, and this crossfades between them rather than swapping with a cut:
 * the resting face eases up and out as the overlay eases in from below. Friends'
 * top row (title/actions → close/count/merge) and Review's balance figure
 * (count waiting → count selected) both ride this exact value and timing,
 * which is why the two panels read as the same gesture on two different lists
 * rather than two separately-tuned ones.
 */
export function useHeroCrossfade(active: boolean) {
  const reduceMotion = useReducedMotion();
  const sel = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    sel.set(reduceMotion ? (active ? 1 : 0) : withTiming(active ? 1 : 0, { duration: 150 }));
  }, [active, reduceMotion, sel]);
  const restingStyle = useAnimatedStyle(() => ({
    opacity: 1 - sel.get(),
    transform: [{ translateY: sel.get() * -6 }],
  }));
  const overlayStyle = useAnimatedStyle(() => ({
    opacity: sel.get(),
    transform: [{ translateY: (1 - sel.get()) * 6 }],
  }));
  return { restingStyle, overlayStyle };
}

/**
 * One round translucent action on a hero — a white glyph on a dim white disc.
 * Icon-only; its name rides on the accessibility label.
 */
export function HeroActionCircle({
  icon,
  label,
  onPress,
  disabled,
  badge = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /**
   * A small plus on the disc's shoulder, for an action that *makes* something
   * rather than opening it.
   *
   * It is drawn rather than picked because Ionicons has no "add a group" glyph:
   * the only one carrying a plus is `person-add`, a single figure, and this app
   * already means something specific and different by adding a person (a 1:1
   * ledger with them). Pointing that icon at "new group" would name the wrong
   * feature — so the group glyph keeps its meaning and the plus is composed on
   * top, which is the same badge the friends list wears for a merged guest.
   */
  badge?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 42,
        height: 42,
        borderRadius: 21,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255, 255, 255, 0.18)',
        opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
      })}
    >
      <Ionicons name={icon} size={iconSize.lg} color={theme.color.onBrand} />
      {badge ? (
        // Opaque, on the panel's own ink, so the plus reads as a mark on the
        // disc rather than a glyph floating over the wash behind it. Decorative:
        // the button's label already says what it makes.
        <View
          accessible={false}
          pointerEvents="none"
          style={{
            position: 'absolute',
            right: -1,
            bottom: -1,
            width: 16,
            height: 16,
            borderRadius: 8,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.color.onBrand,
          }}
        >
          <Ionicons name="add" size={12} color={theme.color.brand} />
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * The hero's primary action: a white pill whose ink is the gradient's darkest
 * stop, so the one solid shape on the panel is unmistakably the thing to press.
 *
 * It takes the stops rather than a colour because that darkest stop is the only
 * value guaranteed to clear contrast against white on whichever wash the panel
 * happens to be wearing — the group hero changes its gradient with the balance.
 */
export function HeroPillButton({
  label,
  spokenLabel,
  icon,
  trailingIcon,
  gradient,
  onPress,
  onLongPress,
  disabled,
  variant = 'solid',
  style,
}: {
  label: string;
  /**
   * What a screen reader says, when the drawn label is shortened to fit.
   * A pill at half a phone's width has room for "Expense" and not for "Add
   * expense", and the word that fits is the weaker one to hear on its own —
   * "Expense" could be a heading. Sighted readers get the short label in
   * context; everyone else gets the whole verb.
   */
  spokenLabel?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  trailingIcon?: keyof typeof Ionicons.glyphMap;
  gradient: readonly string[];
  onPress: () => void;
  /**
   * A second, faster way into the same thing — the dashboard's add-expense
   * raises the type/scan/speak sheet on a hold. Given here rather than left to
   * the caller to wrap, because a hold on a `Pressable` is the pill's own
   * gesture and wrapping it in another pressable would eat the tap.
   */
  onLongPress?: () => void;
  disabled?: boolean;
  /**
   * `outline` is the same pill with the fill taken out: white ink inside a
   * translucent white hairline — the face the group hero's "reject" already
   * wears beside its solid "confirm". It is what a *second* labelled action on
   * a panel gets, because two white pills side by side are two primaries and
   * leave nothing for the eye to land on first.
   */
  variant?: 'solid' | 'outline';
  style?: ViewStyle;
}) {
  const theme = useTheme();
  const solid = variant === 'solid';
  // Filled, the ink is the wash's own darkest stop on white; hollow, the pill
  // *is* the wash, so the ink is the white everything else on the panel uses.
  const ink = solid ? (gradient[0] ?? theme.color.brand) : theme.color.onBrand;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spokenLabel ?? label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={250}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.spacing.xs,
        paddingVertical: theme.spacing.sm,
        paddingHorizontal: theme.spacing.lg,
        borderRadius: theme.radius.pill,
        backgroundColor: solid ? '#FFFFFF' : 'transparent',
        borderWidth: solid ? 0 : 1,
        borderColor: 'rgba(255, 255, 255, 0.5)',
        opacity: disabled ? 0.6 : pressed ? 0.85 : 1,
        ...style,
      })}
    >
      {icon ? <Ionicons name={icon} size={iconSize.lg} color={ink} /> : null}
      <Text variant="subheading" style={{ color: ink }} numberOfLines={1}>
        {label}
      </Text>
      {trailingIcon ? <Ionicons name={trailingIcon} size={iconSize.md} color={ink} /> : null}
    </Pressable>
  );
}

/**
 * A small white glyph on the hero's top row — sync, filter, scan, overflow.
 *
 * `icon` covers every ordinary case: one glyph, one meaning. `render` is the
 * escape hatch for the rare action that has to show more than a single glyph
 * — Friends' sort control pairs the active key's icon with a direction arrow,
 * which no single `Ionicons` name can express — and takes over the whole
 * pressable's content when given. Exactly one of the two is expected.
 *
 * `primary` marks the one action on the row that *is* the screen's button —
 * Friends' "add a person", Review's "paste a message" — and trades the bare
 * glyph for a solid white disc with a press-scale dip, so the one thing worth
 * pressing on a busy panel of icons is unmistakable. At most one action per
 * row should carry it.
 */
export interface HeroAction {
  readonly icon?: keyof typeof Ionicons.glyphMap;
  readonly label: string;
  readonly onPress: () => void;
  readonly render?: ReactNode;
  readonly primary?: boolean;
}

export function ScreenHero({
  gradient,
  art,
  icon,
  title,
  subtitle,
  back,
  actions = [],
  overlay,
  children,
}: {
  /** The wash. Defaults to the brand indigo where a screen has no verdict. */
  gradient?: readonly string[];
  /**
   * A watermark painted behind everything — Friends' faint people-and-rings,
   * Review's faint tray-and-rings. Purely decorative: give it its own
   * `pointerEvents="none"`, since the shell does not add one for you.
   */
  art?: ReactNode;
  /** The identity glyph beside the name — what this screen is about. */
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  /** A line of *state* under the name. A string, or a component that owns it. */
  subtitle?: ReactNode;
  /**
   * Given only where there is somewhere to go back to — never on a tab. Carries
   * its own label because the chevron is the one control here with no word
   * beside it, and a screen reader announcing an untranslated "back" on an
   * Arabic build is the kind of gap nothing else catches.
   */
  back?: { readonly label: string; readonly onPress: () => void };
  actions?: readonly HeroAction[];
  /**
   * A second top row that crossfades over the title row — Friends' selection
   * mode, where a long press replaces title/glyph/actions with close / count /
   * merge on the same panel rather than opening a new screen. Both rows stay
   * mounted throughout (see `useHeroCrossfade`), so the swap dissolves instead
   * of cutting, and only the visible row takes taps.
   */
  overlay?: { readonly active: boolean; readonly content: ReactNode };
  /** The body: a balance, a count, a total, a search field. */
  children?: ReactNode;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const stops = gradient ?? theme.gradient.brand;
  // The one solid shape on a busy row of glyphs draws its ink from the wash's
  // own darkest stop — the same trick `HeroPillButton` uses — so it clears
  // contrast against white on whichever gradient the caller hands in.
  const primaryInk = stops[0] ?? theme.color.brand;
  const { restingStyle, overlayStyle } = useHeroCrossfade(overlay?.active ?? false);

  const titleRow = (
    <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
      {back ? (
        <Pressable
          onPress={back.onPress}
          accessibilityRole="button"
          accessibilityLabel={back.label}
          hitSlop={10}
        >
          <Ionicons
            name={directionalIcon('chevron-back')}
            size={iconSize.xxl}
            color={theme.color.onBrand}
          />
        </Pressable>
      ) : null}
      {icon ? (
        // The glyph pops in on mount — a small, once-only spring, the beat of
        // motion that reads as "premium" without ever nagging.
        <Reanimated.View
          entering={reduceMotion ? undefined : ZoomIn.springify().damping(14).mass(0.6)}
        >
          <Ionicons name={icon} size={iconSize.xl} color={theme.color.onBrand} />
        </Reanimated.View>
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="title" tone="onBrand" numberOfLines={1}>
          {title}
        </Text>
        {typeof subtitle === 'string' ? (
          <Text variant="micro" tone="onBrand" style={{ opacity: 0.85 }} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : (
          subtitle
        )}
      </View>
      {actions.map((action) =>
        action.primary ? (
          // The screen's one real button: a solid white disc with the wash's
          // own ink, and a press-scale dip rather than the bare glyphs'
          // opacity blink — the same treatment `HeroPillButton` gives a
          // primary action, sized to sit in the top row instead of below it.
          <PressableScale
            key={action.label}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            onPress={action.onPress}
            hitSlop={10}
            style={{
              width: 38,
              height: 38,
              borderRadius: 19,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.color.onBrand,
            }}
          >
            {action.render ?? <Ionicons name={action.icon} size={iconSize.xl} color={primaryInk} />}
          </PressableScale>
        ) : (
          <Pressable
            key={action.label}
            onPress={action.onPress}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            hitSlop={10}
          >
            {action.render ?? (
              <Ionicons name={action.icon} size={iconSize.xl} color={theme.color.onBrand} />
            )}
          </Pressable>
        ),
      )}
    </Row>
  );

  return (
    <Gradient
      radius={0}
      colors={stops}
      style={{
        paddingTop: insets.top + theme.spacing.md,
        paddingHorizontal: theme.spacing.xl,
        paddingBottom: theme.spacing.md,
        borderBottomLeftRadius: theme.radius.xxl,
        borderBottomRightRadius: theme.radius.xxl,
        gap: theme.spacing.lg,
        overflow: 'hidden',
      }}
    >
      {art}

      {overlay ? (
        <View style={{ justifyContent: 'center' }}>
          <Reanimated.View pointerEvents={overlay.active ? 'none' : 'auto'} style={restingStyle}>
            {titleRow}
          </Reanimated.View>
          <Reanimated.View
            pointerEvents={overlay.active ? 'auto' : 'none'}
            style={[
              {
                position: 'absolute',
                left: 0,
                right: 0,
                top: 0,
                bottom: 0,
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.md,
              },
              overlayStyle,
            ]}
          >
            {overlay.content}
          </Reanimated.View>
        </View>
      ) : (
        titleRow
      )}

      {children}
    </Gradient>
  );
}
