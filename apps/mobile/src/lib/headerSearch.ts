/** Header search state: hidden by default, opens from an icon, Cancel closes and clears. */
export type HeaderSearch = { open: boolean; query: string };

export const HEADER_SEARCH_CLOSED: HeaderSearch = { open: false, query: '' };

export const openHeaderSearch = (s: HeaderSearch): HeaderSearch => ({ ...s, open: true });
export const closeHeaderSearch = (): HeaderSearch => HEADER_SEARCH_CLOSED;
export const setHeaderQuery = (s: HeaderSearch, query: string): HeaderSearch => ({ ...s, query });
export const clearHeaderQuery = (s: HeaderSearch): HeaderSearch => ({ ...s, query: '' });
