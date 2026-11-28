/**
 * The "Me" tab — the private personal-finance ledger (A48).
 *
 * A person's own money, nothing shared. It wears Home's clothes: the time of
 * day's scene runs up under the status bar, carrying just the section's name
 * and its face; one white card rides up over the scene's foot — on glass,
 * blended into it exactly like Home's balance card — carrying this month's
 * spend big with how it compares to last month, a short bar history, the
 * month picker, and the three figures beneath it (income, spent, what is
 * left). Below, on the plain page, the month reads top-down the way a person
 * scans it: the budget, what is still due, the top categories, the latest
 * spends, and the money tools (recurring bills and loans).
 *
 * Everything is local-first from the mirror and every figure is computed on
 * the device.
 *
 * Before any of that exists — no entry, no rule, no loan, no budget — the tab
 * is a first run instead (`PersonalFirstRun`), because a dashboard of zeroes
 * asks for work without ever saying what the work is for.
 *
 * Opening the tab also posts any auto-recurring entries that have come due since
 * it was last open (idempotent — see `postDueRecurring`).
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {} from '@waves/core';
import {
  Button,
  EmptyState,
  Gradient,
  iconSize,
  Row,
  Screen,
  Text,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import { CalmHeader, CalmIconButton } from '@/components/calm/CalmHeader';
import { PersonalToday } from '@/components/personal/PersonalToday';
import { ResumeVehicleMoves } from '@/components/wealth/ResumeVehicleMoves';
import { useVehicleReminders } from '@/lib/vehicleReminders';
import { useWealthReminders } from '@/lib/wealthReminders';
import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import { PersonalIntro } from '@/components/PersonalIntro';
import { PrivacyPill, usePersonalUpcoming } from '@/components/personal/PersonalHomeParts';
import { hasDue } from '@/lib/personalUpcoming';
import {
  onPersonalIntroDismissed,
  personalIntroSeen,
  rememberPersonalIntroSeen,
} from '@/lib/onboardingSeen';
import { useSpaceSwitchItems } from '@/lib/useSpaceSwitchItems';
import { SignInWall } from '@/components/SignInWall';
import {
  postDueRecurring,
  todayIso,
  usePersonalLedger,
  useUpsertPersonalRecord,
} from '@/data/personal';
import { usePersonalWealth } from '@/data/personalWealth';
import { personalHomeIdentity } from '@/data/personalHomeIdentity';
import { useProfileForDisplay } from '@/lib/profileCache';
import { useDefaultCurrency } from '@/lib/currency';
import { dateTimeFormat } from '@/lib/dateTimeFormat';
import { useAuth, useViewerId } from '@/lib/auth';
import { shouldAutoOfferSetup } from '@/lib/personalSetup';
import { router } from '@/lib/navigation';
import { openPlanning } from '@/lib/openPlanning';
import { useSync } from '@/sync';
import { useStrings } from '@/i18n';

// The first run's saturated wash, deep enough to hold white ink on every corner.
const SAVED_WASH = ['#1E5A8C', '#0C2E4A'] as const;

// One faint watermark glyph, bled off the hero's corner.
const HERO_GLYPH = 'wallet-outline' as const;

/**
 * The account wall stands outside the ledger, not inside it: a guest session
 * cannot be signed back into, so a year of private spending kept under one is a
 * promise the app cannot keep (`components/SignInWall`). Outside, because
 * everything below reads the mirror and raises the biometric prompt on mount,
 * and neither should happen on the way to turning somebody away.
 */
export default function MeScreen() {
  const { isGuest } = useAuth();
  if (isGuest) return <SignInWall area="personal" />;
  return <MeLedger />;
}

function MeLedger() {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { t, locale } = useStrings();
  const deviceCurrency = useDefaultCurrency();
  const { hydrated } = useSync();
  // Name and currency survive an offline cold start (display only).
  const displayProfile = useProfileForDisplay();
  const ledger = usePersonalLedger();
  const identity = personalHomeIdentity(
    displayProfile,
    ledger.txns,
    ledger.budgets,
    deviceCurrency,
    t.account.you,
  );
  const dc = identity.currency;
  const upsert = useUpsertPersonalRecord();
  // The eye on the summary card: masks every figure on it (and the three
  // tiles beneath it), the same privacy the dashboard's own eye gives Home.

  // Read the clock once, off render (the React Compiler forbids it inline).
  const [today] = useState(() => todayIso());

  const [gearOpen, setGearOpen] = useState(false);

  // Post due auto-recurring entries once the mirror has hydrated from disk and
  // there are recurring rules to act on. Gating on `hydrated` (not the raw mount)
  // means we never latch against a still-loading, empty ledger; gating on
  // local hydration — not a network round-trip — keeps it working offline, which
  // is the whole point of the local-first ledger. `posted` is set only after the
  // catch-up resolves and cleared on failure, so a transient write error can
  // retry on a later run rather than being swallowed for the session. Even a
  // double-fire is harmless: occurrence ids are deterministic
  // (recurringOccurrenceId), so a repeat upserts the same rows, never a dupe.
  // Always keyed on `today`, never the browsed month.
  const wealth = usePersonalWealth();
  const posted = useRef(false);
  const ready = hydrated && ledger.recurrings.length > 0;
  useEffect(() => {
    if (posted.current || !ready) return;
    posted.current = true;
    postDueRecurring(ledger, today, (input) => upsert.mutateAsync(input), wealth.tenancies).catch(
      () => {
        posted.current = false;
      },
    );
    // Keyed on readiness only; `ledger`/`today`/`upsert` are read at fire time
    // and the ref makes it one-shot per successful run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const h = t.personalHome;
  const upcomingRows = usePersonalUpcoming(
    { txns: ledger.txns, recurrings: ledger.recurrings, currency: dc, today },
    3,
  );
  const switchItems = useSpaceSwitchItems('personal', {
    shared: h.sharedSpace,
    personal: h.space,
    onlyYou: h.onlyYou,
    sharedSubtitle: h.sharedSubtitle,
    couple: h.groupCouple,
    family: h.groupFamily,
  });
  useWealthReminders();
  useVehicleReminders();

  // One set of quick actions on this screen; the less-used ones live here.
  const moreItems: OverflowMenuItem[] = [
    {
      icon: 'pie-chart-outline',
      label: t.personal.nav.spending,
      route: '/personal/spending',
      section: 'views',
    },
    {
      icon: 'sparkles-outline',
      label: t.spendingAsk.title,
      route: '/personal/ask',
      section: 'views',
    },
    { icon: 'notifications-outline', label: h.reminder, route: '/dates/edit', section: 'add' },
    {
      icon: 'mic-outline',
      label: h.moreVoice,
      route: { pathname: '/voice', params: { scope: 'personal' } },
      section: 'add',
    },
    {
      icon: 'document-text-outline',
      label: t.statementImport.title,
      route: '/captures/statement',
      section: 'data',
    },
  ];

  // The tab's own intro, once per account, once they are in.
  // Keyed on the session's user rather than the profile, which can arrive late
  // or not at all; and held as *which* account it is open for, so a switch to
  // another account never carries the first one's open intro across.
  const ownerId = useViewerId();
  const [introFor, setIntroFor] = useState<string | null>(null);
  const introOpen = introFor !== null && introFor === ownerId;
  useEffect(() => {
    if (!ownerId) return;
    let live = true;
    void personalIntroSeen(ownerId).then((seen) => {
      if (live && !seen) setIntroFor(ownerId);
    });
    return () => {
      live = false;
    };
  }, [ownerId]);
  // Setup started (it sits above this tab): never open the tour on top of it.
  useEffect(() => onPersonalIntroDismissed(() => setIntroFor(null)), []);
  const closeIntro = useCallback(() => {
    setIntroFor(null);
    if (ownerId) void rememberPersonalIntroSeen(ownerId);
  }, [ownerId]);

  // Nothing in the section at all — no entry, no recurring rule, no loan, no
  // budget — and the mirror has finished loading, so that is the truth of it
  // rather than a screen caught mid-hydration. A month of zeroes is a form to
  // fill in with no reason attached; the first run says the promise instead,
  // and everything below comes back the moment there is one record to draw.
  const blank =
    hydrated &&
    ledger.txns.length === 0 &&
    ledger.recurrings.length === 0 &&
    ledger.loans.length === 0 &&
    ledger.budgets.length === 0;
  if (blank) {
    return (
      <>
        <PersonalFirstRun t={t} />
        <OpenSetupOnce ownerId={ownerId} />
      </>
    );
  }

  return (
    <Screen edges={[]}>
      <ResumeVehicleMoves />
      <CalmHeader
        dateLine={dateTimeFormat(locale, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          timeZone: 'UTC',
        }).format(new Date(`${today}T00:00:00Z`))}
        title={t.personal.today}
      >
        <CalmIconButton
          icon="add"
          label={t.personal.addExpense}
          onPress={() => router.push({ pathname: '/personal/entry', params: { kind: 'expense' } })}
        />
        <CalmIconButton
          icon="notifications-outline"
          label={h.reminders}
          dot={hasDue(upcomingRows)}
          onPress={() => router.push('/personal/upcoming')}
        />
        <CalmIconButton
          icon="ellipsis-vertical"
          label={h.settings}
          onPress={() => setGearOpen(true)}
        />
      </CalmHeader>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: clearance + 96, gap: theme.spacing.md }}
        showsVerticalScrollIndicator={false}
      >
        <PersonalToday today={today} currency={dc} />
        <View style={{ paddingHorizontal: theme.spacing.lg }}>
          <PrivacyFooterPill />
        </View>
      </ScrollView>
      <OverflowMenu
        visible={gearOpen}
        onClose={() => setGearOpen(false)}
        items={[
          ...switchItems,
          {
            icon: 'calendar-outline',
            label: t.comingUp.seeCalendar,
            route: '/personal/calendar',
            section: 'views',
          },
          {
            icon: 'cash-outline',
            label: t.comingUp.bigTitle,
            route: '/personal/bigbills',
            section: 'views',
          },
          {
            icon: 'home-outline',
            label: t.calm.menuRentals,
            route: '/rentals',
            section: 'views',
          },
          {
            icon: 'car-outline',
            label: t.vehicles.vehicles,
            route: '/vehicles',
            section: 'views',
          },
          {
            icon: 'speedometer-outline',
            label: t.comingUp.tileBudgets,
            onPress: () => openPlanning('budgets'),
            section: 'views',
          },
          {
            icon: 'receipt-outline',
            label: t.calm.menuTransactions,
            route: '/personal/transactions',
            section: 'views',
          },
          ...moreItems,
          { icon: 'sparkles-outline', label: t.personalSetup.title, route: '/personal/setup' },
          {
            icon: 'image-outline',
            label: t.heroScene.title,
            route: '/settings/scene?space=personal',
          },
          {
            icon: 'pricetags-outline',
            label: t.personal.dash.toolCategories,
            route: '/settings/categories?space=personal',
          },
          {
            icon: 'lock-closed-outline',
            label: t.personal.dash.settings,
            route: '/settings/lock?space=personal',
          },
          // The settings the Me tab used to open; the bar stays Personal.
          {
            icon: 'settings-outline',
            label: t.account.faceSettings,
            route: '/profile?space=personal',
          },
        ]}
      />
      <PersonalIntro visible={introOpen} onDone={closeIntro} />
    </Screen>
  );
}

// ──────────────────────────────────────────────────────────────── body ──

/**
 * The edge-to-edge ground every version of the hero stands on: the saturated
 * wash under the status bar, its rounded foot, and the one wallet watermark
 * bled off the corner. Shared so the first run looks like the same section as
 * the month panel it becomes.
 */
function HeroShell({ wash, children }: { wash: readonly string[]; children: ReactNode }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        paddingTop: insets.top + theme.spacing.md,
        paddingHorizontal: theme.spacing.xl,
        paddingBottom: theme.spacing.lg,
        borderBottomLeftRadius: theme.radius.xxl,
        borderBottomRightRadius: theme.radius.xxl,
        gap: theme.spacing.lg,
        overflow: 'hidden',
      }}
    >
      {/* The saturated ground. */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Gradient colors={wash} radius={0} style={{ flex: 1 }} />
      </View>
      {/* One faint watermark bled off the corner. */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Ionicons
          name={HERO_GLYPH}
          size={208}
          color={theme.color.onBrand}
          style={{ position: 'absolute', right: -44, bottom: -52, opacity: 0.16 }}
        />
      </View>
      {children}
    </View>
  );
}

/**
 * The way into the ledger on the hero: one "+ Expense" pill, the dashboard's
 * and a group's own. Income is not a second button — the entry screen opens on
 * an Expense / Income switch, so an earning is one tap further in.
 */
function AddActions({ t }: { t: ReturnType<typeof useStrings>['t'] }) {
  const theme = useTheme();
  return (
    <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
      <HeroPill
        icon="add"
        // The plus does the verb's work; spoken, it is still the whole action.
        label={t.expenseShort}
        spokenLabel={t.personal.addExpense}
        onPress={() => router.push({ pathname: '/personal/entry', params: { kind: 'expense' } })}
      />
    </Row>
  );
}

/**
 * The first run: the section with nothing in it yet.
 *
 * A private ledger asks for real work — every entry is typed by hand — so the
 * empty screen has to be worth the first one. It leads with what the month's
 * figures would eventually say ("see what you keep each month") rather than
 * with the figures themselves at zero, keeps the same saturated panel so the
 * tab is recognisably itself, and offers the three doors in the order a person
 * needs them: spend, earn, and the recurring rules that mean salary and rent
 * post themselves from here on.
 *
 * The privacy line stays, and stays early: the one question anybody has about
 * a personal ledger inside a bill-splitting app is who else can see it.
 */
/** A blank ledger opens the setup flow once per account (setup records `started`); backing out leaves the first-run screen. */
let setupOffered = false;
function OpenSetupOnce({ ownerId }: { ownerId: string | null | undefined }) {
  useEffect(() => {
    if (setupOffered || !ownerId) return;
    setupOffered = true;
    void shouldAutoOfferSetup(ownerId).then((offer) => offer && router.push('/personal/setup'));
  }, [ownerId]);
  return null;
}

function PersonalFirstRun({ t }: { t: ReturnType<typeof useStrings>['t'] }) {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  return (
    <Screen edges={[]}>
      <HeroShell wash={SAVED_WASH}>
        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="title" tone="onBrand" numberOfLines={1}>
            {t.personal.nav.overview}
          </Text>
          <Text variant="caption" tone="onBrand" numberOfLines={2} style={{ opacity: 0.85 }}>
            {t.personal.subtitle}
          </Text>
        </View>
        <AddActions t={t} />
      </HeroShell>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: clearance }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingHorizontal: theme.spacing.xl, gap: theme.spacing.xl }}>
          <EmptyState
            icon={<Ionicons name={HERO_GLYPH} size={iconSize.xxl} color={theme.color.brand} />}
            title={t.personal.introTitle}
            body={t.personal.introBody}
            action={
              <Button
                label={t.personalSetup.title}
                variant="secondary"
                onPress={() => router.push('/personal/setup')}
              />
            }
          />
          <PrivateNote />
        </View>
      </ScrollView>
    </Screen>
  );
}

/** An add action on the hero — a pill that shares the row evenly. `solid` is the
 *  primary white pill with brand ink; `ghost` is a translucent secondary in white
 *  ink, so both actions read as buttons and neither is an unlabelled glyph. */
function HeroPill({
  icon,
  label,
  spokenLabel,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  spokenLabel?: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const ink = theme.color.brand;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spokenLabel ?? label}
      onPress={onPress}
      // Hugs its word, like the dashboard's pill, rather than filling the row.
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.spacing.xs,
        // Two lots of `md` over a 22pt line: 46pt, clear of the 44pt floor a
        // finger needs. The dashboard's pill is built to the same measure.
        paddingVertical: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
        borderRadius: theme.radius.md,
        backgroundColor: '#FFFFFF',
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Ionicons name={icon} size={iconSize.lg} color={ink} />
      <Text variant="subheading" style={{ color: ink }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** A quiet reassurance, on every state of the tab: this ledger is nobody
 *  else's. The one question a private ledger inside a shared-expense app has to
 *  answer, so it is answered whether or not there is anything in it yet. */
function PrivateNote() {
  const theme = useTheme();
  const { t } = useStrings();
  return (
    <Row style={{ justifyContent: 'center', gap: theme.spacing.xs }}>
      <Ionicons name="lock-closed-outline" size={iconSize.xs} color={theme.color.textFaint} />
      <Text variant="micro" tone="faint">
        {t.personal.privateNote}
      </Text>
    </Row>
  );
}

/**
 * The same reassurance as `PrivateNote`, but said once at the foot of the
 * dashboard proper as a lavender strip rather than a quiet caption — closer
 * to a pressable fact than a footnote. Opens the backup screen, which is the
 * one place that actually explains what "not shared" means for this ledger
 * (where its backup lives and whose key locks it); where that door does not
 * make sense (the first run, with nothing backed up yet) the plain
 * `PrivateNote` is still the right weight.
 */
function PrivacyFooterPill() {
  const { t } = useStrings();
  return (
    <PrivacyPill
      label={t.personal.privateNote}
      onPress={() => router.push('/settings/backup?space=personal')}
    />
  );
}
