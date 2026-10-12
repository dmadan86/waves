import { useState, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { decode } from 'base64-arraybuffer';
import * as FileSystem from 'expo-file-system';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import {
  ActivityIndicator,
  I18nManager,
  Platform,
  Pressable,
  ScrollView,
  View,
} from 'react-native';

import {
  Callout,
  Card,
  directionalIcon,
  Gradient,
  IconButton,
  iconSize,
  Row,
  Screen,
  Text,
  useTheme,
} from '@waves/ui';

import { useGroup, useGroupLedger } from '@/data/hooks';
import { displayName, groupLabel, isGhost, GroupType, SettlementMethod } from '@/data/types';
import { useBlockedUsers } from '@/data/blocked';
import { buildGroupExportModel, INCLUDE_ALL, type ExportInclude } from '@/data/groupExport';
import { renderGroupExportHtml, type GroupExportLabels } from '@/data/groupExportHtml';
import {
  buildGroupExportWorkbook,
  workbookToBase64,
  type GroupExportSheetLabels,
} from '@/data/groupExportXlsx';
import { friendlyError } from '@/lib/errors';
import { router } from '@/lib/navigation';
import { printAvailable, printHtmlToFile } from '@/lib/print';
import { useAuth } from '@/lib/auth';
import { plural, useStrings } from '@/i18n';
import { inviteCardBackground } from '@/components/invite/inviteCardBackgrounds';
import { TYPE_ICON } from '@/components/invite/inviteCardModel';
import { useBottomClearance } from '@/lib/clearance';

/** The correct OOXML spreadsheet MIME type + Apple UTI for an .xlsx. */
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const XLSX_UTI = 'org.openxmlformats.spreadsheetml.sheet';

enum Format {
  Pdf = 'pdf',
  Excel = 'excel',
}

// File-type hues for the format cards and the settlements row. The app palette
// is deliberately green-free, so these are local to this screen.
const PDF_RED = { fill: '#FDE7E9', ink: '#E5484D' };
const EXCEL_GREEN = { fill: '#DDF3E4', ink: '#1D7A45' };

const BANNER_HEIGHT = 88;

/** A filesystem-safe slug for the group name, so the shared file is recognisable. */
function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'group';
}

/**
 * A per-group export to PDF or Excel (a client-side statement built from the
 * local mirror — distinct from the account-wide data export under Settings).
 *
 * Reached from the group's ••• overflow menu. Everything is assembled on device
 * from data already read for the group screen, so it works offline. The PDF path
 * leans on expo-print, a native module that may be missing from an older binary
 * (an OTA update landed the dependency before a native rebuild shipped); that
 * case shows an "update the app" message rather than crashing. The Excel path is
 * pure JS (SheetJS) and always works.
 */
export default function GroupExportScreen() {
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const { id } = useLocalSearchParams<{ id: string }>();
  const groupId = id ?? '';
  const { profile } = useAuth();
  const { blockedIds } = useBlockedUsers();

  const { group, members, expenses, settlements } = useGroup(groupId);
  const ledger = useGroupLedger(groupId, profile?.id ?? null);

  const [format, setFormat] = useState<Format>(Format.Pdf);
  const [include, setInclude] = useState<ExportInclude>(INCLUDE_ALL);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const groupData = group.data;
  const title = groupLabel(groupData, members.data ?? [], profile?.id);
  const nothingIncluded = !include.balances && !include.expenses && !include.settlements;
  const toggle = (key: keyof ExportInclude): void =>
    setInclude((current) => ({ ...current, [key]: !current[key] }));

  /** The visible document labels the PDF renderer needs. */
  const pdfLabels = (): GroupExportLabels => ({
    documentTitle: t.groupExport.documentTitle,
    generatedOn: t.groupExport.generatedOn,
    totalSpent: t.groupExport.totalSpent,
    membersLabel: t.groupExport.membersLabel,
    expensesLabel: t.groupExport.expensesLabel,
    settlementsLabel: t.groupExport.settlementsLabel,
    balancesTitle: t.groupExport.balancesTitle,
    membersTitle: t.groupExport.membersTitle,
    colDate: t.groupExport.colDate,
    colDescription: t.groupExport.colDescription,
    colCategory: t.groupExport.colCategory,
    colPaidBy: t.groupExport.colPaidBy,
    colAmount: t.groupExport.colAmount,
    colParticipants: t.groupExport.colParticipants,
    colFrom: t.groupExport.colFrom,
    colTo: t.groupExport.colTo,
    colMethod: t.groupExport.colMethod,
    colStatus: t.groupExport.colStatus,
    colMember: t.groupExport.colMember,
    colRole: t.groupExport.colRole,
    colBalance: t.groupExport.colBalance,
    colDirection: t.groupExport.colDirection,
    noneYet: t.groupExport.noneYet,
    deletedTag: t.groupExport.deletedTag,
    footer: t.groupExport.footer,
  });

  /** The visible sheet + column labels the Excel builder needs. */
  const sheetLabels = (): GroupExportSheetLabels => ({
    sheetSummary: t.groupExport.sheetSummary,
    sheetExpenses: t.groupExport.sheetExpenses,
    sheetSettlements: t.groupExport.sheetSettlements,
    sheetBalances: t.groupExport.sheetBalances,
    sheetMembers: t.groupExport.sheetMembers,
    fieldGroup: t.groupExport.fieldGroup,
    fieldType: t.groupExport.fieldType,
    fieldCurrency: t.groupExport.fieldCurrency,
    fieldGeneratedOn: t.groupExport.fieldGeneratedOn,
    fieldMembers: t.groupExport.fieldMembers,
    fieldExpenses: t.groupExport.fieldExpenses,
    fieldSettlements: t.groupExport.fieldSettlements,
    fieldTotalSpent: t.groupExport.fieldTotalSpent,
    colDate: t.groupExport.colDate,
    colDescription: t.groupExport.colDescription,
    colCategory: t.groupExport.colCategory,
    colPaidBy: t.groupExport.colPaidBy,
    colParticipants: t.groupExport.colParticipants,
    colAmount: t.groupExport.colAmount,
    colDisplay: t.groupExport.colDisplay,
    colCurrency: t.groupExport.colCurrency,
    colDeleted: t.groupExport.colDeleted,
    colFrom: t.groupExport.colFrom,
    colTo: t.groupExport.colTo,
    colMethod: t.groupExport.colMethod,
    colStatus: t.groupExport.colStatus,
    colCount: t.groupExport.colCount,
    colMember: t.groupExport.colMember,
    colRole: t.groupExport.colRole,
    colDirection: t.groupExport.colDirection,
    colBalance: t.groupExport.colBalance,
    colJoined: t.groupExport.colJoined,
    yes: t.groupExport.yes,
    no: t.groupExport.no,
  });

  const run = async (): Promise<void> => {
    if (!groupData || nothingIncluded) return;
    setBusy(true);
    setError(null);
    setDone(null);

    // Guard the native path up front so a stale binary never renders a PDF that
    // cannot be produced — the Excel path is pure JS and never blocked.
    if (format === Format.Pdf && !printAvailable()) {
      setError(t.groupExport.updateNeeded);
      setBusy(false);
      return;
    }

    try {
      // Captured in the handler, never in render (React Compiler: no clock reads
      // during render).
      const generatedOnIso = new Date().toISOString();

      const typeLabel =
        t.groupExport.types[(groupData.type as GroupType) ?? GroupType.Other] ??
        t.groupExport.types.other;

      const model = buildGroupExportModel({
        group: {
          name: title,
          coverEmoji: groupData.cover_emoji,
          type: groupData.type,
          currency: groupData.default_currency,
        },
        members: (members.data ?? []).map((member) => ({
          id: member.id,
          name: displayName(member, profile?.id, blockedIds, t.misc.someone),
          role: member.role,
          isGhost: isGhost(member),
        })),
        // `expenses.rows` is the queue-replayed render list; `settlements.data`
        // is the mirror's settlement rows. Both already read for this group.
        expenses: expenses.rows,
        settlements: settlements.data ?? [],
        balances: ledger.balances,
        labels: {
          appName: t.common.appName,
          groupType: typeLabel,
          categories: t.categories,
          methods: {
            [SettlementMethod.Upi]: t.groupExport.methods.upi,
            [SettlementMethod.Cash]: t.groupExport.methods.cash,
            [SettlementMethod.Bank]: t.groupExport.methods.bank,
            [SettlementMethod.Other]: t.groupExport.methods.other,
          },
          untitled: t.expense.untitled,
          roleAdmin: t.groupExport.roleAdmin,
          roleMember: t.groupExport.roleMember,
          notJoined: t.groupExport.notJoined,
          someone: t.misc.someone,
          owed: t.groupExport.owed,
          owes: t.groupExport.owes,
          settled: t.groupExport.settled,
        },
        generatedOnIso,
        locale,
      });

      const base = `waves-${slugify(title)}`;

      if (format === Format.Pdf) {
        const html = renderGroupExportHtml(model, pdfLabels(), include);
        const uri = await printHtmlToFile(html);
        // Null means expo-print is not linked in this build (checked above too,
        // but the module can vanish between the guard and here on a hot reload).
        if (!uri) {
          setError(t.groupExport.updateNeeded);
          return;
        }
        // The rendered PDF holds the same group statement as the workbook —
        // member names, amounts, balances — so it must not linger in the cache
        // after sharing any more than the XLSX file does. Best-effort delete in a
        // finally, the same cleanup the Excel branch below performs.
        const pdf = new FileSystem.File(uri);
        try {
          if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(uri, {
              mimeType: 'application/pdf',
              dialogTitle: t.groupExport.shareTitle,
              UTI: 'com.adobe.pdf',
            });
          }
        } finally {
          try {
            if (pdf.exists) pdf.delete();
          } catch {
            // Best-effort privacy cleanup; the share result still drives the UI.
          }
        }
        setDone(`${base}.pdf`);
      } else {
        const workbook = buildGroupExportWorkbook(model, sheetLabels(), include);
        const base64 = workbookToBase64(workbook);

        // expo-file-system 57 API: File/Paths, base64 decoded to bytes — the
        // exact write+share+cleanup pattern the settings export uses.
        const filename = `${base}.xlsx`;
        const file = new FileSystem.File(FileSystem.Paths.cache, filename);
        if (file.exists) file.delete();
        file.create();
        const bytes = new Uint8Array(decode(base64));
        file.write(bytes);

        try {
          if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(file.uri, {
              mimeType: XLSX_MIME,
              dialogTitle: t.groupExport.shareTitle,
              UTI: XLSX_UTI,
            });
          }
        } finally {
          try {
            if (file.exists) file.delete();
          } catch {
            // Best-effort privacy cleanup; the share result still drives the UI.
          }
        }
        setDone(`${filename} · ${Math.ceil(bytes.byteLength / 1024)} KB`);
      }
    } catch (caught) {
      setError(friendlyError(caught, t.groupExport.exportFailed, 'groupExport.run'));
    } finally {
      setBusy(false);
    }
  };

  const memberTotal = (members.data ?? []).length;
  const expenseTotal = expenses.rows.length;
  const rtl = I18nManager.isRTL;
  const cardBg = theme.color.surface;

  return (
    <Screen>
      <Row style={{ paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.md }}>
        <IconButton label={t.common.back} onPress={() => router.back()}>
          <Ionicons
            name={directionalIcon('chevron-back')}
            size={iconSize.lg}
            color={theme.color.text}
          />
        </IconButton>
        <View style={{ flex: 1 }}>
          <Text variant="heading">{t.groupExport.title}</Text>
          <Text variant="caption" tone="muted">
            {t.groupExport.subtitle}
          </Text>
        </View>
      </Row>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          paddingTop: theme.spacing.lg,
          paddingBottom: clearance,
          gap: theme.spacing.xl,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[{ backgroundColor: cardBg, borderRadius: theme.radius.lg }, theme.shadow.soft]}
        >
          <View style={{ borderRadius: theme.radius.lg, overflow: 'hidden' }}>
            <Image
              source={inviteCardBackground(groupData?.type)}
              contentFit="cover"
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                end: 0,
                width: '62%',
              }}
            />
            <LinearGradient
              colors={[cardBg, `${cardBg}00`]}
              start={{ x: rtl ? 1 : 0, y: 0 }}
              end={{ x: rtl ? 0 : 1, y: 0 }}
              locations={[0.35, 0.95]}
              style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0 }}
            />
            <Row
              style={{
                gap: theme.spacing.lg,
                padding: theme.spacing.lg,
                minHeight: BANNER_HEIGHT,
              }}
            >
              <View
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.color.positiveSoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons
                  name={TYPE_ICON[groupData?.type ?? ''] ?? 'people'}
                  size={iconSize.xl}
                  color={theme.color.positive}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="subheading" numberOfLines={1}>
                  {title}
                </Text>
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {plural(locale, memberTotal, t.memberCount)}
                  {' • '}
                  {plural(locale, expenseTotal, t.importLedger.expenseCount)}
                </Text>
              </View>
            </Row>
          </View>
        </View>

        <Text variant="caption" tone="muted">
          {t.groupExport.intro}
        </Text>

        <View style={{ gap: theme.spacing.md }}>
          <Text variant="caption" tone="muted">
            {t.groupExport.formatLabel}
          </Text>
          <Row style={{ gap: theme.spacing.md, alignItems: 'stretch' }}>
            <FormatCard
              selected={format === Format.Pdf}
              onPress={() => setFormat(Format.Pdf)}
              tone={PDF_RED}
              icon="file-pdf-box"
              title={t.groupExport.pdf}
              hint={t.groupExport.pdfHint}
            />
            <FormatCard
              selected={format === Format.Excel}
              onPress={() => setFormat(Format.Excel)}
              tone={EXCEL_GREEN}
              icon="microsoft-excel"
              title={t.groupExport.excel}
              hint={t.groupExport.excelHint}
            />
          </Row>
        </View>

        <View style={{ gap: theme.spacing.md }}>
          <Text variant="caption" tone="muted">
            {t.groupExport.includeLabel}
          </Text>
          <Card padded={false}>
            <IncludeRow
              checked={include.balances}
              onPress={() => toggle('balances')}
              tone={{ fill: theme.color.brandSoft, ink: theme.color.brand }}
              icon="people-outline"
              title={t.groupExport.includeBalances}
              hint={t.groupExport.includeBalancesHint}
            />
            <IncludeRow
              checked={include.expenses}
              onPress={() => toggle('expenses')}
              tone={{ fill: theme.color.positiveSoft, ink: theme.color.positive }}
              icon="list-outline"
              title={t.groupExport.includeExpenses}
              hint={t.groupExport.includeExpensesHint}
              divided
            />
            <IncludeRow
              checked={include.settlements}
              onPress={() => toggle('settlements')}
              tone={EXCEL_GREEN}
              icon="swap-horizontal"
              title={t.groupExport.includeSettlements}
              hint={t.groupExport.includeSettlementsHint}
              divided
            />
          </Card>
        </View>

        <Gradient radius={theme.radius.pill} style={theme.shadow.soft}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.groupExport.generate}
            accessibilityState={{ disabled: busy || !groupData || nothingIncluded }}
            disabled={busy || !groupData || nothingIncluded}
            onPress={() => void run()}
            style={({ pressed }) => ({
              minHeight: 56,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: theme.spacing.sm,
              opacity: busy || !groupData || nothingIncluded ? 0.5 : pressed ? 0.85 : 1,
            })}
          >
            <Ionicons name="document-text-outline" size={iconSize.md} color={theme.color.onBrand} />
            <Text variant="subheading" tone="onBrand">
              {busy ? t.groupExport.preparing : t.groupExport.generate}
            </Text>
          </Pressable>
        </Gradient>
        {busy ? <ActivityIndicator color={theme.color.brand} /> : null}

        {done ? (
          <Card style={{ gap: theme.spacing.sm }}>
            <Text variant="subheading" tone="positive">
              {t.groupExport.ready}
            </Text>
            <Text variant="caption" tone="muted">
              {done}
            </Text>
            {Platform.OS === 'web' ? (
              <Text variant="micro" tone="muted">
                {t.groupExport.webNote}
              </Text>
            ) : null}
          </Card>
        ) : null}

        {error ? <Callout tone="negative">{error}</Callout> : null}
      </ScrollView>
    </Screen>
  );
}

interface Tone {
  readonly fill: string;
  readonly ink: string;
}

/** A soft-tinted circle holding a glyph. */
function TintCircle({ tone, size, children }: { tone: Tone; size: number; children: ReactNode }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: tone.fill,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {children}
    </View>
  );
}

/** One of the two side-by-side format cards: purple border + filled tick when picked. */
function FormatCard({
  selected,
  onPress,
  tone,
  icon,
  title,
  hint,
}: {
  selected: boolean;
  onPress: () => void;
  tone: Tone;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  title: string;
  hint: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={title}
      onPress={onPress}
      style={[
        {
          flex: 1,
          gap: theme.spacing.xs,
          padding: theme.spacing.lg,
          backgroundColor: theme.color.surface,
          borderRadius: theme.radius.lg,
          borderWidth: 1.5,
          borderColor: selected ? theme.color.brand : theme.color.border,
        },
        theme.shadow.soft,
      ]}
    >
      <View style={{ position: 'absolute', top: theme.spacing.md, end: theme.spacing.md }}>
        {selected ? (
          <View
            style={{
              width: 24,
              height: 24,
              borderRadius: 12,
              backgroundColor: theme.color.brand,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="checkmark" size={iconSize.sm} color={theme.color.onBrand} />
          </View>
        ) : (
          <View
            style={{
              width: 24,
              height: 24,
              borderRadius: 12,
              borderWidth: 1.5,
              borderColor: theme.color.textFaint,
            }}
          />
        )}
      </View>
      <TintCircle tone={tone} size={52}>
        <MaterialCommunityIcons name={icon} size={30} color={tone.ink} />
      </TintCircle>
      <Text variant="subheading" style={{ marginTop: theme.spacing.xs }}>
        {title}
      </Text>
      <Text variant="caption" tone="muted">
        {hint}
      </Text>
    </Pressable>
  );
}

/** A row of the "Include" list: tinted icon, title + hint, purple checkbox. */
function IncludeRow({
  checked,
  onPress,
  tone,
  icon,
  title,
  hint,
  divided = false,
}: {
  checked: boolean;
  onPress: () => void;
  tone: Tone;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  hint: string;
  divided?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={title}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: theme.spacing.md,
        borderTopWidth: divided ? 1 : 0,
        borderTopColor: theme.color.border,
      }}
    >
      <TintCircle tone={tone} size={40}>
        <Ionicons name={icon} size={iconSize.md} color={tone.ink} />
      </TintCircle>
      <View style={{ flex: 1 }}>
        <Text variant="subheading">{title}</Text>
        <Text variant="caption" tone="muted">
          {hint}
        </Text>
      </View>
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: 7,
          borderWidth: 1.5,
          borderColor: checked ? theme.color.brand : theme.color.textFaint,
          backgroundColor: checked ? theme.color.brand : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {checked ? (
          <Ionicons name="checkmark" size={iconSize.sm} color={theme.color.onBrand} />
        ) : null}
      </View>
    </Pressable>
  );
}
