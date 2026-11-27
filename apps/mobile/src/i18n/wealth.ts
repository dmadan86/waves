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
  investmentTypeLabel: string;
  recurringAmountLabel: string;
  howOftenLabel: string;
  saveInvestmentBtn: string;
  trackInvTitle: string;
  addRental: string;
  trackRentTitle: string;
  trackRentSub: string;
  addProperty: string;
  propertyTypeLabel: string;
  propertyNameLabel: string;
  currentlyRentedQ: string;
  tenantNameLabel: string;
  monthlyRent: string;
  refundableDeposit: string;
  rentDueDay: string;
  selectDay: string;
  dayOfMonth: string;
  leaseEndOptional: string;
  savePropertyBtn: string;
  thisMonth: string;
  receivedLabel: string;
  expectedLabel: string;
  percentReceived: string;
  receivedOfExpected: string;
  propertiesCount: string;
  rentBalance: string;
  addShort: string;
  tenantRow: string;
  leaseRow: string;
  currentRentDue: string;
  refundableDepositHeld: string;
  thisYear: string;
  propertyExpenses: string;
  receiptsBtn: string;
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
  documents: string;
  attachDoc: string;
  attachPhoto: string;
  attachFile: string;
  docsLocalNote: string;
  docsEmpty: string;
  renameDoc: string;
  docSlotAgreement: string;
  docSlotTenantId: string;
  docSlotMoveIn: string;
  docSlotPolice: string;
  docSlotOther: string;
  docOf: string;
  docAddTo: string;
  docNameTitle: string;
  docNameHint: string;
  docScan: string;
  docReplace: string;
  docAddMore: string;
  docPdf: string;
  docPhotoOne: string;
  docPhotos: string;
  docFiles: string;
  docAdded: string;
  docRemoveBody: string;
  docOpenFailed: string;
  docBadType: string;
  detailsTitle: string;
  addressLabel: string;
  notesLabel: string;
  agreementStart: string;
  agreementEnd: string;
  callTenant: string;
  whatsappTenant: string;
  notAdded: string;
  sendToPartner: string;
  /** The lock line on a couple/home group's Rentals screen. */
  e2eeNote: string;
  phoneAdded: string;
  dismiss: string;
  formerCouple: string;
  formerCouplesTitle: string;
  formerCoupleNote: string;
  backupCoupleStandard: string;
  backupCoupleExtra: string;
  yourPhones: string;
  yourPhonesSub: string;
  thisPhone: string;
  phoneLastSeen: string;
  removePhone: string;
  removePhoneConfirm: string;
  signOutBackUpTitle: string;
  signOutBackUpBody: string;
  backUpAction: string;
  signOutAnyway: string;
  recordedBy: string;
  rentalsRowSub: string;
  tenants: string;
  unit: string;
  recordRent: string;
  rentDueCap: string;
  dueThisMonthCap: string;
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
  raiseFailed: string;
  /** {amount} {date} */
  raiseFuture: string;
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
  investmentTypeLabel: 'Investment type',
  recurringAmountLabel: 'Amount each time',
  howOftenLabel: 'How often',
  saveInvestmentBtn: 'Save investment',
  trackInvTitle: 'Track your investments',
  addRental: 'Add a property',
  trackRentTitle: 'Track your rent',
  trackRentSub: 'Keep rent payments, deposits and expenses in one place.',
  addProperty: 'Add property',
  propertyTypeLabel: 'Property type',
  propertyNameLabel: 'Property name',
  currentlyRentedQ: 'Currently rented?',
  tenantNameLabel: 'Tenant name',
  monthlyRent: 'Monthly rent',
  refundableDeposit: 'Refundable deposit',
  rentDueDay: 'Rent due day',
  selectDay: 'Select day',
  dayOfMonth: 'Day {n}',
  leaseEndOptional: 'Lease end date (optional)',
  savePropertyBtn: 'Save property',
  thisMonth: 'This month',
  receivedLabel: 'Received',
  expectedLabel: 'Expected',
  percentReceived: '{pct}% received',
  receivedOfExpected: '{received} of {expected}',
  propertiesCount: 'Properties ({n})',
  rentBalance: 'Rent balance',
  addShort: 'Add',
  tenantRow: 'Tenant',
  leaseRow: 'Lease',
  currentRentDue: 'Current month rent due',
  refundableDepositHeld: 'Refundable deposit (held)',
  thisYear: 'This year',
  propertyExpenses: 'Property expenses',
  receiptsBtn: 'Receipts',
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
  documents: 'Documents',
  attachDoc: 'Attach',
  attachPhoto: 'Photo',
  attachFile: 'File (PDF)',
  docsLocalNote: 'Kept only on this phone, never uploaded.',
  docsEmpty: 'Add the rental agreement or other papers.',
  renameDoc: 'Rename',
  docSlotAgreement: 'Agreement',
  docSlotTenantId: 'Tenant ID',
  docSlotMoveIn: 'Move-in photos',
  docSlotPolice: 'Police verification',
  docSlotOther: 'Other',
  docOf: '{a} of {b}',
  docAddTo: 'Add {name}',
  docNameTitle: 'Name this document',
  docNameHint: 'e.g. Electricity bill',
  docScan: 'Scan',
  docReplace: 'Replace',
  docAddMore: 'Add more',
  docPdf: 'PDF',
  docPhotoOne: 'Photo',
  docPhotos: '{n} photos',
  docFiles: '{n} files',
  docAdded: 'Added {date}',
  docRemoveBody: 'Remove {n} file(s) from {name}?',
  docOpenFailed: 'Could not open this file.',
  docBadType: 'Only PDF or photos can be attached.',
  detailsTitle: 'Details',
  addressLabel: 'Address',
  notesLabel: 'Notes',
  agreementStart: 'Agreement start',
  agreementEnd: 'Agreement end',
  callTenant: 'Call',
  whatsappTenant: 'WhatsApp',
  notAdded: 'Not added',
  sendToPartner: 'Send to partner',
  e2eeNote: 'End-to-end encrypted. Only you and your partner can read this.',
  phoneAdded: '{name} added a new phone.',
  dismiss: 'Dismiss',
  formerCouple: 'Former couple: {name}',
  formerCouplesTitle: 'Former couples',
  formerCoupleNote: 'A read-only copy, kept on this phone only.',
  backupCoupleStandard:
    'Your shared rentals are included. On Standard backups they are protected by Google.',
  backupCoupleExtra:
    'Your shared rentals are included. On Extra backups they are protected by your own recovery key.',
  yourPhones: 'Your phones',
  yourPhonesSub: 'Phones that can read your shared rentals.',
  thisPhone: 'This phone',
  phoneLastSeen: 'Last seen {when}',
  removePhone: 'Remove',
  removePhoneConfirm: 'Remove this phone? It will stop receiving shared rentals.',
  signOutBackUpTitle: 'Back up first?',
  signOutBackUpBody: 'Shared rentals live only on your phones.',
  backUpAction: 'Back up',
  signOutAnyway: 'Sign out anyway',
  recordedBy: 'Recorded by {name}',
  rentalsRowSub: '{n} properties · {amount} received this month',
  tenants: 'Tenants',
  unit: 'Unit (optional)',
  recordRent: 'Record rent',
  rentDueCap: 'Rent due',
  dueThisMonthCap: 'Due this month',
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
  raiseFailed: 'Could not apply the new rent. Try again.',
  raiseFuture: 'Goes up to {amount} on {date}',
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
  investments: 'முதலீடுகள்',
  rentals: 'வாடகை சொத்துகள்',
  invested: 'முதலீடு',
  investedNotSpending: 'முதலீடு, செலவு அல்ல',
  goingIn: 'மாதந்தோறும் செல்வது',
  investedSoFar: 'இதுவரை முதலீடு',
  valueLine: 'இதுவரை முதலீடு {invested}. நீங்கள் {date} அன்று கொடுத்த மதிப்பு {value}.',
  currentValue: 'தற்போதைய மதிப்பு (நீங்கள் கொடுத்தது)',
  valueNote: 'இது உங்கள் சொந்த எண். Waves இதை சரிபார்க்காது.',
  addInvestment: 'முதலீட்டைச் சேர்',
  investmentTypeLabel: 'முதலீட்டு வகை',
  recurringAmountLabel: 'ஒவ்வொரு முறையும் தொகை',
  howOftenLabel: 'எத்தனை முறை',
  saveInvestmentBtn: 'முதலீட்டைச் சேமி',
  trackInvTitle: 'உங்கள் முதலீடுகளைக் கண்காணியுங்கள்',
  addRental: 'சொத்தைச் சேர்',
  trackRentTitle: 'உங்கள் வாடகையைக் கண்காணியுங்கள்',
  trackRentSub: 'வாடகை, முன்பணம், செலவுகளை ஒரே இடத்தில் வைத்திருங்கள்.',
  addProperty: 'சொத்தைச் சேர்',
  propertyTypeLabel: 'சொத்து வகை',
  propertyNameLabel: 'சொத்தின் பெயர்',
  currentlyRentedQ: 'தற்போது வாடகைக்கு உள்ளதா?',
  tenantNameLabel: 'குடியிருப்பவர் பெயர்',
  monthlyRent: 'மாத வாடகை',
  refundableDeposit: 'திரும்பப் பெறும் முன்பணம்',
  rentDueDay: 'வாடகை செலுத்தும் நாள்',
  selectDay: 'நாளைத் தேர்ந்தெடு',
  dayOfMonth: 'நாள் {n}',
  leaseEndOptional: 'குத்தகை முடிவு தேதி (விருப்பம்)',
  savePropertyBtn: 'சொத்தைச் சேமி',
  thisMonth: 'இந்த மாதம்',
  receivedLabel: 'பெற்றது',
  expectedLabel: 'எதிர்பார்ப்பு',
  percentReceived: '{pct}% பெறப்பட்டது',
  receivedOfExpected: '{expected} இல் {received}',
  propertiesCount: 'சொத்துகள் ({n})',
  rentBalance: 'வாடகை நிலுவை',
  addShort: 'சேர்',
  tenantRow: 'குடியிருப்பவர்',
  leaseRow: 'குத்தகை',
  currentRentDue: 'இந்த மாத வாடகை நிலுவை',
  refundableDepositHeld: 'திரும்பப் பெறும் முன்பணம் (வைத்திருப்பது)',
  thisYear: 'இந்த ஆண்டு',
  propertyExpenses: 'சொத்து செலவுகள்',
  receiptsBtn: 'ரசீதுகள்',
  goPro: 'Pro-ஆக மாறு',
  freeInvestmentLimit: 'இலவச திட்டத்தில் 3 முதலீடுகள் மட்டுமே. Pro-ல் வரம்பு இல்லை.',
  freeRentalLimit: 'இலவச திட்டத்தில் 1 வாடகை சொத்து மட்டுமே. Pro-ல் வரம்பு இல்லை.',
  types: {
    fund: 'தொடர் நிதி முதலீடு',
    stocks: 'பங்குகள் & ETF',
    deposit: 'நிலையான வைப்பு',
    retirement: 'ஓய்வூதிய கணக்கு',
    metals: 'தங்கம் & உலோகங்கள்',
    bonds: 'சேமிப்பு திட்டம் அல்லது பத்திரங்கள்',
    insurance_linked: 'திரும்பப் பெறும் காப்பீடு',
    crypto: 'கிரிப்டோ',
    savings_group: 'சேமிப்பு குழு',
    property: 'சொத்து',
    other: 'மற்றவை',
  },
  propertyTypes: {
    house: 'வீடு',
    apartment: 'அடுக்குமாடி',
    room: 'அறை',
    shop: 'கடை',
    commercial: 'வணிக இடம்',
    land: 'நிலம்',
    other: 'மற்றவை',
  },
  frequencies: {
    weekly: 'வாரந்தோறும்',
    fortnightly: 'இரண்டு வாரத்திற்கு ஒரு முறை',
    monthly: 'மாதந்தோறும்',
    quarterly: 'மூன்று மாதத்திற்கு ஒரு முறை',
    yearly: 'வருடந்தோறும்',
    custom: 'வேறு',
  },
  invWhatQ: 'என்ன வகை?',
  invNameQ: 'என்ன பெயர் வைக்கிறீர்கள்?',
  invNamePlaceholder: 'பெயர்',
  invHowMuchQ: 'எவ்வளவு, எத்தனை முறை?',
  invDayQ: 'எந்த நாள்?',
  invAutoQ: 'வங்கி தானாக எடுக்கிறதா?',
  invAutoYes: 'ஆம், தானாக நடக்கும்',
  invAutoNo: 'இல்லை, நான் சேர்க்கிறேன்',
  invStartQ: 'எந்த நாளில் தொடங்குகிறது?',
  taxWrapper: 'வரி சலுகை கணக்கில் உள்ளது',
  maturityQ: 'எப்போது முடிகிறது? வேண்டாமென்றால் தவிர்க்கலாம்.',
  noEndDate: 'கடைசி தேதி இல்லை',
  invOpeningQ: 'இதுவரை எவ்வளவு முதலீடு செய்தீர்கள்?',
  invValueQ: 'இன்று என்ன மதிப்பு? வேண்டாமென்றால் தவிர்க்கலாம்.',
  insuranceQ: 'முடிவில் பணம் திரும்பி வருகிறதா?',
  insuranceNo: 'அப்படியானால் இது சாதாரண கட்டணமே, முதலீடு அல்ல.',
  yes: 'ஆம்',
  no: 'இல்லை',
  save: 'சேமி',
  emptyInvestments: 'மாதந்தோறும் எவ்வளவு செல்கிறது, இதுவரை என்ன போட்டீர்கள் என அறிய முதலீட்டைச் சேருங்கள்.',
  nextOn: 'அடுத்தது {date}',
  noSchedule: 'அட்டவணை இல்லை',
  entries: 'பதிவுகள்',
  noEntries: 'இன்னும் எதுவும் பதிவாகவில்லை.',
  addMoney: 'பணம் சேர்',
  tookOut: 'பணம் எடுத்தது',
  updateValue: 'மதிப்பை புதுப்பி',
  pause: 'இடைநிறுத்து',
  resume: 'தொடர்',
  close: 'மூடு',
  closed: 'மூடப்பட்டது',
  amountLabel: 'தொகை',
  addMoneyTitle: 'எவ்வளவு சேர்த்தீர்கள்?',
  tookOutTitle: 'எவ்வளவு எடுத்தீர்கள்?',
  updateValueTitle: 'இப்போது என்ன மதிப்பு?',
  withdrawal: 'எடுத்த பணம்',
  propWhatQ: 'என்ன வாடகைக்கு விடுகிறீர்கள்?',
  propNameQ: 'என்ன பெயர் வைக்கிறீர்கள்?',
  propNamePlaceholder: 'பெயர், எ.கா. கடை 2',
  rentedNowQ: 'இப்போது யாரேனும் வாடகைக்கு இருக்கிறார்களா?',
  tenantNameQ: 'குத்தகைதாரர் பெயர்',
  tenantPhone: 'போன் (விருப்பமானால்)',
  rentQ: 'வாடகை எவ்வளவு?',
  rentFrequencyQ: 'எத்தனை நாட்களுக்கு ஒரு முறை?',
  depositQ: '{term} எவ்வளவு வைத்திருக்கிறீர்கள்?',
  depositNouns: {
    depositAdvance: 'முன்பணம்',
    depositBond: 'பாண்ட்',
    depositSecurity: 'பாதுகாப்பு முன்பணம்',
    depositHeld: 'முன்பணம்',
  },
  depositHeld: 'முன்பணம் வைத்திருக்கிறோம்',
  depositAdvance: 'முன்பணம்',
  depositBond: 'பாண்ட்',
  depositSecurity: 'பாதுகாப்பு முன்பணம்',
  startEndQ: 'தொடக்கம் மற்றும் முடிவு',
  startDate: 'தொடங்கும் நாள்',
  endDate: 'முடியும் நாள்',
  openEnded: 'திறந்த ஒப்பந்தம்',
  escalationQ: 'வாடகை ஒவ்வொரு வருடமும் உயருகிறதா?',
  escalationNone: 'இல்லை',
  escalationPct: 'ஆம், {pct}%',
  emptyRentals: 'வாடகை, முன்பணம் மற்றும் நிலுவை தொகைகளை கண்காணிக்க சொத்தைச் சேருங்கள்.',
  receivedOf: 'இந்த மாதம் {due}-இல் {received} கிடைத்தது',
  statusPaid: 'செலுத்தியது',
  statusPart: 'பகுதி செலுத்தியது',
  statusOverdue: 'தாமதம்',
  statusDue: 'செலுத்தவேண்டியது',
  statusVacant: 'காலி',
  rentOwed: 'நிலுவை {amount}',
  depositLine: 'நீங்கள் {term} ஆக {amount} வைத்திருக்கிறீர்கள். குத்தகைதாரர் போகும்போது திரும்பி போகும்.',
  partLine: 'பகுதி செலுத்தியது: {due}-இல் {paid}. {left} இன்னும் வரவேண்டும்.',
  leaseEndsIn: 'குத்தகை {n} நாட்களில் முடிகிறது',
  documents: 'ஆவணங்கள்',
  attachDoc: 'இணை',
  attachPhoto: 'புகைப்படம்',
  attachFile: 'கோப்பு (PDF)',
  docsLocalNote: 'இந்த போனில் மட்டும் வைக்கப்படும்; பதிவேற்றப்படாது.',
  docsEmpty: 'வாடகை ஒப்பந்தம் அல்லது பிற ஆவணங்களை சேர்க்கவும்.',
  renameDoc: 'பெயர் மாற்று',
  docSlotAgreement: 'ஒப்பந்தம்',
  docSlotTenantId: 'குடியிருப்பாளர் ஐடி',
  docSlotMoveIn: 'குடிபுகும் புகைப்படங்கள்',
  docSlotPolice: 'காவல் சரிபார்ப்பு',
  docSlotOther: 'மற்றவை',
  docOf: '{a} / {b}',
  docAddTo: '{name} சேர்',
  docNameTitle: 'இந்த ஆவணத்திற்குப் பெயரிடுங்கள்',
  docNameHint: 'எ.கா. மின் கட்டணம்',
  docScan: 'ஸ்கேன்',
  docReplace: 'மாற்று',
  docAddMore: 'மேலும் சேர்',
  docPdf: 'PDF',
  docPhotoOne: 'புகைப்படம்',
  docPhotos: '{n} புகைப்படங்கள்',
  docFiles: '{n} கோப்புகள்',
  docAdded: 'சேர்த்தது {date}',
  docRemoveBody: '{name} இலிருந்து {n} கோப்பு(களை) நீக்கவா?',
  docOpenFailed: 'இந்த கோப்பை திறக்க முடியவில்லை.',
  docBadType: 'PDF அல்லது புகைப்படங்களை மட்டுமே இணைக்கலாம்.',
  detailsTitle: 'விவரங்கள்',
  addressLabel: 'முகவரி',
  notesLabel: 'குறிப்புகள்',
  agreementStart: 'ஒப்பந்த தொடக்கம்',
  agreementEnd: 'ஒப்பந்த முடிவு',
  callTenant: 'அழை',
  whatsappTenant: 'வாட்ஸ்அப்',
  notAdded: 'சேர்க்கவில்லை',
  sendToPartner: 'துணைக்கு அனுப்பு',
  e2eeNote: 'முழுமையாக குறியாக்கம் செய்யப்பட்டது. நீங்களும் உங்கள் துணையும் மட்டுமே இதைப் படிக்க முடியும்.',
  phoneAdded: '{name} புதிய ஃபோனைச் சேர்த்தார்.',
  dismiss: 'மூடு',
  formerCouple: 'முன்னாள் ஜோடி: {name}',
  formerCouplesTitle: 'முன்னாள் ஜோடிகள்',
  formerCoupleNote: 'படிக்க மட்டும் நகல், இந்த ஃபோனில் மட்டும் வைக்கப்பட்டுள்ளது.',
  backupCoupleStandard:
    'உங்கள் பகிர்ந்த வாடகைகளும் சேர்க்கப்படும். நிலையான காப்புப்பிரதியில் அவை Google மூலம் பாதுகாக்கப்படும்.',
  backupCoupleExtra:
    'உங்கள் பகிர்ந்த வாடகைகளும் சேர்க்கப்படும். கூடுதல் காப்புப்பிரதியில் அவை உங்கள் சொந்த மீட்பு விசையால் பாதுகாக்கப்படும்.',
  yourPhones: 'உங்கள் ஃபோன்கள்',
  yourPhonesSub: 'உங்கள் பகிர்ந்த வாடகைகளைப் படிக்கக்கூடிய ஃபோன்கள்.',
  thisPhone: 'இந்த ஃபோன்',
  phoneLastSeen: 'கடைசியாகப் பார்த்தது {when}',
  removePhone: 'நீக்கு',
  removePhoneConfirm: 'இந்த ஃபோனை நீக்கவா? இது பகிர்ந்த வாடகைகளைப் பெறுவதை நிறுத்தும்.',
  signOutBackUpTitle: 'முதலில் காப்புப்பிரதி எடுக்கவா?',
  signOutBackUpBody: 'பகிர்ந்த வாடகைகள் உங்கள் ஃபோன்களில் மட்டுமே உள்ளன.',
  backUpAction: 'காப்புப்பிரதி',
  signOutAnyway: 'எப்படியும் வெளியேறு',
  recordedBy: '{name} பதிவு செய்தார்',
  rentalsRowSub: '{n} சொத்துகள் · இந்த மாதம் {amount} பெறப்பட்டது',
  tenants: 'குத்தகைதாரர்கள்',
  unit: 'யூனிட் (விருப்பமானால்)',
  recordRent: 'வாடகையைப் பதிவுசெய்',
  rentDueCap: 'வாடகை நிலுவை',
  dueThisMonthCap: 'இந்த மாதம் வர வேண்டியது',
  addExpense: 'செலவு சேர்',
  expenseNote: 'பழுது அல்லது வரி',
  yearlyIncome: 'இந்த ஆண்டு வந்த வாடகை',
  yearlyExpense: 'இந்த ஆண்டு இந்த சொத்தில் செலவு',
  last12: 'கடந்த 12 மாதங்கள்',
  confirmQ: '{name} {unit}-க்கு {amount} கொடுத்தார்களா?',
  yesReceived: 'ஆம், கிடைத்தது',
  notYet: 'இன்னும் இல்லை',
  partPayment: 'பகுதி தொகை',
  rentReceived: 'வாடகை பெறப்பட்டது',
  tenantLeft: 'குத்தகைதாரர் போய்விட்டார்',
  settleQ: '{term}-இல் எவ்வளவு திரும்பி போகும்?',
  returned: 'திரும்பி போவது',
  kept: 'வைத்திருப்பது அல்லது கழிப்பது',
  shareReceipt: 'ரசீது பகிர்',
  receiptTitle: 'வாடகை செலுத்தல்',
  receiptFooter: 'Waves-ல் பதிவு செய்யப்பட்டது — வங்கி உறுதிப்படுத்தல் அல்ல, வரி ரசீதும் அல்ல',
  proOnly: 'வாடகை ரசீதுகள் Pro-ல் மட்டுமே.',
  addTenant: 'குத்தகைதாரர் சேர்',
  shareFailed: 'பகிர்வு திறக்க முடியவில்லை.',
  receiptLine: '{date} அன்று {name} {unit}-க்காக {amount} கொடுத்தார்.',
  expenseTitle: 'எவ்வளவு செலவானது?',
  newRentQ: 'புதிய வாடகை என்ன?',
  vacantNote: 'இப்போது குத்தகைதாரர் இல்லை.',
  today: 'இன்று',
  raiseRent: 'வாடகை மாற்று',
  raisePrompt: '{date} அன்று வாடகை {pct}% உயர்ந்து {old} இலிருந்து {new} ஆகும். மாற்றவா?',
  raiseApply: 'மாற்று',
  raiseNotNow: 'இப்போது வேண்டாம்',
  raiseFailed: 'புதிய வாடகையை மாற்ற முடியவில்லை. மீண்டும் முயற்சிக்கவும்.',
  raiseFuture: '{date} அன்று {amount} ஆக உயரும்',
  sipTomorrow: '{name}: நாளை {amount} செல்லும்.',
  sipToday: '{name}-க்கு {amount} சேர்க்க நேரம்.',
  rentDueToday: '{name}: இன்று {amount} வாடகை வரவேண்டும்.',
  rentNotRecorded: '{name}: {amount} வாடகை இன்னும் பதிவாகவில்லை.',
  leaseEndNote: '{name}: குத்தகை {n} நாட்களில் முடிகிறது.',
  maturityNote: '{name} {n} நாட்களில் முதிர்கிறது.',
  rentRowTitle: 'வாடகை · {name}',
  leaseRowTitle: 'குத்தகை முடிவு · {name}',
  maturityRowTitle: 'முதிர்வு · {name}',
};

export const wealthHi: WealthStrings = {
  investments: 'निवेश',
  rentals: 'किराया',
  invested: 'निवेश किया',
  investedNotSpending: 'निवेश, खर्च नहीं',
  goingIn: 'हर महीने जाने वाला',
  investedSoFar: 'अब तक निवेश',
  valueLine: 'अब तक निवेश {invested}। आपने {date} को {value} दर्ज किया था।',
  currentValue: 'मौजूदा मूल्य (आपका दर्ज किया)',
  valueNote: 'यह आपका अपना आँकड़ा है। Waves इसे जाँचता या बदलता नहीं।',
  addInvestment: 'निवेश जोड़ें',
  investmentTypeLabel: 'निवेश का प्रकार',
  recurringAmountLabel: 'हर बार की राशि',
  howOftenLabel: 'कितनी बार',
  saveInvestmentBtn: 'निवेश सहेजें',
  trackInvTitle: 'अपने निवेश ट्रैक करें',
  addRental: 'संपत्ति जोड़ें',
  trackRentTitle: 'अपना किराया ट्रैक करें',
  trackRentSub: 'किराया, जमा राशि और खर्च एक ही जगह रखें।',
  addProperty: 'संपत्ति जोड़ें',
  propertyTypeLabel: 'संपत्ति का प्रकार',
  propertyNameLabel: 'संपत्ति का नाम',
  currentlyRentedQ: 'क्या अभी किराये पर है?',
  tenantNameLabel: 'किरायेदार का नाम',
  monthlyRent: 'मासिक किराया',
  refundableDeposit: 'वापसी योग्य जमा राशि',
  rentDueDay: 'किराया देय दिन',
  selectDay: 'दिन चुनें',
  dayOfMonth: 'दिन {n}',
  leaseEndOptional: 'लीज़ समाप्ति तिथि (वैकल्पिक)',
  savePropertyBtn: 'संपत्ति सहेजें',
  thisMonth: 'इस महीने',
  receivedLabel: 'मिला',
  expectedLabel: 'अपेक्षित',
  percentReceived: '{pct}% मिला',
  receivedOfExpected: '{expected} में से {received}',
  propertiesCount: 'संपत्तियाँ ({n})',
  rentBalance: 'किराया बकाया',
  addShort: 'जोड़ें',
  tenantRow: 'किरायेदार',
  leaseRow: 'लीज़',
  currentRentDue: 'इस महीने का किराया बाकी',
  refundableDepositHeld: 'वापसी योग्य जमा राशि (रखी हुई)',
  thisYear: 'इस साल',
  propertyExpenses: 'संपत्ति के खर्च',
  receiptsBtn: 'रसीदें',
  goPro: 'Pro लें',
  freeInvestmentLimit: 'फ्री प्लान में 3 निवेश ट्रैक होते हैं। Pro में कोई सीमा नहीं।',
  freeRentalLimit: 'फ्री प्लान में 1 किराये की संपत्ति ट्रैक होती है। Pro में कोई सीमा नहीं।',
  types: {
    fund: 'नियमित फंड निवेश',
    stocks: 'शेयर और ETF',
    deposit: 'सावधि जमा',
    retirement: 'रिटायरमेंट खाता',
    metals: 'सोना और धातुएँ',
    bonds: 'बचत योजना या बॉन्ड',
    insurance_linked: 'पैसे वापस मिलने वाला बीमा',
    crypto: 'क्रिप्टो',
    savings_group: 'बचत समूह',
    property: 'संपत्ति',
    other: 'अन्य',
  },
  propertyTypes: {
    house: 'मकान',
    apartment: 'अपार्टमेंट',
    room: 'कमरा',
    shop: 'दुकान',
    commercial: 'व्यावसायिक',
    land: 'ज़मीन',
    other: 'अन्य',
  },
  frequencies: {
    weekly: 'हर हफ्ते',
    fortnightly: 'हर 2 हफ्ते',
    monthly: 'हर महीने',
    quarterly: 'हर 3 महीने',
    yearly: 'हर साल',
    custom: 'अन्य',
  },
  invWhatQ: 'यह क्या है?',
  invNameQ: 'आप इसे क्या कहते हैं?',
  invNamePlaceholder: 'नाम',
  invHowMuchQ: 'कितना, और कितनी बार?',
  invDayQ: 'कौन सा दिन?',
  invAutoQ: 'क्या बैंक खुद काटता है?',
  invAutoYes: 'हाँ, अपने आप होता है',
  invAutoNo: 'नहीं, मैं खुद जोड़ता हूँ',
  invStartQ: 'किस दिन से शुरू होगा?',
  taxWrapper: 'टैक्स-सुविधा वाले खाते में',
  maturityQ: 'यह कब खत्म होगा? चाहें तो छोड़ सकते हैं।',
  noEndDate: 'कोई अंतिम तारीख नहीं',
  invOpeningQ: 'अब तक कितना निवेश किया है?',
  invValueQ: 'आज इसकी कीमत क्या है? चाहें तो छोड़ सकते हैं।',
  insuranceQ: 'अंत में पैसे वापस मिलते हैं?',
  insuranceNo: 'तो यह सामान्य बिल है, निवेश नहीं।',
  yes: 'हाँ',
  no: 'नहीं',
  save: 'सेव करें',
  emptyInvestments: 'हर महीने कितना जाता है और अब तक क्या डाला, यह देखने के लिए निवेश जोड़ें।',
  nextOn: 'अगली बार {date}',
  noSchedule: 'कोई शेड्यूल नहीं',
  entries: 'एंट्री',
  noEntries: 'अभी तक कुछ दर्ज नहीं।',
  addMoney: 'पैसे जोड़ें',
  tookOut: 'पैसे निकाले',
  updateValue: 'मूल्य अपडेट करें',
  pause: 'रोकें',
  resume: 'फिर शुरू करें',
  close: 'बंद करें',
  closed: 'बंद',
  amountLabel: 'राशि',
  addMoneyTitle: 'कितने पैसे जोड़े?',
  tookOutTitle: 'कितने पैसे निकाले?',
  updateValueTitle: 'अभी इसकी कीमत क्या है?',
  withdrawal: 'निकाले गए पैसे',
  propWhatQ: 'आप क्या किराये पर दे रहे हैं?',
  propNameQ: 'आप इसे क्या कहते हैं?',
  propNamePlaceholder: 'नाम, जैसे दुकान 2',
  rentedNowQ: 'क्या अभी कोई किराये पर है?',
  tenantNameQ: 'किरायेदार का नाम',
  tenantPhone: 'फोन (वैकल्पिक)',
  rentQ: 'किराया कितना है?',
  rentFrequencyQ: 'किराया कितने समय पर मिलता है?',
  depositQ: '{term} कितना रखा है?',
  depositNouns: {
    depositAdvance: 'अग्रिम',
    depositBond: 'बॉन्ड',
    depositSecurity: 'जमा राशि',
    depositHeld: 'जमा राशि',
  },
  depositHeld: 'जमा राशि रखी है',
  depositAdvance: 'अग्रिम',
  depositBond: 'बॉन्ड',
  depositSecurity: 'जमा राशि',
  startEndQ: 'शुरू और खत्म',
  startDate: 'शुरू होता है',
  endDate: 'खत्म होता है',
  openEnded: 'खुला अनुबंध',
  escalationQ: 'क्या किराया हर साल बढ़ता है?',
  escalationNone: 'नहीं',
  escalationPct: 'हाँ, {pct}%',
  emptyRentals: 'किराया, जमा राशि और बकाया ट्रैक करने के लिए संपत्ति जोड़ें।',
  receivedOf: 'इस महीने {due} में से {received} मिला',
  statusPaid: 'मिल गया',
  statusPart: 'आंशिक मिला',
  statusOverdue: 'देरी',
  statusDue: 'बाकी है',
  statusVacant: 'खाली',
  rentOwed: 'बकाया {amount}',
  depositLine: 'आपने {term} के रूप में {amount} रखा है। किरायेदार जाने पर वापस मिलेगा।',
  partLine: 'आंशिक मिला: {due} में से {paid}। {left} अभी बाकी है।',
  leaseEndsIn: 'किरायानामा {n} दिनों में खत्म होगा',
  documents: 'दस्तावेज़',
  attachDoc: 'जोड़ें',
  attachPhoto: 'फ़ोटो',
  attachFile: 'फ़ाइल (PDF)',
  docsLocalNote: 'सिर्फ़ इसी फ़ोन में रहता है, अपलोड नहीं होता।',
  docsEmpty: 'किरायानामा या दूसरे काग़ज़ जोड़ें।',
  renameDoc: 'नाम बदलें',
  docSlotAgreement: 'किरायानामा',
  docSlotTenantId: 'किरायेदार की आईडी',
  docSlotMoveIn: 'मूव-इन फ़ोटो',
  docSlotPolice: 'पुलिस वेरिफ़िकेशन',
  docSlotOther: 'अन्य',
  docOf: '{a} / {b}',
  docAddTo: '{name} जोड़ें',
  docNameTitle: 'इस दस्तावेज़ का नाम रखें',
  docNameHint: 'जैसे बिजली का बिल',
  docScan: 'स्कैन',
  docReplace: 'बदलें',
  docAddMore: 'और जोड़ें',
  docPdf: 'PDF',
  docPhotoOne: 'फ़ोटो',
  docPhotos: '{n} फ़ोटो',
  docFiles: '{n} फ़ाइलें',
  docAdded: 'जोड़ा गया {date}',
  docRemoveBody: '{name} से {n} फ़ाइल हटाएँ?',
  docOpenFailed: 'यह फ़ाइल नहीं खुल सकी।',
  docBadType: 'सिर्फ़ PDF या फ़ोटो जोड़ सकते हैं।',
  detailsTitle: 'विवरण',
  addressLabel: 'पता',
  notesLabel: 'नोट्स',
  agreementStart: 'किरायानामा शुरू',
  agreementEnd: 'किरायानामा खत्म',
  callTenant: 'कॉल करें',
  whatsappTenant: 'व्हाट्सऐप',
  notAdded: 'जोड़ा नहीं',
  sendToPartner: 'साथी को भेजें',
  e2eeNote: 'एंड-टू-एंड एन्क्रिप्टेड। इसे केवल आप और आपके साथी पढ़ सकते हैं।',
  phoneAdded: '{name} ने नया फ़ोन जोड़ा।',
  dismiss: 'बंद करें',
  formerCouple: 'पूर्व जोड़ी: {name}',
  formerCouplesTitle: 'पूर्व जोड़ियाँ',
  formerCoupleNote: 'केवल पढ़ने के लिए प्रति, सिर्फ़ इसी फ़ोन पर रखी गई।',
  backupCoupleStandard: 'आपके साझा किराये भी शामिल हैं। स्टैंडर्ड बैकअप में ये Google द्वारा सुरक्षित रहते हैं।',
  backupCoupleExtra:
    'आपके साझा किराये भी शामिल हैं। एक्स्ट्रा बैकअप में ये आपकी अपनी रिकवरी कुंजी से सुरक्षित रहते हैं।',
  yourPhones: 'आपके फ़ोन',
  yourPhonesSub: 'वे फ़ोन जो आपके साझा किराये पढ़ सकते हैं।',
  thisPhone: 'यह फ़ोन',
  phoneLastSeen: 'आखिरी बार देखा गया {when}',
  removePhone: 'हटाएँ',
  removePhoneConfirm: 'इस फ़ोन को हटाएँ? यह साझा किराये पाना बंद कर देगा।',
  signOutBackUpTitle: 'पहले बैकअप लें?',
  signOutBackUpBody: 'साझा किराये सिर्फ़ आपके फ़ोन पर रहते हैं।',
  backUpAction: 'बैकअप लें',
  signOutAnyway: 'फिर भी साइन आउट करें',
  recordedBy: '{name} ने दर्ज किया',
  rentalsRowSub: '{n} संपत्तियाँ · इस महीने {amount} मिला',
  tenants: 'किरायेदार',
  unit: 'यूनिट (वैकल्पिक)',
  recordRent: 'किराया दर्ज करें',
  rentDueCap: 'किराया बाकी',
  dueThisMonthCap: 'इस महीने बाकी',
  addExpense: 'खर्च जोड़ें',
  expenseNote: 'मरम्मत या टैक्स',
  yearlyIncome: 'इस साल मिला किराया',
  yearlyExpense: 'इस साल इस संपत्ति पर खर्च',
  last12: 'पिछले 12 महीने',
  confirmQ: 'क्या {name} ने {unit} के लिए {amount} दिया?',
  yesReceived: 'हाँ, मिल गया',
  notYet: 'अभी नहीं',
  partPayment: 'आंशिक भुगतान',
  rentReceived: 'किराया मिला',
  tenantLeft: 'किरायेदार चला गया',
  settleQ: '{term} में से कितना वापस जाएगा?',
  returned: 'वापस जाएगा',
  kept: 'रखा या काटा',
  shareReceipt: 'रसीद शेयर करें',
  receiptTitle: 'किराया भुगतान',
  receiptFooter: 'Waves में दर्ज — बैंक की पुष्टि नहीं, टैक्स इनवॉइस नहीं',
  proOnly: 'किराया रसीद Pro में मिलती है।',
  addTenant: 'किरायेदार जोड़ें',
  shareFailed: 'शेयर नहीं हो सका।',
  receiptLine: '{name} ने {date} को {unit} के लिए {amount} दिया।',
  expenseTitle: 'कितना खर्च हुआ?',
  newRentQ: 'नया किराया क्या होगा?',
  vacantNote: 'अभी कोई किरायेदार नहीं।',
  today: 'आज',
  raiseRent: 'किराया बदलें',
  raisePrompt: '{date} से किराया {pct}% बढ़कर {old} से {new} होगा। लागू करें?',
  raiseApply: 'लागू करें',
  raiseNotNow: 'अभी नहीं',
  raiseFailed: 'नया किराया लागू नहीं हो सका। फिर कोशिश करें।',
  raiseFuture: '{date} को बढ़कर {amount} होगा',
  sipTomorrow: '{name}: कल {amount} जाएगा।',
  sipToday: '{name} में {amount} जोड़ने का समय।',
  rentDueToday: '{name}: आज {amount} किराया देना है।',
  rentNotRecorded: '{name}: {amount} किराया अभी दर्ज नहीं हुआ।',
  leaseEndNote: '{name}: किरायानामा {n} दिनों में खत्म होगा।',
  maturityNote: '{name} {n} दिनों में मैच्योर होगा।',
  rentRowTitle: 'किराया · {name}',
  leaseRowTitle: 'किरायानामा खत्म · {name}',
  maturityRowTitle: 'मैच्योरिटी · {name}',
};

export const wealthAr: WealthStrings = {
  investments: 'الاستثمارات',
  rentals: 'الإيجارات',
  invested: 'مستثمر',
  investedNotSpending: 'مستثمر، وليس إنفاقًا',
  goingIn: 'يُضاف كل شهر',
  investedSoFar: 'المستثمر حتى الآن',
  valueLine: 'المستثمر حتى الآن {invested}. القيمة التي أدخلتها {value} بتاريخ {date}.',
  currentValue: 'القيمة الحالية (أدخلتها أنت)',
  valueNote: 'هذا رقمك الخاص. لا تتحقق Waves منه ولا تعدّله.',
  addInvestment: 'أضف استثمارًا',
  investmentTypeLabel: 'نوع الاستثمار',
  recurringAmountLabel: 'المبلغ في كل مرة',
  howOftenLabel: 'كم مرة',
  saveInvestmentBtn: 'احفظ الاستثمار',
  trackInvTitle: 'تابع استثماراتك',
  addRental: 'أضف عقارًا',
  trackRentTitle: 'تابع إيجارك',
  trackRentSub: 'احتفظ بدفعات الإيجار والتأمين والمصروفات في مكان واحد.',
  addProperty: 'أضف عقارًا',
  propertyTypeLabel: 'نوع العقار',
  propertyNameLabel: 'اسم العقار',
  currentlyRentedQ: 'هل هو مؤجَّر حاليًا؟',
  tenantNameLabel: 'اسم المستأجر',
  monthlyRent: 'الإيجار الشهري',
  refundableDeposit: 'التأمين المسترد',
  rentDueDay: 'يوم استحقاق الإيجار',
  selectDay: 'اختر اليوم',
  dayOfMonth: 'اليوم {n}',
  leaseEndOptional: 'تاريخ انتهاء العقد (اختياري)',
  savePropertyBtn: 'احفظ العقار',
  thisMonth: 'هذا الشهر',
  receivedLabel: 'المستلَم',
  expectedLabel: 'المتوقَّع',
  percentReceived: 'تم استلام {pct}%',
  receivedOfExpected: '{received} من {expected}',
  propertiesCount: 'العقارات ({n})',
  rentBalance: 'رصيد الإيجار',
  addShort: 'إضافة',
  tenantRow: 'المستأجر',
  leaseRow: 'العقد',
  currentRentDue: 'إيجار الشهر الحالي المستحق',
  refundableDepositHeld: 'التأمين المسترد (محتجز)',
  thisYear: 'هذا العام',
  propertyExpenses: 'مصروفات العقار',
  receiptsBtn: 'الإيصالات',
  goPro: 'اشترك في Pro',
  freeInvestmentLimit: 'الخطة المجانية تتابع 3 استثمارات فقط. Pro بلا حدود.',
  freeRentalLimit: 'الخطة المجانية تتابع عقارًا واحدًا للإيجار. Pro بلا حدود.',
  types: {
    fund: 'استثمار منتظم في صندوق',
    stocks: 'أسهم وصناديق ETF',
    deposit: 'وديعة ثابتة',
    retirement: 'حساب التقاعد',
    metals: 'الذهب والمعادن',
    bonds: 'خطة ادخار أو سندات',
    insurance_linked: 'تأمين برد مبالغ',
    crypto: 'عملات رقمية',
    savings_group: 'جمعية ادخار',
    property: 'عقار',
    other: 'أخرى',
  },
  propertyTypes: {
    house: 'منزل',
    apartment: 'شقة',
    room: 'غرفة',
    shop: 'محل',
    commercial: 'تجاري',
    land: 'أرض',
    other: 'أخرى',
  },
  frequencies: {
    weekly: 'أسبوعيًا',
    fortnightly: 'كل أسبوعين',
    monthly: 'شهريًا',
    quarterly: 'كل 3 أشهر',
    yearly: 'سنويًا',
    custom: 'أخرى',
  },
  invWhatQ: 'ما نوعه؟',
  invNameQ: 'ماذا تسمّيه؟',
  invNamePlaceholder: 'الاسم',
  invHowMuchQ: 'كم المبلغ؟ وكم مرة؟',
  invDayQ: 'أي يوم؟',
  invAutoQ: 'هل يخصمه البنك تلقائيًا؟',
  invAutoYes: 'نعم، يتم تلقائيًا',
  invAutoNo: 'لا، أضيفه بنفسي',
  invStartQ: 'من أي يوم يبدأ؟',
  taxWrapper: 'محتفظ به في حساب ذو مزايا ضريبية',
  maturityQ: 'متى ينتهي؟ يمكنك تخطّي هذا.',
  noEndDate: 'بلا تاريخ انتهاء',
  invOpeningQ: 'كم استثمرت حتى الآن؟',
  invValueQ: 'ما قيمته اليوم؟ يمكنك تخطّي هذا.',
  insuranceQ: 'هل تسترد أموالك في النهاية؟',
  insuranceNo: 'إذن هو فاتورة عادية، وليس استثمارًا.',
  yes: 'نعم',
  no: 'لا',
  save: 'حفظ',
  emptyInvestments: 'أضف استثمارًا لترى كم يُضاف كل شهر وما الذي وضعته حتى الآن.',
  nextOn: 'التالي {date}',
  noSchedule: 'لا جدول',
  entries: 'المدخلات',
  noEntries: 'لم يُسجَّل شيء بعد.',
  addMoney: 'أضف مبلغًا',
  tookOut: 'سحب مبلغ',
  updateValue: 'حدّث القيمة',
  pause: 'إيقاف مؤقت',
  resume: 'استئناف',
  close: 'إغلاق',
  closed: 'مغلق',
  amountLabel: 'المبلغ',
  addMoneyTitle: 'كم أضفت؟',
  tookOutTitle: 'كم سحبت؟',
  updateValueTitle: 'ما قيمته الآن؟',
  withdrawal: 'مبلغ مسحوب',
  propWhatQ: 'ماذا تؤجّر؟',
  propNameQ: 'ماذا تسمّيه؟',
  propNamePlaceholder: 'الاسم، مثل محل 2',
  rentedNowQ: 'هل يسكنه مستأجر الآن؟',
  tenantNameQ: 'اسم المستأجر',
  tenantPhone: 'الهاتف (اختياري)',
  rentQ: 'كم الإيجار؟',
  rentFrequencyQ: 'كم مرة يُدفع؟',
  depositQ: 'كم لديك من {term}؟',
  depositNouns: {
    depositAdvance: 'دفعة مقدمة',
    depositBond: 'ضمان بنكي',
    depositSecurity: 'تأمين',
    depositHeld: 'التأمين',
  },
  depositHeld: 'التأمين لديك',
  depositAdvance: 'دفعة مقدمة',
  depositBond: 'ضمان بنكي',
  depositSecurity: 'تأمين',
  startEndQ: 'البداية والنهاية',
  startDate: 'يبدأ',
  endDate: 'ينتهي',
  openEnded: 'عقد مفتوح',
  escalationQ: 'هل يرتفع الإيجار كل سنة؟',
  escalationNone: 'لا',
  escalationPct: 'نعم، {pct}%',
  emptyRentals: 'أضف عقارًا لمتابعة الإيجار والتأمين والمبالغ المستحقة.',
  receivedOf: 'استلمت {received} من {due} هذا الشهر',
  statusPaid: 'مدفوع',
  statusPart: 'مدفوع جزئيًا',
  statusOverdue: 'متأخر',
  statusDue: 'مستحق',
  statusVacant: 'شاغر',
  rentOwed: 'المتبقي {amount}',
  depositLine: 'لديك {amount} كـ{term}. يُعاد للمستأجر عند مغادرته.',
  partLine: 'مدفوع جزئيًا: {paid} من {due}. {left} لا يزال مستحقًا.',
  leaseEndsIn: 'ينتهي العقد خلال {n} أيام',
  documents: 'المستندات',
  attachDoc: 'إرفاق',
  attachPhoto: 'صورة',
  attachFile: 'ملف (PDF)',
  docsLocalNote: 'تبقى على هذا الهاتف فقط ولا يتم رفعها.',
  docsEmpty: 'أضف عقد الإيجار أو أوراقًا أخرى.',
  renameDoc: 'إعادة تسمية',
  docSlotAgreement: 'عقد الإيجار',
  docSlotTenantId: 'هوية المستأجر',
  docSlotMoveIn: 'صور الاستلام',
  docSlotPolice: 'التحقق الأمني',
  docSlotOther: 'أخرى',
  docOf: '{a} من {b}',
  docAddTo: 'إضافة {name}',
  docNameTitle: 'سمِّ هذا المستند',
  docNameHint: 'مثل فاتورة الكهرباء',
  docScan: 'مسح',
  docReplace: 'استبدال',
  docAddMore: 'إضافة المزيد',
  docPdf: 'PDF',
  docPhotoOne: 'صورة',
  docPhotos: '{n} صور',
  docFiles: '{n} ملفات',
  docAdded: 'أضيف في {date}',
  docRemoveBody: 'حذف {n} ملف(ات) من {name}؟',
  docOpenFailed: 'تعذّر فتح هذا الملف.',
  docBadType: 'يمكن إرفاق ملفات PDF أو صور فقط.',
  detailsTitle: 'التفاصيل',
  addressLabel: 'العنوان',
  notesLabel: 'ملاحظات',
  agreementStart: 'بداية العقد',
  agreementEnd: 'نهاية العقد',
  callTenant: 'اتصال',
  whatsappTenant: 'واتساب',
  notAdded: 'غير مضاف',
  sendToPartner: 'إرسال إلى الشريك',
  e2eeNote: 'مشفّر من طرف إلى طرف. أنت وشريكك فقط يمكنكما قراءة هذا.',
  phoneAdded: '{name} أضاف هاتفًا جديدًا.',
  dismiss: 'إغلاق',
  formerCouple: 'الزوجان السابقان: {name}',
  formerCouplesTitle: 'الأزواج السابقون',
  formerCoupleNote: 'نسخة للقراءة فقط، محفوظة على هذا الهاتف فقط.',
  backupCoupleStandard: 'إيجاراتكما المشتركة مضمّنة. في النسخ الاحتياطي القياسي تحميها Google.',
  backupCoupleExtra:
    'إيجاراتكما المشتركة مضمّنة. في النسخ الاحتياطي الإضافي يحميها مفتاح الاسترداد الخاص بك.',
  yourPhones: 'هواتفك',
  yourPhonesSub: 'الهواتف التي يمكنها قراءة إيجاراتك المشتركة.',
  thisPhone: 'هذا الهاتف',
  phoneLastSeen: 'آخر ظهور {when}',
  removePhone: 'إزالة',
  removePhoneConfirm: 'إزالة هذا الهاتف؟ سيتوقف عن تلقي الإيجارات المشتركة.',
  signOutBackUpTitle: 'النسخ الاحتياطي أولًا؟',
  signOutBackUpBody: 'الإيجارات المشتركة موجودة على هواتفكما فقط.',
  backUpAction: 'نسخ احتياطي',
  signOutAnyway: 'تسجيل الخروج على أي حال',
  recordedBy: 'سجّله {name}',
  rentalsRowSub: '{n} عقارات · استُلم {amount} هذا الشهر',
  tenants: 'المستأجرون',
  unit: 'الوحدة (اختياري)',
  recordRent: 'سجّل الإيجار',
  rentDueCap: 'الإيجار المستحق',
  dueThisMonthCap: 'مستحق هذا الشهر',
  addExpense: 'أضف مصروفًا',
  expenseNote: 'صيانة أو ضريبة',
  yearlyIncome: 'الإيجار المحصّل هذا العام',
  yearlyExpense: 'المصروف على هذا العقار هذا العام',
  last12: 'آخر 12 شهرًا',
  confirmQ: 'هل دفع {name} مبلغ {amount} عن {unit}؟',
  yesReceived: 'نعم، تم الاستلام',
  notYet: 'ليس بعد',
  partPayment: 'دفع جزئي',
  rentReceived: 'إيجار مستلم',
  tenantLeft: 'غادر المستأجر',
  settleQ: 'كم يُرد من {term}؟',
  returned: 'يُرد',
  kept: 'محتجز أو مخصوم',
  shareReceipt: 'مشاركة الإيصال',
  receiptTitle: 'سداد الإيجار',
  receiptFooter: 'مسجَّل في Waves — ليس تأكيدًا بنكيًا ولا فاتورة ضريبية',
  proOnly: 'إيصالات الإيجار متاحة في Pro فقط.',
  addTenant: 'أضف مستأجرًا',
  shareFailed: 'تعذّر فتح قائمة المشاركة.',
  receiptLine: 'استلمت {amount} من {name} بتاريخ {date} عن {unit}.',
  expenseTitle: 'كم كانت التكلفة؟',
  newRentQ: 'ما الإيجار الجديد؟',
  vacantNote: 'لا يوجد مستأجر حاليًا.',
  today: 'اليوم',
  raiseRent: 'تعديل الإيجار',
  raisePrompt: 'سيزيد الإيجار بنسبة {pct}% من {old} إلى {new} في {date}. هل تطبّق التغيير؟',
  raiseApply: 'طبّق التغيير',
  raiseNotNow: 'ليس الآن',
  raiseFailed: 'تعذّر تطبيق الإيجار الجديد. حاول مرة أخرى.',
  raiseFuture: 'سيصبح {amount} في {date}',
  sipTomorrow: '{name}: سيُضاف {amount} غدًا.',
  sipToday: 'حان وقت إضافة {amount} إلى {name}.',
  rentDueToday: '{name}: إيجار {amount} مستحق اليوم.',
  rentNotRecorded: '{name}: إيجار {amount} لم يُسجَّل بعد.',
  leaseEndNote: '{name}: ينتهي العقد خلال {n} أيام.',
  maturityNote: 'يستحق {name} خلال {n} أيام.',
  rentRowTitle: 'إيجار · {name}',
  leaseRowTitle: 'انتهاء العقد · {name}',
  maturityRowTitle: 'الاستحقاق · {name}',
};
