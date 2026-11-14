/**
 * Ask about my spending (Me tab): one question, one answer, from your own ledger.
 *
 * The server builds a digest of the person's personal entries and the model only
 * phrases the answer; the figures under it (the facts, the subscriptions) are
 * computed there, not by the model, and are shown whatever the model said. A
 * single shot, not a chat: the question stays above its answer, a new question
 * clears the old answer so one can never look like the reply to the other, and a
 * failed ask keeps what was typed.
 *
 * Free people see the paywall card up front rather than after typing: the plan
 * gate is the server's, the screen only decides what to show.
 */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from '@/lib/navigation';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';

import { format, money } from '@waves/core';
import { Button, Callout, Card, iconSize, Row, Screen, Text, useTheme } from '@waves/ui';

import { PersonalGuard } from '@/components/PersonalGuard';
import { todayIso } from '@/data/personal';
import { fill, useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { useDefaultCurrency } from '@/lib/currency';
import { callSpendingAsk, type AskAnswer } from '@/lib/spendingAsk/client';
import { useEntitlement } from '@/lib/useEntitlement';

const MAX = 500;
/** Shown once the question is this close to the limit. */
const COUNTER_FROM = 400;

type State =
  | { name: 'idle' }
  | { name: 'asking'; question: string }
  | { name: 'answered'; question: string; answer: AskAnswer }
  | { name: 'error'; message: string };

function AskScreenBody() {
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const s = t.spendingAsk;
  const { isPaid } = useEntitlement();
  const dc = useDefaultCurrency();
  const [text, setText] = useState('');
  const [state, setState] = useState<State>({ name: 'idle' });

  const today = todayIso();
  const from = `${today.slice(0, 7)}-01`;
  const fmt = (minor: string, currency: string): string => {
    const neg = minor.startsWith('-');
    const out = format(money(BigInt(neg ? minor.slice(1) : minor), currency as never), { locale });
    return neg ? `−${out}` : out;
  };

  const ask = async (): Promise<void> => {
    const question = text.trim();
    if (!question || state.name === 'asking') return;
    setState({ name: 'asking', question });
    const result = await callSpendingAsk({ question, from, to: today, currency: dc });
    if (result.kind === 'ok') {
      setState({ name: 'answered', question, answer: result.answer });
    } else if (result.kind === 'paid') {
      router.push('/paywall');
      setState({ name: 'idle' });
    } else {
      setState({
        name: 'error',
        message:
          result.kind === 'quota'
            ? fill(s.quota, { limit: result.limit })
            : result.kind === 'rate'
              ? s.rate
              : result.kind === 'unavailable'
                ? s.unavailable
                : s.failed,
      });
    }
  };

  const busy = state.name === 'asking';
  const cadenceLabel = { monthly: s.monthly, weekly: s.weekly, yearly: s.yearly } as const;

  return (
    <Screen>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: clearance,
          gap: theme.spacing.md,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingTop: theme.spacing.sm, gap: theme.spacing.xs }}>
          <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
            <Ionicons name="sparkles-outline" size={iconSize.lg} color={theme.color.brand} />
            <Text
              accessibilityRole="header"
              style={{ fontSize: 26, lineHeight: 32, fontWeight: '800' }}
            >
              {s.title}
            </Text>
          </Row>
          <Text tone="muted">{s.sub}</Text>
          <Text variant="caption" tone="muted">
            {fill(s.period, { from, to: today })}
          </Text>
        </View>

        {!isPaid ? (
          <Card style={{ gap: theme.spacing.sm }}>
            <Text style={{ fontWeight: '700' }}>{s.paywallTitle}</Text>
            <Text tone="muted">{s.paywallBody}</Text>
            <Button label={s.unlock} onPress={() => router.push('/paywall')} />
          </Card>
        ) : null}

        {/* Stacked, not a row of chips: the questions are long and wrap at phone width.
            A tap fills the box; the person still presses Ask. */}
        <View style={{ gap: theme.spacing.sm }}>
          {[s.q1, s.q2, s.q3].map((q) => (
            <Pressable
              key={q}
              accessibilityRole="button"
              accessibilityLabel={q}
              disabled={busy}
              onPress={() => setText(q)}
              style={{
                paddingVertical: theme.spacing.md,
                paddingHorizontal: theme.spacing.lg,
                borderRadius: theme.radius.lg,
                borderWidth: 1,
                borderColor: theme.color.border,
                backgroundColor: theme.color.surface,
                minHeight: 48,
                justifyContent: 'center',
              }}
            >
              <Text>{q}</Text>
            </Pressable>
          ))}
        </View>

        <Card style={{ gap: theme.spacing.sm }}>
          <TextInput
            value={text}
            onChangeText={(v) => setText(v.slice(0, MAX))}
            maxLength={MAX}
            multiline
            editable={!busy}
            accessibilityLabel={s.placeholder}
            placeholder={s.placeholder}
            placeholderTextColor={theme.color.textFaint}
            style={{
              minHeight: 56,
              fontSize: 16,
              color: theme.color.text,
              textAlignVertical: 'top',
            }}
          />
          <Row
            style={{ alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.md }}
          >
            <Text variant="micro" tone="muted">
              {text.length >= COUNTER_FROM ? fill(s.counter, { n: text.length, max: MAX }) : ''}
            </Text>
            <Button
              label={s.send}
              disabled={!isPaid || busy || text.trim() === ''}
              onPress={() => void ask()}
            />
          </Row>
        </Card>

        {busy ? (
          <Row
            style={{ alignItems: 'center', gap: theme.spacing.sm }}
            accessibilityLiveRegion="polite"
          >
            <ActivityIndicator color={theme.color.brand} />
            <Text tone="muted">{s.asking}</Text>
          </Row>
        ) : null}

        {state.name === 'error' ? <Callout tone="negative">{state.message}</Callout> : null}

        {state.name === 'answered' ? (
          <View style={{ gap: theme.spacing.md }} accessibilityLiveRegion="polite">
            <Card style={{ gap: theme.spacing.sm }}>
              <Text variant="micro" tone="muted">
                {s.yourQuestion}
              </Text>
              <Text style={{ fontWeight: '600' }}>{state.question}</Text>
              <View style={{ height: 1, backgroundColor: theme.color.border }} />
              <Text style={{ lineHeight: 22 }}>{state.answer.answer}</Text>
              <Text variant="micro" tone="muted">
                {s.ledgerNote}
              </Text>
            </Card>

            {state.answer.facts.length > 0 ? (
              <Card style={{ gap: theme.spacing.sm }}>
                <Text style={{ fontWeight: '700' }}>{s.facts}</Text>
                {state.answer.facts.map((f, i) => (
                  <Row key={i} style={{ justifyContent: 'space-between', gap: theme.spacing.md }}>
                    <Text style={{ flex: 1 }}>{f.label}</Text>
                    <Text style={{ fontWeight: '700', fontVariant: ['tabular-nums'] }}>
                      {fmt(f.amountMinor, f.currency)}
                    </Text>
                  </Row>
                ))}
              </Card>
            ) : null}

            {state.answer.subscriptions.length > 0 ? (
              <Card style={{ gap: theme.spacing.sm }}>
                <Text style={{ fontWeight: '700' }}>{s.subscriptions}</Text>
                <Text variant="caption" tone="muted">
                  {s.subscriptionsHint}
                </Text>
                {state.answer.subscriptions.map((sub, i) => (
                  <Row
                    key={i}
                    style={{
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: theme.spacing.md,
                    }}
                  >
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text
                        numberOfLines={1}
                        style={{ fontWeight: '600', textTransform: 'capitalize' }}
                      >
                        {sub.merchant}
                      </Text>
                      <Text variant="caption" tone="muted">
                        {cadenceLabel[sub.cadence]} · {fill(s.lastCharge, { date: sub.lastDate })}
                      </Text>
                    </View>
                    <Text style={{ fontWeight: '700', fontVariant: ['tabular-nums'] }}>
                      {fmt(sub.amountMinor, sub.currency)}
                    </Text>
                  </Row>
                ))}
              </Card>
            ) : null}

            <Button
              label={s.askAnother}
              variant="ghost"
              onPress={() => {
                setText('');
                setState({ name: 'idle' });
              }}
            />
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

export default function AskScreen() {
  return (
    <PersonalGuard>
      <AskScreenBody />
    </PersonalGuard>
  );
}
