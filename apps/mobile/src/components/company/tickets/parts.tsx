import { View } from 'react-native';

import {
  ticketDueIn,
  ticketNumber,
  ticketSpan,
  type CompanyTicket,
  type TicketPriority,
  type TicketStatus,
} from '@waves/core';
import { Text, useTheme } from '@waves/ui';

import { PersonAvatar } from '@/components/PersonAvatar';
import { ListRow } from '@/components/standard';
import { ticketEscalation, type TicketsView } from '@/data/companyTickets';
import { fill, useStrings } from '@/i18n';

/** Wording for priorities, statuses and due times, from the current language. */
export function useTicketText() {
  const { t } = useStrings();
  const s = t.companyTickets;
  const span = (ms: number): string => {
    const { n, unit } = ticketSpan(ms);
    return fill({ m: s.unitM, h: s.unitH, d: s.unitD }[unit], { n });
  };
  const priority = (p: TicketPriority) =>
    ({ low: s.pLow, normal: s.pNormal, high: s.pHigh, urgent: s.pUrgent })[p];
  const status = (st: TicketStatus) =>
    ({
      open: s.stOpen,
      in_progress: s.stInProgress,
      resolved: s.stResolved,
      closed: s.stClosed,
    })[st];
  /** "Due in 3h", or "Overdue 1d · Escalated to Meera" once late; the status once it is no longer open. */
  const due = (
    tk: CompanyTicket,
    now: number,
    view: Pick<TicketsView, 'hierarchy' | 'memberName'>,
  ): { text: string; late: boolean } => {
    if (tk.status === 'resolved' || tk.status === 'closed')
      return { text: status(tk.status), late: false };
    const ms = ticketDueIn(tk, now);
    const esc = ticketEscalation(view, tk, now);
    if (esc.level === 0) return { text: fill(s.dueIn, { t: span(ms) }), late: false };
    return {
      text: `${fill(s.overdue, { t: span(ms) })} · ${fill(s.escalatedTo, { name: esc.name || s.owner })}`,
      late: true,
    };
  };
  return { priority, status, due, span };
}

export function PriorityChip({ priority }: { priority: TicketPriority }) {
  const theme = useTheme();
  const c = theme.color;
  const { priority: label } = useTicketText();
  const look = {
    low: [c.surfaceMuted, c.textMuted],
    normal: [c.brandSoft, c.brand],
    high: [c.warningSoft, c.warning],
    urgent: [c.negativeSoft, c.negative],
  }[priority];
  return (
    <View
      style={{
        backgroundColor: look[0],
        borderRadius: theme.radius.sm,
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: 2,
      }}
    >
      <Text variant="micro" style={{ color: look[1], fontWeight: '700' }}>
        {label(priority)}
      </Text>
    </View>
  );
}

export function StatusPill({ status }: { status: TicketStatus }) {
  const theme = useTheme();
  const c = theme.color;
  const { status: label } = useTicketText();
  const look = {
    open: [c.warningSoft, c.warning],
    in_progress: [c.brandSoft, c.brand],
    resolved: [c.positiveSoft, c.positive],
    closed: [c.surfaceMuted, c.textMuted],
  }[status];
  return (
    <View
      style={{
        backgroundColor: look[0],
        borderRadius: theme.radius.sm,
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: 2,
      }}
    >
      <Text variant="micro" style={{ color: look[1], fontWeight: '700' }}>
        {label(status)}
      </Text>
    </View>
  );
}

/** One complaint in a list: client (or title), title and number, assignee, priority and when it is due. */
export function TicketRow({
  ticket,
  now,
  view,
  divider,
  onPress,
}: {
  ticket: CompanyTicket;
  now: number;
  view: TicketsView;
  divider: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { due } = useTicketText();
  const d = due(ticket, now, view);
  const num = ticket.number > 0 ? ticketNumber(ticket.number) : '';
  return (
    <ListRow
      divider={divider}
      title={ticket.clientName ?? ticket.title}
      subtitle={[ticket.clientName ? ticket.title : null, num].filter(Boolean).join(' · ')}
      leading={<PersonAvatar name={view.memberName(ticket.assigneeMemberId) || '?'} size={36} />}
      trailing={
        <View style={{ alignItems: 'flex-end', gap: 2, maxWidth: 170 }}>
          <PriorityChip priority={ticket.priority} />
          <Text
            variant="micro"
            numberOfLines={2}
            style={{
              textAlign: 'right',
              fontWeight: '700',
              color: d.late ? theme.color.negative : theme.color.textMuted,
            }}
          >
            {d.text}
          </Text>
        </View>
      }
      onPress={onPress}
    />
  );
}
