'use client';

/** A company's short department list and each employee's pick. */
import { useMemo } from 'react';
import {
  MutationKind,
  type CompanyDepartmentsSetPayload,
  type CompanyMemberDepartmentSetPayload,
} from '@waves/core';

import { useSync } from '@/lib/sync';
import { useCompanyView } from './view';

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
  const { group } = useCompanyView(groupId);
  return useMemo(() => parse((group as { company_departments?: unknown } | null)?.company_departments), [group]);
}

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
    add: (name: string): string | null => {
      const n = clean(name);
      if (!n || taken(n) || list.length >= MAX_DEPARTMENTS) return null;
      const id = crypto.randomUUID();
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
    setMemberDepartment: (input: CompanyMemberDepartmentSetPayload) =>
      mutate(MutationKind.CompanyMemberDepartmentSet, groupId, { ...input }),
  };
}
