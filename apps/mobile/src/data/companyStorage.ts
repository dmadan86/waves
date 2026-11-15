/** A company's image-storage meter (owners and managers only; the server refuses everyone else). */

import { useQuery } from '@tanstack/react-query';

import { friendlyError } from '@/lib/errors';
import { backend } from '@/lib/backend';
import { StorageCapError } from '@/lib/storage';

export interface CompanyStorageUsage {
  readonly usedBytes: number;
  readonly quotaBytes: number;
}

/** Banner from this fraction used. */
export const STORAGE_WARN_AT = 0.8;

export function useCompanyStorage(groupId: string, enabled = true) {
  return useQuery({
    queryKey: ['company-storage', groupId],
    enabled: enabled && !!groupId,
    staleTime: 60_000,
    queryFn: async (): Promise<CompanyStorageUsage> => {
      const { data, error } = await backend.rpc('waves_company_storage_usage', {
        p_group_id: groupId,
      });
      if (error) throw new Error(error.message);
      const row = (Array.isArray(data) ? data[0] : data) as
        | {
            used_bytes: number | string;
            reserved_bytes: number | string;
            quota_bytes: number | string;
          }
        | undefined;
      return {
        usedBytes: Number(row?.used_bytes ?? 0) + Number(row?.reserved_bytes ?? 0),
        quotaBytes: Number(row?.quota_bytes ?? 0),
      };
    },
  });
}

/** Why a company photo did not attach: a full company gets the specific line, everything else the generic one. */
export function companyPhotoError(
  caught: unknown,
  t: { company: { photoFailed: string }; companyStorage: { full: string } },
  where: string,
): string {
  return caught instanceof StorageCapError
    ? t.companyStorage.full
    : friendlyError(caught, t.company.photoFailed, where);
}
