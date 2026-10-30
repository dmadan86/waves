/** A company's short department list and each employee's pick, read local-first (queued edits show at once). */

import { useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  MutationKind,
  type CompanyDepartmentsSetPayload,
  type CompanyMemberDepartmentSetPayload,
} from '@waves/core';
import { randomUUID } from 'expo-crypto';

import { useGroup } from '@/data/hooks';
import { useSync } from '@/sync';

export interface CompanyDepartment {
  readonly id: string;
  readonly name: string;
}

export const MAX_DEPARTMENTS = 30;

function parse(raw: unknown): CompanyDepartment[] {
  return Array.isArray(raw)
    ? raw.flatMap((d) =>
        d && typeof d.id === 'string' && typeof d.name === 'string'
          ? [{ id: d.id, name: d.name }]
          : [],
      )
    : [];
}

export function useDepartments(groupId: string): readonly CompanyDepartment[] {
  const { group } = useGroup(groupId);
  const { queue } = useSync();
  return useMemo(() => {
    let list = parse(group.data?.company_departments);
    for (const m of [...queue].sort((a, b) => a.seq - b.seq)) {
      if (m.groupId === groupId && !m.rejection && m.kind === MutationKind.CompanyDepartmentsSet)
        list = parse((m.payload as unknown as CompanyDepartmentsSetPayload).departments);
    }
    return list;
  }, [group.data?.company_departments, queue, groupId]);
}

/** The department name for a member, or undefined when none / the list no longer has it. */
export function departmentName(
  list: readonly CompanyDepartment[],
  departmentId: string | null | undefined,
): string | undefined {
  return departmentId ? list.find((d) => d.id === departmentId)?.name : undefined;
}

/** Owner: add, rename or remove departments by sending the whole next list. */
export function useDepartmentEditor(groupId: string) {
  const { mutate } = useSync();
  const list = useDepartments(groupId);
  const save = (next: readonly CompanyDepartment[]) =>
    mutate(MutationKind.CompanyDepartmentsSet, groupId, {
      departments: next,
    } satisfies CompanyDepartmentsSetPayload);
  const clean = (name: string) => name.trim().slice(0, 40);
  const taken = (name: string, exceptId?: string) =>
    list.some((d) => d.id !== exceptId && d.name.toLowerCase() === name.toLowerCase());
  return {
    list,
    /** Returns the new id, or null when blank, duplicate or the list is full. */
    add: (name: string): string | null => {
      const n = clean(name);
      if (!n || taken(n) || list.length >= MAX_DEPARTMENTS) return null;
      const id = randomUUID();
      void save([...list, { id, name: n }]);
      return id;
    },
    rename: (id: string, name: string): boolean => {
      const n = clean(name);
      if (!n || taken(n, id)) return false;
      void save(list.map((d) => (d.id === id ? { id, name: n } : d)));
      return true;
    },
    remove: (id: string) => void save(list.filter((d) => d.id !== id)),
  };
}

/** Owner or the employee's manager: set (null clears) one employee's department. */
export function useSetMemberDepartment(groupId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: (input: CompanyMemberDepartmentSetPayload) =>
      mutate(MutationKind.CompanyMemberDepartmentSet, groupId, { ...input }),
  });
}
