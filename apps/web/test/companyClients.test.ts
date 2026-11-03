import { describe, expect, it } from 'vitest';

import {
  addFollowUpPayload,
  clientNotePayload,
  clientSetPayload,
  completeFollowUpPayloads,
  inquiryRejectPayload,
  inquirySetPayload,
  stageChange,
} from '@/lib/company/clients';
import { ticketInput, ticketSetPayload, ticketStatusPayload } from '@/lib/company/tickets';

describe('company client payloads', () => {
  it('trims and nulls blanks; keeps the id on a save', () => {
    const { clientId, payload } = clientSetPayload(
      {
        name: ' Asha ',
        phone: ' ',
        need: ' x ',
        address: '',
        stage: 'lead',
        lostReason: 'no',
      } as never,
      'new-id',
    );
    expect(clientId).toBe('new-id');
    expect(payload).toMatchObject({
      name: 'Asha',
      phone: null,
      need: 'x',
      address: null,
      lostReason: null,
    });
    expect(
      clientSetPayload({ clientId: 'c1', name: 'B', stage: 'lost', lostReason: ' r ' } as never)
        .payload,
    ).toMatchObject({
      clientId: 'c1',
      lostReason: 'r',
    });
  });
  it('stageChange carries the client fields', () => {
    const c = {
      id: 'c',
      name: 'N',
      phone: null,
      need: null,
      source: null,
      expectedValueMinor: 5n,
      address: null,
      ownerMemberId: 'm',
    };
    expect(stageChange(c as never, 'won')).toMatchObject({
      clientId: 'c',
      expectedValueMinor: '5',
      stage: 'won',
      lostReason: null,
    });
  });
  it('inquiry, reject, note', () => {
    expect(
      inquirySetPayload({ title: 'a'.repeat(200), details: ' ' } as never, 'i').payload,
    ).toMatchObject({ inquiryId: 'i', details: null });
    expect(
      inquiryRejectPayload({ inquiryId: 'i', rejected: false, reason: 'x' }).reason,
    ).toBeNull();
    expect(clientNotePayload({ clientId: 'c', body: ' hi ' }, 'n')).toEqual({
      noteId: 'n',
      clientId: 'c',
      body: 'hi',
    });
  });
  it('follow-ups', () => {
    expect(
      addFollowUpPayload({ clientId: 'c', memberId: 'm', day: '2026-01-01', title: 't' }, 'k'),
    ).toMatchObject({ taskId: 'k', status: 'todo', clientId: 'c' });
    const task = {
      id: 't1',
      memberId: 'm',
      day: '2026-01-01',
      title: 'T',
      projectId: null,
      note: null,
      dueTime: null,
      clientId: 'c',
    };
    const out = completeFollowUpPayloads(task as never, 'none', '2026-01-02', 'n2');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ status: 'done', taskId: 't1' });
  });
});

describe('company ticket payloads', () => {
  it('set, reassign round-trip, status', () => {
    const { payload } = ticketSetPayload(
      {
        clientId: 'c',
        title: ' T ',
        details: '',
        priority: 'high',
        assigneeMemberId: null,
        dueAt: null,
      } as never,
      't',
    );
    expect(payload).toMatchObject({ ticketId: 't', title: 'T', details: null });
    const t = {
      id: 'x',
      clientId: 'c',
      title: 'T',
      details: null,
      priority: 'high',
      assigneeMemberId: 'm',
      dueAt: null,
    };
    expect(ticketInput(t as never).ticketId).toBe('x');
    expect(
      ticketStatusPayload({ ticketId: 'x', status: 'solved' as never, note: ' ' }).note,
    ).toBeNull();
  });
});
