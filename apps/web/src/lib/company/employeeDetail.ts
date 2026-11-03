'use client';

/** Employee detail writes (rate, team, id, employment, type, sites) with payloads exactly as the mobile hooks send them. */
import { employeeIdTaken, MutationKind, normaliseEmployeeId } from '@waves/core';

import { useSync } from '@/lib/sync';
import { supabase } from '@/lib/waves';
import type { CompanyMember as MemberRow } from './view';

export function useEmployeeActions(groupId: string) {
  const { mutate, refresh } = useSync();
  return {
    setRate: (i: { memberId: string; dailyRateMinor: string | null }) =>
      mutate(MutationKind.CompanyMemberRateSet, groupId, { ...i }),
    setMileageRate: (i: { memberId: string | null; rateMinor: string | null }) =>
      mutate(MutationKind.CompanyMileageRateSet, groupId, { ...i }),
    assign: (i: { memberId: string; managerId: string | null; reason: string }) =>
      mutate(MutationKind.CompanyMemberAssign, groupId, { ...i }),
    setEmployeeId: (i: { memberId: string; employeeId: string | null }) =>
      mutate(MutationKind.CompanyMemberEmployeeIdSet, groupId, { ...i }),
    setProjects: (i: { memberId: string; projectIds: readonly string[] }) =>
      mutate(MutationKind.CompanyMemberProjectsSet, groupId, { ...i }),
    /** Online RPC; the member row refreshes after. */
    setEmploymentType: async (i: { memberId: string; employmentType: string | null }) => {
      const { error } = await supabase.rpc('waves_company_employment_type_set', {
        p_group_id: groupId,
        p_member_id: i.memberId,
        p_type: i.employmentType,
      });
      if (error) throw new Error(error.message);
      await refresh();
    },
    setEmployment: async (i: {
      memberId: string;
      employed: boolean;
      endedOn?: string | null;
      note?: string | null;
      clearEmployeeId?: boolean;
      newEmployeeId?: string;
    }) => {
      const { error } = await supabase.rpc('waves_company_employment_set', {
        p_group_id: groupId,
        p_member_id: i.memberId,
        p_employed: i.employed,
        p_ended_on: i.endedOn ?? null,
        p_note: i.note?.trim().slice(0, 200) || null,
        p_clear_employee_id: i.clearEmployeeId ?? false,
        p_new_employee_id: i.newEmployeeId?.trim() || null,
      });
      if (error) throw new Error(error.message);
      await refresh();
    },
    isEmployeeIdTaken: async (
      people: readonly MemberRow[],
      raw: string,
      exceptMemberId?: string | null,
    ): Promise<boolean> => {
      const id = normaliseEmployeeId(raw);
      if (!id) return false;
      if (employeeIdTaken(people, id, exceptMemberId)) return true;
      const { data, error } = await supabase.rpc('waves_company_employee_id_taken', {
        p_group_id: groupId,
        p_employee_id: id,
        p_except_member: exceptMemberId ?? null,
      });
      return !error && data === true;
    },
  };
}
