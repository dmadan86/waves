/**
 * The full-screen contact picker.
 *
 * Adding people to a group used to open the address book inline — a tall list
 * folded into the middle of the new-group and members forms. A thousand-name
 * book needs the whole screen (the alphabet rail needs somewhere to aim), so it
 * lives here as its own route now, and the form that wanted it navigates in.
 *
 * A pushed route cannot return a value the way an inline callback did, so the
 * caller leaves its intent in `contactPickerBridge` first — who is already
 * picked, and what to do with the answer — and this screen reads it once on
 * open. Confirming hands the ticked people back through that callback and
 * closes; backing out without confirming drops the request untouched.
 *
 * The hero wears the same scenic scene Home and Personal do (`HeroScene`), cut
 * down to one row (the back button inline with the title) and a single small
 * line under it — because this is a picker, not a dashboard: the scene is
 * here to say "you are still inside Waves", not to carry a balance or a
 * greeting. The search field rides up over its foot the way Home's balance
 * card and the new-group form's first card already do (a negative margin
 * equal to the scene's own overlap, not a second idea about how to float a
 * card over a landscape) — kept no bigger than the sliver of mountain the
 * header leaves under its own text, so the ride never reaches the subtitle.
 * Everything below the search field — the filter pills, the list, the
 * confirm bar — is `ContactPicker`'s own `compact` dress, so the behaviour
 * (search, the recent section, the escape row, permissions) is exactly what
 * every other picker in the app already has.
 */

import { useEffect, useState } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { directionalIcon, iconSize, Row, Screen, Text, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';

import { ContactPicker, type PickedContact } from '@/components/ContactPicker';
import { useHeroStatusBar } from '@/components/ScreenHero';
import { HeroScene } from '@/components/home/HeroScene';
import { useHeroScene } from '@/lib/heroScenePreference';
import { HERO_THEMES } from '@/lib/scene';
import { takeContactRequest } from '@/lib/contactPickerBridge';
import { router } from '@/lib/navigation';

/** The back button's own size, so the subtitle below it can line up under the
 *  title rather than under the button. */
const BACK_BUTTON = 40;

/**
 * How far under the header's own text the mountains still show before the
 * search card rides up over their foot, how far that ride is, and how far the
 * scene keeps fading on under the card once it has.
 *
 * `SCENE_OVERLAP` is kept at or under `SCENE_ROOM` on purpose — the search
 * card can only ride up as far as the empty sliver of mountain the header
 * left for it. Let it ride further than that and it rides into the header's
 * own text instead of the scene, which is exactly the bug a taller pair of
 * these two numbers once drew: the subtitle sat in the room the overlap had
 * already eaten.
 */
const SCENE_ROOM = 16;
const SCENE_OVERLAP = 14;
const SCENE_INTO_CARD = 34;

export default function ContactPickerScreen(): React.JSX.Element {
  const theme = useTheme();
  const { t } = useStrings();
  const insetsTop = useSafeAreaInsets().top;
  const { width: screenWidth } = useWindowDimensions();

  // The same scene Home and Personal wear, measured the way the new-group
  // form measures its own header: the title block's height, read back off its
  // layout, is what the scene and the overlap below it size themselves to.
  const scene = useHeroScene();
  const [headerHeight, setHeaderHeight] = useState(0);
  const darkInk = HERO_THEMES[scene].ink === 'dark';
  useHeroStatusBar(darkInk ? 'dark' : 'light');

  // Taken once on mount — this captures the request and clears the bridge in
  // one step, so the route owns it outright and no re-render or later open can
  // see a stale request. Nothing else clears it; this screen is the sole owner.
  const [request] = useState(() => takeContactRequest());

  // Opened with no pending request (a deep link, a stray navigation) has
  // nothing to pick for — close rather than show a picker that answers nobody.
  useEffect(() => {
    if (!request) router.back();
  }, [request]);

  const confirm = (people: readonly PickedContact[]): void => {
    request?.onPicked(people);
    router.back();
  };

  return (
    // `edges={['bottom']}` only: the top inset is read by hand (`insetsTop`)
    // so the scene itself can run up under the status bar, the way every
    // other scenic hero in the app does — the bottom is a plain safe area,
    // so the confirm bar never sits under the home indicator.
    <Screen edges={['bottom']}>
      {/* The scene, under the status bar down to just past the search card's
          foot — the same layering `HeroScene` always draws in, just shorter. */}
      {headerHeight > 0 ? (
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
          <HeroScene
            scene={scene}
            width={screenWidth}
            height={headerHeight + SCENE_INTO_CARD}
            horizon={headerHeight - SCENE_OVERLAP}
            headerBottom={insetsTop + BACK_BUTTON}
            pageColor={theme.color.bg}
          />
        </View>
      ) : null}

      <View
        onLayout={(event) => setHeaderHeight(event.nativeEvent.layout.height)}
        style={{
          paddingTop: insetsTop + theme.spacing.xs,
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: SCENE_ROOM,
          gap: 2,
        }}
      >
        {/* One row: the button inline with the title, not stacked above it —
            a row of its own cost the header a whole extra line of height for
            nothing the title couldn't say beside it. */}
        <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
          <TranslucentBackButton
            dark={darkInk}
            label={t.common.back}
            onPress={() => router.back()}
          />
          <Text
            variant="subheading"
            numberOfLines={1}
            style={{ flex: 1, color: darkInk ? theme.color.text : '#FFFFFF' }}
          >
            {t.misc.fromYourContacts}
          </Text>
        </Row>
        {/* Indented under the title, not the button, and kept to the one line
            it is given — a wrap here is what the search card's ride then
            covers half of. */}
        <Text
          variant="micro"
          numberOfLines={1}
          style={{
            marginStart: BACK_BUTTON + theme.spacing.sm,
            color: darkInk ? theme.color.text : '#FFFFFF',
            opacity: darkInk ? 0.7 : 0.85,
          }}
        >
          {t.pickers.fromYourContactsSubtitle}
        </Text>
      </View>

      {/* The search card rides up over the scene's foot by exactly the overlap
          the scene was drawn with — the same move the new-group form's first
          card and Home's balance card make, applied to `ContactPicker`'s own
          search row instead of a card this screen draws itself. Everything
          `ContactPicker` renders keeps this screen's own rule: the search row
          and the filter pills stay put, only the list scrolls, and the
          confirm bar is pinned at the foot. */}
      <View
        style={{
          flex: 1,
          marginTop: -SCENE_OVERLAP,
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: theme.spacing.md,
        }}
      >
        <ContactPicker
          compact
          onConfirm={confirm}
          initialSelected={request?.initial}
          existing={request?.existing}
          confirmVerb={t.add}
        />
      </View>
    </Screen>
  );
}

/**
 * The round translucent back button the reference board draws on its hero —
 * a disc dim enough to read as glass over the scene rather than a chip
 * floating above it. `HeroActionCircle` (`ScreenHero`) is the app's existing
 * round-translucent action, but it is built for the indigo panel and always
 * draws a white glyph; this scene can be pale enough at midday to need a dark
 * one instead (`darkInk`, the same flag the title text follows), so this is
 * its own small button rather than a second meaning bolted onto that one.
 */
function TranslucentBackButton({
  dark,
  label,
  onPress,
}: {
  dark: boolean;
  label: string;
  onPress: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: dark ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.18)',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Ionicons
        name={directionalIcon('chevron-back')}
        size={iconSize.lg}
        color={dark ? theme.color.text : '#FFFFFF'}
      />
    </Pressable>
  );
}
