/** The few role facts the vendor ports read; `accessOf` narrows the foundation's CompanyView to them. */
export interface CompanyAccess {
  readonly memberId: string | null;
  readonly isOwner: boolean;
  readonly isManager: boolean;
  readonly isVendor: boolean;
  readonly currency: string;
  readonly name: string;
  /** Waves suspended it, or its slot lapsed: read-only. */
  readonly suspended: boolean;
}

export const accessOf = (view: {
  me: { id: string } | null;
  isOwner: boolean;
  isManager: boolean;
  isVendor: boolean;
  currency: string;
  name: string;
  suspended: boolean;
}): CompanyAccess => ({
  memberId: view.me?.id ?? null,
  isOwner: view.isOwner,
  isManager: view.isManager,
  isVendor: view.isVendor,
  currency: view.currency,
  name: view.name,
  suspended: view.suspended,
});
