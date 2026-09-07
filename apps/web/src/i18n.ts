/**
 * The words on the four pages a guest sees, in the four languages the app
 * speaks.
 *
 * Separate from `apps/mobile/src/i18n` on purpose and not shared through a
 * package: that module imports `react-native` and `expo-localization` at the
 * top, and this is a Next app. What is shared is the *shape* — a closed
 * `WebStrings` interface with no spread of English underneath it, so adding a
 * key is a compile error in all four languages until somebody writes the words.
 *
 * The language is decided on the server from `Accept-Language`, which is what
 * lets `<html lang>` and `dir` be right in the first paint rather than
 * corrected a frame later. A guest arriving on an Arabic phone should not watch
 * the page turn around.
 */

export enum Language {
  En = 'en',
  Ta = 'ta',
  Hi = 'hi',
  Ar = 'ar',
}

export const LANGUAGES: readonly Language[] = [Language.En, Language.Ta, Language.Hi, Language.Ar];

export function isRtlLanguage(language: Language): boolean {
  return language === Language.Ar;
}

/**
 * The best of the languages the browser asked for.
 *
 * `Accept-Language` is already in preference order and carries quality values
 * we do not need to weigh: the first tag whose language subtag is one of ours
 * is the answer, and English is the answer when none of them is.
 */
export function pickLanguage(acceptLanguage: string | null | undefined): Language {
  if (!acceptLanguage) return Language.En;
  for (const part of acceptLanguage.split(',')) {
    const tag = part.split(';')[0]?.trim().toLowerCase();
    const subtag = tag?.split('-')[0];
    if (subtag && (LANGUAGES as readonly string[]).includes(subtag)) {
      return subtag as Language;
    }
  }
  return Language.En;
}

/**
 * The locale money and dates are formatted in.
 *
 * The region is kept from whatever the browser asked for, so somebody reading
 * in Hindi from Dubai still sees `hi-AE` money. Choosing a language is not
 * choosing a country.
 */
export function localeFor(language: Language, acceptLanguage: string | null | undefined): string {
  if (!acceptLanguage) return language;
  for (const part of acceptLanguage.split(',')) {
    const tag = part.split(';')[0]?.trim();
    if (!tag?.toLowerCase().startsWith(language + '-')) continue;
    try {
      // Rejects structurally invalid tags; a header is client-supplied.
      return Intl.getCanonicalLocales(tag)[0] ?? language;
    } catch {
      return language;
    }
  }
  return language;
}

export interface PluralForms {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

/** The right form for `count`, with the number formatted for the locale. */
export function plural(locale: string, count: number, forms: PluralForms): string {
  let rule: Intl.LDMLPluralRule = 'other';
  let shown = String(count);
  try {
    rule = new Intl.PluralRules(locale).select(count);
    shown = new Intl.NumberFormat(locale).format(count);
  } catch {
    // A locale Intl will not take is not a reason to render nothing.
  }
  return (forms[rule] ?? forms.other).replaceAll('{n}', shown);
}

export interface WebStrings {
  /** The page somebody reaches by typing the domain in. */
  home: {
    title: string;
    description: string;
    elsewhere: string;
  };
  /** The invite link, which is the whole growth loop (ADR-006). */
  join: {
    linkBroken: string;
    linkBrokenBody: string;
    opening: string;
    aGroup: string;
    addedTo: string;
    splittingHere: PluralForms;
    whichOneAreYou: string;
    claimNote: string;
    someone: string;
    noneOfThese: string;
    yourName: string;
    namePlaceholder: string;
    onlyThingAsked: string;
    joining: string;
    joinGroup: string;
    askToJoinAs: string;
    waitingTitle: string;
    waitingBody: string;
    joinAsNewInstead: string;
  };
  /** The group, in a browser: less than the app, and enough for a trip. */
  group: {
    loading: string;
    notYours: string;
    notYoursBody: string;
    yourGroup: string;
    peopleCount: PluralForms;
    expenseCount: PluralForms;
    whereEveryoneStands: string;
    settledUp: string;
    isSettledUp: string;
    isOwed: string;
    owes: string;
    whoPaysWhom: string;
    whoPaysWhomNote: string;
    recent: string;
    addAnExpense: string;
    installNote: string;
  };
  /** Adding one expense, equally split, and nothing cleverer. */
  add: {
    title: string;
    defaultDescription: string;
    whatWasIt: string;
    howMuch: string;
    amountIn: string;
    notAnAmount: string;
    whoPaid: string;
    you: string;
    splitBetween: string;
    splitEquallyNote: string;
    saving: string;
    save: string;
    cancel: string;
    editTitle: string;
    splitMethod: string;
    invalidSplit: string;
    runningSum: string;
    cannotEditSplit: string;
  };
  /** Attaching where a spend happened (A43). Coordinates only on the web — the
   *  browser has no on-device reverse-geocoder. */
  location: {
    label: string;
    add: string;
    adding: string;
    remove: string;
    blocked: string;
    unavailable: string;
    openMap: string;
  };
  /** The signed-in web client: shell, sign-in and the overview dashboard. */
  dash: {
    nav: {
      overview: string;
      groups: string;
      activity: string;
      friends: string;
      settle: string;
    };
    searchPlaceholder: string;
    signInTitle: string;
    signInBody: string;
    continueWithGoogle: string;
    orDivider: string;
    emailPlaceholder: string;
    passwordPlaceholder: string;
    passwordSignIn: string;
    passwordSignUp: string;
    toggleToSignUp: string;
    toggleToSignIn: string;
    sendMagicLink: string;
    sendingLink: string;
    linkSentTitle: string;
    linkSentBody: string;
    notAnEmail: string;
    signingIn: string;
    guestInstead: string;
    signOut: string;
    guestLabel: string;
    overviewTitle: string;
    groupsCount: PluralForms;
    youreOwed: string;
    youOwe: string;
    net: string;
    activeGroups: string;
    /** The one-line answer the dashboard hero gives: are you up or down. */
    youGetBack: string;
    youNeedToPay: string;
    /** The always-present primary action, and the group picker it opens. */
    addExpense: string;
    addPickGroup: string;
    allSettled: string;
    moreCurrencies: PluralForms;
    yourGroups: string;
    noGroups: string;
    recentActivity: string;
    noActivity: string;
    seeAll: string;
    guestTitle: string;
    guestBody: string;
    guestCta: string;
    selectGroupHint: string;
    membersCount: PluralForms;
    yourNet: string;
    openGroup: string;
    settledUp: string;
    currencyLabel: string;
    loading: string;
  };
  /** One expense, in full: who paid, the split, the history, disputes. */
  expense: {
    notFound: string;
    paidBy: string;
    splitLabel: string;
    total: string;
    history: string;
    versionNo: string;
    edit: string;
    delete: string;
    confirmDelete: string;
    restore: string;
    deletedBadge: string;
    disputes: string;
    reasonPlaceholder: string;
    raiseDispute: string;
    withdraw: string;
    disputedBadge: string;
    markNeedsFix: string;
    markCorrect: string;
    resolvedNeedsFix: string;
    resolvedCorrect: string;
    withdrawn: string;
    splitKind: {
      equal: string;
      exact: string;
      percent: string;
      shares: string;
      adjustment: string;
      itemized: string;
    };
  };
  /** The cross-group activity feed. */
  activity: {
    title: string;
    empty: string;
    loading: string;
  };
  /** Everyone you are not square with, netted across every shared group. */
  friends: {
    title: string;
    empty: string;
    owesYou: string;
    youOwe: string;
    inGroups: PluralForms;
    settleUp: string;
    loading: string;
  };
  /** Recording and confirming settlements (ADR-007). */
  settle: {
    title: string;
    pickGroup: string;
    allSettled: string;
    youOweHead: string;
    owesYouHead: string;
    pendingHead: string;
    settleUp: string;
    howPaid: string;
    amountLabel: string;
    payWith: string;
    noHandle: string;
    record: string;
    recording: string;
    cancel: string;
    confirm: string;
    confirming: string;
    waitingConfirm: string;
    nudge: string;
    nudged: string;
    loading: string;
  };
  /** What a backend failure is allowed to say. The real message goes to Sentry
   *  — see `lib/errors.ts`. */
  /** The groups shelf, and the group management the browser never had. */
  groups: {
    title: string;
    empty: string;
    emptyBody: string;
    newGroup: string;
    showArchived: string;
    hideArchived: string;
    archivedEmpty: string;
    archivedTag: string;
    memberCount: PluralForms;
  };
  newGroup: {
    title: string;
    intro: string;
    nameLabel: string;
    namePlaceholder: string;
    emojiLabel: string;
    currencyLabel: string;
    typeLabel: string;
    typeTrip: string;
    typeHome: string;
    typeCouple: string;
    typeFriends: string;
    typeEvent: string;
    typeOther: string;
    simplifyLabel: string;
    simplifyBody: string;
    peopleLabel: string;
    peopleBody: string;
    personPlaceholder: string;
    addPerson: string;
    create: string;
    creating: string;
  };
  members: {
    title: string;
    you: string;
    admin: string;
    ghost: string;
    ghostBody: string;
    addTitle: string;
    namePlaceholder: string;
    emailPlaceholder: string;
    phonePlaceholder: string;
    add: string;
    makeAdmin: string;
    removeAdmin: string;
    remove: string;
    removeConfirm: string;
    leave: string;
    leaveConfirm: string;
    inviteInstead: string;
  };
  invite: {
    title: string;
    scanToJoin: string;
    copyLink: string;
    copied: string;
    share: string;
    reset: string;
    resetConfirm: string;
    alreadyHere: PluralForms;
    trust: string;
    making: string;
  };
  groupSettings: {
    title: string;
    nameLabel: string;
    emojiLabel: string;
    currencyLabel: string;
    currencyNote: string;
    simplifyLabel: string;
    simplifyBody: string;
    save: string;
    saved: string;
    archive: string;
    archiveBody: string;
    unarchive: string;
    delete: string;
    deleteBody: string;
    deleteConfirm: string;
    adminOnly: string;
    danger: string;
  };
  settings: {
    title: string;
    profile: string;
    displayName: string;
    currency: string;
    country: string;
    paymentHandle: string;
    paymentHandleBody: string;
    save: string;
    saved: string;
    notifications: string;
    notifyInvolvesMe: string;
    notifyDigest: string;
    notifySettlements: string;
    notifyNudges: string;
    notifyWeekly: string;
    language: string;
    languageBody: string;
    guestTitle: string;
    guestBody: string;
    signOut: string;
    onlyInApp: string;
    onlyInAppBody: string;
  };
  errors: {
    couldNotLoad: string;
    couldNotSignIn: string;
    passwordTooShort: string;
    passwordTooCommon: string;
    couldNotSave: string;
    offline: string;
    tooMany: string;
  };
}

const en: WebStrings = {
  home: {
    title: 'Waves',
    description:
      'Split expenses without the argument at the end. This page is only for opening an invite link — if somebody shared a group with you, open their link rather than this address.',
    elsewhere: 'Everything else lives in the app.',
  },
  join: {
    linkBroken: 'This link does not work',
    linkBrokenBody: 'Links expire, and whoever shared it can turn it off. Ask them for a new one.',
    opening: 'Opening the link…',
    aGroup: 'a group',
    addedTo: 'You have been added to {group}',
    splittingHere: {
      one: '{n} person is splitting costs here. You can join and add an expense right now — nothing to install.',
      other:
        '{n} people are splitting costs here. You can join and add an expense right now — nothing to install.',
    },
    whichOneAreYou: 'Which one are you?',
    claimNote:
      'Somebody already added these names. Picking yours keeps the expenses already filed against it.',
    someone: 'Someone',
    noneOfThese: 'None of these',
    yourName: 'Your name',
    namePlaceholder: 'What should they call you?',
    onlyThingAsked: 'This is the only thing asked of you. No email, no password, no app.',
    joining: 'Joining…',
    joinGroup: 'Join {group}',
    askToJoinAs: 'Ask to join as {name}',
    waitingTitle: 'Asked',
    waitingBody:
      'Somebody who runs {group} has to confirm you are {name}. Nothing has changed in the group yet.',
    joinAsNewInstead: 'Join as someone new instead',
  },
  group: {
    loading: 'Loading…',
    notYours: 'Not your group',
    notYoursBody:
      'This browser is not a member of this group. If somebody sent you a link, open that instead.',
    yourGroup: 'Your group',
    peopleCount: { one: '{n} person', other: '{n} people' },
    expenseCount: { one: '{n} expense', other: '{n} expenses' },
    whereEveryoneStands: 'Where everyone stands',
    settledUp: 'settled up',
    isSettledUp: 'is settled up',
    isOwed: 'is owed',
    owes: 'owes',
    whoPaysWhom: 'Who pays whom',
    whoPaysWhomNote:
      'The fewest payments that settle everybody. Nobody is made to pay somebody they never split anything with.',
    recent: 'Recent',
    addAnExpense: 'Add an expense',
    installNote:
      'Install Waves to scan receipts, settle over UPI and keep this working without a signal.',
  },
  add: {
    title: 'Add an expense',
    defaultDescription: 'Expense',
    whatWasIt: 'What was it?',
    howMuch: 'How much? ({currency})',
    amountIn: 'Amount in {currency}',
    notAnAmount: 'That is not an amount.',
    whoPaid: 'Who paid',
    you: 'You',
    splitBetween: 'Split between',
    splitEquallyNote: 'Split equally. For exact shares or an itemised bill, use the app.',
    saving: 'Saving…',
    save: 'Save',
    cancel: 'Cancel',
    editTitle: 'Edit expense',
    splitMethod: 'How to split',
    invalidSplit: 'These shares do not add up yet.',
    runningSum: '{sum} of {total}',
    cannotEditSplit: 'This bill was split in a way the web cannot edit yet — open it in the app.',
  },
  location: {
    label: 'Location',
    add: 'Add location',
    adding: 'Getting location…',
    remove: 'Remove',
    blocked: 'Location is blocked in your browser. Allow it to add a place.',
    unavailable: "Couldn't get your location — please try again.",
    openMap: 'Open in maps',
  },
  dash: {
    nav: {
      overview: 'Overview',
      groups: 'Groups',
      activity: 'Activity',
      friends: 'Friends',
      settle: 'Settle',
    },
    searchPlaceholder: 'Search groups, people, expenses',
    signInTitle: 'Waves',
    signInBody: 'Split expenses without the argument at the end.',
    continueWithGoogle: 'Continue with Google',
    orDivider: 'or',
    emailPlaceholder: 'you@email.com',
    passwordPlaceholder: 'Password',
    passwordSignIn: 'Sign in',
    passwordSignUp: 'Create account',
    toggleToSignUp: 'New here? Create an account',
    toggleToSignIn: 'Already have an account? Sign in',
    sendMagicLink: 'Email me a sign-in link instead',
    sendingLink: 'Sending…',
    linkSentTitle: 'Check your inbox',
    linkSentBody: 'A sign-in link is on its way to {email}. Open it on this device.',
    notAnEmail: 'That does not look like an email address.',
    signingIn: 'Signing in…',
    guestInstead: 'Or open an invite link someone shared with you.',
    signOut: 'Sign out',
    guestLabel: 'Guest',
    overviewTitle: 'Overview',
    groupsCount: { one: '{n} group', other: '{n} groups' },
    youreOwed: "You're owed",
    youOwe: 'You owe',
    net: 'Net position',
    activeGroups: 'Active groups',
    youGetBack: 'You get back',
    youNeedToPay: 'You need to pay',
    addExpense: 'Add expense',
    addPickGroup: 'Which group?',
    allSettled: 'All settled',
    moreCurrencies: { one: '+{n} more currency', other: '+{n} more currencies' },
    yourGroups: 'Your groups',
    noGroups: 'No groups yet. Open an invite link, or start one in the app.',
    recentActivity: 'Recent activity',
    noActivity: 'Nothing has happened yet.',
    seeAll: 'See all',
    guestTitle: "You're browsing as a guest",
    guestBody: 'Sign in to keep your groups and add across more than one.',
    guestCta: 'Sign in',
    selectGroupHint: 'Pick a group to see who owes whom.',
    membersCount: { one: '{n} member', other: '{n} members' },
    yourNet: 'Your balance',
    openGroup: 'Open group',
    settledUp: 'Settled up',
    currencyLabel: 'Currency',
    loading: 'Loading…',
  },
  expense: {
    notFound: 'This expense is not here — it may have been removed, or it is not yours to see.',
    paidBy: 'Paid by',
    splitLabel: 'Split',
    total: 'Total',
    history: 'History',
    versionNo: 'Version {n}',
    edit: 'Edit',
    delete: 'Delete',
    confirmDelete: 'Tap again to delete',
    restore: 'Restore',
    deletedBadge: 'Deleted',
    disputes: 'Disagreements',
    reasonPlaceholder: "What's wrong with it? (optional)",
    raiseDispute: 'Flag as wrong',
    withdraw: 'Take it back',
    disputedBadge: 'Flagged',
    markNeedsFix: 'Agree it needs fixing',
    markCorrect: 'It is correct',
    resolvedNeedsFix: 'Agreed it needs fixing',
    resolvedCorrect: 'Marked correct',
    withdrawn: 'Withdrawn',
    splitKind: {
      equal: 'Split equally',
      exact: 'Exact amounts',
      percent: 'By percentage',
      shares: 'By shares',
      adjustment: 'With adjustments',
      itemized: 'Itemised',
    },
  },
  activity: {
    title: 'Activity',
    empty: 'Nothing has happened yet.',
    loading: 'Loading…',
  },
  friends: {
    title: 'Friends',
    empty: "You're square with everyone.",
    owesYou: 'owes you',
    youOwe: 'you owe',
    inGroups: { one: 'in {n} group', other: 'across {n} groups' },
    settleUp: 'Settle up',
    loading: 'Loading…',
  },
  settle: {
    title: 'Settle up',
    pickGroup: 'Pick a group',
    allSettled: "Everyone's square here. Nothing to settle.",
    youOweHead: 'You owe',
    owesYouHead: 'Owes you',
    pendingHead: 'Waiting to be confirmed',
    settleUp: 'Settle up',
    howPaid: 'How did you pay?',
    amountLabel: 'Amount',
    payWith: 'Open {rail}',
    noHandle: "{name} hasn't shared how they're paid — settle in cash, or ask them to add it.",
    record: 'Mark as paid',
    recording: 'Recording…',
    cancel: 'Cancel',
    confirm: 'Confirm it reached you',
    confirming: 'Confirming…',
    waitingConfirm: 'Waiting for {name} to confirm',
    nudge: 'Nudge',
    nudged: 'Nudged',
    loading: 'Loading…',
  },
  groups: {
    title: 'Your groups',
    empty: 'No groups yet',
    emptyBody: 'Start one for a trip, a flat, or the two of you.',
    newGroup: 'New group',
    showArchived: 'Show archived',
    hideArchived: 'Hide archived',
    archivedEmpty: 'Nothing archived.',
    archivedTag: 'Archived',
    memberCount: { one: '{n} person', other: '{n} people' },
  },
  newGroup: {
    title: 'New group',
    intro: 'Everything after this is free and unlimited — add people now or share a link later.',
    nameLabel: 'Name',
    namePlaceholder: 'Goa trip, Flat 3B, us two…',
    emojiLabel: 'Icon',
    currencyLabel: 'Currency',
    typeLabel: 'What is it for',
    typeTrip: 'Trip',
    typeHome: 'Home',
    typeCouple: 'Couple',
    typeFriends: 'Friends',
    typeEvent: 'Event',
    typeOther: 'Other',
    simplifyLabel: 'Simplify debts',
    simplifyBody: 'Fewest payments that square everybody, rather than one payment per expense.',
    peopleLabel: 'Who is in it',
    peopleBody: 'Add names now; they can claim their place when they open your invite.',
    personPlaceholder: 'Name',
    addPerson: 'Add',
    create: 'Create group',
    creating: 'Creating…',
  },
  members: {
    title: 'People',
    you: 'You',
    admin: 'Admin',
    ghost: 'Not joined',
    ghostBody:
      'A name somebody typed in. Share the invite and they can take this place, with the expenses already against it.',
    addTitle: 'Add somebody',
    namePlaceholder: 'Name',
    emailPlaceholder: 'Email (optional)',
    phonePlaceholder: 'Phone with country code (optional)',
    add: 'Add',
    makeAdmin: 'Make admin',
    removeAdmin: 'Remove admin',
    remove: 'Remove',
    removeConfirm: 'Remove {name}? Their expenses stay in the ledger.',
    leave: 'Leave group',
    leaveConfirm: 'Leave this group? What you added stays.',
    inviteInstead: 'Invite with a link',
  },
  invite: {
    title: 'Invite people',
    scanToJoin: 'Scan to join',
    copyLink: 'Copy link',
    copied: 'Copied',
    share: 'Share invite',
    reset: 'Reset link',
    resetConfirm: 'Reset the link? Every copy already shared stops working.',
    alreadyHere: { one: '{n} person already here', other: '{n} people already here' },
    trust: 'Anyone with this link can join {group}, so share it with people you trust.',
    making: 'Making the link…',
  },
  groupSettings: {
    title: 'Group settings',
    nameLabel: 'Name',
    emojiLabel: 'Icon',
    currencyLabel: 'Currency',
    currencyNote:
      'New expenses default to this. Ones already entered keep the currency they were in.',
    simplifyLabel: 'Simplify debts',
    simplifyBody: 'Fewest payments that square everybody.',
    save: 'Save',
    saved: 'Saved',
    archive: 'Archive group',
    archiveBody: 'It leaves your list and stops appearing in totals. Nothing is deleted.',
    unarchive: 'Bring it back',
    delete: 'Delete for everybody',
    deleteBody:
      'Only when everybody is square, and only an admin can. It goes from everyone’s list.',
    deleteConfirm: 'Delete this group for everybody? This cannot be undone.',
    adminOnly: 'Only an admin of this group can change this.',
    danger: 'Careful',
  },
  settings: {
    title: 'Settings',
    profile: 'You',
    displayName: 'Name',
    currency: 'Default currency',
    country: 'Country',
    paymentHandle: 'Payment handle',
    paymentHandleBody: 'Shown to people settling up with you, so they can pay without asking.',
    save: 'Save',
    saved: 'Saved',
    notifications: 'What we tell you about',
    notifyInvolvesMe: 'Only things that involve me',
    notifyDigest: 'A daily summary of group activity',
    notifySettlements: 'When somebody pays me, or asks me to confirm',
    notifyNudges: 'Reminders somebody sends me',
    notifyWeekly: 'A weekly email',
    language: 'Language',
    languageBody: 'Follows your browser. Change it there and this page follows.',
    guestTitle: 'You are a guest',
    guestBody: 'Add an email so this account can be opened on another device.',
    signOut: 'Sign out',
    onlyInApp: 'In the app',
    onlyInAppBody:
      'Scanning receipts, speaking an expense, offline entry and your private Me ledger live in the phone app.',
  },
  errors: {
    couldNotLoad: 'Couldn’t load this. Try again in a moment.',
    couldNotSignIn: 'Could not sign in. Please try again.',
    passwordTooShort: 'Use at least 8 characters — a phrase is easier to remember than a puzzle.',
    passwordTooCommon: 'That is one of the first passwords anyone tries.',
    couldNotSave: 'That didn’t save. Try again in a moment.',
    offline: 'You appear to be offline. Check your connection and try again.',
    tooMany: 'Too many tries in a row. Wait a moment, then try again.',
  },
};

const ta: WebStrings = {
  home: {
    title: 'Waves',
    description:
      'கடைசியில் வாக்குவாதம் இல்லாமல் செலவுகளைப் பிரியுங்கள். இந்தப் பக்கம் அழைப்புச் சுட்டியைத் திறக்க மட்டுமே — யாராவது ஒரு குழுவை உங்களுடன் பகிர்ந்திருந்தால், இந்த முகவரிக்குப் பதிலாக அவர்களின் சுட்டியைத் திறக்கவும்.',
    elsewhere: 'மற்ற அனைத்தும் செயலியில் உள்ளது.',
  },
  join: {
    linkBroken: 'இந்தச் சுட்டி வேலை செய்யவில்லை',
    linkBrokenBody:
      'சுட்டிகள் காலாவதியாகும், பகிர்ந்தவர் அதை நிறுத்தவும் முடியும். புதிய ஒன்றைக் கேளுங்கள்.',
    opening: 'சுட்டியைத் திறக்கிறது…',
    aGroup: 'ஒரு குழு',
    addedTo: '{group} இல் நீங்கள் சேர்க்கப்பட்டுள்ளீர்கள்',
    splittingHere: {
      one: '{n} நபர் இங்கே செலவுகளைப் பிரிக்கிறார். இப்போதே சேர்ந்து ஒரு செலவைச் சேர்க்கலாம் — எதுவும் நிறுவ வேண்டாம்.',
      other:
        '{n} பேர் இங்கே செலவுகளைப் பிரிக்கிறார்கள். இப்போதே சேர்ந்து ஒரு செலவைச் சேர்க்கலாம் — எதுவும் நிறுவ வேண்டாம்.',
    },
    whichOneAreYou: 'நீங்கள் யார்?',
    claimNote:
      'இந்தப் பெயர்களை ஏற்கெனவே யாரோ சேர்த்துவிட்டார்கள். உங்களுடையதைத் தேர்ந்தெடுத்தால், அதற்கு எதிராக ஏற்கெனவே பதிவான செலவுகள் உங்களுடன் இருக்கும்.',
    someone: 'யாரோ',
    noneOfThese: 'இவை எதுவும் இல்லை',
    yourName: 'உங்கள் பெயர்',
    namePlaceholder: 'உங்களை என்ன அழைக்க வேண்டும்?',
    onlyThingAsked:
      'உங்களிடம் கேட்கப்படுவது இது ஒன்றுதான். மின்னஞ்சல் இல்லை, கடவுச்சொல் இல்லை, செயலி இல்லை.',
    joining: 'சேர்கிறது…',
    joinGroup: '{group} இல் சேர்',
    askToJoinAs: '{name} ஆக சேர அனுமதி கேளுங்கள்',
    waitingTitle: 'கேட்கப்பட்டது',
    waitingBody:
      'நீங்கள் {name} தானா என்பதை {group} நடத்துபவர் உறுதி செய்ய வேண்டும். குழுவில் இன்னும் எதுவும் மாறவில்லை.',
    joinAsNewInstead: 'புதிய நபராகச் சேருங்கள்',
  },
  group: {
    loading: 'ஏற்றுகிறது…',
    notYours: 'உங்கள் குழு அல்ல',
    notYoursBody:
      'இந்த உலாவி இந்தக் குழுவின் உறுப்பினர் அல்ல. யாராவது உங்களுக்கு ஒரு சுட்டி அனுப்பியிருந்தால், அதைத் திறக்கவும்.',
    yourGroup: 'உங்கள் குழு',
    peopleCount: { one: '{n} நபர்', other: '{n} நபர்கள்' },
    expenseCount: { one: '{n} செலவு', other: '{n} செலவுகள்' },
    whereEveryoneStands: 'யார் எங்கே நிற்கிறார்கள்',
    settledUp: 'தீர்ந்தது',
    isSettledUp: 'கணக்கு தீர்ந்தது',
    isOwed: 'பெற வேண்டியது',
    owes: 'தர வேண்டியது',
    whoPaysWhom: 'யார் யாருக்குத் தருவது',
    whoPaysWhomNote:
      'அனைவரையும் தீர்க்கும் மிகக் குறைந்த கொடுப்பனவுகள். எதையும் சேர்ந்து பிரிக்காத ஒருவருக்கு யாரும் பணம் தர வேண்டியதில்லை.',
    recent: 'சமீபத்தியவை',
    addAnExpense: 'ஒரு செலவைச் சேர்',
    installNote:
      'ரசீதுகளை ஸ்கேன் செய்ய, UPI மூலம் தீர்க்க, சிக்னல் இல்லாமலும் இது வேலை செய்ய — Waves ஐ நிறுவுங்கள்.',
  },
  add: {
    title: 'ஒரு செலவைச் சேர்',
    defaultDescription: 'செலவு',
    whatWasIt: 'எதற்காக?',
    howMuch: 'எவ்வளவு? ({currency})',
    amountIn: '{currency} இல் தொகை',
    notAnAmount: 'அது ஒரு தொகை அல்ல.',
    whoPaid: 'யார் கொடுத்தார்கள்',
    you: 'நீங்கள்',
    splitBetween: 'யாருக்கிடையே',
    splitEquallyNote:
      'சமமாகப் பிரிக்கப்பட்டது. சரியான பங்குகளுக்கோ பொருள் வாரியான ரசீதுக்கோ செயலியைப் பயன்படுத்துங்கள்.',
    saving: 'சேமிக்கிறது…',
    save: 'சேமி',
    cancel: 'ரத்து',
    editTitle: 'செலவைத் திருத்து',
    splitMethod: 'எப்படிப் பிரிப்பது',
    invalidSplit: 'இந்தப் பங்குகள் இன்னும் சரியாகக் கூடவில்லை.',
    runningSum: '{total} இல் {sum}',
    cannotEditSplit:
      'இந்த பில் இணையம் இன்னும் திருத்த முடியாத வகையில் பிரிக்கப்பட்டது — செயலியில் திறக்கவும்.',
  },
  location: {
    label: 'இடம்',
    add: 'இடத்தைச் சேர்',
    adding: 'இடத்தைப் பெறுகிறது…',
    remove: 'அகற்று',
    blocked: 'உங்கள் உலாவியில் இடம் தடுக்கப்பட்டுள்ளது. இடத்தைச் சேர்க்க அனுமதிக்கவும்.',
    unavailable: 'உங்கள் இடத்தைப் பெற முடியவில்லை — மீண்டும் முயற்சிக்கவும்.',
    openMap: 'வரைபடத்தில் திற',
  },
  dash: {
    nav: {
      overview: 'கண்ணோட்டம்',
      groups: 'குழுக்கள்',
      activity: 'செயல்பாடு',
      friends: 'நண்பர்கள்',
      settle: 'தீர்வு',
    },
    searchPlaceholder: 'குழுக்கள், நபர்கள், செலவுகளைத் தேடுங்கள்',
    signInTitle: 'Waves',
    signInBody: 'கடைசியில் வாக்குவாதம் இல்லாமல் செலவுகளைப் பிரியுங்கள்.',
    continueWithGoogle: 'Google மூலம் தொடரவும்',
    orDivider: 'அல்லது',
    emailPlaceholder: 'you@email.com',
    passwordPlaceholder: 'கடவுச்சொல்',
    passwordSignIn: 'உள்நுழை',
    passwordSignUp: 'கணக்கை உருவாக்கு',
    toggleToSignUp: 'புதியவரா? கணக்கை உருவாக்குங்கள்',
    toggleToSignIn: 'ஏற்கனவே கணக்கு உள்ளதா? உள்நுழையுங்கள்',
    sendMagicLink: 'அதற்குப் பதிலாக உள்நுழைவுச் சுட்டியை மின்னஞ்சலில் அனுப்பு',
    sendingLink: 'அனுப்புகிறது…',
    linkSentTitle: 'உங்கள் இன்பாக்ஸைப் பாருங்கள்',
    linkSentBody: '{email} க்கு உள்நுழைவுச் சுட்டி வருகிறது. இந்தச் சாதனத்தில் அதைத் திறக்கவும்.',
    notAnEmail: 'அது மின்னஞ்சல் முகவரி போலத் தெரியவில்லை.',
    signingIn: 'உள்நுழைகிறது…',
    guestInstead: 'அல்லது யாராவது பகிர்ந்த அழைப்புச் சுட்டியைத் திறக்கவும்.',
    signOut: 'வெளியேறு',
    guestLabel: 'விருந்தினர்',
    overviewTitle: 'கண்ணோட்டம்',
    groupsCount: { one: '{n} குழு', other: '{n} குழுக்கள்' },
    youreOwed: 'உங்களுக்கு வர வேண்டியது',
    youOwe: 'நீங்கள் தர வேண்டியது',
    net: 'நிகர நிலை',
    activeGroups: 'செயலில் உள்ள குழுக்கள்',
    youGetBack: 'உங்களுக்கு வர வேண்டியது',
    youNeedToPay: 'நீங்கள் தர வேண்டியது',
    addExpense: 'செலவைச் சேர்',
    addPickGroup: 'எந்தக் குழு?',
    allSettled: 'அனைத்தும் தீர்ந்தது',
    moreCurrencies: { one: '+இன்னும் {n} நாணயம்', other: '+இன்னும் {n} நாணயங்கள்' },
    yourGroups: 'உங்கள் குழுக்கள்',
    noGroups:
      'இன்னும் குழுக்கள் இல்லை. அழைப்புச் சுட்டியைத் திறக்கவும், அல்லது செயலியில் ஒன்றைத் தொடங்கவும்.',
    recentActivity: 'சமீபத்திய செயல்பாடு',
    noActivity: 'இன்னும் எதுவும் நடக்கவில்லை.',
    seeAll: 'அனைத்தையும் காண்க',
    guestTitle: 'நீங்கள் விருந்தினராக உலாவுகிறீர்கள்',
    guestBody:
      'உங்கள் குழுக்களை வைத்திருக்கவும், ஒன்றுக்கு மேற்பட்டவற்றில் சேர்க்கவும் உள்நுழையவும்.',
    guestCta: 'உள்நுழை',
    selectGroupHint: 'யார் யாருக்குத் தர வேண்டும் என்பதைக் காண ஒரு குழுவைத் தேர்ந்தெடுக்கவும்.',
    membersCount: { one: '{n} உறுப்பினர்', other: '{n} உறுப்பினர்கள்' },
    yourNet: 'உங்கள் இருப்பு',
    openGroup: 'குழுவைத் திற',
    settledUp: 'தீர்ந்தது',
    currencyLabel: 'நாணயம்',
    loading: 'ஏற்றுகிறது…',
  },
  expense: {
    notFound:
      'இந்தச் செலவு இங்கே இல்லை — நீக்கப்பட்டிருக்கலாம், அல்லது இதைப் பார்க்க உங்களுக்கு உரிமை இல்லை.',
    paidBy: 'கொடுத்தவர்',
    splitLabel: 'பங்கீடு',
    total: 'மொத்தம்',
    history: 'வரலாறு',
    versionNo: 'பதிப்பு {n}',
    edit: 'திருத்து',
    delete: 'நீக்கு',
    confirmDelete: 'நீக்க மீண்டும் தட்டவும்',
    restore: 'மீட்டமை',
    deletedBadge: 'நீக்கப்பட்டது',
    disputes: 'கருத்து வேறுபாடுகள்',
    reasonPlaceholder: 'என்ன தவறு? (விருப்பம்)',
    raiseDispute: 'தவறு எனக் குறி',
    withdraw: 'திரும்பப் பெறு',
    disputedBadge: 'குறிக்கப்பட்டது',
    markNeedsFix: 'சரிசெய்ய வேண்டும் என ஒப்புக்கொள்',
    markCorrect: 'இது சரியானது',
    resolvedNeedsFix: 'சரிசெய்ய வேண்டும் என ஒப்புக்கொள்ளப்பட்டது',
    resolvedCorrect: 'சரியெனக் குறிக்கப்பட்டது',
    withdrawn: 'திரும்பப் பெறப்பட்டது',
    splitKind: {
      equal: 'சமமாகப் பிரி',
      exact: 'சரியான தொகைகள்',
      percent: 'சதவீதத்தில்',
      shares: 'பங்குகளில்',
      adjustment: 'சரிசெய்தல்களுடன்',
      itemized: 'பொருள்வாரியாக',
    },
  },
  activity: {
    title: 'செயல்பாடு',
    empty: 'இன்னும் எதுவும் நடக்கவில்லை.',
    loading: 'ஏற்றுகிறது…',
  },
  friends: {
    title: 'நண்பர்கள்',
    empty: 'அனைவருடனும் கணக்கு தீர்ந்தது.',
    owesYou: 'உங்களுக்குத் தர வேண்டும்',
    youOwe: 'நீங்கள் தர வேண்டும்',
    inGroups: { one: '{n} குழுவில்', other: '{n} குழுக்களில்' },
    settleUp: 'கணக்கு தீர்',
    loading: 'ஏற்றுகிறது…',
  },
  settle: {
    title: 'கணக்கு தீர்',
    pickGroup: 'ஒரு குழுவைத் தேர்வு',
    allSettled: 'இங்கே அனைவரின் கணக்கும் தீர்ந்தது. தீர்க்க எதுவும் இல்லை.',
    youOweHead: 'நீங்கள் தர வேண்டியது',
    owesYouHead: 'உங்களுக்குத் தர வேண்டியது',
    pendingHead: 'உறுதிப்படுத்த காத்திருப்பவை',
    settleUp: 'கணக்கு தீர்',
    howPaid: 'எப்படிக் கொடுத்தீர்கள்?',
    amountLabel: 'தொகை',
    payWith: '{rail} திற',
    noHandle:
      '{name} எப்படிப் பணம் பெறுகிறார் என்பதைப் பகிரவில்லை — பணமாகத் தீர்க்கவும், அல்லது சேர்க்கச் சொல்லவும்.',
    record: 'கொடுத்ததாகக் குறி',
    recording: 'பதிவுசெய்கிறது…',
    cancel: 'ரத்து',
    confirm: 'உங்களுக்கு வந்ததை உறுதிசெய்',
    confirming: 'உறுதிசெய்கிறது…',
    waitingConfirm: '{name} உறுதிசெய்ய காத்திருக்கிறது',
    nudge: 'நினைவூட்டு',
    nudged: 'நினைவூட்டப்பட்டது',
    loading: 'ஏற்றுகிறது…',
  },
  groups: {
    title: 'உங்கள் குழுக்கள்',
    empty: 'இன்னும் குழு இல்லை',
    emptyBody: 'பயணம், வீடு, அல்லது நீங்கள் இருவர் — ஒன்றைத் தொடங்குங்கள்.',
    newGroup: 'புதிய குழு',
    showArchived: 'காப்பகத்தைக் காட்டு',
    hideArchived: 'காப்பகத்தை மறை',
    archivedEmpty: 'காப்பகத்தில் எதுவும் இல்லை.',
    archivedTag: 'காப்பகம்',
    memberCount: { one: '{n} நபர்', other: '{n} நபர்கள்' },
  },
  newGroup: {
    title: 'புதிய குழு',
    intro:
      'இதற்குப் பிறகு எல்லாம் இலவசம் — இப்போது ஆட்களைச் சேர்க்கலாம் அல்லது பிறகு இணைப்பைப் பகிரலாம்.',
    nameLabel: 'பெயர்',
    namePlaceholder: 'கோவா பயணம், வீடு 3B, நாம் இருவர்…',
    emojiLabel: 'சின்னம்',
    currencyLabel: 'நாணயம்',
    typeLabel: 'எதற்காக',
    typeTrip: 'பயணம்',
    typeHome: 'வீடு',
    typeCouple: 'இருவர்',
    typeFriends: 'நண்பர்கள்',
    typeEvent: 'நிகழ்வு',
    typeOther: 'மற்றவை',
    simplifyLabel: 'கடன்களை எளிதாக்கு',
    simplifyBody:
      'ஒவ்வொரு செலவுக்கும் ஒரு பணப்பரிமாற்றம் அல்ல — குறைந்த பரிமாற்றங்களில் அனைவரும் சரியாகிறார்கள்.',
    peopleLabel: 'யார் இருக்கிறார்கள்',
    peopleBody:
      'இப்போது பெயர்களைச் சேர்க்கவும்; உங்கள் அழைப்பைத் திறக்கும்போது அவர்கள் அந்த இடத்தை எடுக்கலாம்.',
    personPlaceholder: 'பெயர்',
    addPerson: 'சேர்',
    create: 'குழுவை உருவாக்கு',
    creating: 'உருவாக்குகிறது…',
  },
  members: {
    title: 'ஆட்கள்',
    you: 'நீங்கள்',
    admin: 'நிர்வாகி',
    ghost: 'சேரவில்லை',
    ghostBody:
      'யாரோ தட்டச்சு செய்த பெயர். அழைப்பைப் பகிர்ந்தால், ஏற்கனவே உள்ள செலவுகளுடன் அவர்கள் இந்த இடத்தை எடுக்கலாம்.',
    addTitle: 'ஒருவரைச் சேர்',
    namePlaceholder: 'பெயர்',
    emailPlaceholder: 'மின்னஞ்சல் (விருப்பம்)',
    phonePlaceholder: 'நாட்டுக் குறியீட்டுடன் எண் (விருப்பம்)',
    add: 'சேர்',
    makeAdmin: 'நிர்வாகியாக்கு',
    removeAdmin: 'நிர்வாகியை நீக்கு',
    remove: 'நீக்கு',
    removeConfirm: '{name} ஐ நீக்கவா? அவர்களின் செலவுகள் கணக்கில் இருக்கும்.',
    leave: 'குழுவிலிருந்து விலகு',
    leaveConfirm: 'இந்தக் குழுவிலிருந்து விலகவா? நீங்கள் சேர்த்தவை இருக்கும்.',
    inviteInstead: 'இணைப்பு மூலம் அழை',
  },
  invite: {
    title: 'ஆட்களை அழை',
    scanToJoin: 'ஸ்கேன் செய்து சேரவும்',
    copyLink: 'இணைப்பை நகலெடு',
    copied: 'நகலெடுக்கப்பட்டது',
    share: 'அழைப்பைப் பகிர்',
    reset: 'இணைப்பை மீட்டமை',
    resetConfirm: 'இணைப்பை மீட்டமைக்கவா? ஏற்கனவே பகிர்ந்த நகல்கள் வேலை செய்யாது.',
    alreadyHere: { one: '{n} பேர் ஏற்கனவே இங்கே', other: '{n} பேர் ஏற்கனவே இங்கே' },
    trust: 'இந்த இணைப்பு உள்ள யாரும் {group} இல் சேரலாம், நம்பிக்கையானவர்களுடன் மட்டும் பகிரவும்.',
    making: 'இணைப்பு உருவாக்கப்படுகிறது…',
  },
  groupSettings: {
    title: 'குழு அமைப்புகள்',
    nameLabel: 'பெயர்',
    emojiLabel: 'சின்னம்',
    currencyLabel: 'நாணயம்',
    currencyNote: 'புதிய செலவுகள் இதைப் பயன்படுத்தும். ஏற்கனவே உள்ளவை மாறாது.',
    simplifyLabel: 'கடன்களை எளிதாக்கு',
    simplifyBody: 'குறைந்த பரிமாற்றங்களில் அனைவரும் சரியாகிறார்கள்.',
    save: 'சேமி',
    saved: 'சேமிக்கப்பட்டது',
    archive: 'குழுவைக் காப்பகப்படுத்து',
    archiveBody: 'உங்கள் பட்டியலிலிருந்து விலகும், மொத்தங்களில் வராது. எதுவும் அழிக்கப்படாது.',
    unarchive: 'மீண்டும் கொண்டு வா',
    delete: 'அனைவருக்கும் நீக்கு',
    deleteBody:
      'அனைவரும் சரியாக இருக்கும்போது மட்டும், நிர்வாகி மட்டும். எல்லோர் பட்டியலிலிருந்தும் போகும்.',
    deleteConfirm: 'இந்தக் குழுவை அனைவருக்கும் நீக்கவா? திரும்பப் பெற முடியாது.',
    adminOnly: 'இந்தக் குழுவின் நிர்வாகி மட்டுமே இதை மாற்ற முடியும்.',
    danger: 'கவனம்',
  },
  settings: {
    title: 'அமைப்புகள்',
    profile: 'நீங்கள்',
    displayName: 'பெயர்',
    currency: 'இயல்பு நாணயம்',
    country: 'நாடு',
    paymentHandle: 'பணம் பெறும் முகவரி',
    paymentHandleBody: 'உங்களுக்குப் பணம் தருபவர்களுக்குக் காட்டப்படும், கேட்காமல் அனுப்ப.',
    save: 'சேமி',
    saved: 'சேமிக்கப்பட்டது',
    notifications: 'எதைப் பற்றி சொல்ல வேண்டும்',
    notifyInvolvesMe: 'என்னைச் சார்ந்தவை மட்டும்',
    notifyDigest: 'குழு நடவடிக்கைகளின் தினசரி சுருக்கம்',
    notifySettlements: 'யாரோ பணம் தந்தால், அல்லது உறுதிப்படுத்தச் சொன்னால்',
    notifyNudges: 'யாரோ அனுப்பும் நினைவூட்டல்கள்',
    notifyWeekly: 'வாராந்திர மின்னஞ்சல்',
    language: 'மொழி',
    languageBody: 'உலாவியைப் பின்பற்றுகிறது. அங்கே மாற்றினால் இந்தப் பக்கமும் மாறும்.',
    guestTitle: 'நீங்கள் விருந்தினர்',
    guestBody: 'மற்றொரு சாதனத்தில் திறக்க மின்னஞ்சலைச் சேர்க்கவும்.',
    signOut: 'வெளியேறு',
    onlyInApp: 'செயலியில்',
    onlyInAppBody:
      'ரசீது ஸ்கேன், குரலில் செலவு, இணையம் இல்லாமல் பதிவு, தனிப்பட்ட கணக்கு — இவை போன் செயலியில்.',
  },
  errors: {
    couldNotLoad: 'இதை ஏற்ற முடியவில்லை. சிறிது நேரத்தில் மீண்டும் முயலவும்.',
    couldNotSignIn: 'உள்நுழைய முடியவில்லை. மீண்டும் முயற்சிக்கவும்.',
    passwordTooShort:
      'குறைந்தது 8 எழுத்துகள் இருக்கட்டும் — புதிரை விட ஒரு சொற்றொடர் நினைவில் நிற்கும்.',
    passwordTooCommon: 'இது யாரும் முதலில் முயற்சிக்கும் கடவுச்சொற்களில் ஒன்று.',
    couldNotSave: 'இது சேமிக்கப்படவில்லை. சிறிது நேரத்தில் மீண்டும் முயலவும்.',
    offline: 'நீங்கள் இணைப்பில் இல்லை போலும். இணைப்பைச் சரிபார்த்து மீண்டும் முயலவும்.',
    tooMany: 'தொடர்ச்சியாக அதிக முயற்சிகள். சிறிது காத்திருந்து மீண்டும் முயலவும்.',
  },
};

const hi: WebStrings = {
  home: {
    title: 'Waves',
    description:
      'आख़िर में बहस किए बिना खर्च बाँटें। यह पेज सिर्फ़ न्योते का लिंक खोलने के लिए है — अगर किसी ने आपके साथ कोई समूह साझा किया है, तो इस पते के बजाय उनका लिंक खोलें।',
    elsewhere: 'बाकी सब कुछ ऐप में है।',
  },
  join: {
    linkBroken: 'यह लिंक काम नहीं करता',
    linkBrokenBody:
      'लिंक की मियाद ख़त्म हो जाती है, और जिसने साझा किया वह उसे बंद भी कर सकता है। उनसे नया माँगें।',
    opening: 'लिंक खुल रहा है…',
    aGroup: 'एक समूह',
    addedTo: 'आपको {group} में जोड़ा गया है',
    splittingHere: {
      one: '{n} व्यक्ति यहाँ खर्च बाँट रहा है। आप अभी जुड़कर खर्च जोड़ सकते हैं — कुछ भी इंस्टॉल नहीं करना।',
      other:
        '{n} लोग यहाँ खर्च बाँट रहे हैं। आप अभी जुड़कर खर्च जोड़ सकते हैं — कुछ भी इंस्टॉल नहीं करना।',
    },
    whichOneAreYou: 'इनमें आप कौन हैं?',
    claimNote:
      'ये नाम पहले ही किसी ने जोड़ दिए हैं। अपना चुनने से उस नाम पर पहले से दर्ज खर्च आपके साथ रहते हैं।',
    someone: 'कोई',
    noneOfThese: 'इनमें से कोई नहीं',
    yourName: 'आपका नाम',
    namePlaceholder: 'वे आपको क्या कहकर बुलाएँ?',
    onlyThingAsked: 'आपसे बस यही पूछा जाता है। न ईमेल, न पासवर्ड, न ऐप।',
    joining: 'जुड़ रहे हैं…',
    joinGroup: '{group} में जुड़ें',
    askToJoinAs: '{name} के रूप में शामिल होने की पूछें',
    waitingTitle: 'पूछ लिया',
    waitingBody:
      '{group} चलाने वाले किसी को पुष्टि करनी है कि आप {name} हैं। समूह में अभी कुछ नहीं बदला।',
    joinAsNewInstead: 'नए व्यक्ति के रूप में शामिल हों',
  },
  group: {
    loading: 'लोड हो रहा है…',
    notYours: 'यह आपका समूह नहीं',
    notYoursBody:
      'यह ब्राउज़र इस समूह का सदस्य नहीं है। अगर किसी ने आपको लिंक भेजा है, तो उसे खोलें।',
    yourGroup: 'आपका समूह',
    peopleCount: { one: '{n} व्यक्ति', other: '{n} लोग' },
    expenseCount: { one: '{n} खर्च', other: '{n} खर्च' },
    whereEveryoneStands: 'किसका क्या हिसाब है',
    settledUp: 'हिसाब बराबर',
    isSettledUp: 'का हिसाब बराबर है',
    isOwed: 'को मिलने हैं',
    owes: 'को देने हैं',
    whoPaysWhom: 'कौन किसे देगा',
    whoPaysWhomNote:
      'सबका हिसाब बराबर करने वाले सबसे कम भुगतान। किसी को ऐसे व्यक्ति को पैसे देने के लिए नहीं कहा जाता जिसके साथ उसने कभी कुछ बाँटा ही नहीं।',
    recent: 'हाल के',
    addAnExpense: 'खर्च जोड़ें',
    installNote:
      'रसीदें स्कैन करने, UPI से निपटाने और बिना सिग्नल भी यह चलाने के लिए Waves इंस्टॉल करें।',
  },
  add: {
    title: 'खर्च जोड़ें',
    defaultDescription: 'खर्च',
    whatWasIt: 'किस चीज़ का था?',
    howMuch: 'कितना? ({currency})',
    amountIn: '{currency} में रकम',
    notAnAmount: 'यह रकम नहीं है।',
    whoPaid: 'किसने दिया',
    you: 'आप',
    splitBetween: 'किनके बीच',
    splitEquallyNote: 'बराबर बाँटा गया। सटीक हिस्सों या चीज़-वार बिल के लिए ऐप इस्तेमाल करें।',
    saving: 'सेव हो रहा है…',
    save: 'सेव करें',
    cancel: 'रद्द करें',
    editTitle: 'खर्च संपादित करें',
    splitMethod: 'कैसे बाँटें',
    invalidSplit: 'ये हिस्से अभी पूरे नहीं जुड़ते।',
    runningSum: '{total} में से {sum}',
    cannotEditSplit: 'यह बिल ऐसे बाँटा गया जिसे वेब अभी संपादित नहीं कर सकता — इसे ऐप में खोलें।',
  },
  location: {
    label: 'स्थान',
    add: 'स्थान जोड़ें',
    adding: 'स्थान लिया जा रहा है…',
    remove: 'हटाएँ',
    blocked: 'आपके ब्राउज़र में स्थान अवरुद्ध है. स्थान जोड़ने के लिए इसे अनुमति दें.',
    unavailable: 'आपका स्थान नहीं मिल सका — कृपया फिर से कोशिश करें.',
    openMap: 'मैप में खोलें',
  },
  dash: {
    nav: {
      overview: 'सिंहावलोकन',
      groups: 'समूह',
      activity: 'गतिविधि',
      friends: 'दोस्त',
      settle: 'हिसाब',
    },
    searchPlaceholder: 'समूह, लोग, खर्च खोजें',
    signInTitle: 'Waves',
    signInBody: 'आख़िर में बहस किए बिना खर्च बाँटें।',
    continueWithGoogle: 'Google से जारी रखें',
    orDivider: 'या',
    emailPlaceholder: 'you@email.com',
    passwordPlaceholder: 'पासवर्ड',
    passwordSignIn: 'साइन इन',
    passwordSignUp: 'खाता बनाएँ',
    toggleToSignUp: 'नए हैं? खाता बनाएँ',
    toggleToSignIn: 'पहले से खाता है? साइन इन करें',
    sendMagicLink: 'इसके बजाय मुझे साइन-इन लिंक ईमेल करें',
    sendingLink: 'भेजा जा रहा है…',
    linkSentTitle: 'अपना इनबॉक्स देखें',
    linkSentBody: '{email} पर साइन-इन लिंक आ रहा है। इसे इसी डिवाइस पर खोलें।',
    notAnEmail: 'यह ईमेल पते जैसा नहीं लगता।',
    signingIn: 'साइन इन हो रहा है…',
    guestInstead: 'या किसी के साझा किए न्योते का लिंक खोलें।',
    signOut: 'साइन आउट',
    guestLabel: 'मेहमान',
    overviewTitle: 'सिंहावलोकन',
    groupsCount: { one: '{n} समूह', other: '{n} समूह' },
    youreOwed: 'आपको मिलने हैं',
    youOwe: 'आपको देने हैं',
    net: 'कुल स्थिति',
    activeGroups: 'सक्रिय समूह',
    youGetBack: 'आपको मिलने हैं',
    youNeedToPay: 'आपको देने हैं',
    addExpense: 'खर्च जोड़ें',
    addPickGroup: 'कौन सा समूह?',
    allSettled: 'सब हिसाब बराबर',
    moreCurrencies: { one: '+{n} और मुद्रा', other: '+{n} और मुद्राएँ' },
    yourGroups: 'आपके समूह',
    noGroups: 'अभी कोई समूह नहीं। न्योते का लिंक खोलें, या ऐप में एक शुरू करें।',
    recentActivity: 'हाल की गतिविधि',
    noActivity: 'अभी तक कुछ नहीं हुआ।',
    seeAll: 'सभी देखें',
    guestTitle: 'आप मेहमान के रूप में देख रहे हैं',
    guestBody: 'अपने समूह बनाए रखने और एक से ज़्यादा में जोड़ने के लिए साइन इन करें।',
    guestCta: 'साइन इन करें',
    selectGroupHint: 'कौन किसे देगा यह देखने के लिए कोई समूह चुनें।',
    membersCount: { one: '{n} सदस्य', other: '{n} सदस्य' },
    yourNet: 'आपका हिसाब',
    openGroup: 'समूह खोलें',
    settledUp: 'हिसाब बराबर',
    currencyLabel: 'मुद्रा',
    loading: 'लोड हो रहा है…',
  },
  expense: {
    notFound: 'यह खर्च यहाँ नहीं है — शायद हटा दिया गया, या इसे देखना आपके लिए नहीं है।',
    paidBy: 'किसने दिया',
    splitLabel: 'बँटवारा',
    total: 'कुल',
    history: 'इतिहास',
    versionNo: 'संस्करण {n}',
    edit: 'संपादित करें',
    delete: 'हटाएँ',
    confirmDelete: 'हटाने के लिए फिर से टैप करें',
    restore: 'बहाल करें',
    deletedBadge: 'हटाया गया',
    disputes: 'असहमति',
    reasonPlaceholder: 'इसमें क्या ग़लत है? (वैकल्पिक)',
    raiseDispute: 'ग़लत बताएँ',
    withdraw: 'वापस लें',
    disputedBadge: 'चिह्नित',
    markNeedsFix: 'मानें कि सुधार चाहिए',
    markCorrect: 'यह सही है',
    resolvedNeedsFix: 'माना गया कि सुधार चाहिए',
    resolvedCorrect: 'सही चिह्नित',
    withdrawn: 'वापस लिया',
    splitKind: {
      equal: 'बराबर बाँटें',
      exact: 'सटीक रकम',
      percent: 'प्रतिशत से',
      shares: 'हिस्सों से',
      adjustment: 'समायोजन के साथ',
      itemized: 'मद-वार',
    },
  },
  activity: {
    title: 'गतिविधि',
    empty: 'अभी तक कुछ नहीं हुआ।',
    loading: 'लोड हो रहा है…',
  },
  friends: {
    title: 'दोस्त',
    empty: 'सबके साथ हिसाब बराबर है।',
    owesYou: 'आपको मिलने हैं',
    youOwe: 'आपको देने हैं',
    inGroups: { one: '{n} समूह में', other: '{n} समूहों में' },
    settleUp: 'हिसाब चुकाएँ',
    loading: 'लोड हो रहा है…',
  },
  settle: {
    title: 'हिसाब चुकाएँ',
    pickGroup: 'कोई समूह चुनें',
    allSettled: 'यहाँ सबका हिसाब बराबर है। चुकाने को कुछ नहीं।',
    youOweHead: 'आपको देने हैं',
    owesYouHead: 'आपको मिलने हैं',
    pendingHead: 'पुष्टि का इंतज़ार',
    settleUp: 'हिसाब चुकाएँ',
    howPaid: 'आपने कैसे दिया?',
    amountLabel: 'रकम',
    payWith: '{rail} खोलें',
    noHandle:
      '{name} ने नहीं बताया कि उन्हें कैसे भुगतान मिलता है — नकद चुकाएँ, या उनसे जोड़ने को कहें।',
    record: 'भुगतान किया, दर्ज करें',
    recording: 'दर्ज हो रहा है…',
    cancel: 'रद्द करें',
    confirm: 'पुष्टि करें कि मिल गया',
    confirming: 'पुष्टि हो रही है…',
    waitingConfirm: '{name} की पुष्टि का इंतज़ार',
    nudge: 'याद दिलाएँ',
    nudged: 'याद दिला दिया',
    loading: 'लोड हो रहा है…',
  },
  groups: {
    title: 'आपके समूह',
    empty: 'अभी कोई समूह नहीं',
    emptyBody: 'यात्रा, घर, या आप दोनों — एक शुरू करें.',
    newGroup: 'नया समूह',
    showArchived: 'संग्रह दिखाएँ',
    hideArchived: 'संग्रह छिपाएँ',
    archivedEmpty: 'संग्रह में कुछ नहीं.',
    archivedTag: 'संग्रहीत',
    memberCount: { one: '{n} व्यक्ति', other: '{n} लोग' },
  },
  newGroup: {
    title: 'नया समूह',
    intro: 'इसके बाद सब कुछ मुफ़्त है — अभी लोग जोड़ें या बाद में लिंक साझा करें.',
    nameLabel: 'नाम',
    namePlaceholder: 'गोवा ट्रिप, फ़्लैट 3B, हम दो…',
    emojiLabel: 'चिह्न',
    currencyLabel: 'मुद्रा',
    typeLabel: 'किसलिए',
    typeTrip: 'यात्रा',
    typeHome: 'घर',
    typeCouple: 'हम दो',
    typeFriends: 'दोस्त',
    typeEvent: 'आयोजन',
    typeOther: 'अन्य',
    simplifyLabel: 'हिसाब आसान करें',
    simplifyBody: 'हर ख़र्च का अलग भुगतान नहीं — कम से कम भुगतान में सब बराबर.',
    peopleLabel: 'कौन-कौन है',
    peopleBody: 'अभी नाम जोड़ें; आपका निमंत्रण खोलकर वे अपनी जगह ले सकते हैं.',
    personPlaceholder: 'नाम',
    addPerson: 'जोड़ें',
    create: 'समूह बनाएँ',
    creating: 'बन रहा है…',
  },
  members: {
    title: 'लोग',
    you: 'आप',
    admin: 'व्यवस्थापक',
    ghost: 'शामिल नहीं',
    ghostBody:
      'किसी ने टाइप किया नाम. निमंत्रण साझा करें और वे पहले से दर्ज ख़र्चों समेत यह जगह ले सकते हैं.',
    addTitle: 'किसी को जोड़ें',
    namePlaceholder: 'नाम',
    emailPlaceholder: 'ईमेल (वैकल्पिक)',
    phonePlaceholder: 'देश कोड सहित नंबर (वैकल्पिक)',
    add: 'जोड़ें',
    makeAdmin: 'व्यवस्थापक बनाएँ',
    removeAdmin: 'व्यवस्थापक हटाएँ',
    remove: 'हटाएँ',
    removeConfirm: '{name} को हटाएँ? उनके ख़र्च हिसाब में रहेंगे.',
    leave: 'समूह छोड़ें',
    leaveConfirm: 'यह समूह छोड़ें? आपने जो जोड़ा वह रहेगा.',
    inviteInstead: 'लिंक से बुलाएँ',
  },
  invite: {
    title: 'लोगों को बुलाएँ',
    scanToJoin: 'स्कैन करके जुड़ें',
    copyLink: 'लिंक कॉपी करें',
    copied: 'कॉपी हो गया',
    share: 'निमंत्रण साझा करें',
    reset: 'लिंक रीसेट करें',
    resetConfirm: 'लिंक रीसेट करें? पहले साझा की गई हर कॉपी काम करना बंद कर देगी.',
    alreadyHere: { one: '{n} व्यक्ति पहले से यहाँ', other: '{n} लोग पहले से यहाँ' },
    trust:
      'इस लिंक वाला कोई भी {group} में जुड़ सकता है, इसलिए इसे भरोसेमंद लोगों के साथ ही साझा करें.',
    making: 'लिंक बन रहा है…',
  },
  groupSettings: {
    title: 'समूह सेटिंग',
    nameLabel: 'नाम',
    emojiLabel: 'चिह्न',
    currencyLabel: 'मुद्रा',
    currencyNote: 'नए ख़र्च इसी में होंगे. पहले के ख़र्च जैसे थे वैसे रहेंगे.',
    simplifyLabel: 'हिसाब आसान करें',
    simplifyBody: 'कम से कम भुगतान में सब बराबर.',
    save: 'सहेजें',
    saved: 'सहेजा गया',
    archive: 'समूह संग्रह करें',
    archiveBody: 'यह आपकी सूची और कुल से हट जाएगा. कुछ मिटता नहीं.',
    unarchive: 'वापस लाएँ',
    delete: 'सबके लिए मिटाएँ',
    deleteBody: 'तभी जब सब बराबर हों, और केवल व्यवस्थापक. यह सबकी सूची से चला जाएगा.',
    deleteConfirm: 'यह समूह सबके लिए मिटाएँ? यह वापस नहीं होगा.',
    adminOnly: 'इसे केवल इस समूह का व्यवस्थापक बदल सकता है.',
    danger: 'सावधान',
  },
  settings: {
    title: 'सेटिंग',
    profile: 'आप',
    displayName: 'नाम',
    currency: 'डिफ़ॉल्ट मुद्रा',
    country: 'देश',
    paymentHandle: 'भुगतान पता',
    paymentHandleBody: 'आपको भुगतान करने वालों को दिखता है, ताकि पूछना न पड़े.',
    save: 'सहेजें',
    saved: 'सहेजा गया',
    notifications: 'किस बारे में बताएँ',
    notifyInvolvesMe: 'केवल वे बातें जिनसे मेरा वास्ता है',
    notifyDigest: 'समूह गतिविधि का रोज़ का सारांश',
    notifySettlements: 'जब कोई मुझे भुगतान करे या पुष्टि माँगे',
    notifyNudges: 'किसी की भेजी याद-दिलाहट',
    notifyWeekly: 'साप्ताहिक ईमेल',
    language: 'भाषा',
    languageBody: 'ब्राउज़र के अनुसार. वहाँ बदलें, यह पेज भी बदल जाएगा.',
    guestTitle: 'आप अतिथि हैं',
    guestBody: 'दूसरे डिवाइस पर खोलने के लिए ईमेल जोड़ें.',
    signOut: 'साइन आउट',
    onlyInApp: 'ऐप में',
    onlyInAppBody: 'रसीद स्कैन, बोलकर ख़र्च, बिना नेट के entry और निजी हिसाब — ये फ़ोन ऐप में हैं.',
  },
  errors: {
    couldNotLoad: 'यह लोड नहीं हो सका। थोड़ी देर में फिर कोशिश करें।',
    couldNotSignIn: 'साइन इन नहीं हो सका। फिर से कोशिश करें।',
    passwordTooShort: 'कम से कम 8 अक्षर रखें — पहेली से बेहतर है कोई वाक्यांश, याद भी रहता है।',
    passwordTooCommon: 'यह उन पासवर्ड में से है जो सबसे पहले आज़माए जाते हैं।',
    couldNotSave: 'यह सेव नहीं हुआ। थोड़ी देर में फिर कोशिश करें।',
    offline: 'लगता है आप ऑफ़लाइन हैं। कनेक्शन जाँचकर फिर कोशिश करें।',
    tooMany: 'लगातार बहुत सारी कोशिशें। थोड़ा रुककर फिर कोशिश करें।',
  },
};

const ar: WebStrings = {
  home: {
    title: 'Waves',
    description:
      'قسّموا المصاريف دون خلاف في النهاية. هذه الصفحة لفتح رابط دعوة فقط — إن شاركك أحدهم مجموعة، فافتح رابطه بدل هذا العنوان.',
    elsewhere: 'كل ما عدا ذلك في التطبيق.',
  },
  join: {
    linkBroken: 'هذا الرابط لا يعمل',
    linkBrokenBody: 'تنتهي صلاحية الروابط، ويمكن لمن شاركها أن يوقفها. اطلب منه رابطًا جديدًا.',
    opening: 'جارٍ فتح الرابط…',
    aGroup: 'مجموعة',
    addedTo: 'تمت إضافتك إلى {group}',
    splittingHere: {
      zero: 'لا أحد يقسّم التكاليف هنا بعد. يمكنك الانضمام وإضافة مصروف الآن — دون تثبيت شيء.',
      one: 'شخص واحد يقسّم التكاليف هنا. يمكنك الانضمام وإضافة مصروف الآن — دون تثبيت شيء.',
      two: 'شخصان يقسّمان التكاليف هنا. يمكنك الانضمام وإضافة مصروف الآن — دون تثبيت شيء.',
      few: '{n} أشخاص يقسّمون التكاليف هنا. يمكنك الانضمام وإضافة مصروف الآن — دون تثبيت شيء.',
      many: '{n} شخصًا يقسّمون التكاليف هنا. يمكنك الانضمام وإضافة مصروف الآن — دون تثبيت شيء.',
      other: '{n} شخص يقسّمون التكاليف هنا. يمكنك الانضمام وإضافة مصروف الآن — دون تثبيت شيء.',
    },
    whichOneAreYou: 'أيّهم أنت؟',
    claimNote: 'أضاف أحدهم هذه الأسماء من قبل. اختيار اسمك يبقي المصاريف المسجّلة عليه معك.',
    someone: 'أحدهم',
    noneOfThese: 'لا أحد منهم',
    yourName: 'اسمك',
    namePlaceholder: 'بماذا ينادونك؟',
    onlyThingAsked: 'هذا كل ما يُطلب منك. لا بريد، ولا كلمة مرور، ولا تطبيق.',
    joining: 'جارٍ الانضمام…',
    joinGroup: 'انضم إلى {group}',
    askToJoinAs: 'اطلب الانضمام بصفتك {name}',
    waitingTitle: 'تم الطلب',
    waitingBody:
      'على أحد القائمين على {group} أن يؤكّد أنك {name}. ولم يتغيّر شيء في المجموعة بعد.',
    joinAsNewInstead: 'انضم بصفتك شخصًا جديدًا',
  },
  group: {
    loading: 'جارٍ التحميل…',
    notYours: 'ليست مجموعتك',
    notYoursBody:
      'هذا المتصفح ليس عضوًا في هذه المجموعة. إن أرسل إليك أحدهم رابطًا، فافتحه بدلًا من ذلك.',
    yourGroup: 'مجموعتك',
    peopleCount: {
      zero: 'لا أشخاص',
      one: 'شخص واحد',
      two: 'شخصان',
      few: '{n} أشخاص',
      many: '{n} شخصًا',
      other: '{n} شخص',
    },
    expenseCount: {
      zero: 'لا مصاريف',
      one: 'مصروف واحد',
      two: 'مصروفان',
      few: '{n} مصاريف',
      many: '{n} مصروفًا',
      other: '{n} مصروف',
    },
    whereEveryoneStands: 'أين يقف كل واحد',
    settledUp: 'مسوّى',
    isSettledUp: 'حسابه مسوّى',
    isOwed: 'له',
    owes: 'عليه',
    whoPaysWhom: 'من يدفع لمن',
    whoPaysWhomNote:
      'أقل عدد من الدفعات يسوّي حساب الجميع. ولا يُطلب من أحد أن يدفع لشخص لم يقسّم معه شيئًا قط.',
    recent: 'الأحدث',
    addAnExpense: 'أضف مصروفًا',
    installNote: 'ثبّت Waves لمسح الإيصالات والتسوية عبر UPI ولكي يعمل هذا دون اتصال.',
  },
  add: {
    title: 'أضف مصروفًا',
    defaultDescription: 'مصروف',
    whatWasIt: 'على ماذا؟',
    howMuch: 'كم؟ ({currency})',
    amountIn: 'المبلغ بـ {currency}',
    notAnAmount: 'هذا ليس مبلغًا.',
    whoPaid: 'من دفع',
    you: 'أنت',
    splitBetween: 'التقسيم بين',
    splitEquallyNote: 'قُسّم بالتساوي. للحصص المحددة أو فاتورة بالأصناف، استخدم التطبيق.',
    saving: 'جارٍ الحفظ…',
    save: 'حفظ',
    cancel: 'إلغاء',
    editTitle: 'تعديل المصروف',
    splitMethod: 'كيفية التقسيم',
    invalidSplit: 'هذه الحصص لا تتوافق بعد.',
    runningSum: '{sum} من {total}',
    cannotEditSplit: 'قُسّمت هذه الفاتورة بطريقة لا يمكن للويب تعديلها بعد — افتحها في التطبيق.',
  },
  location: {
    label: 'الموقع',
    add: 'إضافة موقع',
    adding: 'جارٍ تحديد الموقع…',
    remove: 'إزالة',
    blocked: 'الموقع محظور في متصفحك. اسمح به لإضافة مكان.',
    unavailable: 'تعذّر تحديد موقعك — يُرجى المحاولة مرة أخرى.',
    openMap: 'فتح في الخرائط',
  },
  dash: {
    nav: {
      overview: 'نظرة عامة',
      groups: 'المجموعات',
      activity: 'النشاط',
      friends: 'الأصدقاء',
      settle: 'التسوية',
    },
    searchPlaceholder: 'ابحث في المجموعات والأشخاص والمصاريف',
    signInTitle: 'Waves',
    signInBody: 'قسّموا المصاريف دون خلاف في النهاية.',
    continueWithGoogle: 'المتابعة عبر Google',
    orDivider: 'أو',
    emailPlaceholder: 'you@email.com',
    passwordPlaceholder: 'كلمة المرور',
    passwordSignIn: 'تسجيل الدخول',
    passwordSignUp: 'إنشاء حساب',
    toggleToSignUp: 'جديد هنا؟ أنشئ حسابًا',
    toggleToSignIn: 'لديك حساب بالفعل؟ سجّل الدخول',
    sendMagicLink: 'أرسِل لي بدلاً من ذلك رابط تسجيل الدخول بالبريد',
    sendingLink: 'جارٍ الإرسال…',
    linkSentTitle: 'تحقّق من بريدك',
    linkSentBody: 'رابط تسجيل الدخول في طريقه إلى {email}. افتحه على هذا الجهاز.',
    notAnEmail: 'لا يبدو هذا عنوان بريد إلكتروني.',
    signingIn: 'جارٍ تسجيل الدخول…',
    guestInstead: 'أو افتح رابط دعوة شاركه أحدهم معك.',
    signOut: 'تسجيل الخروج',
    guestLabel: 'ضيف',
    overviewTitle: 'نظرة عامة',
    groupsCount: {
      zero: 'لا مجموعات',
      one: 'مجموعة واحدة',
      two: 'مجموعتان',
      few: '{n} مجموعات',
      many: '{n} مجموعة',
      other: '{n} مجموعة',
    },
    youreOwed: 'لك',
    youOwe: 'عليك',
    net: 'الصافي',
    activeGroups: 'المجموعات النشطة',
    youGetBack: 'لك',
    youNeedToPay: 'عليك',
    addExpense: 'أضف مصروفًا',
    addPickGroup: 'أي مجموعة؟',
    allSettled: 'كل الحسابات مسوّاة',
    moreCurrencies: {
      one: '+عملة أخرى',
      two: '+عملتان أخريان',
      few: '+{n} عملات أخرى',
      many: '+{n} عملة أخرى',
      other: '+{n} عملة أخرى',
    },
    yourGroups: 'مجموعاتك',
    noGroups: 'لا مجموعات بعد. افتح رابط دعوة، أو ابدأ واحدة في التطبيق.',
    recentActivity: 'النشاط الأخير',
    noActivity: 'لم يحدث شيء بعد.',
    seeAll: 'عرض الكل',
    guestTitle: 'أنت تتصفّح كضيف',
    guestBody: 'سجّل الدخول للاحتفاظ بمجموعاتك وللإضافة في أكثر من واحدة.',
    guestCta: 'تسجيل الدخول',
    selectGroupHint: 'اختر مجموعة لترى من يدفع لمن.',
    membersCount: {
      zero: 'لا أعضاء',
      one: 'عضو واحد',
      two: 'عضوان',
      few: '{n} أعضاء',
      many: '{n} عضوًا',
      other: '{n} عضو',
    },
    yourNet: 'رصيدك',
    openGroup: 'افتح المجموعة',
    settledUp: 'مسوّى',
    currencyLabel: 'العملة',
    loading: 'جارٍ التحميل…',
  },
  expense: {
    notFound: 'هذا المصروف غير موجود هنا — ربما حُذف، أو ليس من حقّك الاطلاع عليه.',
    paidBy: 'دفعه',
    splitLabel: 'التقسيم',
    total: 'الإجمالي',
    history: 'السجل',
    versionNo: 'النسخة {n}',
    edit: 'تعديل',
    delete: 'حذف',
    confirmDelete: 'اضغط مرة أخرى للحذف',
    restore: 'استعادة',
    deletedBadge: 'محذوف',
    disputes: 'اعتراضات',
    reasonPlaceholder: 'ما الخطأ فيه؟ (اختياري)',
    raiseDispute: 'وسمه كخطأ',
    withdraw: 'التراجع',
    disputedBadge: 'موسوم',
    markNeedsFix: 'أوافق أنه يحتاج إصلاحًا',
    markCorrect: 'إنه صحيح',
    resolvedNeedsFix: 'اتُّفق أنه يحتاج إصلاحًا',
    resolvedCorrect: 'وُسم كصحيح',
    withdrawn: 'مسحوب',
    splitKind: {
      equal: 'تقسيم بالتساوي',
      exact: 'مبالغ محددة',
      percent: 'بالنسبة المئوية',
      shares: 'بالحصص',
      adjustment: 'مع تعديلات',
      itemized: 'بالأصناف',
    },
  },
  activity: {
    title: 'النشاط',
    empty: 'لم يحدث شيء بعد.',
    loading: 'جارٍ التحميل…',
  },
  friends: {
    title: 'الأصدقاء',
    empty: 'حسابك مسوّى مع الجميع.',
    owesYou: 'لك',
    youOwe: 'عليك',
    inGroups: {
      zero: 'في لا مجموعة',
      one: 'في مجموعة واحدة',
      two: 'في مجموعتين',
      few: 'في {n} مجموعات',
      many: 'في {n} مجموعة',
      other: 'في {n} مجموعة',
    },
    settleUp: 'سوِّ الحساب',
    loading: 'جارٍ التحميل…',
  },
  settle: {
    title: 'تسوية الحساب',
    pickGroup: 'اختر مجموعة',
    allSettled: 'حساب الجميع هنا مسوّى. لا شيء للتسوية.',
    youOweHead: 'عليك',
    owesYouHead: 'لك',
    pendingHead: 'بانتظار التأكيد',
    settleUp: 'سوِّ الحساب',
    howPaid: 'كيف دفعت؟',
    amountLabel: 'المبلغ',
    payWith: 'افتح {rail}',
    noHandle: 'لم يشارك {name} كيف يُدفع له — سوِّ نقدًا، أو اطلب منه إضافتها.',
    record: 'سجّل أنك دفعت',
    recording: 'جارٍ التسجيل…',
    cancel: 'إلغاء',
    confirm: 'أكّد أنه وصلك',
    confirming: 'جارٍ التأكيد…',
    waitingConfirm: 'بانتظار تأكيد {name}',
    nudge: 'تذكير',
    nudged: 'تم التذكير',
    loading: 'جارٍ التحميل…',
  },
  groups: {
    title: 'مجموعاتك',
    empty: 'لا توجد مجموعات بعد',
    emptyBody: 'ابدأ واحدة لرحلة أو سكن أو لكما أنتما الاثنان.',
    newGroup: 'مجموعة جديدة',
    showArchived: 'إظهار المؤرشف',
    hideArchived: 'إخفاء المؤرشف',
    archivedEmpty: 'لا شيء في الأرشيف.',
    archivedTag: 'مؤرشفة',
    memberCount: {
      zero: 'لا أحد',
      one: 'شخص واحد',
      two: 'شخصان',
      few: '{n} أشخاص',
      many: '{n} شخصًا',
      other: '{n} شخص',
    },
  },
  newGroup: {
    title: 'مجموعة جديدة',
    intro: 'كل ما بعد ذلك مجاني — أضف أشخاصًا الآن أو شارك رابطًا لاحقًا.',
    nameLabel: 'الاسم',
    namePlaceholder: 'رحلة جوا، شقة 3B، نحن الاثنان…',
    emojiLabel: 'الرمز',
    currencyLabel: 'العملة',
    typeLabel: 'لماذا هي',
    typeTrip: 'رحلة',
    typeHome: 'سكن',
    typeCouple: 'ثنائي',
    typeFriends: 'أصدقاء',
    typeEvent: 'مناسبة',
    typeOther: 'أخرى',
    simplifyLabel: 'تبسيط الديون',
    simplifyBody: 'أقل عدد من الدفعات يجعل الجميع متعادلين، بدل دفعة لكل مصروف.',
    peopleLabel: 'من فيها',
    peopleBody: 'أضف الأسماء الآن؛ يمكنهم أخذ مكانهم عند فتح دعوتك.',
    personPlaceholder: 'الاسم',
    addPerson: 'إضافة',
    create: 'إنشاء المجموعة',
    creating: 'يتم الإنشاء…',
  },
  members: {
    title: 'الأشخاص',
    you: 'أنت',
    admin: 'مشرف',
    ghost: 'لم ينضم',
    ghostBody: 'اسم كتبه أحدهم. شارك الدعوة ليأخذ صاحبه هذا المكان بما عليه من مصاريف.',
    addTitle: 'أضف شخصًا',
    namePlaceholder: 'الاسم',
    emailPlaceholder: 'البريد (اختياري)',
    phonePlaceholder: 'الهاتف مع رمز الدولة (اختياري)',
    add: 'إضافة',
    makeAdmin: 'اجعله مشرفًا',
    removeAdmin: 'إزالة الإشراف',
    remove: 'إزالة',
    removeConfirm: 'إزالة {name}؟ تبقى مصاريفهم في السجل.',
    leave: 'مغادرة المجموعة',
    leaveConfirm: 'مغادرة هذه المجموعة؟ يبقى ما أضفته.',
    inviteInstead: 'ادعُ برابط',
  },
  invite: {
    title: 'ادعُ أشخاصًا',
    scanToJoin: 'امسح للانضمام',
    copyLink: 'نسخ الرابط',
    copied: 'تم النسخ',
    share: 'مشاركة الدعوة',
    reset: 'إعادة ضبط الرابط',
    resetConfirm: 'إعادة ضبط الرابط؟ كل نسخة شاركتها ستتوقف عن العمل.',
    alreadyHere: {
      zero: 'لا أحد هنا بعد',
      one: 'شخص واحد هنا بالفعل',
      two: 'شخصان هنا بالفعل',
      few: '{n} أشخاص هنا بالفعل',
      many: '{n} شخصًا هنا بالفعل',
      other: '{n} شخص هنا بالفعل',
    },
    trust: 'أي شخص لديه هذا الرابط يمكنه الانضمام إلى {group}، فشاركه مع من تثق بهم.',
    making: 'يتم إنشاء الرابط…',
  },
  groupSettings: {
    title: 'إعدادات المجموعة',
    nameLabel: 'الاسم',
    emojiLabel: 'الرمز',
    currencyLabel: 'العملة',
    currencyNote: 'المصاريف الجديدة تأتي بهذه العملة. ما أُدخل سابقًا يبقى كما هو.',
    simplifyLabel: 'تبسيط الديون',
    simplifyBody: 'أقل عدد من الدفعات يجعل الجميع متعادلين.',
    save: 'حفظ',
    saved: 'تم الحفظ',
    archive: 'أرشفة المجموعة',
    archiveBody: 'تخرج من قائمتك ومن المجاميع. لا يُحذف شيء.',
    unarchive: 'أعدها',
    delete: 'حذف للجميع',
    deleteBody: 'فقط حين يتعادل الجميع، وللمشرف وحده. ستختفي من قائمة كل شخص.',
    deleteConfirm: 'حذف هذه المجموعة للجميع؟ لا يمكن التراجع.',
    adminOnly: 'لا يغيّر هذا إلا مشرف المجموعة.',
    danger: 'انتبه',
  },
  settings: {
    title: 'الإعدادات',
    profile: 'أنت',
    displayName: 'الاسم',
    currency: 'العملة الافتراضية',
    country: 'الدولة',
    paymentHandle: 'عنوان الدفع',
    paymentHandleBody: 'يظهر لمن يسدد لك، ليدفع دون أن يسأل.',
    save: 'حفظ',
    saved: 'تم الحفظ',
    notifications: 'ما الذي نخبرك به',
    notifyInvolvesMe: 'ما يخصني فقط',
    notifyDigest: 'ملخص يومي لنشاط المجموعة',
    notifySettlements: 'حين يدفع لي أحد أو يطلب تأكيدًا',
    notifyNudges: 'التذكيرات التي يرسلها أحدهم',
    notifyWeekly: 'بريد أسبوعي',
    language: 'اللغة',
    languageBody: 'تتبع المتصفح. غيّرها هناك وتتبعها هذه الصفحة.',
    guestTitle: 'أنت ضيف',
    guestBody: 'أضف بريدًا ليمكن فتح هذا الحساب على جهاز آخر.',
    signOut: 'تسجيل الخروج',
    onlyInApp: 'في التطبيق',
    onlyInAppBody:
      'مسح الإيصالات، وقول المصروف صوتًا، والإدخال دون إنترنت، وسجلك الخاص — كلها في تطبيق الهاتف.',
  },
  errors: {
    couldNotLoad: 'تعذّر تحميل هذا. حاول بعد قليل.',
    couldNotSignIn: 'تعذّر تسجيل الدخول. حاول مرة أخرى.',
    passwordTooShort: 'استخدم 8 أحرف على الأقل — عبارة أسهل في التذكّر من لغز.',
    passwordTooCommon: 'هذه من أوّل كلمات المرور التي يجرّبها أي شخص.',
    couldNotSave: 'لم يُحفظ ذلك. حاول بعد قليل.',
    offline: 'يبدو أنك غير متصل. تحقّق من اتصالك وحاول مجدداً.',
    tooMany: 'محاولات كثيرة متتالية. انتظر قليلاً ثم حاول مجدداً.',
  },
};

export const STRINGS_BY_LANGUAGE: Record<Language, WebStrings> = {
  [Language.En]: en,
  [Language.Ta]: ta,
  [Language.Hi]: hi,
  [Language.Ar]: ar,
};

export function stringsFor(language: Language): WebStrings {
  return STRINGS_BY_LANGUAGE[language];
}

/** Substitute `{name}` placeholders. */
export function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    template,
  );
}
