/**
 * The one-shot handoffs between a caller and a pushed picker route. Each holds
 * exactly one request, and reading it clears it — so a request can never leak
 * into the next open, whether the picker confirmed or was backed out of.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  requestAddFromAnotherGroup,
  takeAddFromAnotherGroupRequest,
} from '../src/lib/addFromAnotherGroupBridge';
import { requestContacts, takeContactRequest } from '../src/lib/contactPickerBridge';
import { requestCountry, takeCountryRequest } from '../src/lib/countryPickerBridge';

describe('picker bridges', () => {
  it('hands the add-from-another-group screen the request once, then nothing', () => {
    expect(takeAddFromAnotherGroupRequest()).toBeNull();
    const onPicked = vi.fn();
    requestAddFromAnotherGroup({ groupId: 'g1', onPicked });

    const taken = takeAddFromAnotherGroupRequest();
    expect(taken?.groupId).toBe('g1');
    taken?.onPicked([]);
    expect(onPicked).toHaveBeenCalledWith([]);
    expect(takeAddFromAnotherGroupRequest()).toBeNull();
  });

  it('hands the contact picker the request once, then nothing', () => {
    const request = { initial: [], existing: new Set(['a@b.co']), onPicked: vi.fn() };
    requestContacts(request);
    expect(takeContactRequest()).toBe(request);
    expect(takeContactRequest()).toBeNull();
  });

  it('keeps only the latest contact request when a second arrives before the picker opens', () => {
    const first = { initial: [], onPicked: vi.fn() };
    const second = { initial: [], onPicked: vi.fn() };
    requestContacts(first);
    requestContacts(second);
    expect(takeContactRequest()).toBe(second);
  });

  it('hands the country picker the request once, then nothing', () => {
    const onPicked = vi.fn();
    requestCountry({ initial: 'IN', onPicked });
    const taken = takeCountryRequest();
    expect(taken?.initial).toBe('IN');
    taken?.onPicked('AE');
    expect(onPicked).toHaveBeenCalledWith('AE');
    expect(takeCountryRequest()).toBeNull();
  });
});
