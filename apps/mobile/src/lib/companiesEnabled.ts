/**
 * The one switch for company features. Off on every platform for now: company may move to its own
 * app, so this release is groups only. Make it `true` to bring companies back.
 */
export const COMPANIES_ENABLED: boolean = false;

/** What someone sees instead of joining a company. */
export const COMPANIES_SOON_MESSAGE = 'Companies are coming soon.';

export { isCompanyRoute, visibleGroups } from './companiesGate';
