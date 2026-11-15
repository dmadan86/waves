/**
 * Writing an import's `new` rows with the mutations the add screens already use.
 *
 * Every call lands in the local sync queue (offline-first) and syncs in order
 * from there; nothing here talks to the server. Ids come from the import rows
 * (derived from the person, not random), so a second run writes the same rows.
 */

import { deterministicId, type ImportEntity, type ImportRow } from '@waves/core';

import { useSetMemberDepartment } from '@/data/companyDepartments';
import { useSetClient } from '@/data/companyClients';
import { useAssignCompanyMember, useSetCompanyRate, useSetEmployeeId } from '@/data/companyEntries';
import { useAddVendorLine, useSetVendor } from '@/data/companyVendors';
import { useSetDates } from '@/data/companyCalendar';
import { useAddGhostMember } from '@/data/hooks';
import { todayIso } from '@/data/personal';

export function useCompanyImportWriter(
  groupId: string,
  opts: { owner: boolean; myMemberId: string | null },
) {
  const addGhost = useAddGhostMember(groupId);
  const setEmployeeId = useSetEmployeeId(groupId);
  const assign = useAssignCompanyMember(groupId);
  const setDept = useSetMemberDepartment(groupId);
  const setDates = useSetDates(groupId);
  const setRate = useSetCompanyRate(groupId);
  const setClient = useSetClient(groupId);
  const setVendor = useSetVendor(groupId);
  const addLine = useAddVendorLine(groupId);

  return async (entity: ImportEntity, row: ImportRow): Promise<void> => {
    const v = row.values;
    const id = row.id;
    if (!v || !id) return;
    if (entity === 'employee') {
      await addGhost.mutateAsync({ memberId: id, name: v.name, phone: v.phone });
      if (v.employeeId) await setEmployeeId.mutateAsync({ memberId: id, employeeId: v.employeeId });
      // Assigning and rates are owner actions; a manager's import leaves them blank.
      if (v.managerId && opts.owner) {
        await assign.mutateAsync({ memberId: id, managerId: v.managerId, reason: '' });
      }
      if (v.departmentId) await setDept.mutateAsync({ memberId: id, departmentId: v.departmentId });
      if (v.joinedOn) {
        await setDates.mutateAsync({
          memberId: id,
          birthDay: null,
          birthMonth: null,
          joinedOn: v.joinedOn,
          showBirthday: false,
        });
      }
      if (v.dailyRateMinor && opts.owner) {
        await setRate.mutateAsync({ memberId: id, dailyRateMinor: v.dailyRateMinor.toString() });
      }
    } else if (entity === 'client') {
      await setClient.mutateAsync({
        clientId: id,
        name: v.name,
        phone: v.phone,
        need: v.need,
        source: v.source,
        address: v.address,
        expectedValueMinor: v.expectedValueMinor?.toString() ?? null,
        ownerMemberId: opts.myMemberId,
        stage: v.stage,
        lostReason: null,
      });
    } else {
      await setVendor.mutateAsync({
        vendorId: id,
        name: v.name,
        phone: v.phone,
        category: v.category,
      });
      if (v.openingBalanceMinor) {
        await addLine.mutateAsync({
          vendorId: id,
          kind: 'bill',
          amountMinor: v.openingBalanceMinor,
          occurredOn: todayIso(),
          note: 'Opening balance',
          entryId: deterministicId(`companyimport:opening:${id}`),
        });
      }
    }
  };
}
