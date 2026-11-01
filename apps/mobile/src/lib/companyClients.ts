import { addDays } from '@waves/core';

/** `day` plus `count` days, as an ISO date. */
export const shiftDay = addDays;

/** wa.me wants digits only, with the country code. */
export const whatsappUrl = (phone: string): string => `https://wa.me/${phone.replace(/\D/g, '')}`;
