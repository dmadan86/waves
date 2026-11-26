/** The one switch for company features. On for every platform; make it `false` to hide them. */
export const COMPANIES_ENABLED: boolean = true;

/** What someone sees instead of joining a company. */
export const COMPANIES_SOON_MESSAGE = 'Companies are coming soon.';

export { isCompanyRoute, visibleGroups } from './companiesGate';
