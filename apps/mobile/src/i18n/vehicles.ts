/**
 * Copy for Vehicles and the driving licence. Neutral English: regional product names
 * (PUC, MOT, Rego) appear only as hints chosen by country (lib/vehiclePlan renewalHint).
 * Tamil, Hindi and Arabic translate the headline words and fall back to English for the rest.
 */
import type {
  FuelType,
  RenewalKind,
  VehicleExpenseKind,
  VehicleType,
} from '@waves/core';

export interface VehicleStrings {
  vehicles: string;
  addVehicle: string;
  addShort: string;
  trackTitle: string;
  trackSub: string;
  thisMonth: string;
  spent: string;
  /** {n} */
  vehiclesCount: string;
  freeLimit: string;
  types: Record<VehicleType, string>;
  fuels: Record<FuelType, string>;
  renewalKinds: Record<RenewalKind, string>;
  expenseKinds: Record<VehicleExpenseKind, string>;
  typeLabel: string;
  nameLabel: string;
  namePlaceholder: string;
  registrationLabel: string;
  makeModelLabel: string;
  yearLabel: string;
  fuelLabel: string;
  insuranceExpiry: string;
  emissionExpiry: string;
  notSet: string;
  saveVehicle: string;
  addExpense: string;
  documents: string;
  /** {kind} {n} */
  dueIn: string;
  /** {kind} */
  dueToday: string;
  /** {kind} {n} */
  overdueBy: string;
  dueSoonTitle: string;
  detailsTitle: string;
  /** {unit} */
  odometer: string;
  notes: string;
  customDetails: string;
  addDetail: string;
  detailName: string;
  detailValue: string;
  renewalsTitle: string;
  addRenewal: string;
  renewalLabel: string;
  dueDate: string;
  remindDays: string;
  /** {n} */
  remindDaysValue: string;
  policyNumber: string;
  provider: string;
  docRc: string;
  docInsurance: string;
  docEmission: string;
  docLicence: string;
  recentExpenses: string;
  noExpenses: string;
  last12: string;
  expenseTitle: string;
  expenseNote: string;
  licence: string;
  addLicence: string;
  /** {date} */
  licenceExpires: string;
  licenceTitle: string;
  holderName: string;
  licenceNumber: string;
  licenceClass: string;
  licenceExpiry: string;
  markSold: string;
  markActive: string;
  sold: string;
  moveTo: string;
  personal: string;
  /** {name} */
  moveConfirm: string;
  /** {where} */
  moveBody: string;
  moveFailed: string;
  noSpaces: string;
  deleteBody: string;
  /** Notification titles/bodies. {name} {kind} {n} */
  reminderTitle: string;
  reminderBody: string;
  rowTitle: string;
  e2eeNote: string;
  accountsCardSub: string;
  /** {n} {amount} */
  rowSub: string;
}

export const vehiclesEn: VehicleStrings = {
  vehicles: 'Vehicles',
  addVehicle: 'Add vehicle',
  addShort: 'Add',
  trackTitle: 'Keep every vehicle in one place',
  trackSub: 'Fuel, service, insurance, licence and papers, with a reminder before anything expires.',
  thisMonth: 'This month',
  spent: 'Spent',
  vehiclesCount: '{n} vehicles',
  freeLimit: 'Free plan: 1 vehicle. Upgrade for more.',
  types: {
    car: 'Car',
    bike: 'Motorbike',
    scooter: 'Scooter',
    three_wheeler: 'Three-wheeler',
    truck: 'Truck / van',
    other: 'Other',
  },
  fuels: {
    petrol: 'Petrol',
    diesel: 'Diesel',
    cng: 'CNG / LPG',
    electric: 'Electric',
    hybrid: 'Hybrid',
    other: 'Other',
  },
  renewalKinds: {
    insurance: 'Insurance',
    emission_test: 'Emission test',
    service: 'Service',
    road_tax: 'Road tax',
    registration: 'Registration',
    inspection: 'Inspection',
    permit: 'Permit',
    other: 'Other',
  },
  expenseKinds: {
    fuel: 'Fuel',
    service: 'Service',
    insurance: 'Insurance',
    tax: 'Tax',
    toll_parking: 'Toll / parking',
    repair: 'Repair',
    other: 'Other',
  },
  typeLabel: 'Type',
  nameLabel: 'Name',
  namePlaceholder: 'e.g. Family car',
  registrationLabel: 'Registration number',
  makeModelLabel: 'Make and model',
  yearLabel: 'Year',
  fuelLabel: 'Fuel',
  insuranceExpiry: 'Insurance expires (optional)',
  emissionExpiry: 'Emission test due (optional)',
  notSet: 'Not set',
  saveVehicle: 'Save vehicle',
  addExpense: 'Add expense',
  documents: 'Documents',
  dueIn: '{kind} in {n} days',
  dueToday: '{kind} today',
  overdueBy: '{kind} {n} days overdue',
  dueSoonTitle: 'Due soon',
  detailsTitle: 'Details',
  odometer: 'Odometer ({unit})',
  notes: 'Notes',
  customDetails: 'Other details',
  addDetail: 'Add a detail',
  detailName: 'Name',
  detailValue: 'Value',
  renewalsTitle: 'Renewals',
  addRenewal: 'Add renewal',
  renewalLabel: 'Name (optional)',
  dueDate: 'Due date',
  remindDays: 'Remind me before',
  remindDaysValue: '{n} days',
  policyNumber: 'Policy or reference number',
  provider: 'Provider',
  docRc: 'Registration',
  docInsurance: 'Insurance',
  docEmission: 'Emission test',
  docLicence: 'Driving licence',
  recentExpenses: 'Recent expenses',
  noExpenses: 'No expenses yet',
  last12: 'Last 12 months',
  expenseTitle: 'Vehicle expense',
  expenseNote: 'Note (optional)',
  licence: 'Driving licence',
  addLicence: 'Add driving licence',
  licenceExpires: 'Driving licence · expires {date}',
  licenceTitle: 'Driving licence',
  holderName: 'Name on licence',
  licenceNumber: 'Licence number',
  licenceClass: 'Class',
  licenceExpiry: 'Expiry date',
  markSold: 'Mark as sold',
  markActive: 'Mark as active',
  sold: 'Sold',
  moveTo: 'Move to...',
  personal: 'Personal',
  moveConfirm: 'Move to {name}?',
  moveBody:
    'The vehicle, its renewals and details move. Documents stay on this phone. Past expenses stay in {where}.',
  moveFailed: 'Could not move it. Nothing changed.',
  noSpaces: 'You are not in a couple or home space yet.',
  deleteBody: 'Delete this vehicle? Its documents on this phone are removed. Past expenses stay in your transactions.',
  reminderTitle: 'Vehicles',
  reminderBody: '{name}: {kind} due in {n} days',
  rowTitle: '{name} {kind}',
  e2eeNote: 'Only members of this space can read this.',
  accountsCardSub: 'Fuel, service, insurance and papers',
  rowSub: '{n} vehicles · {amount} this month',
};

export const vehiclesTa: VehicleStrings = {
  ...vehiclesEn,
  vehicles: 'வாகனங்கள்',
  addVehicle: 'வாகனம் சேர்',
  addShort: 'சேர்',
  documents: 'ஆவணங்கள்',
  addExpense: 'செலவு சேர்',
  licence: 'ஓட்டுநர் உரிமம்',
  detailsTitle: 'விவரங்கள்',
  notes: 'குறிப்புகள்',
  thisMonth: 'இந்த மாதம்',
  types: { ...vehiclesEn.types, car: 'கார்', bike: 'பைக்', scooter: 'ஸ்கூட்டர்' },
  fuels: { ...vehiclesEn.fuels, petrol: 'பெட்ரோல்', diesel: 'டீசல்', electric: 'மின்சாரம்' },
  renewalKinds: { ...vehiclesEn.renewalKinds, insurance: 'காப்பீடு', service: 'சர்வீஸ்' },
  expenseKinds: { ...vehiclesEn.expenseKinds, fuel: 'எரிபொருள்', service: 'சர்வீஸ்' },
};

export const vehiclesHi: VehicleStrings = {
  ...vehiclesEn,
  vehicles: 'वाहन',
  addVehicle: 'वाहन जोड़ें',
  addShort: 'जोड़ें',
  documents: 'दस्तावेज़',
  addExpense: 'खर्च जोड़ें',
  licence: 'ड्राइविंग लाइसेंस',
  detailsTitle: 'विवरण',
  notes: 'नोट्स',
  thisMonth: 'इस महीने',
  types: { ...vehiclesEn.types, car: 'कार', bike: 'बाइक', scooter: 'स्कूटर' },
  fuels: { ...vehiclesEn.fuels, petrol: 'पेट्रोल', diesel: 'डीज़ल', electric: 'इलेक्ट्रिक' },
  renewalKinds: { ...vehiclesEn.renewalKinds, insurance: 'बीमा', service: 'सर्विस' },
  expenseKinds: { ...vehiclesEn.expenseKinds, fuel: 'ईंधन', service: 'सर्विस' },
};

export const vehiclesAr: VehicleStrings = {
  ...vehiclesEn,
  vehicles: 'المركبات',
  addVehicle: 'إضافة مركبة',
  addShort: 'إضافة',
  documents: 'المستندات',
  addExpense: 'إضافة مصروف',
  licence: 'رخصة القيادة',
  detailsTitle: 'التفاصيل',
  notes: 'ملاحظات',
  thisMonth: 'هذا الشهر',
  types: { ...vehiclesEn.types, car: 'سيارة', bike: 'دراجة نارية', scooter: 'سكوتر' },
  fuels: { ...vehiclesEn.fuels, petrol: 'بنزين', diesel: 'ديزل', electric: 'كهربائي' },
  renewalKinds: { ...vehiclesEn.renewalKinds, insurance: 'التأمين', service: 'الصيانة' },
  expenseKinds: { ...vehiclesEn.expenseKinds, fuel: 'وقود', service: 'صيانة' },
};
