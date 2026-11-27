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

import {
  personalHomeSpent,
  format,
  formatParts,
  incomeSource,
  money,
  monthOutlook,
  type PersonalTxn,
} from '@waves/core';
import {
  Button,
  Card,
  Divider,
  EmptyState,
  Gradient,
  iconSize,
  Row,
  Screen,
  Text,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import { CategoryBadge } from '@/components/Category';
import { ResumeVehicleMoves } from '@/components/wealth/ResumeVehicleMoves';
import { useVehicleReminders } from '@/lib/vehicleReminders';
import { useWealthReminders } from '@/lib/wealthReminders';
import { BALANCE_MASK } from '@/components/home/HomeBalanceCard';
import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import { TabHeader, TabIconButton } from '@/components/home/TabHeader';
import { PersonAvatar } from '@/components/PersonAvatar';
import { EmptyCard } from '@/components/standard';
import { ComingUpHome } from '@/components/home/ComingUpHome';
import { PersonalIntro } from '@/components/PersonalIntro';
import {
  CardTitle,
  PrivacyPill,
  usePersonalUpcoming,
} from '@/components/personal/PersonalHomeParts';
import { monthLabel } from '@/lib/monthNav';
import { hasDue } from '@/lib/personalUpcoming';
import {
  onPersonalIntroDismissed,
  personalIntroSeen,
  rememberPersonalIntroSeen,
} from '@/lib/onboardingSeen';
import { useAvatarUrl } from '@/components/ProfileAvatar';
import { useSpaceSwitchItems } from '@/lib/useSpaceSwitchItems';
import { useViewerIdentity } from '@/lib/viewerIdentity';
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
import { recentTxns as selectRecentTxns } from '@/lib/txnLedger';
import { usePersonalAmountsHidden } from '@/lib/amountsHidden';
import { useDefaultCurrency } from '@/lib/currency';
import { dateTimeFormat } from '@/lib/dateTimeFormat';
import { useAuth, useViewerId } from '@/lib/auth';
import { router } from '@/lib/navigation';
import { useSync } from '@/sync';
import { fill, useStrings } from '@/i18n';

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
  const viewerFace = useViewerIdentity();
  const avatarUrl = useAvatarUrl(viewerFace.avatarUrl);
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
  const { hidden: amountsHidden } = usePersonalAmountsHidden();

  // Read the clock once, off render (the React Compiler forbids it inline).
  const [today] = useState(() => todayIso());
  const currentMonth = today.slice(0, 7);

  const month = currentMonth;

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

  // What actually moved this month. The recurring rules' still-expected money
  // stays out of these figures — a total that quietly included money nobody has
  // received would be the one lie a ledger cannot tell — and is listed below as
  // what the month is still waiting for.
  const summary = monthOutlook(ledger.txns, ledger.recurrings, month, dc, today);
  // Whole-rupee totals drop a bare ".00"; real paise still show.
  const fmt = (amount: bigint): string => {
    const p = formatParts(money(amount, dc), { locale, trimZeros: true });
    return /[1-9]/.test(p.fraction) ? p.text : p.lead + p.trail;
  };
  const catLabel = labelForCategory(t);

  // Every figure below honours the eye on the hero.

  // The latest three entries, newest first (the ledger comes newest-first).
  const recentTxns = selectRecentTxns(ledger.txns, today);

  const h = t.personalHome;
  const homeSpent = personalHomeSpent(ledger.txns, month, dc);
  const upcomingRows = usePersonalUpcoming(
    { txns: ledger.txns, recurrings: ledger.recurrings, currency: dc, today },
    3,
  );
  const [switchOpen, setSwitchOpen] = useState(false);
  const switchItems = useSpaceSwitchItems('personal', {
    shared: h.sharedSpace,
    personal: h.space,
    onlyYou: h.onlyYou,
    sharedSubtitle: h.sharedSubtitle,
    couple: h.groupCouple,
    family: h.groupFamily,
  });
  const [moreOpen, setMoreOpen] = useState(false);
  useWealthReminders();
  useVehicleReminders();
  const firstName = identity.name.trim().split(/\s+/)[0];

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
        <OpenSetupOnce />
      </>
    );
  }

  return (
    <Screen edges={[]}>
      <ResumeVehicleMoves />
      {/* The scene runs up under the status bar, so the clock goes white — but
          only here, where the scene is drawn: the lock shield and the first run
          are plain pages, and keep the theme's own dark icons. */}
      <TabHeader
        left={
          <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
            <PersonAvatar
              name={displayProfile?.display_name ?? t.account.you}
              avatarUrl={avatarUrl}
              size={44}
              accessibilityLabel={t.profile}
              onPress={() => router.navigate('/profile')}
            />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                accessibilityRole="header"
                numberOfLines={1}
                style={{ fontSize: 18, lineHeight: 23, fontWeight: '700' }}
              >
                {fill(h.hi, { name: firstName ?? '' })}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${h.switchSpace}. ${h.space}`}
                onPress={() => setSwitchOpen(true)}
                hitSlop={6}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 2,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <Text variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {h.space}
                </Text>
                <Ionicons name="chevron-down" size={iconSize.sm} color={theme.color.textMuted} />
              </Pressable>
            </View>
          </Row>
        }
      >
        <TabIconButton
          icon="search-outline"
          label={h.search}
          onPress={() => router.push('/personal/transactions')}
        />
        <TabIconButton
          icon="notifications-outline"
          label={h.reminders}
          dot={hasDue(upcomingRows)}
          onPress={() => router.push('/personal/upcoming')}
        />
        <TabIconButton
          icon="add"
          label={t.personal.addExpense}
          onPress={() => router.push({ pathname: '/personal/entry', params: { kind: 'expense' } })}
        />
        <TabIconButton
          icon="ellipsis-vertical"
          label={h.settings}
          onPress={() => setGearOpen(true)}
        />
      </TabHeader>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: clearance + 96 }}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={{
            paddingHorizontal: theme.spacing.lg,
            paddingTop: theme.spacing.xs,
            gap: theme.spacing.md,
          }}
        >
          <ComingUpHome
            tiles={[
              {
                key: 'rentals',
                icon: 'home-outline',
                label: t.comingUp.tileRentals,
                onPress: () => router.push('/rentals'),
              },
              {
                key: 'vehicles',
                icon: 'car-outline',
                label: t.vehicles.vehicles,
                onPress: () => router.push('/vehicles'),
              },
              {
                key: 'budgets',
                icon: 'speedometer-outline',
                label: t.comingUp.tileBudgets,
                onPress: () => router.push('/personal/budgets'),
              },
              {
                key: 'more',
                icon: 'ellipsis-horizontal',
                label: t.personalHome.toolMore,
                onPress: () => setMoreOpen(true),
              },
            ]}
            month={{
              label: monthLabel(month, locale),
              income: amountsHidden ? BALANCE_MASK : fmt(summary.income),
              spent: amountsHidden ? BALANCE_MASK : fmt(homeSpent),
              left: amountsHidden
                ? BALANCE_MASK
                : fmt(
                    summary.income > homeSpent
                      ? summary.income - homeSpent
                      : homeSpent - summary.income,
                  ),
              leftNegative: homeSpent > summary.income,
            }}
          />

          <Card style={{ gap: theme.spacing.sm, padding: theme.spacing.lg }}>
            <CardTitle
              title={h.recentTitle}
              action={t.personal.dash.viewAll}
              onAction={() => router.push('/personal/transactions')}
            />
            {recentTxns.length === 0 ? (
              <EmptyCard
                icon="receipt-outline"
                title={t.personalHome.emptyRecentTitle}
                helper={t.personalHome.emptyRecentHelp}
              />
            ) : (
              <View>
                {recentTxns.map((txn, index) => (
                  <View key={txn.id}>
                    {index > 0 ? <Divider /> : null}
                    <ExpenseRow
                      txn={txn}
                      title={txn.note?.trim() || catLabel(txn.category) || '—'}
                      categoryLabel={catLabel(txn.category) ?? t.categories.other}
                      date={txn.date === today ? t.personal.today : dayMonthYear(txn.date, locale)}
                      locale={locale}
                      hidden={amountsHidden}
                    />
                  </View>
                ))}
              </View>
            )}
          </Card>

          <PrivacyFooterPill />
        </View>
      </ScrollView>
      <OverflowMenu visible={switchOpen} onClose={() => setSwitchOpen(false)} items={switchItems} />
      <OverflowMenu visible={moreOpen} onClose={() => setMoreOpen(false)} items={moreItems} />
      <OverflowMenu
        visible={gearOpen}
        onClose={() => setGearOpen(false)}
        items={[
          { icon: 'sparkles-outline', label: t.personalSetup.title, route: '/personal/setup' },
          {
            icon: 'image-outline',
            label: t.heroScene.title,
            route: '/settings/scene?space=personal',
          },
          {
            icon: 'pricetags-outline',
            label: t.personal.dash.toolCategories,
            route: '/settings/categories',
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

/** One recent entry: its badge, what it was and when, and the amount. Opens the entry. */
function ExpenseRow({
  txn,
  title,
  categoryLabel,
  date,
  locale,
  hidden = false,
}: {
  txn: PersonalTxn;
  title: string;
  categoryLabel: string;
  date: string;
  locale: string;
  hidden?: boolean;
}) {
  const theme = useTheme();
  const expense = txn.kind === 'expense';
  const amount = hidden
    ? BALANCE_MASK
    : `${expense ? '−' : '+'}${format(money(txn.amount, txn.currency), { locale, trimZeros: true })}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${categoryLabel}, ${date}, ${amount}`}
      onPress={() => router.push({ pathname: '/personal/entry', params: { id: txn.id } })}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
        minHeight: 52,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <CategoryBadge
        category={txn.category ?? 'other'}
        meta={null}
        description={txn.note}
        size={40}
      />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text variant="body" numberOfLines={1} style={{ fontWeight: '600' }}>
          {title}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {date}
        </Text>
      </View>
      <Text
        variant="body"
        numberOfLines={1}
        style={{ fontWeight: '700', color: expense ? theme.color.negative : theme.color.positive }}
      >
        {amount}
      </Text>
    </Pressable>
  );
}

// A day as "2 Sep 2026", for the recent expenses.
function dayMonthYear(date: string, locale: string): string {
  try {
    return dateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${date}T00:00:00Z`));
  } catch {
    return date;
  }
}

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
/** A blank ledger opens the setup flow once per launch; backing out leaves the first-run screen. */
let setupOffered = false;
function OpenSetupOnce() {
  useEffect(() => {
    if (setupOffered) return;
    setupOffered = true;
    router.push('/personal/setup');
  }, []);
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

// The translated label for a category id (built-in key or custom tag id). Custom
// tags fall back to their own stored label via the badge; here we only need the
// built-in names, so an unknown id returns null and the row shows its note.
function labelForCategory(t: ReturnType<typeof useStrings>['t']) {
  return (id: string | null): string | null => {
    if (!id) return null;
    const translated = t.categories[id as keyof typeof t.categories];
    if (translated) return translated;
    if (id.startsWith('inc.')) return incomeSource(id)?.label ?? null;
    if (id.startsWith('inv.')) return id === 'inv.deposit' ? 'Investment deposit' : 'Investment';
    return null;
  };
}
