'use client';

import { useEffect, useState } from 'react';

import {
  ticketDueIn,
  ticketSpan,
  type CompanyTicket,
  type TicketPriority,
  type TicketStatus,
} from '@waves/core';

import { fill } from '@/i18n';
import { useStrings } from '@/i18n-context';
import { ticketEscalation, type TicketsView } from './tickets';

/** The current instant, refreshed every minute so "Due in 3h" and escalations keep up. */
export function useNow(everyMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

export function useTicketText() {
  const s = useStrings().t.company.clients.tk;
  const span = (ms: number): string => {
    const { n, unit } = ticketSpan(ms);
    return fill({ m: s.unitM, h: s.unitH, d: s.unitD }[unit], { n });
  };
  const priority = (p: TicketPriority) =>
    ({ low: s.pLow, normal: s.pNormal, high: s.pHigh, urgent: s.pUrgent })[p];
  const status = (st: TicketStatus) =>
    ({ open: s.stOpen, in_progress: s.stInProgress, resolved: s.stResolved, closed: s.stClosed })[
      st
    ];
  const due = (
    tk: CompanyTicket,
    now: number,
    view: Pick<TicketsView, 'hierarchy' | 'memberName'>,
  ) => {
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
