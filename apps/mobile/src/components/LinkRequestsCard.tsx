/**
 * "Madan says you are Renny in Goa trip — Yes, that is me / Not me."
 *
 * The in-app half of a member link request (link_placeholder_member), for the
 * person asked. It sits above the group list on Home and is the whole of the
 * `/link-requests` screen a push lands on. Nothing is drawn when nothing is
 * waiting, so Home pays nothing for it on an ordinary day.
 *
 * Accepting is the claim: the placeholder row becomes theirs, history and all,
 * and the group appears in their list. "Not me" tells the asker and leaves the
 * placeholder as it was.
 */

import { useState } from 'react';
import { View } from 'react-native';

import { Button, Callout, Card, Row, Text, useTheme } from '@waves/ui';

import { useDecideMemberLink, useMyMemberLinks } from '@/data/hooks';
import { fill, useStrings } from '@/i18n';
import { friendlyError } from '@/lib/errors';
import { linkReasonText } from '@/lib/linkMember';
import { PersonAvatar } from '@/components/PersonAvatar';

export function LinkRequestsCard({
  enabled = true,
  showEmpty = false,
}: {
  /** False while signed out: there is nobody to ask for. */
  enabled?: boolean;
  /** The dedicated screen says so when there is nothing; Home stays quiet. */
  showEmpty?: boolean;
}): React.JSX.Element | null {
  const theme = useTheme();
  const { t } = useStrings();
  const asks = useMyMemberLinks(enabled);
  const decide = useDecideMemberLink();
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);

  const rows = asks.data ?? [];
  if (rows.length === 0 && !note) {
    if (!showEmpty) return null;
    return (
      <Text variant="caption" tone="muted">
        {t.link.empty}
      </Text>
    );
  }

  const answer = (requestId: string, groupName: string, accept: boolean): void => {
    setNote(null);
    decide.mutate(
      { requestId, accept },
      {
        onSuccess: (verdict) => {
          if (verdict.ok) {
            setNote({
              ok: true,
              text: accept ? fill(t.link.accepted, { group: groupName }) : t.link.declined,
            });
            return;
          }
          setNote({ ok: false, text: linkReasonText(verdict.reason, t) });
        },
        onError: (caught) =>
          setNote({ ok: false, text: friendlyError(caught, t.link.failed, 'link.decide') }),
      },
    );
  };

  return (
    <Card style={{ gap: theme.spacing.md }}>
      <Text variant="subheading">{t.link.cardTitle}</Text>
      {note ? <Callout tone={note.ok ? 'positive' : 'negative'}>{note.text}</Callout> : null}
      {rows.map((ask) => {
        const group = ask.group_name ?? t.misc.unnamed;
        return (
          <View key={ask.id} style={{ gap: theme.spacing.sm }}>
            <Row style={{ gap: theme.spacing.md, alignItems: 'center' }}>
              <PersonAvatar name={ask.ghost_name ?? '?'} ghost />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text variant="body">
                  {fill(t.link.cardBody, {
                    who: ask.requester_name ?? t.misc.someone,
                    name: ask.ghost_name ?? t.misc.unnamed,
                    group,
                  })}
                </Text>
                <Text variant="caption" tone="muted">
                  {t.link.cardHint}
                </Text>
              </View>
            </Row>
            <Row style={{ gap: theme.spacing.sm }}>
              <Button
                label={t.link.accept}
                size="sm"
                disabled={decide.isPending}
                onPress={() => answer(ask.id, group, true)}
              />
              <Button
                label={t.link.notMe}
                size="sm"
                variant="secondary"
                disabled={decide.isPending}
                onPress={() => answer(ask.id, group, false)}
              />
            </Row>
          </View>
        );
      })}
    </Card>
  );
}
