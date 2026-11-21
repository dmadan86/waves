/**
 * Copy for Investments and Rentals. Neutral English: country products (SIP,
 * 401(k), ISA, Super, chit fund) appear only as region hints, never here.
 * Tamil, Hindi and Arabic translate the headline words and fall back to English
 * for the rest until a translator reads the whole block.
 */
import type { InvestmentType, PropertyType, RentFrequency } from '@waves/core';

export interface WealthStrings {
  investments: string;
  rentals: string;
  invested: string;
  investedNotSpending: string;
  goingIn: string;
  investedSoFar: string;
  /** {invested} {value} {date} */
  valueLine: string;
  currentValue: string;
  valueNote: string;
  addInvestment: string;
  addRental: string;
  goPro: string;
  freeInvestmentLimit: string;
  freeRentalLimit: string;
  types: Record<InvestmentType, string>;
  propertyTypes: Record<PropertyType, string>;
  frequencies: Record<RentFrequency, string>;
  invWhatQ: string;
  invNameQ: string;
  invNamePlaceholder: string;
  invHowMuchQ: string;
  invDayQ: string;
  invAutoQ: string;
  invAutoYes: string;
  invAutoNo: string;
  invStartQ: string;
  taxWrapper: string;
  maturityQ: string;
  noEndDate: string;
  invOpeningQ: string;
  invValueQ: string;
  insuranceQ: string;
  insuranceNo: string;
  yes: string;
  no: string;
  save: string;
  emptyInvestments: string;
  nextOn: string;
  noSchedule: string;
  entries: string;
  noEntries: string;
  addMoney: string;
  tookOut: string;
  updateValue: string;
  pause: string;
  resume: string;
  close: string;
  closed: string;
  amountLabel: string;
  addMoneyTitle: string;
  tookOutTitle: string;
  updateValueTitle: string;
  withdrawal: string;
  // rentals
  propWhatQ: string;
  propNameQ: string;
  propNamePlaceholder: string;
  rentedNowQ: string;
  tenantNameQ: string;
  tenantPhone: string;
  rentQ: string;
  rentFrequencyQ: string;
  depositQ: string;
  /** The lower-case noun used inside a sentence. */
  depositNouns: Record<
    'depositAdvance' | 'depositBond' | 'depositSecurity' | 'depositHeld',
    string
  >;
  depositHeld: string;
  depositAdvance: string;
  depositBond: string;
  depositSecurity: string;
  startEndQ: string;
  startDate: string;
  endDate: string;
  openEnded: string;
  escalationQ: string;
  escalationNone: string;
  /** {pct} */
  escalationPct: string;
  emptyRentals: string;
  /** {received} {due} */
  receivedOf: string;
  statusPaid: string;
  statusPart: string;
  statusOverdue: string;
  statusDue: string;
  statusVacant: string;
  /** {amount} */
  rentOwed: string;
  /** {amount} {term} */
  depositLine: string;
  /** {paid} {due} {left} */
  partLine: string;
  /** {n} */
  leaseEndsIn: string;
  tenants: string;
  unit: string;
  recordRent: string;
  addExpense: string;
  expenseNote: string;
  yearlyIncome: string;
  yearlyExpense: string;
  last12: string;
  /** {name} {amount} {unit} */
  confirmQ: string;
  yesReceived: string;
  notYet: string;
  partPayment: string;
  rentReceived: string;
  tenantLeft: string;
  /** {term} */
  settleQ: string;
  returned: string;
  kept: string;
  shareReceipt: string;
  receiptTitle: string;
  receiptFooter: string;
  proOnly: string;
  addTenant: string;
  shareFailed: string;
  /** {amount} {date} {unit} {name} */
  receiptLine: string;
  expenseTitle: string;
  newRentQ: string;
  vacantNote: string;
  today: string;
  raiseRent: string;
  /** {pct} {date} {old} {new} */
  raisePrompt: string;
  raiseApply: string;
  raiseNotNow: string;
  // reminders and upcoming
  /** {name} {amount} */
  sipTomorrow: string;
  sipToday: string;
  rentDueToday: string;
  rentNotRecorded: string;
  /** {name} {n} */
  leaseEndNote: string;
  maturityNote: string;
  /** {name} */
  rentRowTitle: string;
  leaseRowTitle: string;
  maturityRowTitle: string;
}

export const wealthEn: WealthStrings = {
  investments: 'Investments',
  rentals: 'Rentals',
  invested: 'Invested',
  investedNotSpending: 'Invested, not spending',
  goingIn: 'Going in each month',
  investedSoFar: 'Invested so far',
  valueLine: 'Invested so far {invested}. Value you entered {value} on {date}.',
  currentValue: 'Current value (you entered)',
  valueNote: 'This is your own figure. Waves does not check or update it.',
  addInvestment: 'Add an investment',
  addRental: 'Add a property',
  goPro: 'Go Pro',
  freeInvestmentLimit: 'The free plan tracks 3 investments. Pro has no limit.',
  freeRentalLimit: 'The free plan tracks 1 rental property. Pro has no limit.',
  types: {
    fund: 'Regular fund investing',
    stocks: 'Stocks & ETFs',
    deposit: 'Fixed deposit',
    retirement: 'Retirement account',
    metals: 'Gold & metals',
    bonds: 'Savings scheme or bonds',
    insurance_linked: 'Insurance with a payout',
    crypto: 'Crypto',
    savings_group: 'Savings group',
    property: 'Property',
    other: 'Other',
  },
  propertyTypes: {
    house: 'House',
    apartment: 'Apartment',
    room: 'Room',
    shop: 'Shop',
    commercial: 'Commercial',
    land: 'Land',
    other: 'Other',
  },
  frequencies: {
    weekly: 'Weekly',
    fortnightly: 'Every 2 weeks',
    monthly: 'Monthly',
    quarterly: 'Every 3 months',
    yearly: 'Yearly',
    custom: 'Other',
  },
  invWhatQ: 'What is it?',
  invNameQ: 'What do you call it?',
  invNamePlaceholder: 'Name',
  invHowMuchQ: 'How much, and how often?',
  invDayQ: 'Which day?',
  invAutoQ: 'Does the bank take it automatically?',
  invAutoYes: 'Yes, it is automatic',
  invAutoNo: 'No, I add it myself',
  invStartQ: 'Which day does it start?',
  taxWrapper: 'Held in a tax-advantaged account',
  maturityQ: 'When does it end? You can skip this.',
  noEndDate: 'No end date',
  invOpeningQ: 'How much have you invested so far?',
  invValueQ: 'What is it worth today? You can skip this.',
  insuranceQ: 'Do you get money back at the end?',
  insuranceNo: 'Then it stays a normal bill, not an investment.',
  yes: 'Yes',
  no: 'No',
  save: 'Save',
  emptyInvestments:
    'Add an investment to see what goes in each month and what you have put in so far.',
  nextOn: 'Next {date}',
  noSchedule: 'No schedule',
  entries: 'Entries',
  noEntries: 'Nothing recorded yet.',
  addMoney: 'Add money',
  tookOut: 'Took money out',
  updateValue: 'Update value',
  pause: 'Pause',
  resume: 'Resume',
  close: 'Close',
  closed: 'Closed',
  amountLabel: 'Amount',
  addMoneyTitle: 'How much did you add?',
  tookOutTitle: 'How much did you take out?',
  updateValueTitle: 'What is it worth now?',
  withdrawal: 'Money taken out',
  propWhatQ: 'What do you rent out?',
  propNameQ: 'What do you call it?',
  propNamePlaceholder: 'Name, like Shop 2',
  rentedNowQ: 'Is someone renting it now?',
  tenantNameQ: "Tenant's name",
  tenantPhone: 'Phone (optional)',
  rentQ: 'How much rent?',
  rentFrequencyQ: 'How often is it paid?',
  depositQ: 'How much {term} do you hold?',
  depositNouns: {
    depositAdvance: 'advance',
    depositBond: 'bond',
    depositSecurity: 'security deposit',
    depositHeld: 'deposit',
  },
  depositHeld: 'Deposit held',
  depositAdvance: 'Advance',
  depositBond: 'Bond',
  depositSecurity: 'Security deposit',
  startEndQ: 'Start and end',
  startDate: 'Starts',
  endDate: 'Ends',
  openEnded: 'Open-ended',
  escalationQ: 'Does rent go up each year?',
  escalationNone: 'No',
  escalationPct: 'Yes, {pct}%',
  emptyRentals: 'Add a property to track rent, the deposit you hold and what is still due.',
  receivedOf: 'Received {received} of {due} this month',
  statusPaid: 'Paid',
  statusPart: 'Part paid',
  statusOverdue: 'Overdue',
  statusDue: 'Due',
  statusVacant: 'Vacant',
  rentOwed: 'Balance due {amount}',
  depositLine: 'You hold {amount} as {term}. It goes back when the tenant leaves.',
  partLine: 'Part paid: {paid} of {due}. {left} still due.',
  leaseEndsIn: 'Lease ends in {n} days',
  tenants: 'Tenants',
  unit: 'Unit (optional)',
  recordRent: 'Record rent',
  addExpense: 'Add expense',
  expenseNote: 'Repair or tax',
  yearlyIncome: 'Rent received this year',
  yearlyExpense: 'Spent on this property this year',
  last12: 'Last 12 months',
  confirmQ: 'Did {name} pay {amount} for {unit}?',
  yesReceived: 'Yes, received',
  notYet: 'Not yet',
  partPayment: 'Part payment',
  rentReceived: 'Rent received',
  tenantLeft: 'Tenant left',
  settleQ: 'How much of the {term} goes back?',
  returned: 'Goes back',
  kept: 'Kept or deducted',
  shareReceipt: 'Share receipt',
  receiptTitle: 'Rent payment',
  receiptFooter: 'Payment recorded in Waves — not a bank confirmation or a tax invoice',
  proOnly: 'Rent receipts are part of Pro.',
  addTenant: 'Add a tenant',
  receiptLine: 'Received {amount} from {name} on {date} for {unit}.',
  expenseTitle: 'How much did it cost?',
  newRentQ: 'What is the new rent?',
  shareFailed: 'Could not open the share sheet.',
  vacantNote: 'No tenant right now.',
  today: 'Today',
  raiseRent: 'Change rent',
  raisePrompt: 'Rent goes up {pct}% on {date}: {old} → {new}. Apply?',
  raiseApply: 'Apply',
  raiseNotNow: 'Not now',
  sipTomorrow: '{name}: {amount} goes in tomorrow.',
  sipToday: 'Time to add {amount} to {name}.',
  rentDueToday: '{name}: rent of {amount} is due today.',
  rentNotRecorded: '{name}: rent of {amount} is not recorded yet.',
  leaseEndNote: '{name}: the lease ends in {n} days.',
  maturityNote: '{name} matures in {n} days.',
  rentRowTitle: 'Rent · {name}',
  leaseRowTitle: 'Lease ends · {name}',
  maturityRowTitle: 'Matures · {name}',
};

export const wealthTa: WealthStrings = {
  ...wealthEn,
  raisePrompt: 'வாடகை {date} அன்று {pct}% உயர்கிறது: {old} → {new}. பயன்படுத்தவா?',
  raiseApply: 'பயன்படுத்து',
  raiseNotNow: 'இப்போது வேண்டாம்',
  investments: 'முதலீடுகள்',
  rentals: 'வாடகை',
  invested: 'முதலீடு',
  investedNotSpending: 'முதலீடு, செலவு அல்ல',
  goingIn: 'மாதந்தோறும் செல்வது',
  investedSoFar: 'இதுவரை முதலீடு',
  addInvestment: 'முதலீட்டைச் சேர்',
  addRental: 'சொத்தைச் சேர்',
  recordRent: 'வாடகையைப் பதிவுசெய்',
  rentReceived: 'வாடகை பெறப்பட்டது',
  yesReceived: 'ஆம், கிடைத்தது',
  notYet: 'இன்னும் இல்லை',
};

export const wealthHi: WealthStrings = {
  ...wealthEn,
  raisePrompt: 'किराया {date} को {pct}% बढ़ेगा: {old} → {new}। लागू करें?',
  raiseApply: 'लागू करें',
  raiseNotNow: 'अभी नहीं',
  investments: 'निवेश',
  rentals: 'किराया',
  invested: 'निवेश किया',
  investedNotSpending: 'निवेश, खर्च नहीं',
  goingIn: 'हर महीने जाने वाला',
  investedSoFar: 'अब तक निवेश',
  addInvestment: 'निवेश जोड़ें',
  addRental: 'संपत्ति जोड़ें',
  recordRent: 'किराया दर्ज करें',
  rentReceived: 'किराया मिला',
  yesReceived: 'हाँ, मिल गया',
  notYet: 'अभी नहीं',
};

export const wealthAr: WealthStrings = {
  ...wealthEn,
  raisePrompt: 'يرتفع الإيجار بنسبة {pct}% في {date}: {old} ← {new}. هل تريد التطبيق؟',
  raiseApply: 'تطبيق',
  raiseNotNow: 'ليس الآن',
  investments: 'الاستثمارات',
  rentals: 'الإيجارات',
  invested: 'مستثمر',
  investedNotSpending: 'مستثمر، وليس إنفاقًا',
  goingIn: 'يُستثمر كل شهر',
  investedSoFar: 'المستثمر حتى الآن',
  addInvestment: 'أضف استثمارًا',
  addRental: 'أضف عقارًا',
  recordRent: 'سجّل الإيجار',
  rentReceived: 'إيجار مستلم',
  yesReceived: 'نعم، تم الاستلام',
  notYet: 'ليس بعد',
};
