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

/**
 * What each API scope actually lets an application do, in the reader's own
 * language.
 *
 * The catalogue itself belongs to the server (`apps/api/src/server/scopes.ts`,
 * duplicated in SQL so the database can refuse an unknown one). These are only
 * the *words*, and they exist because the consent screen is the one place in
 * Waves where somebody is asked to make a security decision — asking it in
 * English of a person reading the rest of the app in Tamil is asking them to
 * guess. A scope the server knows and this table does not falls back to the
 * server's own sentence rather than being hidden.
 *
 * A type alias rather than an interface member written inline: an alias gets an
 * implicit index signature, so the page can look a scope up by name.
 */
export type ScopeWords = {
  'identity.read': string;
  'identity.write': string;
  'groups.read': string;
  'groups.write': string;
  'expenses.read': string;
  'expenses.write': string;
  'settlements.read': string;
  'settlements.write': string;
  'friends.read': string;
  'categories.read': string;
  'categories.write': string;
  offline_access: string;
};

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
    /** The three faces of the group screen. */
    tabExpenses: string;
    tabBalances: string;
    tabActivity: string;
    noneYet: string;
    noneYetBody: string;
    whereEveryoneStands: string;
    settledUp: string;
    isSettledUp: string;
    isOwed: string;
    owes: string;
    whoPaysWhom: string;
    whoPaysWhomNote: string;
    /** The who-pays-whom rows, worded as the phone words them. */
    youPayName: string;
    namePaysYou: string;
    paysWhom: string;
    /** Section headings, shown only when there is something on both sides. */
    yourPayments: string;
    otherPayments: string;
    addAnExpense: string;
    installNote: string;
  };
  /** Adding one expense, equally split, and nothing cleverer. */
  add: {
    title: string;
    defaultDescription: string;
    whatWasIt: string;
    categoryLabel: string;
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
  /** Splitting a bill line by line (ADR-008 §3.1). */
  itemize: {
    title: string;
    /** What the expense is called when nobody types a description. */
    defaultDescription: string;
    lines: string;
    linePlaceholder: string;
    /** A line with an amount but no name, when one has to be named in a message. */
    untitledLine: string;
    addLine: string;
    removeLine: string;
    extras: string;
    /** Why the extras are not simply divided. */
    extrasNote: string;
    taxes: string;
    serviceCharge: string;
    tip: string;
    discounts: string;
    preview: string;
    /** Nothing typed yet, so there is nothing to divide. */
    startTyping: string;
    /** Named lines nobody has claimed; `{lines}` is the list. */
    unclaimed: string;
    /** The split is refused for a reason this screen cannot name precisely. */
    cannotSplit: string;
    /** A group with nobody in it cannot have a bill split across it. */
    noMembers: string;
  };
  /** Where the money went (M5, TDR §8) — the charts and their drill-down. */
  insights: {
    title: string;
    /** The scope control: everybody's spending, or only the reader's share. */
    scopeLabel: string;
    wholeGroup: string;
    justMine: string;
    byCategory: string;
    byMonth: string;
    /** What the headline figure is; `{currency}` is its code. */
    totalIn: string;
    /** A column is a way in, and somebody has to be told that. */
    tapMonth: string;
    nothingYet: string;
    nothingBody: string;
    nothingThisMonth: string;
    nothingThisMonthBody: string;
  };
  /**
   * The trip, once it is over, in the few numbers people repeat (A45).
   *
   * A trip's own question — "per day" means nothing to a flatshare — so the
   * screen is offered for trips only.
   */
  recap: {
    title: string;
    /** The same screen reached by URL on a group that is not a trip. */
    titleAny: string;
    /** What the screen is for, read under the title. */
    subtitle: string;
    /** The total, spread over the days it was spread over. */
    perDay: string;
    biggestBill: string;
    mostSpentOn: string;
    /** Who fronted the most cash. Paid, not owed — a different question. */
    paidMost: string;
    noneYet: string;
  };
  /** Every expense that carries a location (A43), as a list out to a map. */
  places: {
    title: string;
    empty: string;
    emptyBody: string;
  };
  /**
   * The trip, day by day (A45): what was planned, beside what it cost.
   *
   * Planned and spent are never added together and never converted into each
   * other's currency — a plan item is not money.
   */
  plan: {
    title: string;
    /** Read under the title when the group has no name. */
    subtitle: string;
    /** Which day of the trip today is; `{n}` is the number. */
    dayNumber: string;
    planned: string;
    spent: string;
    /** Labels on the signed gap. Over is the one people came to find. */
    over: string;
    under: string;
    /** A day of the trip with nothing on it — an invitation, not a fault. */
    emptyDay: string;
    nothingYet: string;
    nothingBody: string;
    /** Reached by URL on a group that is not a trip: readable, not writable. */
    tripsOnly: string;
    tripsOnlyBody: string;
    /** The inline field, and the two buttons under it. */
    whatIsPlanned: string;
    add: string;
    cancel: string;
    /** Each row's own remove, named so a list of them is not identical. */
    remove: string;
  };
  /**
   * Ceilings on a trip (A45), and the two readings taken against them.
   *
   * Three kinds: the whole trip's (admin-set), each member's own, and what a
   * member chose to share. A cap is never mixed across currencies.
   */
  budgets: {
    title: string;
    /** The whole trip's cap. */
    overall: string;
    /** The reader's own. */
    mine: string;
    amount: string;
    /** Whether the rest of the group gets to see this number. */
    shareWithGroup: string;
    onlyMe: string;
    save: string;
    clear: string;
    set: string;
    edit: string;
    /** Read after the signed gap on a bar: "₹4,000 left" / "₹4,000 over". */
    left: string;
    over: string;
    /** Burn-rate: where the trip lands at this pace. */
    forecast: string;
    projectedTotal: string;
    onTrack: string;
    /** Who has fronted a lopsided share, and who could take the next bill. */
    fairness: string;
    /** `{name}` has fronted `{percent}`% of the trip. */
    paidShare: string;
    evenlyMatched: string;
    /** Suggest `{name}` picks up the next one. */
    nextUp: string;
    /** Somebody who shared a budget but is no longer in the group. */
    someone: string;
  };
  /**
   * Somebody's own category catalog (A42): their tags, and what they did with
   * the ten built-ins.
   */
  tags: {
    title: string;
    subtitle: string;
    /** The row in settings that leads here. */
    settingsRow: string;
    newTag: string;
    editTag: string;
    namePlaceholder: string;
    colourLabel: string;
    noCustomTags: string;
    hide: string;
    show: string;
    moveUp: string;
    moveDown: string;
    /** A built-in that is hidden from the pickers but still in this list. */
    hiddenBadge: string;
    deleteTag: string;
    deleteConfirm: string;
    save: string;
    cancel: string;
    /** A tag needs a name; the field says so rather than saving a blank one. */
    nameNeeded: string;
  };
  /**
   * Leaving (ADR-012), and the consequence in view before the button.
   *
   * Worded exactly as the phone words it, because this is the one screen where
   * a difference between the two clients would read as one of them hiding
   * something.
   */
  privacy: {
    /** The settings row that leads here, and its one-line warning. */
    deleteRow: string;
    deleteRowHint: string;
    deleteTitle: string;
    deleteIntro: string;
    /** The half people expect. */
    deleteGoesTitle: string;
    deleteGoesBody: string;
    /** The half that surprises them, which is why it is said first on screen. */
    deleteStaysTitle: string;
    deleteStaysBody: string;
    /** Offered above the confirmation: data on the way out, not afterwards. */
    deleteExportFirst: string;
    deleteWhyLabel: string;
    deleteWhyPlaceholder: string;
    /** Typing the word is the confirmation; a button alone is too easy to hit. */
    deleteConfirmLabel: string;
    deleteConfirmWord: string;
    deleteButton: string;
    deleteWorking: string;
    deleteDone: string;
    /** How many groups they are now a former member of. `{n}` is the count. */
    deleteSummary: PluralForms;
    /** What erasure would leave behind, counted. */
    previewGroups: PluralForms;
    previewExpenses: PluralForms;
    previewSettlements: PluralForms;
    /** `{list}` is the currencies still unsettled. */
    previewOutstanding: string;
    /**
     * The page itself, which the browser did not have: what is held about you,
     * who else touches it, and how long it stays. Each section is a summary and
     * a body, in that order — six true sentences for somebody skimming, and the
     * paragraph behind whichever one they want.
     *
     * `protectBody`, `servicesSummary` and `servicesBody` are written for a
     * browser rather than lifted from the phone: this site carries no analytics
     * tag and keeps no sealed on-device ledger, and describing the phone's
     * protections here would be describing protections that are not present.
     * `{date}` in `lastUpdated` is the policy date.
     */
    row: string;
    rowHint: string;
    title: string;
    intro: string;
    controlsSection: string;
    expandLabel: string;
    collapseLabel: string;
    supportRow: string;
    supportRowHint: string;
    lastUpdated: string;
    storeTitle: string;
    storeSummary: string;
    storeBody: string;
    protectTitle: string;
    protectSummary: string;
    protectBody: string;
    servicesTitle: string;
    servicesSummary: string;
    servicesBody: string;
    retentionTitle: string;
    retentionSummary: string;
    retentionBody: string;
    choicesTitle: string;
    choicesSummary: string;
    choicesBody: string;
  };
  /**
   * Where this account is signed in.
   *
   * A browser is not a registered device — only the phone app registers — so
   * this list is the phones, and the browser is the useful place to read it
   * from: it is where somebody goes when the phone is the thing they have lost.
   */
  devices: {
    title: string;
    row: string;
    rowHint: string;
    intro: string;
    /** A device already revoked, still listed for the three-month window. */
    signedOut: string;
    /** `{when}` is a formatted date. */
    lastActive: string;
    signOutAll: string;
    signOutAllHint: string;
    /** `{n}` devices were revoked. */
    signedOutAll: PluralForms;
    none: string;
    historyNote: string;
    couldNotSignOut: string;
  };
  /**
   * How findable somebody is, and how much of them their groups can see.
   *
   * Real profile columns, so a choice made here is the same choice the phone
   * reads — unlike the phone's blocked list, which is per-device and has no
   * browser half to speak of.
   */
  discovery: {
    /** The settings row that leads here. */
    discoveryRow: string;
    discoveryRowHint: string;
    discoveryTitle: string;
    discoveryIntro: string;
    /** Heading over the two find-me switches. */
    findTitle: string;
    discoveryPhone: string;
    discoveryPhoneHint: string;
    discoveryEmail: string;
    discoveryEmailHint: string;
    /** What none of these settings can undo. */
    discoveryFootnote: string;
    /** The visibility choice, worded for the web. */
    visibilityTitle: string;
    visibilityGroups: string;
    visibilityNobody: string;
    saved: string;
  };
  /**
   * Typing in a promotion code.
   *
   * Every refusal gets its own sentence. Expired, used up and mistyped send
   * somebody to check three different things, and one "that did not work" makes
   * them check all three.
   */
  promo: {
    /** The settings row that leads here. */
    row: string;
    rowHint: string;
    title: string;
    intro: string;
    placeholder: string;
    redeem: string;
    granted: string;
    /** `{tier}` and `{until}`: what was granted, and until when. */
    grantedBody: string;
    unknownCode: string;
    expired: string;
    exhausted: string;
    alreadyRedeemed: string;
    couldNotRedeem: string;
  };
  /**
   * Saying something back to the people who made this.
   *
   * The server takes the message; the rating is a gift rather than a required
   * field, so it has its own label saying so. Each kind is a different queue to
   * a reader, which is why the chips are not decoration.
   */
  feedback: {
    /** The settings row that leads here. */
    row: string;
    rowHint: string;
    title: string;
    hint: string;
    placeholder: string;
    send: string;
    thanks: string;
    thanksBody: string;
    another: string;
    rating: string;
    /** Said out loud, because a rating nobody gives is not a missing answer. */
    ratingHint: string;
    /** `{n}`: the star a control stands for, announced rather than drawn. */
    starLabel: PluralForms;
    starClearHint: string;
    /** What rides along with the message, said before it is sent. */
    attachNote: string;
    kindGeneral: string;
    kindBug: string;
    kindIdea: string;
    couldNotSend: string;
  };
  /**
   * The open-source software this client stands on.
   *
   * A flat, honest list of the web app's own direct runtime dependencies —
   * which is not the phone's list, and saying so is the point: a screen that
   * copied the mobile one would be attributing software this build does not
   * ship.
   */
  licenses: {
    row: string;
    title: string;
    intro: string;
    /** Said under the list, because a list of names is not a license. */
    note: string;
  };
  /**
   * A debt with somebody who does not use Waves.
   *
   * Under it this is still a group — a one-to-one group named after the person,
   * with one expense that produces the balance — so it folds into the Friends
   * totals like anything else. Nothing here is a new kind of record.
   */
  addPerson: {
    /** The row on Friends that leads here. */
    row: string;
    rowHint: string;
    title: string;
    subtitle: string;
    nameLabel: string;
    namePlaceholder: string;
    amountLabel: string;
    directionQuestion: string;
    theyOweMe: string;
    iOweThem: string;
    noteLabel: string;
    notePlaceholder: string;
    save: string;
    couldNotRecord: string;
    /**
     * The state the phone never has to show. There the group, the person and
     * the amount are one queued unit; here they are three calls, and the group
     * can exist with no amount in it. Saying so beats a bare failure that hides
     * a group somebody now has.
     */
    halfDone: string;
    openGroup: string;
  };
  /**
   * Folding same-person guests into one.
   *
   * A guest appears once per group, because a name is no proof that the "Alex"
   * in one group is the "Alex" in another. This is where the one thing that is
   * proof — a person saying so — gets recorded. The merge is per-viewer and
   * never rewrites the ledger: each group keeps its own guest and its own
   * balance, and only the Friends aggregation folds them into one name.
   */
  mergePeople: {
    entry: string;
    title: string;
    subtitle: string;
    empty: string;
    nameLabel: string;
    namePlaceholder: string;
    hasContact: string;
    warningTitle: string;
    warningBody: string;
    cta: string;
    /** `{n}`: how many are picked. */
    selected: PluralForms;
    errorTooFew: string;
    errorNotMergeable: string;
    errorNameRequired: string;
    errorNotSignedIn: string;
    errorGeneric: string;
    /** How far a guest reaches, said on their row. `{n}`: groups they are in. */
    inGroups: PluralForms;
  };
  /**
   * Said only to the people who need it said.
   *
   * The skip link is invisible until it has focus, so the only person who ever
   * reads it is somebody moving by keyboard — which is exactly who it is for.
   */
  a11y: {
    skipToContent: string;
  };
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
    continueWithApple: string;
    /**
     * The form's own heading, on the right-hand half of the door.
     *
     * The wordmark and the claim live on the illustrated half; this greets the
     * person at the field they are about to type into, so the two halves are
     * not the same sentence twice.
     */
    doorWelcome: string;
    doorSub: string;
    /** Real labels above the fields, not placeholders pretending to be labels. */
    emailLabel: string;
    passwordLabel: string;
    /** The eye on the password field. Both said, because it is a toggle. */
    showPassword: string;
    hidePassword: string;
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
    /** What one bill did to your own balance, said in words. */
    youLent: string;
    youBorrowed: string;
    notInvolved: string;
    paidBy: string;
    splitLabel: string;
    total: string;
    history: string;
    /** Who wrote a version, on the history timeline. */
    createdByName: string;
    editedByName: string;
    /** An edit whose fields all compare equal — a re-save, or a field the audit
     *  does not track. Said plainly rather than left blank. */
    noChanges: string;
    /** The field-level audit: one label per thing an edit can change. */
    audit: {
      /**
       * The reader's own position on this bill — what they put in beyond their
       * share, or their share of what somebody else put in. Not a share: the
       * figure is `paid − share`, so it is signed, and "your share −₹12,050"
       * is a sentence that cannot be true.
       */
      yourShare: string;
      amount: string;
      description: string;
      category: string;
      split: string;
      date: string;
      location: string;
      payers: string;
      participants: string;
      /** The empty end of an arrow — a field that had, or now has, no value. */
      none: string;
    };
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
    /** The payee's other answer: it never arrived. */
    dispute: string;
    disputing: string;
    /** Asked before disputing, because it contradicts somebody. */
    disputeConfirm: string;
    /** The payer withdrawing their own claim. */
    withdraw: string;
    withdrawing: string;
    withdrawConfirm: string;
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
    changedElsewhere: string;
    danger: string;
  };
  /** Light, dark, or whatever the machine is set to (the phone's Appearance). */
  theme: {
    label: string;
    system: string;
    light: string;
    dark: string;
    /** The Appearance page's rows. `{scheme}` in `currently` is Light or Dark. */
    lightHint: string;
    darkHint: string;
    currently: string;
    systemHint: string;
    footnote: string;
  };
  /** The conversation on one expense (A46). */
  comments: {
    title: string;
    emptyTitle: string;
    empty: string;
    placeholder: string;
    post: string;
    posting: string;
    edit: string;
    save: string;
    cancel: string;
    delete: string;
    deleteConfirm: string;
    /** Appended after a comment somebody changed. */
    edited: string;
    /** Flag a comment, and take the flag back. */
    report: string;
    reported: string;
    resolve: string;
    you: string;
    /** The cap the server enforces, shown as the composer fills up. */
    remaining: string;
  };
  /** The bill behind an expense (E2), and anything attached since (A44). */
  /** Who added or removed a receipt or an attachment (A46). Worded as the
   *  phone words it — the same event read on two screens should read the same. */
  imageAudit: {
    /** One line per event; `{name}` is the actor. */
    receiptAdded: string;
    receiptRemoved: string;
    attachmentAdded: string;
    attachmentRemoved: string;
    /** A tag on a party-only attachment's line. */
    partyOnly: string;
  };
  receipt: {
    title: string;
    /** The kept bill itself. */
    theBill: string;
    /** An image added to the expense afterwards. */
    attachment: string;
    /** An attachment only the people on the bill may see. */
    partyOnly: string;
    /** The image is gone, or was never uploaded. */
    missing: string;
    /** The image exists but this client cannot resolve it (R2 is off). */
    notAvailableHere: string;
    /** Open the full-resolution file in a new tab. */
    openOriginal: string;
    /** Follow the author's own cloud link (E3). */
    openShared: string;
    close: string;
  };
  settings: {
    title: string;
    profile: string;
    displayName: string;
    currency: string;
    country: string;
    paymentHandle: string;
    paymentHandleBody: string;
    paymentRail: string;
    save: string;
    saved: string;
    notifications: string;
    notifyInvolvesMe: string;
    notifyDigest: string;
    notifySettlements: string;
    notifyNudges: string;
    notifyWeekly: string;
    notifyEmail: string;
    language: string;
    languageBody: string;
    guestTitle: string;
    guestBody: string;
    signOut: string;
    onlyInApp: string;
    onlyInAppBody: string;
    /** The five group headings on the index, in the phone's words and order. */
    sectionAccount: string;
    sectionPreferences: string;
    sectionData: string;
    sectionSecurity: string;
    sectionHelp: string;
    languageFootnote: string;
  };
  /** The ten built-in categories, worded the same as the phone's. */
  categories: {
    food: string;
    groceries: string;
    travel: string;
    stay: string;
    shopping: string;
    entertainment: string;
    home: string;
    health: string;
    gifts: string;
    other: string;
  };
  /** One person, un-collapsed into the groups the balance came from. */
  person: {
    acrossGroups: string;
    /** One member inside one group: the balance, the badges, their bills. */
    notFound: string;
    notFoundBody: string;
    you: string;
    admin: string;
    notJoinedYet: string;
    left: string;
    /** How many bills this person is on; `{n}` is the count. */
    onCount: PluralForms;
    /** Nobody has put them on a bill yet; `{name}` is the person. */
    noneHere: string;
    squareWith: string;
    /**
     * Finding one person by something you already know about them.
     *
     * The narrowest search in the app: one exact address or number, and a
     * result only if that person left the matching channel discoverable. The
     * refusal never distinguishes "nobody uses that" from "they turned this
     * off", because a server that answered differently would make the setting
     * the oracle it exists to close.
     */
    findRow: string;
    findRowHint: string;
    findTitle: string;
    findHint: string;
    findPlaceholder: string;
    findAction: string;
    findNoMatch: string;
    findNoMatchBody: string;
    /** The one server refusal worth its own sentence: the daily ceiling. */
    findRateLimited: string;
    alreadyShared: string;
    /** Found, but you have never split with them. */
    notSharedYet: string;
    startGroup: string;
  };
  /** Taking the ledger away (ADR-012). */
  exportData: {
    title: string;
    body: string;
    csv: string;
    json: string;
    working: string;
    /**
     * The account-wide export, which is a different offer from the group one
     * above it: every group you are in, in whichever of the three shapes you
     * pick. `row`/`rowHint` are the settings row that leads there.
     */
    row: string;
    rowHint: string;
    accountTitle: string;
    everythingFree: string;
    explain: string;
    format: string;
    formatJson: string;
    formatCsv: string;
    formatPdf: string;
    whatToExport: string;
    allMyGroups: string;
    preparing: string;
    action: string;
    ready: string;
    failed: string;
  };
  /** The developer console: tokens, applications, and the consent screen. */
  developers: {
    title: string;
    intro: string;
    notConfigured: string;
    notConfiguredBody: string;
    copy: string;
    copied: string;
    copyFailed: string;
    permissions: string;
    signInAgain: string;
    tokens: {
      title: string;
      body: string;
      empty: string;
      name: string;
      namePlaceholder: string;
      expiryDays: string;
      expiryBody: string;
      create: string;
      creating: string;
      revoke: string;
      revoking: string;
      revokedTag: string;
      expiredTag: string;
      expires: string;
      neverExpires: string;
      lastUsed: string;
      neverUsed: string;
      createdTitle: string;
      onlyOnce: string;
      prefix: string;
    };
    apps: {
      title: string;
      body: string;
      empty: string;
      name: string;
      namePlaceholder: string;
      description: string;
      website: string;
      redirects: string;
      redirectsBody: string;
      kind: string;
      confidential: string;
      publicClient: string;
      register: string;
      registering: string;
      clientId: string;
      rotate: string;
      rotating: string;
      enable: string;
      disable: string;
      disabledTag: string;
      delete: string;
      deleteConfirm: string;
      deleting: string;
      secretTitle: string;
      secretOnce: string;
      publicNote: string;
    };
    connections: {
      title: string;
      body: string;
      empty: string;
      connected: string;
      lastUsed: string;
      neverUsed: string;
      disconnect: string;
      disconnecting: string;
    };
    consent: {
      title: string;
      wants: string;
      by: string;
      website: string;
      ableTo: string;
      approve: string;
      approving: string;
      cancel: string;
      refused: string;
      refusedBody: string;
      badRequest: string;
      back: string;
    };
    scope: ScopeWords;
  };
  /**
   * The consent screen for somebody else's agent.
   *
   * Supabase's OAuth 2.1 server sends a person here with an `authorization_id`,
   * and what they approve is not a scope list — it is a Supabase session. The
   * three scopes the server speaks (`openid`, `email`, `profile`) describe the
   * identity token and say nothing about the ledger, so a screen that recited
   * them would be true and useless. These words describe what the token can
   * actually reach through `/api/mcp`, which is everything RLS lets that person
   * reach themselves.
   */
  agents: {
    /** `{email}`: whose account is about to be handed over. */
    signedInAs: string;
    /** The heading over the real capability list. */
    willBeAbleTo: string;
    reads: string;
    writes: string;
    /** Said plainly, because the scope names hide it. */
    asYou: string;
    /** The one thing it can never do, worth saying on this screen. */
    neverMoves: string;
    deny: string;
    denying: string;
    /** Shown instead of a client-supplied logo — see the page for why. */
    unverified: string;
  };
  errors: {
    couldNotLoad: string;
    couldNotSignIn: string;
    passwordTooShort: string;
    passwordTooCommon: string;
    couldNotSave: string;
    offline: string;
    tooMany: string;
    tryAgain: string;
  };
  /**
   * The two screens the browser had no words for: who you are, and how somebody
   * hands you money back.
   *
   * One namespace rather than two because the phone keeps them under one — they
   * are two pages of the same row on the profile, and splitting the words would
   * be the first step towards the two clients describing the same column
   * differently.
   */
  account: {
    title: string;
    you: string;
    yourAccount: string;
    yourAccountHint: string;
    guestTitle: string;
    guestBody: string;
    detailsTitle: string;
    displayNameHint: string;
    countryNotSet: string;
    currencyFromCountry: string;
    addressTitle: string;
    addressHint: string;
    addressPlaceholder: string;
    signInMethodsTitle: string;
    signInMethodsBody: string;
    signInFootnote: string;
    emailAddress: string;
    alreadyAdded: string;
    notAddedYet: string;
    link: string;
    linkProvider: string;
    linked: string;
    payingTitle: string;
    howPeoplePayYou: string;
    settlesWith: string;
    handleWrong: string;
    railLinkNote: string;
    railManualNote: string;
    nothingToAdd: string;
  };
  /**
   * The six things Waves is allowed to interrupt you about, each with the
   * sentence that says what it will and will not do.
   *
   * `pushOnWeb` is the one line here with no counterpart on the phone, and it
   * is the important one: these switches decide what the *app* sends, and a
   * browser can receive none of it.
   */
  notifications: {
    title: string;
    rowHint: string;
    neverSpam: string;
    pushSection: string;
    pushOnWeb: string;
    involvesMe: string;
    involvesMeBody: string;
    settlementRequests: string;
    settlementRequestsBody: string;
    nudges: string;
    nudgesBody: string;
    digest: string;
    digestBody: string;
    emailSection: string;
    emailAll: string;
    emailAllBody: string;
    weeklyEmail: string;
    weeklyEmailBody: string;
    footnote: string;
  };
  /**
   * What this account is on, and what would ever cost money.
   *
   * Not `plan` — that name is taken by the trip planner, and a page about money
   * and a page about tomorrow's itinerary sharing a namespace is how the wrong
   * string ends up on the wrong screen. `{free}` in `whatNeverWillBody` is
   * `freeForever`, lowercased into the sentence.
   */
  billing: {
    row: string;
    rowHint: string;
    title: string;
    nothingToBuy: string;
    nothingToBuyBody: string;
    whatWouldCost: string;
    moreScans: string;
    moreScansBody: string;
    biggerTransfers: string;
    biggerTransfersBody: string;
    whatNeverWill: string;
    whatNeverWillBody: string;
    freeForever: string;
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
    tabExpenses: 'Expenses',
    tabBalances: 'Balances',
    tabActivity: 'Activity',
    noneYet: 'Nothing here yet',
    noneYetBody: 'The first expense somebody adds will show up here.',
    whereEveryoneStands: 'Where everyone stands',
    settledUp: 'settled up',
    isSettledUp: 'is settled up',
    isOwed: 'is owed',
    owes: 'owes',
    whoPaysWhom: 'Who pays whom',
    whoPaysWhomNote:
      'The fewest payments that settle everybody. Nobody is made to pay somebody they never split anything with.',
    youPayName: 'You pay {name}',
    namePaysYou: '{name} pays you',
    paysWhom: '{from} pays {to}',
    yourPayments: 'Your payments',
    otherPayments: 'Between other people',
    addAnExpense: 'Add an expense',
    installNote:
      'Install Waves to scan receipts, settle over UPI and keep this working without a signal.',
  },
  add: {
    title: 'Add an expense',
    defaultDescription: 'Expense',
    whatWasIt: 'What was it?',
    categoryLabel: 'What kind of spend',
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
  itemize: {
    title: 'Split by item',
    defaultDescription: 'Itemised bill',
    lines: 'What was on the bill',
    linePlaceholder: 'Item',
    untitledLine: 'an unnamed line',
    addLine: 'Add a line',
    removeLine: 'Remove this line',
    extras: 'Tax, service and tip',
    extrasNote: 'Shared out in proportion to what each person had, not split equally.',
    taxes: 'Tax',
    serviceCharge: 'Service',
    tip: 'Tip',
    discounts: 'Discount',
    preview: 'Who owes what',
    startTyping: 'Add a line and say who had it.',
    unclaimed: 'Nobody has claimed: {lines}',
    cannotSplit: 'This bill cannot be split yet.',
    noMembers: 'Add somebody to this group first.',
  },
  insights: {
    title: 'Spending',
    scopeLabel: 'Whose spending',
    wholeGroup: 'Everyone',
    justMine: 'Just mine',
    byCategory: 'What it went on',
    byMonth: 'Month by month',
    totalIn: 'spent in {currency}',
    tapMonth: 'Open a month to see its days.',
    nothingYet: 'Nothing to chart yet',
    nothingBody: 'Add an expense and this fills in.',
    nothingThisMonth: 'Nothing this month',
    nothingThisMonthBody: 'No expenses here in this currency.',
  },
  recap: {
    title: 'Trip recap',
    titleAny: 'Recap',
    subtitle: 'How it added up',
    perDay: 'Per day',
    biggestBill: 'Biggest bill',
    mostSpentOn: 'Most spent on',
    paidMost: 'Fronted the most',
    noneYet: 'Nothing to recap yet',
  },
  places: {
    title: 'Places',
    empty: 'No places yet',
    emptyBody: 'Add a location to an expense to see it here.',
  },
  plan: {
    title: 'Plan',
    subtitle: 'What is planned, and what it cost',
    dayNumber: 'day {n}',
    planned: 'Planned',
    spent: 'Spent',
    over: 'Over',
    under: 'Under',
    emptyDay: 'Nothing on this day yet.',
    nothingYet: 'Nothing planned yet',
    nothingBody: 'Add the days and what you mean to do. What it actually costs fills itself in.',
    tripsOnly: 'Planning is for trips',
    tripsOnlyBody: 'Make this group a trip in its settings to plan it day by day.',
    whatIsPlanned: 'What are you doing?',
    add: 'Add',
    cancel: 'Cancel',
    remove: 'Remove {title}',
  },
  budgets: {
    title: 'Budgets',
    overall: 'Overall',
    mine: 'My budget',
    amount: 'Amount',
    shareWithGroup: 'Share with group',
    onlyMe: 'Only me',
    save: 'Save',
    clear: 'Clear',
    set: 'Set a budget',
    edit: 'Change',
    left: 'left',
    over: 'over',
    forecast: 'On this pace',
    projectedTotal: 'Projected total',
    onTrack: 'On track',
    fairness: 'Fairness',
    paidShare: '{name} has fronted {percent}% of the trip',
    evenlyMatched: 'Everyone’s chipping in evenly',
    nextUp: '{name} could pick up the next one',
    someone: 'Someone',
  },
  tags: {
    title: 'Tags & categories',
    subtitle: 'Make your own tags, and hide or reorder the built-in ones.',
    settingsRow: 'Tags & categories',
    newTag: 'New tag',
    editTag: 'Edit tag',
    namePlaceholder: 'e.g. Client dinner',
    colourLabel: 'Colour',
    noCustomTags: 'No tags of your own yet. Make one to sort spending your way.',
    hide: 'Hide',
    show: 'Show',
    moveUp: 'Move up',
    moveDown: 'Move down',
    hiddenBadge: 'Hidden',
    deleteTag: 'Delete',
    deleteConfirm: 'Delete this tag? Past expenses keep it; it just leaves the list.',
    save: 'Save tag',
    cancel: 'Cancel',
    nameNeeded: 'Give the tag a name.',
  },
  privacy: {
    deleteRow: 'Delete my data',
    deleteRowHint: 'Remove your account and personal details',
    deleteTitle: 'Delete my data',
    deleteIntro:
      'This cannot be undone. Please read what it does and does not remove — the second part is the one that surprises people.',
    deleteGoesTitle: 'What is removed',
    deleteGoesBody:
      'Your name, photo, payment handle, country, language and notification settings. Your sign-in, so this account can no longer be opened. Your devices, notification history, purchases and anything the AI scanner recorded about your usage.',
    deleteStaysTitle: 'What stays, and why',
    deleteStaysBody:
      "The expenses and settlements in your shared groups remain, along with the notes and comments on them and the images you added — receipts, proofs of payment, trip photos — because they are also other people's records — they are what says who owes whom, and removing them would silently change somebody else's balance to settle a debt nobody paid. You become an unnamed former member in those groups. Your name is gone from them; your share of the dinner is not.",
    deleteExportFirst: 'Export your data first',
    deleteWhyLabel: 'Why are you leaving? (optional)',
    deleteWhyPlaceholder: 'It helps to know, and it is kept after your account is gone',
    deleteConfirmLabel: 'Type DELETE to confirm',
    deleteConfirmWord: 'DELETE',
    deleteButton: 'Delete my data',
    deleteWorking: 'Deleting…',
    deleteDone: 'Your data has been deleted.',
    deleteSummary: {
      one: 'You are now a former member of {n} group.',
      other: 'You are now a former member of {n} groups.',
    },
    previewGroups: { one: 'You are in {n} group.', other: 'You are in {n} groups.' },
    previewExpenses: {
      one: 'You entered {n} expense that will stay.',
      other: 'You entered {n} expenses that will stay.',
    },
    previewSettlements: {
      one: 'You are named in {n} settlement.',
      other: 'You are named in {n} settlements.',
    },
    previewOutstanding: 'You still have an unsettled balance in {list}.',
    row: 'Privacy',
    rowHint: 'What is stored, and how it is kept',
    title: 'Privacy',
    intro:
      'Waves holds as little about you as it can and still work. This describes what that is, in plain terms.',
    controlsSection: 'Your controls',
    expandLabel: 'Read more',
    collapseLabel: 'Show less',
    supportRow: 'Privacy questions',
    supportRowHint: 'Write to us — a person answers',
    lastUpdated: 'Last updated {date}.',
    storeTitle: 'What is stored',
    storeSummary: 'Your profile, groups, expenses, receipts, comments, settings and who owes whom.',
    storeBody:
      'Your display name, and whichever of a phone number, email or sign-in identity you used. Optionally a payment handle, so somebody can pay you back, and a country, which decides which payment rails you are offered, and an optional postal address if you add one. The groups you are in, the expenses in them, and who owes whom. Nothing else: no contacts are uploaded, and there is no advertising identifier.',
    protectTitle: 'How it is kept',
    protectSummary: 'Database rules on every read, private receipt links, scrubbed crash reports.',
    protectBody:
      'Every table is behind row-level security in the database, so a request can only ever read rows your own account is entitled to — not a filter applied by the page, but a rule the database enforces. The key this page carries can do nothing your signed-in session could not already do. Receipt images sit in a private bucket reached through short-lived signed links. Crash reports are scrubbed of addresses, phone numbers, payment handles and keys before they leave the browser, and nothing here records your screen. Each receipt can be visible to everybody in the group, or only to the people on that expense — you choose per image.',
    servicesTitle: 'Who else touches your data',
    servicesSummary:
      'Supabase for the database, Sentry for crashes. No analytics tag, nothing sold.',
    servicesBody:
      'Waves runs on Supabase — the database and sign-in, on servers we control. Crash reports go to Sentry, scrubbed of your details before they leave the page. This site carries no analytics tag: there is no screen recording, no advertising identifier and no ad networks. Your data is never sold.',
    retentionTitle: 'How long we keep it',
    retentionSummary:
      'Kept while your account is open, deleted after 3 untouched years. Shared records stay on without your name.',
    retentionBody:
      "Your data stays while your account is open. If the account goes untouched for 3 years, we delete it and the personal data with it. You never have to wait for that — export or delete everything yourself, any time, from Settings. A group you close and leave untouched for a year and a half is moved to your archive automatically — nothing is deleted, and you can reopen it whenever you like. Some of what you leave behind survives deleting your account, and you should know it before you do. What you added to a shared group stays — the expenses and settlements, the notes and comments on them, and the images you added, whether a receipt, a proof of payment or a trip photo — because it is also the other members' record of who owed whom, and taking it out would silently change somebody else's balance to settle a debt nobody paid. Your name, photo, contact details and payment handles are removed from those groups, where you become an unnamed former member; notifications and activity already written to other people can still carry the name you had at the time. And if you write an answer into the box asking why you are leaving, that answer is kept exactly as you typed it, with the link back to you removed. Nothing is kept for advertising, and nothing is kept because a law obliges us to.",
    choicesTitle: 'What you can do',
    choicesSummary: 'Export everything, mute anything, or delete your account.',
    choicesBody:
      'Export everything you have entered, at any time, in full fidelity and for free. Turn off any notification. Delete your account and the personal data in it. Export and deletion both live in Settings, and the export is offered again on the way out. Write to us with anything you want changed.',
  },
  devices: {
    title: 'Devices',
    row: 'Devices',
    rowHint: 'See where you are signed in',
    intro:
      'The phones signed in to this account. A browser is not registered as a device, so this one is not listed.',
    signedOut: 'Signed out',
    lastActive: 'Last active {when}',
    signOutAll: 'Sign out everywhere else',
    signOutAllHint: 'Signs out every phone, and every other browser. This tab stays signed in.',
    signedOutAll: {
      one: 'Signed out {n} device.',
      other: 'Signed out {n} devices.',
    },
    none: 'No phones are signed in to this account.',
    historyNote: 'Showing the last three months.',
    couldNotSignOut: 'Could not sign the other devices out. Please try again.',
  },
  discovery: {
    discoveryRow: 'How people find you',
    discoveryRowHint: 'Being searched for, and what group-mates can see',
    discoveryTitle: 'How people find you',
    discoveryIntro:
      'Somebody who already has your number or your address can look you up on Waves. Nobody can browse for you, and no search is ever by name.',
    findTitle: 'Find someone',
    discoveryPhone: 'Find me by my phone number',
    discoveryPhoneHint:
      'Only an exact match. Turning this off does not remove you from groups you are already in.',
    discoveryEmail: 'Find me by my email address',
    discoveryEmailHint: 'Only an exact match, and only the address on this account.',
    discoveryFootnote:
      'Somebody who found you by typing your number will see that number — they already had it. None of this ever changes who owes what.',
    visibilityTitle: 'What your groups can see',
    visibilityGroups: 'People in my groups can see my phone and email',
    visibilityNobody: 'Nobody can see them',
    saved: 'Saved',
  },
  promo: {
    row: 'Redeem a code',
    rowHint: 'If somebody gave you one',
    title: 'Redeem a code',
    intro: 'Codes are given out by hand — for a support case, a thank-you, or a trial.',
    placeholder: 'WAVES2026',
    redeem: 'Redeem',
    granted: 'Done',
    grantedBody: 'Plus is on until {until}. Nothing was charged, and nothing renews.',
    unknownCode: 'No code like that. Check the spelling — letters and numbers only.',
    expired: 'That code has passed its date.',
    exhausted: 'That code has been used as many times as it allows.',
    alreadyRedeemed: 'You have already used that one.',
    couldNotRedeem: 'The code could not be checked just now. Try again in a moment.',
  },
  feedback: {
    row: 'Send feedback',
    rowHint: 'Tell us what is wrong, or what is missing',
    title: 'Send feedback',
    hint: 'Read by a person, not a queue. Say as much or as little as you like — it helps most when it is specific.',
    placeholder: 'What happened, or what you wish it did',
    send: 'Send',
    thanks: 'Thank you — that has been received.',
    thanksBody: 'A person reads every one of these. We cannot always reply, but nothing is lost.',
    another: 'Send another',
    rating: 'How is Waves so far?',
    ratingHint: 'Optional',
    starLabel: { one: '{n} star', other: '{n} stars' },
    starClearHint: 'Choose it again to clear the rating',
    attachNote:
      'Which build of the web app you are on comes along, so we can reproduce what you saw. Nothing else.',
    kindGeneral: 'General',
    kindBug: 'Something is broken',
    kindIdea: 'An idea',
    couldNotSend: 'That could not be sent just now. Try again in a moment.',
  },
  licenses: {
    row: 'Open source licenses',
    title: 'Open source',
    intro:
      'Waves is built on open-source software. Thank you to the people who made and maintain these.',
    note: 'Each is used under its own license, kept unchanged.',
  },
  addPerson: {
    title: 'Add a person',
    subtitle: 'Track what someone owes you — nobody needs the app, and no group to set up.',
    nameLabel: 'Their name',
    namePlaceholder: 'e.g. Alex',
    amountLabel: 'Amount',
    directionQuestion: 'Which way?',
    theyOweMe: 'They owe me',
    iOweThem: 'I owe them',
    noteLabel: 'Note (optional)',
    notePlaceholder: 'What is it for?',
    save: 'Record it',
    couldNotRecord: 'Could not record this. Please try again.',
    row: 'Add a person',
    rowHint: 'Someone who does not use Waves',
    halfDone: 'The group was made, but the amount was not recorded. Open it and add the amount.',
    openGroup: 'Open the group',
  },
  mergePeople: {
    entry: 'Merge people',
    title: 'Merge people',
    subtitle:
      'Pick the guests who are the same person. Their balances are combined under one name.',
    empty: 'No guests to merge — only people without a Waves account can be merged.',
    nameLabel: 'Name for the merged person',
    namePlaceholder: 'e.g. Alex',
    hasContact: 'You have their contact details',
    warningTitle: 'This can’t be undone',
    warningBody:
      'Their separate balances are combined into one person for good. There’s no way to split them back apart.',
    cta: 'Merge',
    selected: { one: '{n} person selected', other: '{n} people selected' },
    errorTooFew: 'Pick at least two people to merge.',
    errorNotMergeable: 'You can only merge guests you share a group with.',
    errorNameRequired: 'Give the merged person a name.',
    errorNotSignedIn: 'You’re signed out. Sign in and try the merge again.',
    errorGeneric: 'Could not merge. Please try again.',
    inGroups: { one: 'In {n} group', other: 'In {n} groups' },
  },
  a11y: {
    skipToContent: 'Skip to content',
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
    continueWithApple: 'Continue with Apple',
    doorWelcome: 'Welcome to Waves',
    doorSub: 'Sign in and pick up where your groups left off.',
    emailLabel: 'Email',
    passwordLabel: 'Password',
    showPassword: 'Show password',
    hidePassword: 'Hide password',
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
    youLent: 'you lent',
    youBorrowed: 'you borrowed',
    notInvolved: 'not involved',
    paidBy: 'Paid by',
    splitLabel: 'Split',
    total: 'Total',
    history: 'History',
    createdByName: '{name} added this',
    editedByName: '{name} edited this',
    noChanges: 'No tracked field changed',
    audit: {
      yourShare: 'Your balance',
      amount: 'Amount',
      description: 'Description',
      category: 'Category',
      split: 'Split',
      date: 'Date',
      location: 'Location',
      payers: 'Paid by',
      participants: 'Split between',
      none: 'None',
    },
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
    dispute: 'It never arrived',
    disputing: 'Marking…',
    disputeConfirm: 'Say this payment never reached you?',
    withdraw: 'Withdraw',
    withdrawing: 'Withdrawing…',
    withdrawConfirm: 'Withdraw this payment?',
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
    changedElsewhere:
      'Somebody else changed this group while this page was open. Their version is above — check it, then save again.',
    danger: 'Careful',
  },
  theme: {
    label: 'Appearance',
    system: 'Device',
    light: 'Light',
    dark: 'Dark',
    lightHint: 'The pale lavender canvas.',
    darkHint: 'Easier on the eyes at night.',
    currently: 'Currently {scheme}',
    systemHint: 'Follows whatever this device is set to.',
    footnote: 'Following your phone lets the app turn dark when your phone does.',
  },
  comments: {
    title: 'Comments',
    emptyTitle: 'No comments yet',
    empty: 'Start the conversation.',
    placeholder: 'Add a comment…',
    post: 'Post comment',
    posting: 'Posting…',
    edit: 'Edit',
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    deleteConfirm: 'Delete this comment?',
    edited: 'edited',
    report: 'Report',
    reported: 'Reported',
    resolve: 'Resolve',
    you: 'You',
    remaining: '{count} left',
  },
  imageAudit: {
    receiptAdded: '{name} added the receipt',
    receiptRemoved: '{name} removed the receipt',
    attachmentAdded: '{name} added an attachment',
    attachmentRemoved: '{name} removed an attachment',
    partyOnly: 'Private',
  },
  receipt: {
    title: 'Receipt',
    theBill: 'The bill',
    attachment: 'Attachment',
    partyOnly: 'Only for people on this bill',
    missing: 'This image is no longer here',
    notAvailableHere: 'Not viewable in the browser yet',
    openOriginal: 'Open original',
    openShared: 'Open the shared copy',
    close: 'Close',
  },
  settings: {
    title: 'Settings',
    profile: 'You',
    displayName: 'Name',
    currency: 'Default currency',
    country: 'Country',
    paymentHandle: 'Payment handle',
    paymentHandleBody: 'Shown to people settling up with you, so they can pay without asking.',
    paymentRail: 'Paid via',
    save: 'Save',
    saved: 'Saved',
    notifications: 'What we tell you about',
    notifyInvolvesMe: 'Only things that involve me',
    notifyDigest: 'A daily summary of group activity',
    notifySettlements: 'When somebody pays me, or asks me to confirm',
    notifyNudges: 'Reminders somebody sends me',
    notifyWeekly: 'A weekly email',
    notifyEmail: 'Email me at all',
    language: 'Language',
    languageBody: 'Changing this reloads the page.',
    guestTitle: 'You are a guest',
    guestBody: 'Add an email so this account can be opened on another device.',
    signOut: 'Sign out',
    onlyInApp: 'In the app',
    onlyInAppBody:
      'Scanning receipts, speaking an expense, offline entry and your private Me ledger live in the phone app.',
    sectionAccount: 'Account',
    sectionPreferences: 'Preferences',
    sectionData: 'Data & privacy',
    sectionSecurity: 'Security',
    sectionHelp: 'Help',
    languageFootnote:
      "Your phone's language is the default, and choosing one here only changes Waves. Amounts and dates still follow where you are — reading the app in Hindi in Dubai does not move you to India.",
  },
  categories: {
    food: 'Food & drink',
    groceries: 'Groceries',
    travel: 'Travel',
    stay: 'Stay',
    shopping: 'Shopping',
    entertainment: 'Fun',
    home: 'Home & bills',
    health: 'Health',
    gifts: 'Gifts',
    other: 'Other',
  },
  person: {
    acrossGroups: 'Across the groups you share',
    notFound: 'No such person here',
    notFoundBody: 'They may have left this group, or the link is wrong.',
    you: 'You',
    admin: 'Admin',
    notJoinedYet: 'Not joined yet',
    left: 'Left this group',
    onCount: { one: 'On {n} bill', other: 'On {n} bills' },
    noneHere: '{name} is not on anything here yet.',
    squareWith: 'You are square with each other.',
    findRow: 'Find someone',
    findRowHint: 'By their exact email address or phone number',
    findTitle: 'Find someone',
    findHint: 'Type the exact email address or phone number they use on Waves.',
    findPlaceholder: 'Email or phone',
    findAction: 'Search',
    findNoMatch: 'No match',
    findNoMatchBody: 'Nobody uses that, or they have chosen not to be found by it.',
    findRateLimited: 'That is enough searching for today. Try again tomorrow.',
    alreadyShared: 'Already in a group with you',
    notSharedYet: 'You have not split anything with them yet.',
    startGroup: 'Start a group',
  },
  exportData: {
    title: 'Export',
    body: 'Everything in this group as a file, to keep or to open in a spreadsheet.',
    csv: 'Download CSV',
    json: 'Download JSON',
    working: 'Building the file…',
    row: 'Export data',
    rowHint: 'JSON + CSV, lossless, free',
    accountTitle: 'Export your data',
    everythingFree: 'Everything, always free',
    explain:
      'JSON includes every version of every expense, who paid, who owed, settlements with their per-expense allocations, and the activity trail — enough to rebuild your ledger exactly. CSV is the spreadsheet view, including per-person settlement detail.',
    format: 'Format',
    formatJson: 'JSON (lossless)',
    formatCsv: 'CSV (spreadsheet)',
    formatPdf: 'PDF (printable)',
    whatToExport: 'What to export',
    allMyGroups: 'All my groups',
    preparing: 'Preparing…',
    action: 'Export',
    ready: 'Export ready',
    failed: 'Could not export your data. Please try again.',
  },
  developers: {
    title: 'Developers',
    intro:
      'Build on your own Waves data: a token for a script of your own, or an application other people can connect to their accounts.',
    notConfigured: 'The developer API is not configured for this deployment.',
    notConfiguredBody:
      'Set NEXT_PUBLIC_WAVES_API_URL to the address of the Waves API, then reload this page.',
    copy: 'Copy',
    copied: 'Copied',
    copyFailed: 'Copy it by hand — the browser would not let the page do it for you.',
    permissions: 'Permissions',
    signInAgain: 'Your Waves session has expired. Sign in again, then open this link once more.',
    tokens: {
      title: 'Personal access tokens',
      body: 'A token acts as you, limited to the permissions you tick. Treat one like a password and keep it out of anything you publish.',
      empty: 'You have not made a token yet.',
      name: 'What is it for?',
      namePlaceholder: 'My backup script',
      expiryDays: 'Expires after (days)',
      expiryBody: 'Leave this empty for a token that never expires.',
      create: 'Create token',
      creating: 'Creating…',
      revoke: 'Revoke',
      revoking: 'Revoking…',
      revokedTag: 'Revoked',
      expiredTag: 'Expired',
      expires: 'Expires {date}',
      neverExpires: 'No expiry',
      lastUsed: 'Last used {date}',
      neverUsed: 'Never used',
      createdTitle: 'Your new token',
      onlyOnce:
        'Copy it now. This is the only time it will ever be shown — Waves keeps a fingerprint of it and cannot show it to you again.',
      prefix: 'Starts {prefix}',
    },
    apps: {
      title: 'Applications',
      body: 'An application asks other people for permission and then acts for them. Everyone who connects it sees the name and website you give here.',
      empty: 'You have not registered an application.',
      name: 'Name',
      namePlaceholder: 'Trip Splitter',
      description: 'What it does',
      website: 'Website',
      redirects: 'Redirect addresses',
      redirectsBody:
        'One per line. Waves will only ever send somebody back to an address listed here.',
      kind: 'Where does it run?',
      confidential: 'On a server, where it can keep a secret',
      publicClient: 'On a phone or in a browser, where it cannot',
      register: 'Register application',
      registering: 'Registering…',
      clientId: 'Client id',
      rotate: 'New secret',
      rotating: 'Making one…',
      enable: 'Enable',
      disable: 'Disable',
      disabledTag: 'Disabled',
      delete: 'Delete',
      deleteConfirm: 'Delete for good?',
      deleting: 'Deleting…',
      secretTitle: 'Your new client secret',
      secretOnce:
        'Copy it now. This is the only time it will ever be shown, and making another one signs nobody out — it only stops the old one working.',
      publicNote:
        'A public client has no secret. PKCE is what proves a request really came from it.',
    },
    connections: {
      title: 'Connected apps',
      body: 'Applications you have allowed to act for you. Disconnecting one revokes every token it holds.',
      empty: 'Nothing is connected to your account.',
      connected: 'Connected {date}',
      lastUsed: 'Last used {date}',
      neverUsed: 'Not used yet',
      disconnect: 'Disconnect',
      disconnecting: 'Disconnecting…',
    },
    consent: {
      title: 'Approve access',
      wants: '{app} would like to act for you',
      by: 'Registered by {owner}',
      website: 'Website',
      ableTo: 'It will be able to:',
      approve: 'Approve',
      approving: 'Approving…',
      cancel: 'Cancel',
      refused: 'Waves will not show this request.',
      refusedBody:
        'The application, the address it asked to be sent back to, or the permission it asked for is not what its developer registered. Nothing has been shared, and there is nothing here to approve.',
      badRequest: 'This link is missing something Waves needs, so there is nothing to approve.',
      back: 'Back to developers',
    },
    scope: {
      'identity.read': 'See your name, avatar and default currency.',
      'identity.write': 'Change your profile details.',
      'groups.read': 'See your groups, who is in them and what each person is owed.',
      'groups.write': 'Create groups, rename them, and add or remove people.',
      'expenses.read': 'See the expenses in your groups.',
      'expenses.write': 'Add, edit and delete expenses in your groups.',
      'settlements.read': 'See payments recorded between you and other people.',
      'settlements.write': 'Record and confirm payments on your behalf.',
      'friends.read': 'See who you owe and who owes you, across every group.',
      'categories.read': 'See your expense categories.',
      'categories.write': 'Add, change and hide your expense categories.',
      offline_access: 'Stay connected without asking you again.',
    },
  },
  agents: {
    signedInAs: 'Signed in as {email}',
    willBeAbleTo: 'If you approve, it will be able to:',
    reads: 'Read your groups, expenses, balances and the people you split with',
    writes: 'Add expenses, create groups and record settlements',
    asYou: 'It acts as you. It can reach exactly what you can reach, and nothing else.',
    neverMoves:
      'It cannot move money. Settlements are recorded; paying stays something you do yourself.',
    deny: 'Deny',
    denying: 'Denying…',
    unverified: 'Waves has not verified this application.',
  },
  errors: {
    couldNotLoad: 'Couldn’t load this. Try again in a moment.',
    couldNotSignIn: 'Could not sign in. Please try again.',
    passwordTooShort: 'Use at least 8 characters — a phrase is easier to remember than a puzzle.',
    passwordTooCommon: 'That is one of the first passwords anyone tries.',
    couldNotSave: 'That didn’t save. Try again in a moment.',
    offline: 'You appear to be offline. Check your connection and try again.',
    tooMany: 'Too many tries in a row. Wait a moment, then try again.',
    tryAgain: 'Try again',
  },
  account: {
    title: 'Your account',
    you: 'You',
    yourAccount: 'Your account',
    yourAccountHint: 'Your name, where you are, and the ways in',
    guestTitle: 'Guest account',
    guestBody:
      'Everything you have entered is already saved and yours. Link a Google or Apple account whenever you want to reach it from another device — it keeps this account rather than starting a new one.',
    detailsTitle: 'Your details',
    displayNameHint: 'Everyone you share a group with sees this.',
    countryNotSet: 'Not set',
    currencyFromCountry: 'Set from your country',
    addressTitle: 'Address',
    addressHint: 'Never posted to. Kept for your own records.',
    addressPlaceholder: 'Street, city, postal code',
    signInMethodsTitle: 'Ways to sign in',
    signInMethodsBody: 'Link an account and you can sign in with it next time, on any device.',
    signInFootnote:
      'Waves never asks for this to let you in, and never shares it with anyone in your groups. People see the name you choose, nothing else.',
    emailAddress: 'Email address',
    alreadyAdded: 'Already added: {value}',
    notAddedYet: 'Not added yet',
    link: 'Link',
    linkProvider: 'Link {provider}',
    linked: 'Linked',
    payingTitle: 'Paying',
    howPeoplePayYou: 'How people pay you',
    settlesWith: 'Settles with {rails}',
    handleWrong: 'That does not look like {hint}.',
    railLinkNote: 'People settling with you get a one-tap payment. Waves never handles the money.',
    railManualNote:
      'People settling with you see this to pay you from their own bank app. Waves never handles the money.',
    nothingToAdd: 'Nothing to add — people will record what they paid you by hand.',
  },
  notifications: {
    title: 'Notifications',
    rowHint: 'What Waves may interrupt you about',
    neverSpam:
      'Waves never emails you about routine expense activity. Only the six things you would actually want in your inbox, each unsubscribable on its own.',
    pushSection: 'Push',
    pushOnWeb:
      'These four decide what the phone app sends you. A browser is not a registered device, so nothing here will ever ring on this one.',
    involvesMe: 'Only what involves me',
    involvesMeBody:
      'Push when you owe, are owed, or are mentioned — not for every expense in every group.',
    settlementRequests: 'Settlement confirmations',
    settlementRequestsBody: 'When someone says they paid you, so your balance stays right.',
    nudges: 'Reminders',
    nudgesBody:
      'A friendly nudge about money owed. Limited to one per person per day, in the database.',
    digest: 'Daily group summary',
    digestBody: 'Everything else, batched into one notification a day instead of a stream.',
    emailSection: 'By email',
    emailAll: 'Email me at all',
    emailAllBody:
      'Settlements, reminders and the weekly summary. Security alerts about a new sign-in arrive whatever this says.',
    weeklyEmail: 'Weekly email digest',
    weeklyEmailBody: 'Your net balance and pending confirmations, once a week. Off by default.',
    footnote:
      'Email delivery is still to come. Everything here is also in your inbox, which is the record of what Waves has told you whether or not a notification arrived.',
  },
  billing: {
    row: 'Plan',
    rowHint: 'Free plan — everything included, nothing to buy',
    title: 'Plan',
    nothingToBuy: 'Nothing to buy yet',
    nothingToBuyBody:
      'This is the door, not the shop. When there is something worth paying for it will be here, with the price on it and no surprises.',
    whatWouldCost: 'What would ever cost money',
    moreScans: 'More scanned bills',
    moreScansBody:
      'Photograph a receipt and have the lines read off it. Every scan costs real money to run, which is the honest reason it is the thing with a limit.',
    biggerTransfers: 'Bigger exports and imports',
    biggerTransfersBody:
      'Your data is yours and leaves in full for free. Larger jobs and scheduled backups are the convenience.',
    whatNeverWill: 'What never will',
    whatNeverWillBody:
      'The ledger. Groups, expenses, splits, balances, settling up, and getting all of it back out again — {free}. A ledger you can only half read is not a ledger.',
    freeForever: 'Unlimited and free, forever',
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
    tabExpenses: 'செலவுகள்',
    tabBalances: 'நிலுவைகள்',
    tabActivity: 'நடவடிக்கை',
    noneYet: 'இன்னும் எதுவும் இல்லை',
    noneYetBody: 'யாராவது சேர்க்கும் முதல் செலவு இங்கே தெரியும்.',
    whereEveryoneStands: 'யார் எங்கே நிற்கிறார்கள்',
    settledUp: 'தீர்ந்தது',
    isSettledUp: 'கணக்கு தீர்ந்தது',
    isOwed: 'பெற வேண்டியது',
    owes: 'தர வேண்டியது',
    whoPaysWhom: 'யார் யாருக்குத் தருவது',
    whoPaysWhomNote:
      'அனைவரையும் தீர்க்கும் மிகக் குறைந்த கொடுப்பனவுகள். எதையும் சேர்ந்து பிரிக்காத ஒருவருக்கு யாரும் பணம் தர வேண்டியதில்லை.',
    youPayName: 'நீங்கள் {name}க்குச் செலுத்துகிறீர்கள்',
    namePaysYou: '{name} உங்களுக்குச் செலுத்துகிறார்',
    paysWhom: '{from} {to}க்குச் செலுத்துகிறார்',
    yourPayments: 'உங்கள் பரிமாற்றங்கள்',
    otherPayments: 'மற்றவர்களுக்கு இடையே',
    addAnExpense: 'ஒரு செலவைச் சேர்',
    installNote:
      'ரசீதுகளை ஸ்கேன் செய்ய, UPI மூலம் தீர்க்க, சிக்னல் இல்லாமலும் இது வேலை செய்ய — Waves ஐ நிறுவுங்கள்.',
  },
  add: {
    title: 'ஒரு செலவைச் சேர்',
    defaultDescription: 'செலவு',
    whatWasIt: 'எதற்காக?',
    categoryLabel: 'எந்த வகைச் செலவு',
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
  itemize: {
    title: 'பொருள் வாரியாகப் பிரி',
    defaultDescription: 'பொருள் வாரியான பில்',
    lines: 'பில்லில் இருந்தவை',
    linePlaceholder: 'பொருள்',
    untitledLine: 'பெயரிடப்படாத வரி',
    addLine: 'வரி சேர்',
    removeLine: 'இந்த வரியை நீக்கு',
    extras: 'வரி, சேவை, டிப்',
    extrasNote: 'சமமாகப் பிரிக்காமல், ஒவ்வொருவரும் எடுத்துக்கொண்டதற்கு ஏற்ப பகிரப்படும்.',
    taxes: 'வரி',
    serviceCharge: 'சேவை',
    tip: 'டிப்',
    discounts: 'தள்ளுபடி',
    preview: 'யார் எவ்வளவு தர வேண்டும்',
    startTyping: 'ஒரு வரியைச் சேர்த்து, அதை யார் எடுத்தார் எனச் சொல்லுங்கள்.',
    unclaimed: 'யாரும் உரிமை கோரவில்லை: {lines}',
    cannotSplit: 'இந்த பில்லை இன்னும் பிரிக்க முடியாது.',
    noMembers: 'முதலில் இந்தக் குழுவில் ஒருவரைச் சேருங்கள்.',
  },
  insights: {
    title: 'செலவுகள்',
    scopeLabel: 'யாருடைய செலவு',
    wholeGroup: 'அனைவரும்',
    justMine: 'என்னுடையது மட்டும்',
    byCategory: 'எதற்குச் சென்றது',
    byMonth: 'மாதம் வாரியாக',
    totalIn: '{currency}ல் செலவு',
    tapMonth: 'நாட்களைப் பார்க்க ஒரு மாதத்தைத் திறக்கவும்.',
    nothingYet: 'இன்னும் வரைபடத்திற்கு ஒன்றுமில்லை',
    nothingBody: 'ஒரு செலவைச் சேர்த்தால் இது நிரம்பும்.',
    nothingThisMonth: 'இந்த மாதம் ஒன்றுமில்லை',
    nothingThisMonthBody: 'இந்த நாணயத்தில் இங்கு செலவுகள் இல்லை.',
  },
  recap: {
    title: 'பயண சுருக்கம்',
    titleAny: 'சுருக்கம்',
    subtitle: 'எப்படி கூடியது',
    perDay: 'நாள் ஒன்றுக்கு',
    biggestBill: 'மிகப்பெரிய பில்',
    mostSpentOn: 'அதிகம் செலவழித்தது',
    paidMost: 'அதிகம் செலுத்தியவர்',
    noneYet: 'இன்னும் சுருக்க எதுவும் இல்லை',
  },
  places: {
    title: 'இடங்கள்',
    empty: 'இன்னும் இடங்கள் இல்லை',
    emptyBody: 'ஒரு செலவுக்கு இடத்தைச் சேர்த்தால் அது இங்கே தெரியும்.',
  },
  plan: {
    title: 'திட்டம்',
    subtitle: 'திட்டமிட்டது, ஆன செலவு',
    dayNumber: 'நாள் {n}',
    planned: 'திட்டமிட்டது',
    spent: 'செலவானது',
    over: 'அதிகம்',
    under: 'குறைவு',
    emptyDay: 'இந்த நாளில் இன்னும் ஒன்றுமில்லை.',
    nothingYet: 'இன்னும் திட்டம் ஏதுமில்லை',
    nothingBody:
      'நாட்களையும் செய்யப் போவதையும் சேருங்கள். உண்மையில் ஆன செலவு தானே நிரம்பிக்கொள்ளும்.',
    tripsOnly: 'திட்டமிடல் பயணங்களுக்கு மட்டும்',
    tripsOnlyBody: 'நாள் வாரியாகத் திட்டமிட, அமைப்புகளில் இந்தக் குழுவைப் பயணமாக மாற்றுங்கள்.',
    whatIsPlanned: 'என்ன செய்யப் போகிறீர்கள்?',
    add: 'சேர்',
    cancel: 'ரத்து',
    remove: '{title} அகற்று',
  },
  budgets: {
    title: 'பட்ஜெட்',
    overall: 'மொத்தம்',
    mine: 'என் பட்ஜெட்',
    amount: 'தொகை',
    shareWithGroup: 'குழுவுடன் பகிர்',
    onlyMe: 'எனக்கு மட்டும்',
    save: 'சேமி',
    clear: 'அழி',
    set: 'பட்ஜெட் அமை',
    edit: 'மாற்று',
    left: 'மீதம்',
    over: 'அதிகம்',
    forecast: 'இந்த வேகத்தில்',
    projectedTotal: 'எதிர்பார்க்கும் மொத்தம்',
    onTrack: 'சரியான பாதையில்',
    fairness: 'நியாயம்',
    paidShare: '{name} பயணத்தில் {percent}% செலுத்தியுள்ளார்',
    evenlyMatched: 'அனைவரும் சமமாக பங்களிக்கிறார்கள்',
    nextUp: 'அடுத்த பில்லை {name} எடுக்கலாம்',
    someone: 'யாரோ',
  },
  tags: {
    title: 'குறிச்சொற்கள் & வகைகள்',
    subtitle:
      'உங்கள் சொந்தக் குறிச்சொற்களை உருவாக்குங்கள், உள்ளமைந்தவற்றை மறைக்கவோ மறுவரிசைப்படுத்தவோ செய்யுங்கள்.',
    settingsRow: 'குறிச்சொற்கள் & வகைகள்',
    newTag: 'புதிய குறிச்சொல்',
    editTag: 'குறிச்சொல்லைத் திருத்து',
    namePlaceholder: 'எ.கா. வாடிக்கையாளர் இரவு உணவு',
    colourLabel: 'நிறம்',
    noCustomTags:
      'இன்னும் சொந்தக் குறிச்சொற்கள் இல்லை. உங்கள் வழியில் செலவுகளை வகைப்படுத்த ஒன்றை உருவாக்குங்கள்.',
    hide: 'மறை',
    show: 'காட்டு',
    moveUp: 'மேலே நகர்த்து',
    moveDown: 'கீழே நகர்த்து',
    hiddenBadge: 'மறைக்கப்பட்டது',
    deleteTag: 'நீக்கு',
    deleteConfirm:
      'இந்தக் குறிச்சொல்லை நீக்கவா? பழைய செலவுகள் அதை வைத்திருக்கும்; பட்டியலிலிருந்து மட்டும் போகும்.',
    save: 'குறிச்சொல்லைச் சேமி',
    cancel: 'ரத்து',
    nameNeeded: 'குறிச்சொல்லுக்கு ஒரு பெயர் கொடுங்கள்.',
  },
  privacy: {
    deleteRow: 'என் தரவை நீக்கு',
    deleteRowHint: 'உங்கள் கணக்கையும் தனிப்பட்ட விவரங்களையும் நீக்கு',
    deleteTitle: 'என் தரவை நீக்கு',
    deleteIntro:
      'இதை மீட்டெடுக்க முடியாது. என்ன நீக்கப்படும், என்ன நீக்கப்படாது என்பதைப் படியுங்கள் — இரண்டாவது பகுதிதான் பலரை ஆச்சரியப்படுத்துகிறது.',
    deleteGoesTitle: 'என்ன நீக்கப்படும்',
    deleteGoesBody:
      'உங்கள் பெயர், படம், பணமுகவரி, நாடு, மொழி, அறிவிப்பு அமைப்புகள். உங்கள் உள்நுழைவு — இந்தக் கணக்கை இனி திறக்க முடியாது. உங்கள் சாதனங்கள், அறிவிப்பு வரலாறு, கொள்முதல்கள்.',
    deleteStaysTitle: 'என்ன இருக்கும், ஏன்',
    deleteStaysBody:
      'உங்கள் குழுக்களில் உள்ள செலவுகளும் தீர்வுகளும், அவற்றின் குறிப்புகள், கருத்துகள், நீங்கள் சேர்த்த படங்கள் — ரசீதுகள், பணம் கட்டிய சான்றுகள், பயணப் புகைப்படங்கள் — ஆகியவற்றுடன் இருக்கும், ஏனெனில் அவை மற்றவர்களின் பதிவுகளும் கூட — யார் யாருக்குக் கடன்பட்டவர் என்பதைச் சொல்வது அவைதான். அவற்றை நீக்கினால் யாரும் கட்டாத கடன் தானாகத் தீர்ந்துவிடும். நீங்கள் பெயரில்லாத முன்னாள் உறுப்பினராகிவிடுவீர்கள்.',
    deleteExportFirst: 'முதலில் உங்கள் தரவை ஏற்றுமதி செய்யுங்கள்',
    deleteWhyLabel: 'ஏன் விலகுகிறீர்கள்? (விருப்பம்)',
    deleteWhyPlaceholder: 'தெரிந்தால் உதவும்; கணக்கு போன பிறகும் இது வைக்கப்படும்',
    deleteConfirmLabel: 'உறுதிப்படுத்த DELETE என தட்டச்சு செய்யுங்கள்',
    deleteConfirmWord: 'DELETE',
    deleteButton: 'என் தரவை நீக்கு',
    deleteWorking: 'நீக்கப்படுகிறது…',
    deleteDone: 'உங்கள் தரவு நீக்கப்பட்டது.',
    deleteSummary: {
      one: 'நீங்கள் இப்போது {n} குழுவின் முன்னாள் உறுப்பினர்.',
      other: 'நீங்கள் இப்போது {n} குழுக்களின் முன்னாள் உறுப்பினர்.',
    },
    previewGroups: {
      one: 'நீங்கள் {n} குழுவில் உள்ளீர்கள்.',
      other: 'நீங்கள் {n} குழுக்களில் உள்ளீர்கள்.',
    },
    previewExpenses: {
      one: 'நீங்கள் சேர்த்த {n} செலவு இருக்கும்.',
      other: 'நீங்கள் சேர்த்த {n} செலவுகள் இருக்கும்.',
    },
    previewSettlements: {
      one: '{n} தீர்வில் உங்கள் பெயர் உள்ளது.',
      other: '{n} தீர்வுகளில் உங்கள் பெயர் உள்ளது.',
    },
    previewOutstanding: '{list} இல் இன்னும் தீராத நிலுவை உள்ளது.',
    row: 'தனியுரிமை',
    rowHint: 'என்ன சேமிக்கப்படுகிறது, எப்படி பாதுகாக்கப்படுகிறது',
    title: 'தனியுரிமை',
    intro:
      'Waves வேலை செய்ய எவ்வளவு தேவையோ அவ்வளவு மட்டுமே உங்களைப் பற்றி வைத்திருக்கிறது. அது என்ன என்பது இங்கே.',
    controlsSection: 'உங்கள் கட்டுப்பாடுகள்',
    expandLabel: 'மேலும் படிக்க',
    collapseLabel: 'சுருக்கு',
    supportRow: 'தனியுரிமைக் கேள்விகள்',
    supportRowHint: 'எங்களுக்கு எழுதுங்கள் — ஒரு நபர் பதிலளிப்பார்',
    lastUpdated: 'கடைசியாகப் புதுப்பிக்கப்பட்டது {date}.',
    storeTitle: 'என்ன சேமிக்கப்படுகிறது',
    storeSummary:
      'உங்கள் சுயவிவரம், குழுக்கள், செலவுகள், ரசீதுகள், கருத்துகள், அமைப்புகள், யார் யாருக்குக் கடன்.',
    storeBody:
      'உங்கள் பெயர், நீங்கள் பயன்படுத்திய தொலைபேசி எண், மின்னஞ்சல் அல்லது உள்நுழைவு அடையாளம். விருப்பப்படி ஒரு பணப் பரிமாற்ற முகவரி, ஒரு நாடு, மற்றும் நீங்கள் சேர்த்தால் ஒரு அஞ்சல் முகவரி. நீங்கள் இருக்கும் குழுக்கள், அவற்றின் செலவுகள், யார் யாருக்குக் கடன்பட்டவர். வேறு எதுவும் இல்லை: தொடர்புகள் பதிவேற்றப்படுவதில்லை, விளம்பர அடையாளம் இல்லை.',
    protectTitle: 'எப்படி பாதுகாக்கப்படுகிறது',
    protectSummary:
      'ஒவ்வொரு வாசிப்பிலும் தரவுத்தள விதிகள், தனிப்பட்ட ரசீது இணைப்புகள், சுத்தம் செய்யப்பட்ட பிழை அறிக்கைகள்.',
    protectBody:
      'ஒவ்வொரு அட்டவணையும் தரவுத்தளத்தின் வரிசை-நிலைப் பாதுகாப்புக்குப் பின்னால் உள்ளது; எனவே ஒரு கோரிக்கை உங்கள் கணக்குக்கு உரிமையுள்ள வரிசைகளை மட்டுமே படிக்க முடியும் — இது பக்கம் செய்யும் வடிகட்டல் அல்ல, தரவுத்தளமே நடைமுறைப்படுத்தும் விதி. இந்தப் பக்கம் கொண்டு செல்லும் திறவுகோல், உள்நுழைந்த உங்கள் அமர்வால் ஏற்கெனவே செய்ய முடியாத எதையும் செய்ய முடியாது. ரசீது படங்கள் குறுகிய கால கையொப்ப இணைப்புகள் வழியாக மட்டும் அடையக்கூடிய தனிப்பட்ட இடத்தில் இருக்கின்றன. செயலிழப்பு அறிக்கைகள் உலாவியை விட்டு வெளியேறும் முன் முகவரிகள், தொலைபேசி எண்கள், கட்டண முகவரிகள், திறவுகோல்கள் நீக்கப்படுகின்றன; இங்கே உங்கள் திரை பதிவு செய்யப்படுவதில்லை. ஒவ்வொரு ரசீதும் குழுவில் உள்ள அனைவருக்கும், அல்லது அந்தச் செலவில் உள்ளவர்களுக்கு மட்டும் தெரியலாம் — படத்துக்குப் படம் நீங்களே முடிவு செய்கிறீர்கள்.',
    servicesTitle: 'உங்கள் தரவை வேறு யார் தொடுகிறார்கள்',
    servicesSummary:
      'தரவுத்தளத்துக்கு Supabase, செயலிழப்புகளுக்கு Sentry. பகுப்பாய்வு குறியீடு இல்லை, எதுவும் விற்கப்படுவதில்லை.',
    servicesBody:
      'Waves, Supabase மீது இயங்குகிறது — தரவுத்தளமும் உள்நுழைவும், நாங்கள் கட்டுப்படுத்தும் சேவையகங்களில். செயலிழப்பு அறிக்கைகள் Sentry-க்குச் செல்கின்றன, உங்கள் விவரங்கள் பக்கத்தை விட்டு வெளியேறும் முன் நீக்கப்பட்ட பிறகு. இந்தத் தளத்தில் பகுப்பாய்வு குறியீடு எதுவும் இல்லை: திரைப் பதிவு இல்லை, விளம்பர அடையாளம் இல்லை, விளம்பர வலையமைப்புகள் இல்லை. உங்கள் தரவு ஒருபோதும் விற்கப்படுவதில்லை.',
    retentionTitle: 'எவ்வளவு காலம் வைத்திருக்கிறோம்',
    retentionSummary:
      'கணக்கு திறந்திருக்கும் வரை; 3 ஆண்டுகள் தொடாவிட்டால் நீக்கப்படும். பகிர்ந்த பதிவுகள் உங்கள் பெயர் இல்லாமல் தொடரும்.',
    retentionBody:
      'உங்கள் கணக்கு திறந்திருக்கும் வரை தரவு இருக்கும். கணக்கு 3 ஆண்டுகள் தொடப்படாமல் இருந்தால், அதை அதிலுள்ள தனிப்பட்ட தரவுடன் நீக்குகிறோம். அதற்காகக் காத்திருக்க வேண்டாம் — அமைப்புகளில் எப்போது வேண்டுமானாலும் எல்லாவற்றையும் ஏற்றுமதி செய்யலாம் அல்லது நீக்கலாம். நீங்கள் மூடி, ஒன்றரை ஆண்டுகளாகத் தொடாமல் விட்ட குழு தானாகவே உங்கள் காப்பகத்திற்கு நகர்த்தப்படுகிறது — எதுவும் நீக்கப்படாது, எப்போது வேண்டுமானாலும் மீண்டும் திறக்கலாம். கணக்கை நீக்கிய பிறகும் நீங்கள் விட்டுச் செல்வதில் சில தொடரும்; நீக்கும் முன் அதைத் தெரிந்து கொள்ளுங்கள். பகிர்ந்த குழுவில் நீங்கள் சேர்த்தவை — செலவுகள், தீர்வுகள், அவற்றின் குறிப்புகளும் கருத்துகளும், நீங்கள் சேர்த்த படங்கள், அது ரசீதாக இருந்தாலும், பணம் கட்டிய சான்றாக இருந்தாலும், பயணப் புகைப்படமாக இருந்தாலும் — அப்படியே இருக்கும், ஏனெனில் அவை மற்ற உறுப்பினர்களின் பதிவும் கூட; அவற்றை நீக்கினால் யாரும் கட்டாத கடன் தீர்ந்தது போல் இன்னொருவரின் இருப்பு அமைதியாக மாறிவிடும். உங்கள் பெயர், புகைப்படம், தொடர்பு விவரங்கள், பணம் பெறும் முகவரி ஆகியவை அந்தக் குழுக்களிலிருந்து நீக்கப்படும்; அங்கே நீங்கள் பெயரில்லாத முன்னாள் உறுப்பினராகிவிடுவீர்கள். ஆனால் ஏற்கெனவே மற்றவர்களுக்குச் சென்ற அறிவிப்புகளிலும் செயல்பதிவிலும் அப்போது இருந்த உங்கள் பெயர் இருக்கக்கூடும். ஏன் வெளியேறுகிறீர்கள் என்ற கேள்விக்கு நீங்கள் பதில் எழுதினால், அது நீங்கள் எழுதியபடியே, உங்களுடனான தொடர்பு நீக்கப்பட்டு, வைக்கப்படும். விளம்பரத்திற்காக எதுவும் வைக்கப்படுவதில்லை; சட்டம் கட்டாயப்படுத்துவதால் எதுவும் வைக்கப்படுவதில்லை.',
    choicesTitle: 'நீங்கள் என்ன செய்யலாம்',
    choicesSummary:
      'எல்லாவற்றையும் ஏற்றுமதி செய்யுங்கள், அறிவிப்புகளை நிறுத்துங்கள், கணக்கை நீக்குங்கள்.',
    choicesBody:
      'நீங்கள் உள்ளிட்ட அனைத்தையும் எப்போது வேண்டுமானாலும், முழுமையாக, இலவசமாக ஏற்றுமதி செய்யலாம். எந்த அறிவிப்பையும் நிறுத்தலாம். உங்கள் கணக்கையும் அதிலுள்ள தனிப்பட்ட தரவையும் நீக்கலாம். ஏற்றுமதியும் நீக்கமும் அமைப்புகளில் உள்ளன; வெளியேறும் வழியிலும் ஏற்றுமதி மீண்டும் வழங்கப்படும்.',
  },
  devices: {
    title: 'சாதனங்கள்',
    row: 'சாதனங்கள்',
    rowHint: 'எங்கு உள்நுழைந்துள்ளீர்கள் என்பதைப் பார்க்கவும்',
    intro:
      'இந்தக் கணக்கில் உள்நுழைந்துள்ள தொலைபேசிகள். உலாவி ஒரு சாதனமாகப் பதிவு செய்யப்படுவதில்லை, எனவே இது பட்டியலில் இல்லை.',
    signedOut: 'வெளியேற்றப்பட்டது',
    lastActive: 'கடைசியாகச் செயலில் {when}',
    signOutAll: 'மற்ற எல்லா இடங்களிலும் வெளியேறு',
    signOutAllHint:
      'ஒவ்வொரு தொலைபேசியிலும், மற்ற ஒவ்வொரு உலாவியிலும் வெளியேற்றும். இந்தத் தாவல் உள்நுழைந்தே இருக்கும்.',
    signedOutAll: {
      one: '{n} சாதனத்தில் வெளியேற்றப்பட்டது.',
      other: '{n} சாதனங்களில் வெளியேற்றப்பட்டது.',
    },
    none: 'இந்தக் கணக்கில் எந்தத் தொலைபேசியும் உள்நுழையவில்லை.',
    historyNote: 'கடந்த மூன்று மாதங்கள் காட்டப்படுகின்றன.',
    couldNotSignOut: 'மற்ற சாதனங்களை வெளியேற்ற முடியவில்லை. மீண்டும் முயற்சிக்கவும்.',
  },
  discovery: {
    discoveryRow: 'மற்றவர்கள் உங்களை எப்படிக் கண்டறிவார்கள்',
    discoveryRowHint: 'உங்களைத் தேடுவது, குழுவினர் பார்ப்பது',
    discoveryTitle: 'மற்றவர்கள் உங்களை எப்படிக் கண்டறிவார்கள்',
    discoveryIntro:
      'உங்கள் எண்ணையோ முகவரியையோ ஏற்கனவே வைத்திருப்பவர் உங்களை Waves-இல் தேட முடியும். யாரும் உங்களைத் தேடி உலவ முடியாது; பெயரால் தேடுவது என்பது ஒருபோதும் இல்லை.',
    findTitle: 'ஒருவரைத் தேடுங்கள்',
    discoveryPhone: 'என் தொலைபேசி எண்ணால் என்னைக் கண்டறியலாம்',
    discoveryPhoneHint:
      'சரியான பொருத்தம் மட்டுமே. இதை அணைத்தால், நீங்கள் ஏற்கனவே இருக்கும் குழுக்களிலிருந்து நீக்கப்பட மாட்டீர்கள்.',
    discoveryEmail: 'என் மின்னஞ்சல் முகவரியால் என்னைக் கண்டறியலாம்',
    discoveryEmailHint: 'சரியான பொருத்தம் மட்டுமே, இந்தக் கணக்கின் முகவரி மட்டுமே.',
    discoveryFootnote:
      'உங்கள் எண்ணைத் தட்டச்சு செய்து உங்களைக் கண்டறிந்தவர் அந்த எண்ணைப் பார்ப்பார் — அது ஏற்கனவே அவரிடம் இருந்தது. இவை எதுவும் யார் யாருக்குக் கடன் என்பதை மாற்றாது.',
    visibilityTitle: 'உங்கள் குழுக்கள் பார்ப்பது',
    visibilityGroups: 'என் குழுக்களில் உள்ளவர்கள் என் எண்ணையும் மின்னஞ்சலையும் பார்க்கலாம்',
    visibilityNobody: 'யாரும் பார்க்க முடியாது',
    saved: 'சேமிக்கப்பட்டது',
  },
  promo: {
    row: 'குறியீட்டைப் பயன்படுத்து',
    rowHint: 'யாராவது உங்களுக்குக் கொடுத்திருந்தால்',
    title: 'குறியீட்டைப் பயன்படுத்து',
    intro:
      'குறியீடுகள் கையால் வழங்கப்படுகின்றன — உதவிக்காக, நன்றி சொல்ல, அல்லது ஒரு முறை சோதித்துப் பார்க்க.',
    placeholder: 'WAVES2026',
    redeem: 'பயன்படுத்து',
    granted: 'முடிந்தது',
    grantedBody:
      '{until} வரை Plus இயங்கும். எதுவும் வசூலிக்கப்படவில்லை, தானாகப் புதுப்பிக்கவும் ஆகாது.',
    unknownCode: 'அப்படி ஒரு குறியீடு இல்லை. எழுத்துகளையும் எண்களையும் சரிபாருங்கள்.',
    expired: 'அந்தக் குறியீட்டின் காலம் முடிந்துவிட்டது.',
    exhausted: 'அனுமதிக்கப்பட்ட அளவுக்கு அந்தக் குறியீடு ஏற்கனவே பயன்படுத்தப்பட்டுவிட்டது.',
    alreadyRedeemed: 'அதை நீங்கள் ஏற்கனவே பயன்படுத்திவிட்டீர்கள்.',
    couldNotRedeem: 'இப்போது குறியீட்டைச் சரிபார்க்க முடியவில்லை. சிறிது நேரம் கழித்து முயலுங்கள்.',
  },
  feedback: {
    row: 'கருத்து அனுப்பு',
    rowHint: 'என்ன தவறு, அல்லது என்ன இல்லை என்று ச்சோல்லுங்கள்',
    title: 'கருத்து அனுப்பு',
    hint: 'ஒரு நபரால் படிக்கப்படும். எவ்வளவு வேண்டுமானாலும் எழுதலாம் — குறிப்பிட்டதாக இருந்தால் அதிகம் உதவும்.',
    placeholder: 'என்ன நடந்தது, அல்லது என்ன இருக்க வேண்டும் என நினைக்கிறீர்கள்',
    send: 'அனுப்பு',
    thanks: 'நன்றி — கிடைத்துவிட்டது.',
    thanksBody:
      'ஒவ்வொன்றையும் ஒரு நபர் படிக்கிறார். எப்போதும் பதில் தர முடியாது, ஆனால் எதுவும் தொலைந்து போகாது.',
    another: 'இன்னொன்று அனுப்பு',
    rating: 'Waves இதுவரை எப்படி இருக்கிறது?',
    ratingHint: 'விருப்பம்',
    starLabel: { one: '{n} நட்சத்திரம்', other: '{n} நட்சத்திரங்கள்' },
    starClearHint: 'மதிப்பீட்டை அழிக்க மீண்டும் தேர்ந்தெடுக்கவும்',
    attachNote:
      'நீங்கள் பார்ததை மீண்டும் உருவாக்க, இணைய ஆப்பின் பதிப்பு உடன் வரும். வேறு எதுவும் இல்லை.',
    kindGeneral: 'பொது',
    kindBug: 'ஏதோ வேலை செய்யவில்லை',
    kindIdea: 'ஒரு யோசனை',
    couldNotSend: 'அதை இப்போது அனுப்ப முடியவில்லை. கொஞ்சம் கழித்து மீண்டும் முயற்சிக்கவும்.',
  },
  licenses: {
    row: 'திறந்த மூல உரிமங்கள்',
    title: 'திறந்த மூலம்',
    intro:
      'Waves திறந்த மூல மென்பொருளால் கட்டப்பட்டது. இவற்றை உருவாக்கிப் பராமரிப்பவர்களுக்கு நன்றி.',
    note: 'ஒவ்வொன்றும் அதன் சொந்த உரிமத்தின் கீழ், மாற்றமின்றிப் பயன்படுத்தப்படுகிறது.',
  },
  addPerson: {
    title: 'ஒருவரைச் சேர்',
    subtitle:
      'யார் உங்களுக்குத் தர வேண்டும் என்பதைக் கண்காணி — அவருக்கு ஆப் தேவையில்லை, குழுவும் தேவையில்லை.',
    nameLabel: 'அவரது பெயர்',
    namePlaceholder: 'எ.கா. அலெக்ஸ்',
    amountLabel: 'தொகை',
    directionQuestion: 'எந்தப் பக்கம்?',
    theyOweMe: 'அவர் எனக்குத் தர வேண்டும்',
    iOweThem: 'நான் அவருக்குத் தர வேண்டும்',
    noteLabel: 'குறிப்பு (விருப்பம்)',
    notePlaceholder: 'எதற்காக?',
    save: 'பதிவு செய்',
    couldNotRecord: 'இதைப் பதிவு செய்ய முடியவில்லை. மீண்டும் முயற்சிக்கவும்.',
    row: 'ஒருவரைச் சேர்',
    rowHint: 'Waves பயன்படுத்தாத ஒருவர்',
    halfDone:
      'குழு உருவாக்கப்பட்டது, ஆனால் தொகை பதிவாகவில்லை. குழுவைத் திறந்து தொகையைச் சேர்க்கவும்.',
    openGroup: 'குழுவைத் திற',
  },
  mergePeople: {
    entry: 'நபர்களை இணை',
    title: 'நபர்களை இணை',
    subtitle:
      'ஒரே நபராக இருக்கும் விருந்தினர்களைத் தேர்ந்தெடுக்கவும். அவர்களின் இருப்புகள் ஒரே பெயரின் கீழ் இணைக்கப்படும்.',
    empty: 'இணைக்க விருந்தினர்கள் இல்லை — Waves கணக்கு இல்லாதவர்களை மட்டுமே இணைக்க முடியும்.',
    nameLabel: 'இணைந்த நபருக்கான பெயர்',
    namePlaceholder: 'எ.கா. அலெக்ஸ்',
    hasContact: 'உங்களிடம் அவர்களின் தொடர்பு விவரங்கள் உள்ளன',
    warningTitle: 'இதை மீட்டெடுக்க முடியாது',
    warningBody:
      'அவர்களின் தனித்தனி இருப்புகள் நிரந்தரமாக ஒரே நபராக இணைக்கப்படும். மீண்டும் பிரிக்க வழி இல்லை.',
    cta: 'இணை',
    selected: {
      one: '{n} நபர் தேர்ந்தெடுக்கப்பட்டார்',
      other: '{n} நபர்கள் தேர்ந்தெடுக்கப்பட்டனர்',
    },
    errorTooFew: 'இணைக்க குறைந்தது இரண்டு நபர்களைத் தேர்ந்தெடுக்கவும்.',
    errorNotMergeable: 'நீங்கள் பகிரும் குழுவில் உள்ள விருந்தினர்களை மட்டுமே இணைக்க முடியும்.',
    errorNameRequired: 'இணைந்த நபருக்கு ஒரு பெயரைக் கொடுக்கவும்.',
    errorNotSignedIn: 'நீங்கள் வெளியேறிவிட்டீர்கள். உள்நுழைந்து மீண்டும் இணைக்க முயற்சிக்கவும்.',
    errorGeneric: 'இணைக்க முடியவில்லை. மீண்டும் முயற்சிக்கவும்.',
    inGroups: { one: '{n} குழுவில்', other: '{n} குழுக்களில்' },
  },
  a11y: {
    skipToContent: 'உள்ளடக்கத்திற்குச் செல்',
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
    continueWithApple: 'Apple மூலம் தொடரவும்',
    doorWelcome: 'Waves-க்கு வருக',
    doorSub: 'உள்நுழைந்து உங்கள் குழுக்கள் நின்ற இடத்திலிருந்து தொடருங்கள்.',
    emailLabel: 'மின்னஞ்சல்',
    passwordLabel: 'கடவுச்சொல்',
    showPassword: 'கடவுச்சொல்லைக் காட்டு',
    hidePassword: 'கடவுச்சொல்லை மறை',
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
    youLent: 'நீங்கள் கொடுத்தது',
    youBorrowed: 'நீங்கள் வாங்கியது',
    notInvolved: 'சம்பந்தம் இல்லை',
    paidBy: 'கொடுத்தவர்',
    splitLabel: 'பங்கீடு',
    total: 'மொத்தம்',
    history: 'வரலாறு',
    createdByName: '{name} இதைச் சேர்த்தார்',
    editedByName: '{name} இதைத் திருத்தினார்',
    noChanges: 'கண்காணிக்கப்படும் எந்தப் புலமும் மாறவில்லை',
    audit: {
      yourShare: 'உங்கள் நிலுவை',
      amount: 'தொகை',
      description: 'விவரம்',
      category: 'வகை',
      split: 'பிரிப்பு',
      date: 'தேதி',
      location: 'இடம்',
      payers: 'செலுத்தியவர்',
      participants: 'பிரித்தவர்கள்',
      none: 'இல்லை',
    },
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
    dispute: 'இது வரவில்லை',
    disputing: 'குறிக்கிறது…',
    disputeConfirm: 'இந்தப் பணம் உங்களுக்கு வரவில்லை எனச் சொல்லவா?',
    withdraw: 'திரும்பப் பெறு',
    withdrawing: 'திரும்பப் பெறுகிறது…',
    withdrawConfirm: 'இந்தக் கொடுப்பனவைத் திரும்பப் பெறவா?',
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
    changedElsewhere:
      'இந்தப் பக்கம் திறந்திருந்தபோது வேறு ஒருவர் இந்தக் குழுவை மாற்றியுள்ளார். அவர்களின் பதிப்பு மேலே உள்ளது — பார்த்துவிட்டு மீண்டும் சேமிக்கவும்.',
    danger: 'கவனம்',
  },
  theme: {
    label: 'தோற்றம்',
    system: 'சாதனம்',
    light: 'வெளிச்சம்',
    dark: 'இருள்',
    lightHint: 'வெளிர் லாவெண்டர் திரை.',
    darkHint: 'இரவில் கண்களுக்கு எளிது.',
    currently: 'தற்போது {scheme}',
    systemHint: 'இந்தச் சாதனம் எதற்கு அமைக்கப்பட்டுள்ளதோ அதையே பின்பற்றும்.',
    footnote: 'உங்கள் ஃபோனைப் பின்பற்றினால், ஃபோன் இருளும்போது ஆப்பும் இருளும்.',
  },
  comments: {
    title: 'கருத்துகள்',
    emptyTitle: 'இன்னும் கருத்துகள் இல்லை',
    empty: 'உரையாடலைத் தொடங்குங்கள்.',
    placeholder: 'ஒரு கருத்தைச் சேர்…',
    post: 'கருத்தை இடு',
    posting: 'இடப்படுகிறது…',
    edit: 'திருத்து',
    save: 'சேமி',
    cancel: 'ரத்து',
    delete: 'நீக்கு',
    deleteConfirm: 'இந்தக் கருத்தை நீக்கவா?',
    edited: 'திருத்தப்பட்டது',
    report: 'புகார்',
    reported: 'புகார் அளிக்கப்பட்டது',
    resolve: 'தீர்',
    you: 'நீங்கள்',
    remaining: '{count} மீதம்',
  },
  imageAudit: {
    receiptAdded: 'ரசீதை {name} சேர்த்தார்',
    receiptRemoved: 'ரசீதை {name} அகற்றினார்',
    attachmentAdded: 'இணைப்பை {name} சேர்த்தார்',
    attachmentRemoved: 'இணைப்பை {name} அகற்றினார்',
    partyOnly: 'தனிப்பட்டது',
  },
  receipt: {
    title: 'ரசீது',
    theBill: 'பில்',
    attachment: 'இணைப்பு',
    partyOnly: 'இந்த பில்லில் உள்ளவர்களுக்கு மட்டும்',
    missing: 'இந்தப் படம் இப்போது இல்லை',
    notAvailableHere: 'உலாவியில் இன்னும் பார்க்க முடியாது',
    openOriginal: 'மூலப் படத்தைத் திற',
    openShared: 'பகிர்ந்த நகலைத் திற',
    close: 'மூடு',
  },
  settings: {
    title: 'அமைப்புகள்',
    profile: 'நீங்கள்',
    displayName: 'பெயர்',
    currency: 'இயல்பு நாணயம்',
    country: 'நாடு',
    paymentHandle: 'பணம் பெறும் முகவரி',
    paymentHandleBody: 'உங்களுக்குப் பணம் தருபவர்களுக்குக் காட்டப்படும், கேட்காமல் அனுப்ப.',
    paymentRail: 'எதன் மூலம் பணம்',
    save: 'சேமி',
    saved: 'சேமிக்கப்பட்டது',
    notifications: 'எதைப் பற்றி சொல்ல வேண்டும்',
    notifyInvolvesMe: 'என்னைச் சார்ந்தவை மட்டும்',
    notifyDigest: 'குழு நடவடிக்கைகளின் தினசரி சுருக்கம்',
    notifySettlements: 'யாரோ பணம் தந்தால், அல்லது உறுதிப்படுத்தச் சொன்னால்',
    notifyNudges: 'யாரோ அனுப்பும் நினைவூட்டல்கள்',
    notifyWeekly: 'வாராந்திர மின்னஞ்சல்',
    notifyEmail: 'மின்னஞ்சல் அனுப்பவும்',
    language: 'மொழி',
    languageBody: 'இதை மாற்றினால் பக்கம் மீண்டும் ஏற்றப்படும்.',
    guestTitle: 'நீங்கள் விருந்தினர்',
    guestBody: 'மற்றொரு சாதனத்தில் திறக்க மின்னஞ்சலைச் சேர்க்கவும்.',
    signOut: 'வெளியேறு',
    onlyInApp: 'செயலியில்',
    onlyInAppBody:
      'ரசீது ஸ்கேன், குரலில் செலவு, இணையம் இல்லாமல் பதிவு, தனிப்பட்ட கணக்கு — இவை போன் செயலியில்.',
    sectionAccount: 'கணக்கு',
    sectionPreferences: 'விருப்பங்கள்',
    sectionData: 'தரவு & தனியுரிமை',
    sectionSecurity: 'பாதுகாப்பு',
    sectionHelp: 'உதவி',
    languageFootnote:
      'உங்கள் ஃபோனின் மொழியே இயல்புநிலை; இங்கே தேர்ந்தெடுப்பது Waves-ஐ மட்டுமே மாற்றும். தொகைகளும் தேதிகளும் நீங்கள் இருக்கும் இடத்தையே பின்பற்றும் — துபாயில் இந்தியில் படிப்பது உங்களை இந்தியாவுக்கு நகர்த்தாது.',
  },
  categories: {
    food: 'உணவு',
    groceries: 'மளிகை',
    travel: 'பயணம்',
    stay: 'தங்குமிடம்',
    shopping: 'ஷாப்பிங்',
    entertainment: 'பொழுதுபோக்கு',
    home: 'வீடு & பில்',
    health: 'உடல்நலம்',
    gifts: 'பரிசு',
    other: 'மற்றவை',
  },
  person: {
    acrossGroups: 'நீங்கள் பகிரும் குழுக்களில்',
    notFound: 'அப்படி ஒருவர் இங்கு இல்லை',
    notFoundBody: 'அவர் இந்தக் குழுவை விட்டு விலகியிருக்கலாம், அல்லது இணைப்பு தவறானது.',
    you: 'நீங்கள்',
    admin: 'நிர்வாகி',
    notJoinedYet: 'இன்னும் சேரவில்லை',
    left: 'குழுவை விட்டு விலகினார்',
    onCount: { one: '{n} பில்லில்', other: '{n} பில்களில்' },
    noneHere: '{name} இன்னும் எந்தப் பில்லிலும் இல்லை.',
    squareWith: 'நீங்கள் இருவரும் சரியாக இருக்கிறீர்கள்.',
    findRow: 'ஒருவரைத் தேடுங்கள்',
    findRowHint: 'அவரது சரியான மின்னஞ்சல் முகவரி அல்லது தொலைபேசி எண் மூலம்',
    findTitle: 'ஒருவரைத் தேடுங்கள்',
    findHint:
      'அவர் Waves-இல் பயன்படுத்தும் மின்னஞ்சல் முகவரியையோ தொலைபேசி எண்ணையோ அப்படியே தட்டச்சு செய்யுங்கள்.',
    findPlaceholder: 'மின்னஞ்சல் அல்லது தொலைபேசி',
    findAction: 'தேடு',
    findNoMatch: 'பொருத்தம் இல்லை',
    findNoMatchBody:
      'அதை யாரும் பயன்படுத்தவில்லை, அல்லது அதன் மூலம் கண்டறியப்படுவதை அவர் விரும்பவில்லை.',
    findRateLimited: 'இன்றைக்கு இவ்வளவு தேடல் போதும். நாளை மீண்டும் முயற்சியுங்கள்.',
    alreadyShared: 'ஏற்கனவே உங்களுடன் ஒரு குழுவில் இருக்கிறார்',
    notSharedYet: 'அவருடன் நீங்கள் இதுவரை எதையும் பகிர்ந்து கொள்ளவில்லை.',
    startGroup: 'ஒரு குழுவைத் தொடங்குங்கள்',
  },
  exportData: {
    title: 'ஏற்றுமதி',
    body: 'இந்தக் குழுவின் அனைத்தும் ஒரு கோப்பாக — வைத்துக்கொள்ளவும் அல்லது விரிதாளில் திறக்கவும்.',
    csv: 'CSV பதிவிறக்கு',
    json: 'JSON பதிவிறக்கு',
    working: 'கோப்பு தயாராகிறது…',
    row: 'தரவை ஏற்றுமதி செய்',
    rowHint: 'JSON + CSV, முழுமையானது, இலவசம்',
    accountTitle: 'உங்கள் தரவை ஏற்றுமதி செய்',
    everythingFree: 'எல்லாமே, எப்போதும் இலவசம்',
    explain:
      'JSON இல் ஒவ்வொரு செலவின் ஒவ்வொரு பதிப்பும், யார் கொடுத்தார்கள், யார் தர வேண்டும், தீர்வுகளும் அவற்றின் செலவு வாரியான பங்கீடும், செயல்பாட்டுப் பதிவும் இருக்கும் — உங்கள் கணக்கை அப்படியே மீண்டும் கட்ட இது போதும். CSV என்பது விரிதாள் பார்வை, ஆள் வாரியான தீர்வு விவரங்களுடன்.',
    format: 'வடிவம்',
    formatJson: 'JSON (முழுமையானது)',
    formatCsv: 'CSV (விரிதாள்)',
    formatPdf: 'PDF (அச்சிடக்கூடியது)',
    whatToExport: 'எதை ஏற்றுமதி செய்ய',
    allMyGroups: 'என் குழுக்கள் அனைத்தும்',
    preparing: 'தயாராகிறது…',
    action: 'ஏற்றுமதி',
    ready: 'ஏற்றுமதி தயார்',
    failed: 'உங்கள் தரவை ஏற்றுமதி செய்ய முடியவில்லை. மீண்டும் முயற்சிக்கவும்.',
  },
  developers: {
    title: 'உருவாக்குநர்கள்',
    intro:
      'உங்கள் Waves தரவின் மீது கட்டமையுங்கள்: உங்கள் சொந்த ஸ்கிரிப்ட்டுக்கு ஒரு டோக்கன், அல்லது மற்றவர்கள் தங்கள் கணக்குகளுடன் இணைக்கக்கூடிய ஒரு செயலி.',
    notConfigured: 'இந்த நிறுவலில் டெவலப்பர் API அமைக்கப்படவில்லை.',
    notConfiguredBody:
      'NEXT_PUBLIC_WAVES_API_URL-ஐ Waves API முகவரிக்கு அமைத்து, இந்தப் பக்கத்தை மீண்டும் ஏற்றவும்.',
    copy: 'நகலெடு',
    copied: 'நகலெடுக்கப்பட்டது',
    copyFailed: 'கையால் நகலெடுக்கவும் — உலாவி இந்தப் பக்கத்தை அதைச் செய்ய அனுமதிக்கவில்லை.',
    permissions: 'அனுமதிகள்',
    signInAgain:
      'உங்கள் Waves அமர்வு காலாவதியாகிவிட்டது. மீண்டும் உள்நுழைந்து, இந்த இணைப்பை மறுபடியும் திறக்கவும்.',
    tokens: {
      title: 'தனிப்பட்ட அணுகல் டோக்கன்கள்',
      body: 'ஒரு டோக்கன் உங்களைப் போலவே செயல்படும், நீங்கள் தேர்ந்தெடுத்த அனுமதிகளுக்கு மட்டும். அதைக் கடவுச்சொல்லாகக் கருதி, வெளியிடும் எதிலும் சேர்க்க வேண்டாம்.',
      empty: 'நீங்கள் இன்னும் எந்த டோக்கனையும் உருவாக்கவில்லை.',
      name: 'இது எதற்காக?',
      namePlaceholder: 'என் காப்புப்பிரதி ஸ்கிரிப்ட்',
      expiryDays: 'எத்தனை நாட்களில் காலாவதி',
      expiryBody: 'காலாவதியாகாத டோக்கனுக்கு இதைக் காலியாக விடவும்.',
      create: 'டோக்கனை உருவாக்கு',
      creating: 'உருவாக்குகிறது…',
      revoke: 'ரத்து செய்',
      revoking: 'ரத்து செய்கிறது…',
      revokedTag: 'ரத்து செய்யப்பட்டது',
      expiredTag: 'காலாவதியானது',
      expires: '{date} அன்று காலாவதியாகும்',
      neverExpires: 'காலாவதி இல்லை',
      lastUsed: 'கடைசியாக {date} அன்று பயன்படுத்தப்பட்டது',
      neverUsed: 'பயன்படுத்தப்படவில்லை',
      createdTitle: 'உங்கள் புதிய டோக்கன்',
      onlyOnce:
        'இப்போதே நகலெடுக்கவும். இது காட்டப்படும் ஒரே தருணம் இதுதான் — Waves அதன் கைரேகையை மட்டுமே வைத்திருப்பதால் மீண்டும் காட்ட முடியாது.',
      prefix: '{prefix} என்று தொடங்குகிறது',
    },
    apps: {
      title: 'செயலிகள்',
      body: 'ஒரு செயலி மற்றவர்களிடம் அனுமதி கேட்டு அவர்களுக்காகச் செயல்படுகிறது. இணைக்கும் ஒவ்வொருவரும் நீங்கள் இங்கே தரும் பெயரையும் இணையதளத்தையும் பார்ப்பார்கள்.',
      empty: 'நீங்கள் எந்தச் செயலியையும் பதிவு செய்யவில்லை.',
      name: 'பெயர்',
      namePlaceholder: 'பயணப் பங்கீடு',
      description: 'இது என்ன செய்கிறது',
      website: 'இணையதளம்',
      redirects: 'திருப்பியனுப்பும் முகவரிகள்',
      redirectsBody:
        'ஒரு வரிக்கு ஒன்று. இங்கே பட்டியலிடப்பட்ட முகவரிக்கு மட்டுமே Waves ஒருவரைத் திருப்பி அனுப்பும்.',
      kind: 'இது எங்கே இயங்குகிறது?',
      confidential: 'ரகசியத்தைக் காக்கக்கூடிய ஒரு சேவையகத்தில்',
      publicClient: 'தொலைபேசியிலோ உலாவியிலோ, அங்கே காக்க முடியாது',
      register: 'செயலியைப் பதிவு செய்',
      registering: 'பதிவு செய்கிறது…',
      clientId: 'கிளையண்ட் ஐடி',
      rotate: 'புதிய ரகசியம்',
      rotating: 'உருவாக்குகிறது…',
      enable: 'இயக்கு',
      disable: 'முடக்கு',
      disabledTag: 'முடக்கப்பட்டது',
      delete: 'நீக்கு',
      deleteConfirm: 'நிரந்தரமாக நீக்கவா?',
      deleting: 'நீக்குகிறது…',
      secretTitle: 'உங்கள் புதிய கிளையண்ட் ரகசியம்',
      secretOnce:
        'இப்போதே நகலெடுக்கவும். இது காட்டப்படும் ஒரே தருணம் இதுதான்; புதியது ஒன்றை உருவாக்குவது யாரையும் வெளியேற்றாது — பழையது வேலை செய்வதை மட்டும் நிறுத்தும்.',
      publicNote:
        'பொதுக் கிளையண்டுக்கு ரகசியம் இல்லை. கோரிக்கை அதிலிருந்துதான் வந்தது என்பதை PKCE நிரூபிக்கிறது.',
    },
    connections: {
      title: 'இணைக்கப்பட்ட செயலிகள்',
      body: 'உங்களுக்காகச் செயல்பட நீங்கள் அனுமதித்த செயலிகள். ஒன்றைத் துண்டித்தால் அது வைத்திருக்கும் எல்லா டோக்கன்களும் ரத்தாகும்.',
      empty: 'உங்கள் கணக்குடன் எதுவும் இணைக்கப்படவில்லை.',
      connected: '{date} அன்று இணைக்கப்பட்டது',
      lastUsed: 'கடைசியாக {date} அன்று பயன்படுத்தப்பட்டது',
      neverUsed: 'இன்னும் பயன்படுத்தப்படவில்லை',
      disconnect: 'துண்டி',
      disconnecting: 'துண்டிக்கிறது…',
    },
    consent: {
      title: 'அணுகலை அனுமதி',
      wants: '{app} உங்களுக்காகச் செயல்பட விரும்புகிறது',
      by: '{owner} பதிவு செய்தது',
      website: 'இணையதளம்',
      ableTo: 'இது செய்யக்கூடியவை:',
      approve: 'அனுமதி',
      approving: 'அனுமதிக்கிறது…',
      cancel: 'ரத்து',
      refused: 'இந்தக் கோரிக்கையை Waves காட்டாது.',
      refusedBody:
        'செயலி, அது திரும்பக் கேட்ட முகவரி, அல்லது அது கேட்ட அனுமதி — இவற்றில் ஏதோ ஒன்று அதன் உருவாக்குநர் பதிவு செய்ததோடு ஒத்துப்போகவில்லை. எதுவும் பகிரப்படவில்லை; இங்கே அனுமதிக்க எதுவும் இல்லை.',
      badRequest: 'இந்த இணைப்பில் Waves-க்குத் தேவையான ஒன்று இல்லை, எனவே அனுமதிக்க எதுவும் இல்லை.',
      back: 'உருவாக்குநர்கள் பக்கத்திற்குத் திரும்பு',
    },
    scope: {
      'identity.read': 'உங்கள் பெயர், படம், இயல்பு நாணயத்தைப் பார்க்கும்.',
      'identity.write': 'உங்கள் சுயவிவரத்தை மாற்றும்.',
      'groups.read': 'உங்கள் குழுக்கள், அவற்றில் உள்ளவர்கள், யாருக்கு எவ்வளவு என்பதைப் பார்க்கும்.',
      'groups.write': 'குழுக்களை உருவாக்கும், பெயர் மாற்றும், ஆட்களைச் சேர்க்கும் அல்லது நீக்கும்.',
      'expenses.read': 'உங்கள் குழுக்களின் செலவுகளைப் பார்க்கும்.',
      'expenses.write': 'உங்கள் குழுக்களில் செலவுகளைச் சேர்க்கும், திருத்தும், நீக்கும்.',
      'settlements.read':
        'உங்களுக்கும் மற்றவர்களுக்கும் இடையே பதிவான பணப் பரிமாற்றங்களைப் பார்க்கும்.',
      'settlements.write':
        'உங்கள் சார்பாகப் பணப் பரிமாற்றங்களைப் பதிவு செய்யும், உறுதிப்படுத்தும்.',
      'friends.read':
        'எல்லாக் குழுக்களிலும் நீங்கள் யாருக்குத் தர வேண்டும், யார் உங்களுக்குத் தர வேண்டும் என்பதைப் பார்க்கும்.',
      'categories.read': 'உங்கள் செலவு வகைகளைப் பார்க்கும்.',
      'categories.write': 'உங்கள் செலவு வகைகளைச் சேர்க்கும், மாற்றும், மறைக்கும்.',
      offline_access: 'மீண்டும் கேட்காமல் இணைந்திருக்கும்.',
    },
  },
  agents: {
    signedInAs: '{email} என உள்நுழைந்துள்ளீர்கள்',
    willBeAbleTo: 'நீங்கள் ஒப்புதல் அளித்தால், இதனால் முடியும்:',
    reads: 'உங்கள் குழுக்கள், செலவுகள், இருப்புகள் மற்றும் நீங்கள் பங்கிடுபவர்களைப் படிக்க',
    writes: 'செலவுகளைச் சேர்க்க, குழுக்களை உருவாக்க, தீர்வுகளைப் பதிவு செய்ய',
    asYou:
      'இது உங்களாகவே செயல்படுகிறது. நீங்கள் அணுகக்கூடியதை மட்டுமே அணுக முடியும், வேறு எதுவும் இல்லை.',
    neverMoves:
      'இது பணத்தை அனுப்ப முடியாது. தீர்வுகள் பதிவு செய்யப்படுகின்றன; பணம் செலுத்துவது நீங்கள் செய்வதாகவே இருக்கும்.',
    deny: 'மறு',
    denying: 'மறுக்கிறது…',
    unverified: 'இந்தப் பயன்பாட்டை Waves சரிபார்க்கவில்லை.',
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
    tryAgain: 'மீண்டும் முயலவும்',
  },
  account: {
    title: 'உங்கள் கணக்கு',
    you: 'நீங்கள்',
    yourAccount: 'உங்கள் கணக்கு',
    yourAccountHint: 'உங்கள் பெயர், நீங்கள் இருக்கும் இடம், உள்ளே வரும் வழிகள்',
    guestTitle: 'விருந்தினர் கணக்கு',
    guestBody:
      'நீங்கள் சேர்த்தவை அனைத்தும் ஏற்கனவே சேமிக்கப்பட்டு உங்களுடையவை. வேறு சாதனத்திலிருந்து அணுக விரும்பும்போது Google அல்லது Apple கணக்கை இணைக்கவும் — புதிய கணக்கு தொடங்காமல் இதே கணக்கு தொடரும்.',
    detailsTitle: 'உங்கள் விவரங்கள்',
    displayNameHint: 'நீங்கள் குழு பகிரும் அனைவரும் இதைப் பார்ப்பார்கள்.',
    countryNotSet: 'அமைக்கப்படவில்லை',
    currencyFromCountry: 'உங்கள் நாட்டிலிருந்து அமைக்கப்படுகிறது',
    addressTitle: 'முகவரி',
    addressHint: 'இதற்கு எதுவும் அனுப்பப்படாது. உங்கள் பதிவுக்காக மட்டும்.',
    addressPlaceholder: 'தெரு, நகரம், அஞ்சல் குறியீடு',
    signInMethodsTitle: 'உள்நுழையும் வழிகள்',
    signInMethodsBody:
      'ஒரு கணக்கை இணைத்தால், அடுத்த முறை எந்தச் சாதனத்திலும் அதைக் கொண்டு உள்நுழையலாம்.',
    signInFootnote:
      'உள்ளே விடுவதற்கு Waves இதை ஒருபோதும் கேட்பதில்லை, உங்கள் குழுக்களில் உள்ள யாருடனும் இதைப் பகிர்வதும் இல்லை. நீங்கள் தேர்ந்தெடுத்த பெயரை மட்டுமே மற்றவர்கள் பார்ப்பார்கள்.',
    emailAddress: 'மின்னஞ்சல் முகவரி',
    alreadyAdded: 'ஏற்கனவே சேர்க்கப்பட்டது: {value}',
    notAddedYet: 'இன்னும் சேர்க்கப்படவில்லை',
    link: 'இணை',
    linkProvider: '{provider} ஐ இணை',
    linked: 'இணைக்கப்பட்டது',
    payingTitle: 'பணம் பெற',
    howPeoplePayYou: 'உங்களுக்கு எப்படிப் பணம் தருவது',
    settlesWith: '{rails} மூலம் தீர்க்கப்படும்',
    handleWrong: 'இது {hint} போல் தெரியவில்லை.',
    railLinkNote:
      'உங்களுடன் தீர்ப்பவர்களுக்கு ஒரே தட்டில் பணம் அனுப்ப முடியும். Waves பணத்தைக் கையாள்வதே இல்லை.',
    railManualNote:
      'உங்களுடன் தீர்ப்பவர்கள் இதைப் பார்த்து தங்கள் வங்கி ஆப்பிலிருந்து பணம் அனுப்புவார்கள். Waves பணத்தைக் கையாள்வதே இல்லை.',
    nothingToAdd: 'சேர்க்க ஒன்றுமில்லை — கொடுத்ததை மற்றவர்கள் கையால் பதிவு செய்வார்கள்.',
  },
  notifications: {
    title: 'அறிவிப்புகள்',
    rowHint: 'Waves உங்களைக் குறுக்கிடக்கூடியவை',
    neverSpam:
      'வழக்கமான செலவுச் செயல்பாடுகள் குறித்து Waves உங்களுக்கு மின்னஞ்சல் அனுப்புவதே இல்லை. உங்கள் அஞ்சல் பெட்டியில் நீங்கள் உண்மையிலேயே விரும்பும் ஆறு விஷயங்கள் மட்டுமே, ஒவ்வொன்றையும் தனித்தனியே நிறுத்தலாம்.',
    pushSection: 'அறிவிப்பு',
    pushOnWeb:
      'இந்த நான்கும் தொலைபேசி செயலி உங்களுக்கு அனுப்புவதைத் தீர்மானிக்கின்றன. உலாவி பதிவுசெய்யப்பட்ட சாதனம் அல்ல, எனவே இங்கே எதுவும் இந்தச் சாதனத்தில் ஒலிக்காது.',
    involvesMe: 'என்னைச் சார்ந்தவை மட்டும்',
    involvesMeBody:
      'நீங்கள் தர வேண்டியபோதோ, வர வேண்டியபோதோ, குறிப்பிடப்படும்போதோ அறிவிப்பு — ஒவ்வொரு குழுவின் ஒவ்வொரு செலவுக்கும் அல்ல.',
    settlementRequests: 'தீர்வு உறுதிப்படுத்தல்கள்',
    settlementRequestsBody:
      'உங்களுக்குப் பணம் கொடுத்ததாக யாராவது சொல்லும்போது, உங்கள் பாக்கி சரியாக இருக்க.',
    nudges: 'நினைவூட்டல்கள்',
    nudgesBody:
      'தர வேண்டிய பணம் குறித்த மென்மையான நினைவூட்டல். ஒரு நாளைக்கு ஒருவருக்கு ஒன்று மட்டுமே, தரவுத்தளத்திலேயே வரையறுக்கப்பட்டது.',
    digest: 'நாள்தோறும் குழுச் சுருக்கம்',
    digestBody: 'மற்ற அனைத்தும், தொடர்ச்சியாக அல்லாமல் நாளுக்கு ஒரு அறிவிப்பாகத் தொகுத்து.',
    emailSection: 'மின்னஞ்சல் வழியாக',
    emailAll: 'மின்னஞ்சல் அனுப்பவும்',
    emailAllBody:
      'தீர்வுகள், நினைவூட்டல்கள், வாராந்திரச் சுருக்கம். புதிய உள்நுழைவு பற்றிய பாதுகாப்பு எச்சரிக்கை இது எதுவாக இருந்தாலும் வரும்.',
    weeklyEmail: 'வாராந்திர மின்னஞ்சல் சுருக்கம்',
    weeklyEmailBody:
      'உங்கள் நிகர பாக்கியும் நிலுவையிலுள்ள உறுதிப்படுத்தல்களும், வாரம் ஒருமுறை. இயல்பாக நிறுத்தத்தில்.',
    footnote:
      'மின்னஞ்சல் இன்னும் வரவில்லை. இங்குள்ள அனைத்தும் உங்கள் அஞ்சல் பெட்டியிலும் இருக்கும் — அறிவிப்பு வந்ததா இல்லையா என்பதைப் பொருட்படுத்தாமல் Waves உங்களிடம் சொன்னதற்கான பதிவு அதுவே.',
  },
  billing: {
    row: 'திட்டம்',
    rowHint: 'இலவசத் திட்டம் — எல்லாம் உள்ளடக்கம், வாங்க எதுவுமில்லை',
    title: 'திட்டம்',
    nothingToBuy: 'இன்னும் வாங்க எதுவும் இல்லை',
    nothingToBuyBody:
      'இது கடை அல்ல, கதவு. பணம் தர மதிப்புள்ள ஏதாவது வரும்போது, விலையுடன் இங்கே இருக்கும் — திடீர் ஆச்சரியங்கள் இல்லை.',
    whatWouldCost: 'எப்போதாவது பணம் என்ன செலவாகும்',
    moreScans: 'அதிக ரசீது ஸ்கேன்கள்',
    moreScansBody:
      'ஒரு ரசீதைப் புகைப்படம் எடுத்தால் அதன் வரிகள் படிக்கப்படும். ஒவ்வொரு ஸ்கேனுக்கும் உண்மையான செலவு ஆகிறது — அதனால்தான் இதற்கு மட்டும் வரம்பு உள்ளது.',
    biggerTransfers: 'பெரிய ஏற்றுமதிகளும் இறக்குமதிகளும்',
    biggerTransfersBody:
      'உங்கள் தரவு உங்களுடையது, முழுமையாக இலவசமாக வெளியேறும். பெரிய வேலைகளும் திட்டமிட்ட காப்புப் பிரதிகளுமே வசதி.',
    whatNeverWill: 'எதற்கு ஒருபோதும் இல்லை',
    whatNeverWillBody:
      'கணக்கு. குழுக்கள், செலவுகள், பிரிவுகள், இருப்புகள், தீர்த்தல், அனைத்தையும் திரும்பப் பெறுதல் — {free}. பாதி மட்டுமே படிக்கக்கூடிய கணக்கு கணக்கே அல்ல.',
    freeForever: 'எப்போதும் இலவசம்',
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
    tabExpenses: 'खर्च',
    tabBalances: 'हिसाब',
    tabActivity: 'गतिविधि',
    noneYet: 'अभी यहाँ कुछ नहीं',
    noneYetBody: 'कोई पहला खर्च जोड़ेगा तो यहाँ दिखेगा।',
    whereEveryoneStands: 'किसका क्या हिसाब है',
    settledUp: 'हिसाब बराबर',
    isSettledUp: 'का हिसाब बराबर है',
    isOwed: 'को मिलने हैं',
    owes: 'को देने हैं',
    whoPaysWhom: 'कौन किसे देगा',
    whoPaysWhomNote:
      'सबका हिसाब बराबर करने वाले सबसे कम भुगतान। किसी को ऐसे व्यक्ति को पैसे देने के लिए नहीं कहा जाता जिसके साथ उसने कभी कुछ बाँटा ही नहीं।',
    youPayName: 'आप {name} को भुगतान करते हैं',
    namePaysYou: '{name} आपको भुगतान करते हैं',
    paysWhom: '{from} {to} को भुगतान करते हैं',
    yourPayments: 'आपके भुगतान',
    otherPayments: 'बाकी लोगों के बीच',
    addAnExpense: 'खर्च जोड़ें',
    installNote:
      'रसीदें स्कैन करने, UPI से निपटाने और बिना सिग्नल भी यह चलाने के लिए Waves इंस्टॉल करें।',
  },
  add: {
    title: 'खर्च जोड़ें',
    defaultDescription: 'खर्च',
    whatWasIt: 'किस चीज़ का था?',
    categoryLabel: 'किस तरह का ख़र्च',
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
  itemize: {
    title: 'चीज़-वार बाँटें',
    defaultDescription: 'चीज़-वार बिल',
    lines: 'बिल में क्या था',
    linePlaceholder: 'चीज़',
    untitledLine: 'बिना नाम की एक लाइन',
    addLine: 'लाइन जोड़ें',
    removeLine: 'यह लाइन हटाएँ',
    extras: 'टैक्स, सर्विस और टिप',
    extrasNote: 'बराबर नहीं — जिसने जितना लिया, उसी अनुपात में बाँटा जाता है।',
    taxes: 'टैक्स',
    serviceCharge: 'सर्विस',
    tip: 'टिप',
    discounts: 'छूट',
    preview: 'किसका कितना',
    startTyping: 'एक लाइन जोड़ें और बताएँ कि वह किसने ली।',
    unclaimed: 'इन पर किसी ने दावा नहीं किया: {lines}',
    cannotSplit: 'यह बिल अभी बाँटा नहीं जा सकता।',
    noMembers: 'पहले इस ग्रुप में किसी को जोड़ें।',
  },
  insights: {
    title: 'ख़र्च',
    scopeLabel: 'किसका ख़र्च',
    wholeGroup: 'सब',
    justMine: 'सिर्फ़ मेरा',
    byCategory: 'किस पर गया',
    byMonth: 'महीने दर महीने',
    totalIn: '{currency} में ख़र्च',
    tapMonth: 'दिन देखने के लिए कोई महीना खोलें।',
    nothingYet: 'अभी दिखाने को कुछ नहीं',
    nothingBody: 'एक ख़र्च जोड़ें और यह भर जाएगा।',
    nothingThisMonth: 'इस महीने कुछ नहीं',
    nothingThisMonthBody: 'इस मुद्रा में यहाँ कोई ख़र्च नहीं।',
  },
  recap: {
    title: 'ट्रिप का सार',
    titleAny: 'सार',
    subtitle: 'हिसाब कैसे बना',
    perDay: 'प्रति दिन',
    biggestBill: 'सबसे बड़ा बिल',
    mostSpentOn: 'सबसे ज़्यादा खर्च',
    paidMost: 'सबसे ज़्यादा चुकाया',
    noneYet: 'अभी सार के लिए कुछ नहीं',
  },
  places: {
    title: 'जगहें',
    empty: 'अभी कोई जगह नहीं',
    emptyBody: 'किसी खर्च में जगह जोड़ें, वह यहाँ दिखेगी.',
  },
  plan: {
    title: 'योजना',
    subtitle: 'क्या तय है, और क्या लगा',
    dayNumber: 'दिन {n}',
    planned: 'तय किया',
    spent: 'खर्च हुआ',
    over: 'ज़्यादा',
    under: 'कम',
    emptyDay: 'इस दिन अभी कुछ नहीं।',
    nothingYet: 'अभी कोई योजना नहीं',
    nothingBody: 'दिन और जो करना है वह जोड़िए। असल में जो लगा वह अपने आप भर जाएगा।',
    tripsOnly: 'योजना ट्रिप के लिए है',
    tripsOnlyBody: 'दिन-ब-दिन योजना बनाने के लिए सेटिंग्स में इस ग्रुप को ट्रिप बनाइए।',
    whatIsPlanned: 'क्या करना है?',
    add: 'जोड़ें',
    cancel: 'रद्द',
    remove: '{title} हटाएँ',
  },
  budgets: {
    title: 'बजट',
    overall: 'कुल',
    mine: 'मेरा बजट',
    amount: 'राशि',
    shareWithGroup: 'ग्रुप के साथ साझा करें',
    onlyMe: 'सिर्फ़ मैं',
    save: 'सेव',
    clear: 'हटाएँ',
    set: 'बजट तय करें',
    edit: 'बदलें',
    left: 'बचा',
    over: 'ज़्यादा',
    forecast: 'इस रफ़्तार पर',
    projectedTotal: 'अनुमानित कुल',
    onTrack: 'सही राह पर',
    fairness: 'बराबरी',
    paidShare: '{name} ने ट्रिप का {percent}% चुकाया है',
    evenlyMatched: 'सब बराबर योगदान दे रहे हैं',
    nextUp: 'अगला बिल {name} ले सकते हैं',
    someone: 'कोई',
  },
  tags: {
    title: 'टैग और श्रेणियाँ',
    subtitle: 'अपने टैग बनाएँ, और पहले से मौजूद को छिपाएँ या क्रम बदलें।',
    settingsRow: 'टैग और श्रेणियाँ',
    newTag: 'नया टैग',
    editTag: 'टैग संपादित करें',
    namePlaceholder: 'जैसे क्लाइंट डिनर',
    colourLabel: 'रंग',
    noCustomTags: 'अभी आपका कोई टैग नहीं है। अपने तरीके से खर्च बाँटने के लिए एक बनाएँ।',
    hide: 'छिपाएँ',
    show: 'दिखाएँ',
    moveUp: 'ऊपर ले जाएँ',
    moveDown: 'नीचे ले जाएँ',
    hiddenBadge: 'छिपा हुआ',
    deleteTag: 'हटाएँ',
    deleteConfirm: 'यह टैग हटाएँ? पुराने खर्च इसे रखेंगे; यह बस सूची से हटेगा।',
    save: 'टैग सहेजें',
    cancel: 'रद्द',
    nameNeeded: 'टैग को एक नाम दीजिए।',
  },
  privacy: {
    deleteRow: 'मेरा डेटा मिटाएँ',
    deleteRowHint: 'अपना खाता और निजी विवरण हटाएँ',
    deleteTitle: 'मेरा डेटा मिटाएँ',
    deleteIntro:
      'यह वापस नहीं हो सकता। पढ़िए कि क्या हटता है और क्या नहीं — दूसरा हिस्सा ही लोगों को चौंकाता है।',
    deleteGoesTitle: 'क्या हटता है',
    deleteGoesBody:
      'आपका नाम, फ़ोटो, भुगतान पता, देश, भाषा और सूचना सेटिंग्स। आपका साइन-इन, ताकि यह खाता फिर न खुले। आपके उपकरण, सूचना इतिहास और ख़रीद।',
    deleteStaysTitle: 'क्या रहता है, और क्यों',
    deleteStaysBody:
      'आपके साझा समूहों के ख़र्चे और भुगतान, उन पर लिखे नोट और टिप्पणियाँ तथा आपकी जोड़ी हुई तस्वीरें — रसीदें, भुगतान के सबूत, यात्रा की फ़ोटो — रहती हैं, क्योंकि वे दूसरों के भी रिकॉर्ड हैं — वही बताते हैं कि कौन किसका देनदार है। उन्हें हटाने से किसी और का हिसाब चुपचाप बदल जाएगा और वह कर्ज़ चुक जाएगा जो किसी ने चुकाया ही नहीं। आप उन समूहों में एक अनाम पूर्व-सदस्य बन जाते हैं।',
    deleteExportFirst: 'पहले अपना डेटा निर्यात करें',
    deleteWhyLabel: 'आप क्यों जा रहे हैं? (वैकल्पिक)',
    deleteWhyPlaceholder: 'जानना मददगार है; खाता जाने के बाद भी यह रखा जाता है',
    deleteConfirmLabel: 'पुष्टि के लिए DELETE लिखें',
    deleteConfirmWord: 'DELETE',
    deleteButton: 'मेरा डेटा मिटाएँ',
    deleteWorking: 'मिटाया जा रहा है…',
    deleteDone: 'आपका डेटा मिटा दिया गया।',
    deleteSummary: {
      one: 'अब आप {n} समूह के पूर्व-सदस्य हैं।',
      other: 'अब आप {n} समूहों के पूर्व-सदस्य हैं।',
    },
    previewGroups: { one: 'आप {n} समूह में हैं।', other: 'आप {n} समूहों में हैं।' },
    previewExpenses: {
      one: 'आपका डाला {n} ख़र्च बना रहेगा।',
      other: 'आपके डाले {n} ख़र्चे बने रहेंगे।',
    },
    previewSettlements: {
      one: '{n} भुगतान में आपका नाम है।',
      other: '{n} भुगतानों में आपका नाम है।',
    },
    previewOutstanding: '{list} में अब भी बकाया है।',
    row: 'निजता',
    rowHint: 'क्या रखा जाता है, और कैसे सुरक्षित रहता है',
    title: 'निजता',
    intro:
      'Waves आपके बारे में उतना ही रखता है जितना काम करने के लिए ज़रूरी है। वह क्या है, सीधे शब्दों में।',
    controlsSection: 'आपके नियंत्रण',
    expandLabel: 'और पढ़ें',
    collapseLabel: 'कम दिखाएँ',
    supportRow: 'निजता से जुड़े सवाल',
    supportRowHint: 'हमें लिखें — जवाब एक व्यक्ति देता है',
    lastUpdated: 'अंतिम बार {date} को अपडेट किया गया।',
    storeTitle: 'क्या रखा जाता है',
    storeSummary:
      'आपकी प्रोफ़ाइल, समूह, ख़र्च, रसीदें, टिप्पणियाँ, सेटिंग्स और कौन किसका देनदार है।',
    storeBody:
      'आपका नाम, और फ़ोन नंबर, ईमेल या साइन-इन पहचान में से जो आपने इस्तेमाल किया। वैकल्पिक रूप से एक भुगतान पता, ताकि कोई आपको लौटा सके, एक देश, और यदि आप जोड़ें तो एक डाक पता। आप जिन समूहों में हैं, उनके ख़र्चे, और कौन किसका देनदार है। और कुछ नहीं: कोई संपर्क अपलोड नहीं होते, कोई विज्ञापन पहचानकर्ता नहीं।',
    protectTitle: 'कैसे सुरक्षित रहता है',
    protectSummary: 'हर पठन पर डेटाबेस नियम, निजी रसीद लिंक, साफ़ की गई क्रैश रिपोर्ट।',
    protectBody:
      'हर टेबल डेटाबेस की रो-लेवल सुरक्षा के पीछे है, इसलिए कोई भी अनुरोध केवल वही पंक्तियाँ पढ़ सकता है जिनका हक़ आपके अपने खाते को है — यह पेज का लगाया फ़िल्टर नहीं, डेटाबेस का लागू किया नियम है. यह पेज जो कुंजी लेकर चलता है वह इससे ज़्यादा कुछ नहीं कर सकती जो आपका साइन-इन सत्र पहले से न कर सकता हो. रसीद की तस्वीरें एक निजी जगह में रहती हैं, जहाँ थोड़ी देर चलने वाले हस्ताक्षरित लिंक से ही पहुँचा जाता है. क्रैश रिपोर्ट से पते, फ़ोन नंबर, भुगतान हैंडल और कुंजियाँ ब्राउज़र छोड़ने से पहले हटा दी जाती हैं, और यहाँ आपकी स्क्रीन कहीं रिकॉर्ड नहीं होती. हर रसीद पूरे समूह को दिख सकती है, या सिर्फ़ उन लोगों को जो उस ख़र्च में हैं — हर तस्वीर के लिए आप तय करते हैं.',
    servicesTitle: 'आपका डेटा और कौन छूता है',
    servicesSummary:
      'डेटाबेस के लिए Supabase, क्रैश के लिए Sentry. कोई एनालिटिक्स टैग नहीं, कुछ भी बेचा नहीं जाता.',
    servicesBody:
      'Waves, Supabase पर चलता है — डेटाबेस और साइन-इन, उन सर्वरों पर जो हमारे नियंत्रण में हैं. क्रैश रिपोर्ट Sentry को जाती हैं, आपके ब्योरे पेज छोड़ने से पहले हटा दिए जाने के बाद. इस साइट पर कोई एनालिटिक्स टैग नहीं है: न स्क्रीन रिकॉर्डिंग, न विज्ञापन पहचानकर्ता, न विज्ञापन नेटवर्क. आपका डेटा कभी नहीं बेचा जाता.',
    retentionTitle: 'हम इसे कब तक रखते हैं',
    retentionSummary:
      'खाता खुला रहने तक; 3 साल अछूता रहा तो हटा दिया जाता है। साझा रिकॉर्ड आपके नाम के बिना बने रहते हैं।',
    retentionBody:
      'जब तक आपका खाता खुला है, आपका डेटा रहता है। अगर खाता 3 साल तक अछूता रहे, तो हम उसे और उसके निजी डेटा को हटा देते हैं। इसके लिए इंतज़ार करने की ज़रूरत नहीं — सेटिंग्स में कभी भी सब कुछ ख़ुद निर्यात या हटा सकते हैं। जिस समूह को आप बंद कर दें और डेढ़ साल तक न छूएं, वह अपने-आप आपके संग्रह में चला जाता है — कुछ भी नहीं हटता, और आप उसे कभी भी दोबारा खोल सकते हैं। खाता मिटाने के बाद भी आपकी छोड़ी हुई कुछ चीज़ें बनी रहती हैं, और मिटाने से पहले यह जान लेना चाहिए। साझा समूह में आपने जो जोड़ा — ख़र्च और भुगतान, उन पर लिखे नोट और टिप्पणियाँ, और आपकी जोड़ी हुई तस्वीरें, चाहे वह रसीद हो, भुगतान का सबूत हो या यात्रा की फ़ोटो — वह बना रहता है, क्योंकि वह बाक़ी सदस्यों का भी रिकॉर्ड है; उसे हटाने से किसी और का हिसाब चुपचाप बदल जाता, जैसे कोई क़र्ज़ बिना चुकाए चुक गया हो। आपका नाम, फ़ोटो, संपर्क विवरण और भुगतान पता उन समूहों से हटा दिए जाते हैं और वहाँ आप एक अनाम पूर्व सदस्य बन जाते हैं; लेकिन जो सूचनाएँ और गतिविधि पहले ही दूसरों तक पहुँच चुकी हैं, उनमें उस समय का आपका नाम रह सकता है। और अगर आप “क्यों जा रहे हैं” वाले बॉक्स में कुछ लिखते हैं, तो वह जवाब जैसा आपने लिखा वैसा ही रखा जाता है, आपसे उसका नाता हटाकर। विज्ञापन के लिए कुछ नहीं रखा जाता, और किसी क़ानूनी बाध्यता के कारण भी कुछ नहीं रखा जाता।',
    choicesTitle: 'आप क्या कर सकते हैं',
    choicesSummary: 'सब कुछ निर्यात करें, कोई भी सूचना बंद करें, या खाता हटाएँ।',
    choicesBody:
      'जो कुछ आपने डाला है, कभी भी, पूरा और मुफ़्त निर्यात करें। कोई भी सूचना बंद करें। अपना खाता और उसमें रखा निजी डेटा मिटाएँ। निर्यात और खाता मिटाना, दोनों सेटिंग्स में हैं; जाते समय निर्यात फिर से पूछा जाता है।',
  },
  devices: {
    title: 'डिवाइस',
    row: 'डिवाइस',
    rowHint: 'देखें कि आप कहाँ-कहाँ साइन इन हैं',
    intro:
      'इस खाते में साइन इन फ़ोन। ब्राउज़र डिवाइस के रूप में दर्ज नहीं होता, इसलिए यह सूची में नहीं है।',
    signedOut: 'साइन आउट',
    lastActive: 'आख़िरी बार सक्रिय {when}',
    signOutAll: 'बाकी हर जगह से साइन आउट करें',
    signOutAllHint: 'हर फ़ोन और हर दूसरे ब्राउज़र से साइन आउट कर देता है। यह टैब साइन इन रहेगा।',
    signedOutAll: {
      one: '{n} डिवाइस से साइन आउट किया।',
      other: '{n} डिवाइसों से साइन आउट किया।',
    },
    none: 'इस खाते में कोई फ़ोन साइन इन नहीं है।',
    historyNote: 'पिछले तीन महीने दिखाए जा रहे हैं।',
    couldNotSignOut: 'अन्य डिवाइस साइन आउट नहीं हो सके। कृपया फिर कोशिश करें।',
  },
  discovery: {
    discoveryRow: 'लोग आपको कैसे खोजें',
    discoveryRowHint: 'खोजा जाना, और समूह वालों को क्या दिखे',
    discoveryTitle: 'लोग आपको कैसे खोजें',
    discoveryIntro:
      'जिसके पास पहले से आपका नंबर या पता है, वह आपको Waves पर खोज सकता है। कोई यूँ ही लोगों में आपको ढूँढ़ नहीं सकता, और नाम से खोज कभी नहीं होती।',
    findTitle: 'किसी को खोजें',
    discoveryPhone: 'मेरे फ़ोन नंबर से मुझे खोजा जा सके',
    discoveryPhoneHint:
      'सिर्फ़ पूरा मिलान। इसे बंद करने से आप उन समूहों से नहीं हटते जिनमें आप पहले से हैं।',
    discoveryEmail: 'मेरे ईमेल पते से मुझे खोजा जा सके',
    discoveryEmailHint: 'सिर्फ़ पूरा मिलान, और सिर्फ़ इस खाते का पता।',
    discoveryFootnote:
      'जिसने आपका नंबर लिखकर आपको खोजा, उसे वह नंबर दिखेगा — वह उसके पास पहले से था। इनमें से कुछ भी यह नहीं बदलता कि किस पर कितना बाक़ी है।',
    visibilityTitle: 'आपके ग्रुप क्या देख सकते हैं',
    visibilityGroups: 'मेरे ग्रुप के लोग मेरा फ़ोन और ईमेल देख सकते हैं',
    visibilityNobody: 'कोई नहीं देख सकता',
    saved: 'सहेजा गया',
  },
  promo: {
    row: 'कोड इस्तेमाल करें',
    rowHint: 'अगर किसी ने आपको दिया हो',
    title: 'कोड इस्तेमाल करें',
    intro: 'कोड हाथ से दिए जाते हैं — किसी मदद के लिए, शुक्रिया के तौर पर, या आज़माने के लिए।',
    placeholder: 'WAVES2026',
    redeem: 'इस्तेमाल करें',
    granted: 'हो गया',
    grantedBody: '{until} तक Plus चालू है। कुछ नहीं लिया गया, और कुछ अपने आप नहीं बढ़ेगा।',
    unknownCode: 'ऐसा कोई कोड नहीं। वर्तनी जाँच लें — सिर्फ़ अक्षर और अंक।',
    expired: 'उस कोड की तारीख़ निकल चुकी है।',
    exhausted: 'वह कोड जितनी बार चल सकता था, उतनी बार चल चुका।',
    alreadyRedeemed: 'आप उसे पहले ही इस्तेमाल कर चुके हैं।',
    couldNotRedeem: 'अभी कोड जाँचा नहीं जा सका। थोड़ी देर बाद कोशिश करें।',
  },
  feedback: {
    row: 'सुझाव भेजें',
    rowHint: 'बताइए क्या ग़लत है, या क्या नहीं है',
    title: 'सुझाव भेजें',
    hint: 'इसे एक व्यक्ति पढ़ता है। जितना चाहें लिखें — विशिष्ट होने पर सबसे ज़्यादा मदद मिलती है।',
    placeholder: 'क्या हुआ, या आप क्या चाहते थे कि यह करे',
    send: 'भेजें',
    thanks: 'धन्यवाद — मिल गया।',
    thanksBody: 'हर संदेश एक इंसान पढ़ता है। जवाब हमेशा नहीं दे पाते, पर कुछ भी खोता नहीं।',
    another: 'एक और भेजें',
    rating: 'Waves अब तक कैसा लगा?',
    ratingHint: 'वैकल्पिक',
    starLabel: { one: '{n} तारा', other: '{n} तारे' },
    starClearHint: 'रेटिंग हटाने के लिए फिर से चुनें',
    attachNote: 'आपने जो देखा उसे दोहरा सकें, इसलिए वेब ऐप का वर्शन साथ आता है। और कुछ नहीं।',
    kindGeneral: 'सामान्य',
    kindBug: 'कुछ ख़राब है',
    kindIdea: 'एक सुझाव',
    couldNotSend: 'यह अभी भेजा नहीं जा सका। थोड़ी देर में फिर कोशिश करें।',
  },
  licenses: {
    row: 'ओपन सोर्स लाइसेंस',
    title: 'ओपन सोर्स',
    intro: 'Waves ओपन-सोर्स सॉफ़्टवेयर पर बना है। इन्हें बनाने और सँभालने वालों का धन्यवाद।',
    note: 'हर एक अपने लाइसेंस के तहत, बिना बदलाव के इस्तेमाल होती है।',
  },
  addPerson: {
    title: 'एक व्यक्ति जोड़ें',
    subtitle: 'किसी को आप पर कितना देना है, यह रखें — न उन्हें ऐप चाहिए, न कोई समूह बनाना है।',
    nameLabel: 'उनका नाम',
    namePlaceholder: 'जैसे एलेक्स',
    amountLabel: 'राशि',
    directionQuestion: 'किस ओर?',
    theyOweMe: 'वे मुझे देंगे',
    iOweThem: 'मैं उन्हें दूँगा',
    noteLabel: 'नोट (वैकल्पिक)',
    notePlaceholder: 'किस लिए?',
    save: 'दर्ज करें',
    couldNotRecord: 'यह दर्ज नहीं हो सका। कृपया फिर कोशिश करें।',
    row: 'एक व्यक्ति जोड़ें',
    rowHint: 'कोई जो Waves इस्तेमाल नहीं करता',
    halfDone: 'समूह बन गया, पर राशि दर्ज नहीं हुई। उसे खोलकर राशि जोड़ें।',
    openGroup: 'समूह खोलें',
  },
  mergePeople: {
    entry: 'लोगों को मर्ज करें',
    title: 'लोगों को मर्ज करें',
    subtitle:
      'उन मेहमानों को चुनें जो एक ही व्यक्ति हैं। उनके बैलेंस एक नाम के तहत जोड़ दिए जाएँगे.',
    empty:
      'मर्ज करने के लिए कोई मेहमान नहीं — केवल बिना Waves खाते वाले लोग ही मर्ज किए जा सकते हैं.',
    nameLabel: 'मर्ज किए गए व्यक्ति का नाम',
    namePlaceholder: 'जैसे एलेक्स',
    hasContact: 'आपके पास उनके संपर्क विवरण हैं',
    warningTitle: 'इसे पहले जैसा नहीं किया जा सकता',
    warningBody:
      'उनके अलग-अलग बैलेंस हमेशा के लिए एक व्यक्ति में जोड़ दिए जाते हैं। इन्हें वापस अलग करने का कोई तरीका नहीं है.',
    cta: 'मर्ज करें',
    selected: { one: '{n} व्यक्ति चुना गया', other: '{n} लोग चुने गए' },
    errorTooFew: 'मर्ज करने के लिए कम से कम दो लोग चुनें.',
    errorNotMergeable:
      'आप केवल उन मेहमानों को मर्ज कर सकते हैं जिनके साथ आप कोई समूह साझा करते हैं.',
    errorNameRequired: 'मर्ज किए गए व्यक्ति को एक नाम दें.',
    errorNotSignedIn: 'आप साइन आउट हैं. साइन इन करके फिर से मर्ज करें.',
    errorGeneric: 'मर्ज नहीं हो सका. कृपया फिर से प्रयास करें.',
    inGroups: { one: '{n} समूह में', other: '{n} समूहों में' },
  },
  a11y: {
    skipToContent: 'सामग्री पर जाएँ',
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
    continueWithApple: 'Apple से जारी रखें',
    doorWelcome: 'Waves में आपका स्वागत है',
    doorSub: 'साइन इन करें और जहाँ आपके समूह रुके थे वहीं से आगे बढ़ें।',
    emailLabel: 'ईमेल',
    passwordLabel: 'पासवर्ड',
    showPassword: 'पासवर्ड दिखाएँ',
    hidePassword: 'पासवर्ड छिपाएँ',
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
    youLent: 'आपने दिए',
    youBorrowed: 'आपने लिए',
    notInvolved: 'आप शामिल नहीं',
    paidBy: 'किसने दिया',
    splitLabel: 'बँटवारा',
    total: 'कुल',
    history: 'इतिहास',
    createdByName: '{name} ने यह जोड़ा',
    editedByName: '{name} ने इसे बदला',
    noChanges: 'ट्रैक किया गया कोई फ़ील्ड नहीं बदला',
    audit: {
      yourShare: 'आपका हिसाब',
      amount: 'रकम',
      description: 'ब्योरा',
      category: 'श्रेणी',
      split: 'बँटवारा',
      date: 'तारीख़',
      location: 'जगह',
      payers: 'किसने चुकाया',
      participants: 'किनमें बँटा',
      none: 'कुछ नहीं',
    },
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
    dispute: 'यह मुझ तक नहीं पहुँचा',
    disputing: 'दर्ज हो रहा है…',
    disputeConfirm: 'कहें कि यह भुगतान आप तक नहीं पहुँचा?',
    withdraw: 'वापस लें',
    withdrawing: 'वापस ले रहे हैं…',
    withdrawConfirm: 'यह भुगतान वापस लें?',
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
    changedElsewhere:
      'यह पेज खुला रहते हुए किसी और ने इस समूह में बदलाव किया। उनका संस्करण ऊपर है — देखकर फिर से सेव करें।',
    danger: 'सावधान',
  },
  theme: {
    label: 'रूप-रंग',
    system: 'डिवाइस',
    light: 'हल्का',
    dark: 'गहरा',
    lightHint: 'हल्का लैवेंडर पर्दा।',
    darkHint: 'रात में आँखों के लिए आसान।',
    currently: 'अभी {scheme}',
    systemHint: 'यह डिवाइस जिस पर सेट है, वही अपनाता है.',
    footnote: 'फ़ोन के अनुसार रखने पर, फ़ोन गहरा होने पर ऐप भी गहरा हो जाता है।',
  },
  comments: {
    title: 'टिप्पणियाँ',
    emptyTitle: 'अभी कोई टिप्पणी नहीं',
    empty: 'बातचीत शुरू करें।',
    placeholder: 'एक टिप्पणी जोड़ें…',
    post: 'टिप्पणी भेजें',
    posting: 'भेजा जा रहा है…',
    edit: 'बदलें',
    save: 'सहेजें',
    cancel: 'रद्द',
    delete: 'हटाएँ',
    deleteConfirm: 'यह टिप्पणी हटाएँ?',
    edited: 'बदली गई',
    report: 'रिपोर्ट',
    reported: 'रिपोर्ट की गई',
    resolve: 'हल करें',
    you: 'आप',
    remaining: '{count} बचे',
  },
  imageAudit: {
    receiptAdded: '{name} ने रसीद जोड़ी',
    receiptRemoved: '{name} ने रसीद हटाई',
    attachmentAdded: '{name} ने एक अटैचमेंट जोड़ा',
    attachmentRemoved: '{name} ने एक अटैचमेंट हटाया',
    partyOnly: 'निजी',
  },
  receipt: {
    title: 'रसीद',
    theBill: 'बिल',
    attachment: 'संलग्न',
    partyOnly: 'सिर्फ़ इस बिल वालों के लिए',
    missing: 'यह तस्वीर अब यहाँ नहीं है',
    notAvailableHere: 'ब्राउज़र में अभी नहीं दिखती',
    openOriginal: 'मूल फ़ाइल खोलें',
    openShared: 'साझा प्रति खोलें',
    close: 'बंद करें',
  },
  settings: {
    title: 'सेटिंग',
    profile: 'आप',
    displayName: 'नाम',
    currency: 'डिफ़ॉल्ट मुद्रा',
    country: 'देश',
    paymentHandle: 'भुगतान पता',
    paymentHandleBody: 'आपको भुगतान करने वालों को दिखता है, ताकि पूछना न पड़े.',
    paymentRail: 'किसके ज़रिए',
    save: 'सहेजें',
    saved: 'सहेजा गया',
    notifications: 'किस बारे में बताएँ',
    notifyInvolvesMe: 'केवल वे बातें जिनसे मेरा वास्ता है',
    notifyDigest: 'समूह गतिविधि का रोज़ का सारांश',
    notifySettlements: 'जब कोई मुझे भुगतान करे या पुष्टि माँगे',
    notifyNudges: 'किसी की भेजी याद-दिलाहट',
    notifyWeekly: 'साप्ताहिक ईमेल',
    notifyEmail: 'मुझे ईमेल भेजें',
    language: 'भाषा',
    languageBody: 'इसे बदलने पर पेज फिर से लोड होगा.',
    guestTitle: 'आप अतिथि हैं',
    guestBody: 'दूसरे डिवाइस पर खोलने के लिए ईमेल जोड़ें.',
    signOut: 'साइन आउट',
    onlyInApp: 'ऐप में',
    onlyInAppBody: 'रसीद स्कैन, बोलकर ख़र्च, बिना नेट के entry और निजी हिसाब — ये फ़ोन ऐप में हैं.',
    sectionAccount: 'खाता',
    sectionPreferences: 'प्राथमिकताएँ',
    sectionData: 'डेटा और गोपनीयता',
    sectionSecurity: 'सुरक्षा',
    sectionHelp: 'सहायता',
    languageFootnote:
      'आपके फ़ोन की भाषा ही डिफ़ॉल्ट है, और यहाँ चुनने से सिर्फ़ Waves बदलता है। रकम और तारीखें वहीं के हिसाब से चलती रहेंगी जहाँ आप हैं — दुबई में हिंदी में पढ़ने से आप भारत नहीं पहुँच जाते।',
  },
  categories: {
    food: 'खाना-पीना',
    groceries: 'किराना',
    travel: 'सफ़र',
    stay: 'ठहरना',
    shopping: 'शॉपिंग',
    entertainment: 'मनोरंजन',
    home: 'घर व बिल',
    health: 'सेहत',
    gifts: 'तोहफ़े',
    other: 'अन्य',
  },
  person: {
    acrossGroups: 'आप जिन समूहों में साथ हैं',
    notFound: 'यहाँ ऐसा कोई नहीं',
    notFoundBody: 'हो सकता है वे यह ग्रुप छोड़ चुके हों, या लिंक ग़लत हो।',
    you: 'आप',
    admin: 'एडमिन',
    notJoinedYet: 'अभी शामिल नहीं हुए',
    left: 'ग्रुप छोड़ चुके',
    onCount: { one: '{n} बिल पर', other: '{n} बिलों पर' },
    noneHere: '{name} अभी किसी बिल पर नहीं हैं।',
    squareWith: 'आप दोनों बराबर हैं.',
    findRow: 'किसी को खोजें',
    findRowHint: 'उनके ठीक ईमेल या फ़ोन नंबर से',
    findTitle: 'किसी को खोजें',
    findHint: 'वही ईमेल पता या फ़ोन नंबर लिखें जो वे Waves पर इस्तेमाल करते हैं।',
    findPlaceholder: 'ईमेल या फ़ोन',
    findAction: 'खोजें',
    findNoMatch: 'कोई मेल नहीं',
    findNoMatchBody: 'इसे कोई इस्तेमाल नहीं करता, या उन्होंने इससे खोजे जाने से मना किया है।',
    findRateLimited: 'आज के लिए इतनी खोज काफ़ी। कल फ़िर कोशिश करें।',
    alreadyShared: 'पहले से आपके साथ एक समूह में',
    notSharedYet: 'आपने उनके साथ अब तक कुछ बाँटा नहीं है।',
    startGroup: 'एक समूह बनाएँ',
  },
  exportData: {
    title: 'निर्यात',
    body: 'इस समूह का सब कुछ एक फ़ाइल में — रखने के लिए या स्प्रेडशीट में खोलने के लिए.',
    csv: 'CSV डाउनलोड करें',
    json: 'JSON डाउनलोड करें',
    working: 'फ़ाइल बन रही है…',
    row: 'डेटा निर्यात',
    rowHint: 'JSON + CSV, कुछ छूटता नहीं, मुफ़्त',
    accountTitle: 'अपना डेटा निर्यात करें',
    everythingFree: 'सब कुछ, हमेशा मुफ़्त',
    explain:
      'JSON में हर खर्च का हर संस्करण, किसने दिया, किस पर बाकी था, निपटान और उनका खर्च-वार बँटवारा, और गतिविधि का पूरा ब्योरा होता है — आपका पूरा हिसाब हूबहू दोबारा बनाने के लिए काफ़ी। CSV स्प्रेडशीट वाला रूप है, जिसमें व्यक्ति-वार निपटान का ब्योरा भी है।',
    format: 'प्रारूप',
    formatJson: 'JSON (कुछ छूटता नहीं)',
    formatCsv: 'CSV (स्प्रेडशीट)',
    formatPdf: 'PDF (प्रिंट करने योग्य)',
    whatToExport: 'क्या निर्यात करें',
    allMyGroups: 'मेरे सभी समूह',
    preparing: 'तैयार हो रहा है…',
    action: 'निर्यात',
    ready: 'निर्यात तैयार है',
    failed: 'आपका डेटा निर्यात नहीं हो सका। कृपया फिर कोशिश करें।',
  },
  developers: {
    title: 'डेवलपर',
    intro:
      'अपने Waves डेटा पर कुछ बनाइए: अपनी स्क्रिप्ट के लिए एक टोकन, या एक ऐप्लिकेशन जिसे दूसरे लोग अपने खाते से जोड़ सकें।',
    notConfigured: 'इस परिनियोजन में डेवलपर API सेट नहीं है।',
    notConfiguredBody:
      'NEXT_PUBLIC_WAVES_API_URL को Waves API के पते पर सेट करें और यह पृष्ठ फिर से लोड करें।',
    copy: 'कॉपी करें',
    copied: 'कॉपी हो गया',
    copyFailed: 'इसे हाथ से कॉपी करें — ब्राउज़र ने पृष्ठ को ऐसा करने नहीं दिया।',
    permissions: 'अनुमतियाँ',
    signInAgain: 'आपका Waves सत्र समाप्त हो गया है। फिर से साइन इन करें और यह लिंक दोबारा खोलें।',
    tokens: {
      title: 'निजी एक्सेस टोकन',
      body: 'टोकन आपकी ओर से काम करता है, सिर्फ़ उन्हीं अनुमतियों तक जो आप चुनते हैं। इसे पासवर्ड मानिए और कहीं प्रकाशित मत कीजिए।',
      empty: 'आपने अभी कोई टोकन नहीं बनाया है।',
      name: 'यह किस काम के लिए है?',
      namePlaceholder: 'मेरी बैकअप स्क्रिप्ट',
      expiryDays: 'कितने दिनों में समाप्त',
      expiryBody: 'कभी समाप्त न होने वाले टोकन के लिए इसे खाली छोड़ दें।',
      create: 'टोकन बनाएँ',
      creating: 'बन रहा है…',
      revoke: 'रद्द करें',
      revoking: 'रद्द किया जा रहा है…',
      revokedTag: 'रद्द',
      expiredTag: 'समाप्त',
      expires: '{date} को समाप्त',
      neverExpires: 'कोई समाप्ति नहीं',
      lastUsed: 'आख़िरी बार {date} को इस्तेमाल',
      neverUsed: 'कभी इस्तेमाल नहीं हुआ',
      createdTitle: 'आपका नया टोकन',
      onlyOnce:
        'इसे अभी कॉपी कर लें। यह इसे दिखाने का इकलौता मौक़ा है — Waves के पास सिर्फ़ इसका फ़िंगरप्रिंट रहता है, इसलिए यह दोबारा नहीं दिखाया जा सकता।',
      prefix: '{prefix} से शुरू',
    },
    apps: {
      title: 'ऐप्लिकेशन',
      body: 'ऐप्लिकेशन दूसरों से अनुमति माँगकर उनकी ओर से काम करता है। जोड़ने वाला हर व्यक्ति वही नाम और वेबसाइट देखेगा जो आप यहाँ देंगे।',
      empty: 'आपने कोई ऐप्लिकेशन पंजीकृत नहीं किया है।',
      name: 'नाम',
      namePlaceholder: 'ट्रिप स्प्लिटर',
      description: 'यह क्या करता है',
      website: 'वेबसाइट',
      redirects: 'वापसी पते',
      redirectsBody: 'हर पंक्ति में एक। Waves किसी को सिर्फ़ यहाँ लिखे पते पर ही वापस भेजेगा।',
      kind: 'यह कहाँ चलता है?',
      confidential: 'सर्वर पर, जहाँ राज़ छिपाया जा सकता है',
      publicClient: 'फ़ोन या ब्राउज़र में, जहाँ नहीं छिपाया जा सकता',
      register: 'ऐप्लिकेशन पंजीकृत करें',
      registering: 'पंजीकृत हो रहा है…',
      clientId: 'क्लाइंट आईडी',
      rotate: 'नया सीक्रेट',
      rotating: 'बन रहा है…',
      enable: 'चालू करें',
      disable: 'बंद करें',
      disabledTag: 'बंद',
      delete: 'हटाएँ',
      deleteConfirm: 'हमेशा के लिए हटाएँ?',
      deleting: 'हटाया जा रहा है…',
      secretTitle: 'आपका नया क्लाइंट सीक्रेट',
      secretOnce:
        'इसे अभी कॉपी कर लें। यह इसे दिखाने का इकलौता मौक़ा है; नया बनाने से कोई साइन आउट नहीं होता — बस पुराना काम करना बंद कर देता है।',
      publicNote:
        'सार्वजनिक क्लाइंट के पास सीक्रेट नहीं होता। अनुरोध वाक़ई उसी से आया है, यह PKCE साबित करता है।',
    },
    connections: {
      title: 'जुड़े हुए ऐप',
      body: 'वे ऐप्लिकेशन जिन्हें आपने अपनी ओर से काम करने दिया है। किसी का कनेक्शन तोड़ने पर उसके सारे टोकन रद्द हो जाते हैं।',
      empty: 'आपके खाते से कुछ भी नहीं जुड़ा है।',
      connected: '{date} को जुड़ा',
      lastUsed: 'आख़िरी बार {date} को इस्तेमाल',
      neverUsed: 'अभी इस्तेमाल नहीं हुआ',
      disconnect: 'कनेक्शन तोड़ें',
      disconnecting: 'तोड़ा जा रहा है…',
    },
    consent: {
      title: 'पहुँच की अनुमति',
      wants: '{app} आपकी ओर से काम करना चाहता है',
      by: '{owner} द्वारा पंजीकृत',
      website: 'वेबसाइट',
      ableTo: 'यह ये कर सकेगा:',
      approve: 'अनुमति दें',
      approving: 'अनुमति दी जा रही है…',
      cancel: 'रद्द करें',
      refused: 'Waves यह अनुरोध नहीं दिखाएगा।',
      refusedBody:
        'ऐप्लिकेशन, जिस पते पर वापस भेजने को कहा गया, या जो अनुमति माँगी गई — इनमें से कुछ वैसा नहीं है जैसा उसके डेवलपर ने पंजीकृत किया था। कुछ भी साझा नहीं हुआ है और यहाँ अनुमति देने को कुछ नहीं है।',
      badRequest:
        'इस लिंक में वह चीज़ नहीं है जो Waves को चाहिए, इसलिए यहाँ अनुमति देने को कुछ नहीं है।',
      back: 'डेवलपर पृष्ठ पर लौटें',
    },
    scope: {
      'identity.read': 'आपका नाम, तस्वीर और डिफ़ॉल्ट मुद्रा देखना।',
      'identity.write': 'आपकी प्रोफ़ाइल बदलना।',
      'groups.read': 'आपके समूह, उनमें कौन है और किसका कितना बाक़ी है, यह देखना।',
      'groups.write': 'समूह बनाना, नाम बदलना, और लोगों को जोड़ना या हटाना।',
      'expenses.read': 'आपके समूहों के खर्च देखना।',
      'expenses.write': 'आपके समूहों में खर्च जोड़ना, बदलना और हटाना।',
      'settlements.read': 'आपके और दूसरों के बीच दर्ज भुगतान देखना।',
      'settlements.write': 'आपकी ओर से भुगतान दर्ज करना और पक्का करना।',
      'friends.read': 'हर समूह में आप किसके देनदार हैं और कौन आपका, यह देखना।',
      'categories.read': 'आपकी खर्च श्रेणियाँ देखना।',
      'categories.write': 'आपकी खर्च श्रेणियाँ जोड़ना, बदलना और छिपाना।',
      offline_access: 'दोबारा पूछे बिना जुड़े रहना।',
    },
  },
  agents: {
    signedInAs: '{email} के रूप में साइन इन',
    willBeAbleTo: 'आपकी मंज़ूरी के बाद यह कर सकेगा:',
    reads: 'आपके समूह, ख़र्च, बकाया और जिनके साथ आप बाँटते हैं, उन्हें पढ़ना',
    writes: 'ख़र्च जोड़ना, समूह बनाना और निपटान दर्ज करना',
    asYou:
      'यह आपकी ओर से काम करता है। जो आप देख सकते हैं वही यह देख सकता है, इससे ज़्यादा कुछ नहीं।',
    neverMoves: 'यह पैसे नहीं भेज सकता। निपटान दर्ज होते हैं; भुगतान आप ही करते हैं।',
    deny: 'मना करें',
    denying: 'मना कर रहे हैं…',
    unverified: 'Waves ने इस ऐप्लिकेशन की जाँच नहीं की है।',
  },
  errors: {
    couldNotLoad: 'यह लोड नहीं हो सका। थोड़ी देर में फिर कोशिश करें।',
    couldNotSignIn: 'साइन इन नहीं हो सका। फिर से कोशिश करें।',
    passwordTooShort: 'कम से कम 8 अक्षर रखें — पहेली से बेहतर है कोई वाक्यांश, याद भी रहता है।',
    passwordTooCommon: 'यह उन पासवर्ड में से है जो सबसे पहले आज़माए जाते हैं।',
    couldNotSave: 'यह सेव नहीं हुआ। थोड़ी देर में फिर कोशिश करें।',
    offline: 'लगता है आप ऑफ़लाइन हैं। कनेक्शन जाँचकर फिर कोशिश करें।',
    tooMany: 'लगातार बहुत सारी कोशिशें। थोड़ा रुककर फिर कोशिश करें।',
    tryAgain: 'फिर कोशिश करें',
  },
  account: {
    title: 'आपका खाता',
    you: 'आप',
    yourAccount: 'आपका खाता',
    yourAccountHint: 'आपका नाम, आप कहाँ हैं, और अंदर आने के रास्ते',
    guestTitle: 'मेहमान खाता',
    guestBody:
      'आपने जो कुछ जोड़ा है वह पहले ही सेव है और आपका है। जब भी किसी दूसरे डिवाइस से पहुँचना हो, Google या Apple खाता जोड़ लें — इससे नया खाता नहीं बनता, यही खाता बना रहता है।',
    detailsTitle: 'आपकी जानकारी',
    displayNameHint: 'जिन ग्रुप में आप हैं, उनमें सब यही देखते हैं।',
    countryNotSet: 'तय नहीं',
    currencyFromCountry: 'आपके देश से सेट',
    addressTitle: 'पता',
    addressHint: 'यहाँ कुछ नहीं भेजा जाता। सिर्फ़ आपके रिकॉर्ड के लिए।',
    addressPlaceholder: 'गली, शहर, पिन कोड',
    signInMethodsTitle: 'साइन इन करने के तरीके',
    signInMethodsBody:
      'कोई खाता जोड़ लें, तो अगली बार किसी भी डिवाइस पर उसी से साइन इन कर सकते हैं.',
    signInFootnote:
      'अंदर आने देने के लिए Waves यह कभी नहीं माँगता, और आपके समूह में किसी के साथ इसे साझा नहीं करता। लोग सिर्फ़ वही नाम देखते हैं जो आप चुनते हैं।',
    emailAddress: 'ईमेल पता',
    alreadyAdded: 'पहले से जुड़ा है: {value}',
    notAddedYet: 'अभी जोड़ा नहीं गया',
    link: 'लिंक करें',
    linkProvider: '{provider} लिंक करें',
    linked: 'लिंक किया गया',
    payingTitle: 'भुगतान',
    howPeoplePayYou: 'लोग आपको कैसे भुगतान करें',
    settlesWith: '{rails} से निपटाया जाता है',
    handleWrong: 'यह {hint} जैसा नहीं लगता।',
    railLinkNote: 'आपसे हिसाब करने वालों को एक टैप में भुगतान मिलता है। Waves पैसा कभी नहीं छूता।',
    railManualNote:
      'आपसे हिसाब करने वाले इसे देखकर अपने बैंक ऐप से भुगतान करते हैं। Waves पैसा कभी नहीं छूता।',
    nothingToAdd: 'जोड़ने को कुछ नहीं — लोग जो चुकाया है उसे खुद दर्ज करेंगे।',
  },
  notifications: {
    title: 'सूचनाएँ',
    rowHint: 'Waves किन बातों के लिए आपको टोक सकता है',
    neverSpam:
      'रोज़मर्रा की खर्च गतिविधि के लिए Waves कभी ईमेल नहीं करता। सिर्फ़ वे छह चीज़ें जो आप वाकई इनबॉक्स में चाहेंगे, और हर एक अलग से बंद की जा सकती है।',
    pushSection: 'पुश',
    pushOnWeb:
      'ये चार तय करते हैं कि फ़ोन ऐप आपको क्या भेजे. ब्राउज़र कोई पंजीकृत डिवाइस नहीं है, इसलिए यहाँ का कुछ भी इस डिवाइस पर नहीं बजेगा.',
    involvesMe: 'सिर्फ़ वही जिनसे मेरा वास्ता है',
    involvesMeBody:
      'जब आप पर बाकी हो, आपको मिलना हो, या आपका ज़िक्र हो तब सूचना — हर समूह के हर खर्च पर नहीं।',
    settlementRequests: 'निपटान की पुष्टि',
    settlementRequestsBody: 'जब कोई कहे कि उसने आपको भुगतान किया, ताकि आपकी बाकी सही रहे।',
    nudges: 'याद दिलाना',
    nudgesBody: 'बाकी पैसे की एक विनम्र याद। डेटाबेस में ही सीमित — एक व्यक्ति को दिन में एक बार।',
    digest: 'दैनिक समूह सारांश',
    digestBody: 'बाकी सब कुछ, लगातार की जगह दिन में एक सूचना में इकट्ठा।',
    emailSection: 'ईमेल से',
    emailAll: 'मुझे ईमेल भेजें',
    emailAllBody:
      'हिसाब, याद दिलाने वाले संदेश और साप्ताहिक सारांश। नए साइन-इन की सुरक्षा चेतावनी इससे परे हमेशा आएगी।',
    weeklyEmail: 'साप्ताहिक ईमेल सारांश',
    weeklyEmailBody: 'आपकी कुल बाकी और लंबित पुष्टियाँ, हफ़्ते में एक बार। डिफ़ॉल्ट रूप से बंद।',
    footnote:
      'ईमेल अभी आना बाकी है। यहाँ का सब कुछ आपके इनबॉक्स में भी है, और सूचना पहुँची या नहीं, Waves ने आपसे क्या कहा उसका रिकॉर्ड वही है।',
  },
  billing: {
    row: 'प्लान',
    rowHint: 'मुफ़्त प्लान — सब कुछ शामिल, खरीदने को कुछ नहीं',
    title: 'प्लान',
    nothingToBuy: 'अभी खरीदने को कुछ नहीं',
    nothingToBuyBody:
      'यह दुकान नहीं, दरवाज़ा है। जब कुछ ऐसा होगा जिसके पैसे देने लायक हो, वह यहीं मिलेगा — कीमत लिखी हुई और कोई चौंकाने वाली बात नहीं।',
    whatWouldCost: 'कभी पैसे किस चीज़ के लगेंगे',
    moreScans: 'ज़्यादा बिल स्कैन',
    moreScansBody:
      'रसीद की फ़ोटो लें और उसकी पंक्तियाँ पढ़ ली जाएँ। हर स्कैन पर सचमुच पैसा लगता है — यही ईमानदार वजह है कि सीमा इसी पर है।',
    biggerTransfers: 'बड़े निर्यात और आयात',
    biggerTransfersBody:
      'आपका डेटा आपका है और पूरा मुफ़्त में बाहर आता है। बड़े काम और तय समय पर बैकअप — यही सुविधा है।',
    whatNeverWill: 'किसके कभी नहीं',
    whatNeverWillBody:
      'हिसाब। समूह, खर्च, बँटवारा, बकाया, निपटान, और यह सब वापस बाहर निकालना — {free}। जो हिसाब आप आधा ही पढ़ सकें, वह हिसाब नहीं।',
    freeForever: 'हमेशा मुफ़्त',
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
    tabExpenses: 'المصروفات',
    tabBalances: 'الأرصدة',
    tabActivity: 'النشاط',
    noneYet: 'لا شيء هنا بعد',
    noneYetBody: 'أول مصروف يضيفه أحدهم سيظهر هنا.',
    whereEveryoneStands: 'أين يقف كل واحد',
    settledUp: 'مسوّى',
    isSettledUp: 'حسابه مسوّى',
    isOwed: 'له',
    owes: 'عليه',
    whoPaysWhom: 'من يدفع لمن',
    whoPaysWhomNote:
      'أقل عدد من الدفعات يسوّي حساب الجميع. ولا يُطلب من أحد أن يدفع لشخص لم يقسّم معه شيئًا قط.',
    youPayName: 'تدفع لـ {name}',
    namePaysYou: 'يدفع لك {name}',
    paysWhom: 'يدفع {from} لـ {to}',
    yourPayments: 'دفعاتك',
    otherPayments: 'بين أشخاص آخرين',
    addAnExpense: 'أضف مصروفًا',
    installNote: 'ثبّت Waves لمسح الإيصالات والتسوية عبر UPI ولكي يعمل هذا دون اتصال.',
  },
  add: {
    title: 'أضف مصروفًا',
    defaultDescription: 'مصروف',
    whatWasIt: 'على ماذا؟',
    categoryLabel: 'أي نوع من الصرف',
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
  itemize: {
    title: 'التقسيم حسب الأصناف',
    defaultDescription: 'فاتورة مفصّلة',
    lines: 'ما كان في الفاتورة',
    linePlaceholder: 'صنف',
    untitledLine: 'سطر بلا اسم',
    addLine: 'إضافة سطر',
    removeLine: 'إزالة هذا السطر',
    extras: 'الضريبة والخدمة والبقشيش',
    extrasNote: 'تُوزَّع بنسبة ما أخذه كل شخص، لا بالتساوي.',
    taxes: 'الضريبة',
    serviceCharge: 'الخدمة',
    tip: 'البقشيش',
    discounts: 'الخصم',
    preview: 'من عليه كم',
    startTyping: 'أضف سطرًا وقل من أخذه.',
    unclaimed: 'لم يطالب أحد بـ: {lines}',
    cannotSplit: 'لا يمكن تقسيم هذه الفاتورة بعد.',
    noMembers: 'أضف شخصًا إلى هذه المجموعة أولًا.',
  },
  insights: {
    title: 'الإنفاق',
    scopeLabel: 'إنفاق من',
    wholeGroup: 'الجميع',
    justMine: 'إنفاقي فقط',
    byCategory: 'على ماذا صُرف',
    byMonth: 'شهرًا بشهر',
    totalIn: 'أُنفقت بـ {currency}',
    tapMonth: 'افتح شهرًا لعرض أيامه.',
    nothingYet: 'لا شيء لعرضه بعد',
    nothingBody: 'أضف مصروفًا وسيمتلئ هذا.',
    nothingThisMonth: 'لا شيء هذا الشهر',
    nothingThisMonthBody: 'لا مصروفات هنا بهذه العملة.',
  },
  recap: {
    title: 'ملخص الرحلة',
    titleAny: 'الملخص',
    subtitle: 'كيف تجمّعت المصاريف',
    perDay: 'لكل يوم',
    biggestBill: 'أكبر فاتورة',
    mostSpentOn: 'الأكثر إنفاقًا',
    paidMost: 'الأكثر دفعًا',
    noneYet: 'لا شيء للتلخيص بعد',
  },
  places: {
    title: 'الأماكن',
    empty: 'لا أماكن بعد',
    emptyBody: 'أضف موقعًا إلى مصروف لتراه هنا.',
  },
  plan: {
    title: 'الخطة',
    subtitle: 'ما هو مخطط، وما كلّف',
    dayNumber: 'اليوم {n}',
    planned: 'المخطط',
    spent: 'المصروف',
    over: 'تجاوز',
    under: 'أقل',
    emptyDay: 'لا شيء في هذا اليوم بعد.',
    nothingYet: 'لا خطة بعد',
    nothingBody: 'أضف الأيام وما تنوي فعله. أما التكلفة الفعلية فتُملأ من تلقاء نفسها.',
    tripsOnly: 'التخطيط للرحلات',
    tripsOnlyBody: 'اجعل هذه المجموعة رحلة من إعداداتها للتخطيط يومًا بيوم.',
    whatIsPlanned: 'ماذا ستفعل؟',
    add: 'إضافة',
    cancel: 'إلغاء',
    remove: 'إزالة {title}',
  },
  budgets: {
    title: 'الميزانية',
    overall: 'الإجمالي',
    mine: 'ميزانيتي',
    amount: 'المبلغ',
    shareWithGroup: 'مشاركة مع المجموعة',
    onlyMe: 'لي فقط',
    save: 'حفظ',
    clear: 'مسح',
    set: 'تحديد ميزانية',
    edit: 'تغيير',
    left: 'المتبقي',
    over: 'زيادة',
    forecast: 'بهذه الوتيرة',
    projectedTotal: 'الإجمالي المتوقع',
    onTrack: 'على المسار',
    fairness: 'الإنصاف',
    paidShare: 'دفع {name} ‏{percent}٪ من الرحلة',
    evenlyMatched: 'الجميع يساهمون بالتساوي',
    nextUp: 'يمكن أن يدفع {name} الفاتورة التالية',
    someone: 'شخص ما',
  },
  tags: {
    title: 'الوسوم والفئات',
    subtitle: 'أنشئ وسومك الخاصة، وأخفِ أو أعد ترتيب الوسوم الجاهزة.',
    settingsRow: 'الوسوم والفئات',
    newTag: 'وسم جديد',
    editTag: 'تعديل الوسم',
    namePlaceholder: 'مثال: عشاء عمل',
    colourLabel: 'اللون',
    noCustomTags: 'لا توجد وسوم خاصة بك بعد. أنشئ واحدًا لتصنيف المصروفات بطريقتك.',
    hide: 'إخفاء',
    show: 'إظهار',
    moveUp: 'تحريك لأعلى',
    moveDown: 'تحريك لأسفل',
    hiddenBadge: 'مخفي',
    deleteTag: 'حذف',
    deleteConfirm: 'حذف هذا الوسم؟ ستحتفظ به المصروفات السابقة؛ يختفي من القائمة فقط.',
    save: 'حفظ الوسم',
    cancel: 'إلغاء',
    nameNeeded: 'أعطِ الوسم اسمًا.',
  },
  privacy: {
    deleteRow: 'احذف بياناتي',
    deleteRowHint: 'إزالة حسابك وتفاصيلك الشخصية',
    deleteTitle: 'احذف بياناتي',
    deleteIntro:
      'لا يمكن التراجع عن هذا. اقرأ ما يُحذف وما لا يُحذف — والجزء الثاني هو ما يفاجئ الناس.',
    deleteGoesTitle: 'ما الذي يُحذف',
    deleteGoesBody:
      'اسمك وصورتك وعنوان الدفع والبلد واللغة وإعدادات الإشعارات. وتسجيل دخولك، فلا يُفتح هذا الحساب بعدها. وأجهزتك وسجل إشعاراتك ومشترياتك.',
    deleteStaysTitle: 'ما الذي يبقى، ولماذا',
    deleteStaysBody:
      'تبقى المصروفات والتسويات في مجموعاتك المشتركة، ومعها الملاحظات والتعليقات والصور التي أضفتها — إيصالات وإثباتات دفع وصور رحلات — لأنها سجلات الآخرين أيضًا — وهي ما يحدد من يدين لمن. وحذفها يغيّر حساب شخص آخر بصمت ويُسقط دَينًا لم يسدده أحد. تصبح عضوًا سابقًا بلا اسم في تلك المجموعات.',
    deleteExportFirst: 'صدّر بياناتك أولًا',
    deleteWhyLabel: 'لماذا تغادر؟ (اختياري)',
    deleteWhyPlaceholder: 'معرفة السبب تفيدنا، ويُحتفظ بها بعد زوال الحساب',
    deleteConfirmLabel: 'اكتب DELETE للتأكيد',
    deleteConfirmWord: 'DELETE',
    deleteButton: 'احذف بياناتي',
    deleteWorking: 'جارٍ الحذف…',
    deleteDone: 'تم حذف بياناتك.',
    deleteSummary: {
      zero: 'أنت الآن عضو سابق في {n} مجموعة.',
      one: 'أنت الآن عضو سابق في مجموعة واحدة.',
      two: 'أنت الآن عضو سابق في مجموعتين.',
      few: 'أنت الآن عضو سابق في {n} مجموعات.',
      many: 'أنت الآن عضو سابق في {n} مجموعة.',
      other: 'أنت الآن عضو سابق في {n} مجموعة.',
    },
    previewGroups: {
      zero: 'أنت في {n} مجموعة.',
      one: 'أنت في مجموعة واحدة.',
      two: 'أنت في مجموعتين.',
      few: 'أنت في {n} مجموعات.',
      many: 'أنت في {n} مجموعة.',
      other: 'أنت في {n} مجموعة.',
    },
    previewExpenses: {
      zero: 'ستبقى {n} من المصروفات التي أدخلتها.',
      one: 'سيبقى مصروف واحد أدخلته.',
      two: 'سيبقى مصروفان أدخلتهما.',
      few: 'ستبقى {n} مصروفات أدخلتها.',
      many: 'ستبقى {n} مصروفًا أدخلته.',
      other: 'ستبقى {n} من المصروفات التي أدخلتها.',
    },
    previewSettlements: {
      zero: 'اسمك مذكور في {n} تسوية.',
      one: 'اسمك مذكور في تسوية واحدة.',
      two: 'اسمك مذكور في تسويتين.',
      few: 'اسمك مذكور في {n} تسويات.',
      many: 'اسمك مذكور في {n} تسوية.',
      other: 'اسمك مذكور في {n} تسوية.',
    },
    previewOutstanding: 'لا يزال لديك رصيد غير مسوّى بـ {list}.',
    row: 'الخصوصية',
    rowHint: 'ما الذي يُحفظ، وكيف يُحمى',
    title: 'الخصوصية',
    intro: 'يحتفظ Waves بأقل قدر ممكن عنك مع بقائه صالحًا للعمل. وهذا بيان بما يحتفظ به.',
    controlsSection: 'أدواتك',
    expandLabel: 'اقرأ المزيد',
    collapseLabel: 'إظهار أقل',
    supportRow: 'أسئلة عن الخصوصية',
    supportRowHint: 'راسلنا — يردّ عليك شخص',
    lastUpdated: 'آخر تحديث {date}.',
    storeTitle: 'ما الذي يُحفظ',
    storeSummary: 'ملفك الشخصي ومجموعاتك ومصروفاتك وإيصالاتك وتعليقاتك وإعداداتك ومن يدين لمن.',
    storeBody:
      'اسمك، وما استخدمته من رقم هاتف أو بريد أو هوية دخول. واختياريًا عنوان دفع كي يتمكن أحدهم من ردّ المال إليك، وبلد، وعنوان بريدي اختياري إن أضفته. المجموعات التي تشارك فيها ومصروفاتها ومن يدين لمن. لا شيء غير ذلك: لا تُرفع جهات الاتصال، ولا يوجد معرّف إعلاني.',
    protectTitle: 'كيف يُحمى',
    protectSummary: 'قواعد قاعدة البيانات عند كل قراءة، وروابط إيصالات خاصة، وتقارير أعطال منقّاة.',
    protectBody:
      'كل جدول محميّ بأمان على مستوى الصف داخل قاعدة البيانات، فلا يستطيع أي طلب أن يقرأ إلا الصفوف التي يحق لحسابك الاطلاع عليها — وهذه ليست تصفية تجريها الصفحة، بل قاعدة تفرضها قاعدة البيانات نفسها. والمفتاح الذي تحمله هذه الصفحة لا يفعل شيئًا لم تكن جلستك المسجَّلة قادرة عليه أصلًا. صور الإيصالات محفوظة في مساحة خاصة لا يُوصل إليها إلا عبر روابط موقَّعة قصيرة العمر. وتقارير الأعطال تُنظَّف من العناوين وأرقام الهواتف ومعرِّفات الدفع والمفاتيح قبل أن تغادر المتصفح، ولا شيء هنا يسجّل شاشتك. ويمكن لكل إيصال أن يكون ظاهرًا لكل من في المجموعة، أو لمن في تلك النفقة وحدهم — والاختيار لك صورةً صورة.',
    servicesTitle: 'من غيرنا يلمس بياناتك',
    servicesSummary:
      'قاعدة البيانات على Supabase، وتقارير الأعطال إلى Sentry. لا وسم تحليلات، ولا شيء يُباع.',
    servicesBody:
      'يعمل Waves على Supabase — قاعدة البيانات وتسجيل الدخول، على خوادم نتحكم بها. وتذهب تقارير الأعطال إلى Sentry بعد تنظيفها من تفاصيلك قبل مغادرتها الصفحة. لا يحمل هذا الموقع أي وسم تحليلات: لا تسجيل للشاشة، ولا معرِّف إعلاني، ولا شبكات إعلانات. وبياناتك لا تُباع أبدًا.',
    retentionTitle: 'كم نحتفظ بها',
    retentionSummary:
      'يبقى ما دام حسابك مفتوحًا، ويُحذف بعد ثلاث سنوات دون استخدام. وتبقى السجلات المشتركة دون اسمك.',
    retentionBody:
      'تبقى بياناتك ما دام حسابك مفتوحًا. إذا بقي الحساب دون استخدام لمدة 3 سنوات، نحذفه ونحذف معه البيانات الشخصية. لا داعي للانتظار — يمكنك تصدير كل شيء أو حذفه بنفسك في أي وقت من الإعدادات. المجموعة التي تغلقها وتتركها دون استخدام لمدة عام ونصف تُنقل تلقائيًا إلى أرشيفك — لا يُحذف شيء، ويمكنك إعادة فتحها في أي وقت. ويبقى بعض ما تتركه خلفك حتى بعد حذف حسابك، ومن حقك معرفته قبل أن تحذف. ما أضفته إلى مجموعة مشتركة — المصروفات والتسويات، والملاحظات والتعليقات عليها، والصور التي أضفتها، سواء كانت إيصالًا أو إثبات دفع أو صورة رحلة — يبقى، لأنه سجلّ بقية الأعضاء أيضًا، وإزالته تغيّر رصيد شخص آخر بصمت وكأن دَينًا سُدّد دون أن يدفعه أحد. أما اسمك وصورتك وبيانات التواصل وعناوين الدفع فتُزال من تلك المجموعات، وتصبح فيها عضوًا سابقًا بلا اسم؛ غير أن الإشعارات وسجل النشاط التي وصلت إلى آخرين من قبل قد تظل تحمل اسمك وقتها. وإذا كتبت شيئًا في خانة سبب المغادرة، فيُحفظ ما كتبته كما هو بعد إزالة ما يربطه بك. لا يُحتفظ بشيء لأغراض إعلانية، ولا يُحتفظ بشيء لأن قانونًا يلزمنا بذلك.',
    choicesTitle: 'ما الذي يمكنك فعله',
    choicesSummary: 'صدّر كل شيء، أوقف أي إشعار، أو احذف حسابك.',
    choicesBody:
      'تصدير كل ما أدخلته، في أي وقت، كاملًا ومجانًا. إيقاف أي إشعار. حذف حسابك والبيانات الشخصية التي فيه. التصدير والحذف كلاهما في الإعدادات، ويُعرض التصدير مرة أخرى عند المغادرة.',
  },
  devices: {
    title: 'الأجهزة',
    row: 'الأجهزة',
    rowHint: 'اطّلع على أماكن تسجيل دخولك',
    intro: 'الهواتف المسجّل دخولها إلى هذا الحساب. المتصفح لا يُسجّل كجهاز، لذا لا يظهر هنا.',
    signedOut: 'تم تسجيل الخروج',
    lastActive: 'آخر نشاط {when}',
    signOutAll: 'تسجيل الخروج من كل مكان آخر',
    signOutAllHint: 'يُسجّل الخروج من كل هاتف ومن كل متصفح آخر. تبقى هذه النافذة مسجّلة الدخول.',
    signedOutAll: {
      zero: 'تم تسجيل الخروج من {n} جهاز.',
      one: 'تم تسجيل الخروج من جهاز واحد.',
      two: 'تم تسجيل الخروج من جهازين.',
      few: 'تم تسجيل الخروج من {n} أجهزة.',
      many: 'تم تسجيل الخروج من {n} جهازًا.',
      other: 'تم تسجيل الخروج من {n} جهاز.',
    },
    none: 'لا توجد هواتف مسجّل دخولها إلى هذا الحساب.',
    historyNote: 'تُعرض آخر ثلاثة أشهر.',
    couldNotSignOut: 'تعذّر تسجيل خروج الأجهزة الأخرى. حاول مرة أخرى.',
  },
  discovery: {
    discoveryRow: 'كيف يعثر عليك الآخرون',
    discoveryRowHint: 'أن يُبحث عنك، وما يراه أفراد مجموعاتك',
    discoveryTitle: 'كيف يعثر عليك الآخرون',
    discoveryIntro:
      'من يملك رقمك أو عنوان بريدك مسبقًا يستطيع البحث عنك على Waves. لا أحد يستطيع تصفّح الأشخاص بحثًا عنك، ولا بحث بالاسم إطلاقًا.',
    findTitle: 'ابحث عن شخص',
    discoveryPhone: 'يمكن العثور عليّ برقم هاتفي',
    discoveryPhoneHint: 'تطابق تام فقط. إيقافه لا يُخرجك من المجموعات التي أنت فيها بالفعل.',
    discoveryEmail: 'يمكن العثور عليّ ببريدي الإلكتروني',
    discoveryEmailHint: 'تطابق تام فقط، ولعنوان هذا الحساب وحده.',
    discoveryFootnote:
      'من عثر عليك بكتابة رقمك سيرى ذلك الرقم — فقد كان لديه أصلًا. ولا شيء من هذا يغيّر أبدًا من يدين لمن.',
    visibilityTitle: 'ما يمكن لمجموعاتك رؤيته',
    visibilityGroups: 'يمكن لمن في مجموعاتي رؤية رقمي وبريدي',
    visibilityNobody: 'لا أحد يمكنه رؤيتها',
    saved: 'تم الحفظ',
  },
  promo: {
    row: 'استخدام رمز',
    rowHint: 'إن أعطاك أحدهم واحدًا',
    title: 'استخدام رمز',
    intro: 'تُمنح الرموز يدويًا — لحالة دعم، أو شكرًا، أو للتجربة.',
    placeholder: 'WAVES2026',
    redeem: 'استخدام',
    granted: 'تم',
    grantedBody: 'Plus مفعّل حتى {until}. لم يُخصم شيء، ولا شيء يتجدد تلقائيًا.',
    unknownCode: 'لا يوجد رمز كهذا. راجع الحروف والأرقام.',
    expired: 'انتهى تاريخ هذا الرمز.',
    exhausted: 'استُخدم هذا الرمز بالعدد المسموح به.',
    alreadyRedeemed: 'لقد استخدمته من قبل.',
    couldNotRedeem: 'تعذّر التحقق من الرمز الآن. حاول بعد قليل.',
  },
  feedback: {
    row: 'أرسل ملاحظاتك',
    rowHint: 'أخبرنا بما لا يعمل أو بما ينقص',
    title: 'أرسل ملاحظاتك',
    hint: 'يقرأها إنسان. اكتب ما تشاء — وكلما كان محددًا كان أنفع.',
    placeholder: 'ماذا حدث، أو ما الذي كنت تتمناه',
    send: 'إرسال',
    thanks: 'شكرًا — وصلتنا.',
    thanksBody: 'يقرأ كل رسالة شخص حقيقي. لا نستطيع الرد دائمًا، لكن لا شيء يضيع.',
    another: 'إرسال رسالة أخرى',
    rating: 'كيف تجد Waves حتى الآن؟',
    ratingHint: 'اختياري',
    starLabel: { one: '{n} نجمة', other: '{n} نجوم' },
    starClearHint: 'اخترها مرة أخرى لمسح التقييم',
    attachNote: 'تُرفق نسخة تطبيق الويب حتى نتمكّن من إعادة إنتاج ما رأيته. لا شيء غير ذلك.',
    kindGeneral: 'عام',
    kindBug: 'شيء لا يعمل',
    kindIdea: 'فكرة',
    couldNotSend: 'تعذّر الإرسال الآن. حاول بعد قليل.',
  },
  licenses: {
    row: 'تراخيص المصدر المفتوح',
    title: 'المصدر المفتوح',
    intro: 'ُبني Waves على برمجيات مفتوحة المصدر. شكرًا لمن صنعها ويصونها.',
    note: 'كلٌّ منها يُستخدم بموجب ترخيصه الخاص، دون تغيير.',
  },
  addPerson: {
    title: 'إضافة شخص',
    subtitle: 'تتبّع ما يدين لك به أحدهم — لا يحتاج إلى التطبيق، ولا إلى إنشاء مجموعة.',
    nameLabel: 'اسمه',
    namePlaceholder: 'مثال: أليكس',
    amountLabel: 'المبلغ',
    directionQuestion: 'في أي اتجاه؟',
    theyOweMe: 'يدين لي',
    iOweThem: 'أدين له',
    noteLabel: 'ملاحظة (اختياري)',
    notePlaceholder: 'لأجل ماذا؟',
    save: 'سجّل',
    couldNotRecord: 'تعذّر تسجيل هذا. حاول مرة أخرى.',
    row: 'إضافة شخص',
    rowHint: 'شخص لا يستخدم Waves',
    halfDone: 'أُنشئت المجموعة، لكن المبلغ لم يُسجّل. افتحها وأضف المبلغ.',
    openGroup: 'افتح المجموعة',
  },
  mergePeople: {
    entry: 'دمج الأشخاص',
    title: 'دمج الأشخاص',
    subtitle: 'اختر الضيوف الذين هم الشخص نفسه. تُجمع أرصدتهم تحت اسم واحد.',
    empty: 'لا يوجد ضيوف للدمج — يمكن دمج من ليس لديهم حساب Waves فقط.',
    nameLabel: 'اسم الشخص المدمج',
    namePlaceholder: 'مثال: أليكس',
    hasContact: 'لديك بيانات الاتصال الخاصة به',
    warningTitle: 'لا يمكن التراجع عن هذا',
    warningBody: 'تُجمع أرصدتهم المنفصلة في شخص واحد نهائيًا. لا توجد طريقة لفصلهم مرة أخرى.',
    cta: 'دمج',
    selected: { one: 'تم اختيار شخص واحد', other: 'تم اختيار {n} أشخاص' },
    errorTooFew: 'اختر شخصين على الأقل للدمج.',
    errorNotMergeable: 'يمكنك دمج الضيوف الذين تشاركهم مجموعة فقط.',
    errorNameRequired: 'أعطِ الشخص المدمج اسمًا.',
    errorNotSignedIn: 'أنت مسجّل الخروج. سجّل الدخول وحاول الدمج مرة أخرى.',
    errorGeneric: 'تعذّر الدمج. يرجى المحاولة مرة أخرى.',
    inGroups: { one: 'في مجموعة واحدة', other: 'في {n} مجموعات' },
  },
  a11y: {
    skipToContent: 'انتقل إلى المحتوى',
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
    continueWithApple: 'المتابعة عبر Apple',
    doorWelcome: 'أهلًا بك في Waves',
    doorSub: 'سجّل الدخول وتابع من حيث توقّفت مجموعاتك.',
    emailLabel: 'البريد الإلكتروني',
    passwordLabel: 'كلمة المرور',
    showPassword: 'إظهار كلمة المرور',
    hidePassword: 'إخفاء كلمة المرور',
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
    youLent: 'أنت أقرضت',
    youBorrowed: 'أنت اقترضت',
    notInvolved: 'لست طرفًا',
    paidBy: 'دفعه',
    splitLabel: 'التقسيم',
    total: 'الإجمالي',
    history: 'السجل',
    createdByName: 'أضافها {name}',
    editedByName: 'عدّلها {name}',
    noChanges: 'لم يتغيّر أي حقل متتبَّع',
    audit: {
      yourShare: 'رصيدك',
      amount: 'المبلغ',
      description: 'الوصف',
      category: 'الفئة',
      split: 'التقسيم',
      date: 'التاريخ',
      location: 'المكان',
      payers: 'من دفع',
      participants: 'مقسومة بين',
      none: 'لا شيء',
    },
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
    dispute: 'لم تصلني',
    disputing: 'جارٍ التسجيل…',
    disputeConfirm: 'هل تقول إن هذه الدفعة لم تصلك؟',
    withdraw: 'سحب',
    withdrawing: 'جارٍ السحب…',
    withdrawConfirm: 'سحب هذه الدفعة؟',
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
    changedElsewhere:
      'غيّر شخص آخر هذه المجموعة بينما كانت هذه الصفحة مفتوحة. نسخته ظاهرة أعلاه — راجعها ثم احفظ من جديد.',
    danger: 'انتبه',
  },
  theme: {
    label: 'المظهر',
    system: 'الجهاز',
    light: 'فاتح',
    dark: 'داكن',
    lightHint: 'خلفية الخزامى الفاتحة.',
    darkHint: 'أرفق بالعينين ليلًا.',
    currently: 'حاليًا {scheme}',
    systemHint: 'يتبع ما هو مضبوط عليه هذا الجهاز.',
    footnote: 'اتباع هاتفك يجعل التطبيق يصير داكنًا حين يصير هاتفك داكنًا.',
  },
  comments: {
    title: 'التعليقات',
    emptyTitle: 'لا تعليقات بعد',
    empty: 'ابدأ المحادثة.',
    placeholder: 'أضف تعليقًا…',
    post: 'نشر التعليق',
    posting: 'جارٍ النشر…',
    edit: 'تعديل',
    save: 'حفظ',
    cancel: 'إلغاء',
    delete: 'حذف',
    deleteConfirm: 'حذف هذا التعليق؟',
    edited: 'مُعدّل',
    report: 'إبلاغ',
    reported: 'تم الإبلاغ',
    resolve: 'حل',
    you: 'أنت',
    remaining: 'بقي {count}',
  },
  imageAudit: {
    receiptAdded: 'أضاف {name} الإيصال',
    receiptRemoved: 'أزال {name} الإيصال',
    attachmentAdded: 'أضاف {name} مرفقًا',
    attachmentRemoved: 'أزال {name} مرفقًا',
    partyOnly: 'خاص',
  },
  receipt: {
    title: 'الإيصال',
    theBill: 'الفاتورة',
    attachment: 'مرفق',
    partyOnly: 'لأطراف هذه الفاتورة فقط',
    missing: 'لم تعد هذه الصورة هنا',
    notAvailableHere: 'غير قابلة للعرض في المتصفح بعد',
    openOriginal: 'فتح الأصل',
    openShared: 'فتح النسخة المشتركة',
    close: 'إغلاق',
  },
  settings: {
    title: 'الإعدادات',
    profile: 'أنت',
    displayName: 'الاسم',
    currency: 'العملة الافتراضية',
    country: 'الدولة',
    paymentHandle: 'عنوان الدفع',
    paymentHandleBody: 'يظهر لمن يسدد لك، ليدفع دون أن يسأل.',
    paymentRail: 'يُدفع عبر',
    save: 'حفظ',
    saved: 'تم الحفظ',
    notifications: 'ما الذي نخبرك به',
    notifyInvolvesMe: 'ما يخصني فقط',
    notifyDigest: 'ملخص يومي لنشاط المجموعة',
    notifySettlements: 'حين يدفع لي أحد أو يطلب تأكيدًا',
    notifyNudges: 'التذكيرات التي يرسلها أحدهم',
    notifyWeekly: 'بريد أسبوعي',
    notifyEmail: 'راسلني بالبريد',
    language: 'اللغة',
    languageBody: 'تغيير هذا يعيد تحميل الصفحة.',
    guestTitle: 'أنت ضيف',
    guestBody: 'أضف بريدًا ليمكن فتح هذا الحساب على جهاز آخر.',
    signOut: 'تسجيل الخروج',
    onlyInApp: 'في التطبيق',
    onlyInAppBody:
      'مسح الإيصالات، وقول المصروف صوتًا، والإدخال دون إنترنت، وسجلك الخاص — كلها في تطبيق الهاتف.',
    sectionAccount: 'الحساب',
    sectionPreferences: 'التفضيلات',
    sectionData: 'البيانات والخصوصية',
    sectionSecurity: 'الأمان',
    sectionHelp: 'المساعدة',
    languageFootnote:
      'لغة هاتفك هي الافتراضية، والاختيار هنا يغيّر Waves وحده. تبقى المبالغ والتواريخ تابعة لمكانك — قراءة التطبيق بالهندية في دبي لا تنقلك إلى الهند.',
  },
  categories: {
    food: 'طعام وشراب',
    groceries: 'بقالة',
    travel: 'تنقّل',
    stay: 'إقامة',
    shopping: 'تسوّق',
    entertainment: 'ترفيه',
    home: 'المنزل والفواتير',
    health: 'صحة',
    gifts: 'هدايا',
    other: 'أخرى',
  },
  person: {
    acrossGroups: 'في المجموعات التي تشاركانها',
    notFound: 'لا يوجد هذا الشخص هنا',
    notFoundBody: 'ربما غادر هذه المجموعة، أو أن الرابط غير صحيح.',
    you: 'أنت',
    admin: 'مشرف',
    notJoinedYet: 'لم ينضم بعد',
    left: 'غادر هذه المجموعة',
    onCount: { one: 'على فاتورة واحدة', other: 'على {n} فواتير' },
    noneHere: '{name} ليس على أي فاتورة هنا بعد.',
    squareWith: 'أنتما متعادلان.',
    findRow: 'ابحث عن شخص',
    findRowHint: 'ببريده الإلكتروني أو رقم هاتفه بالضبط',
    findTitle: 'ابحث عن شخص',
    findHint: 'اكتب بالضبط البريد الإلكتروني أو رقم الهاتف الذي يستخدمه على Waves.',
    findPlaceholder: 'بريد إلكتروني أو هاتف',
    findAction: 'بحث',
    findNoMatch: 'لا يوجد تطابق',
    findNoMatchBody: 'لا أحد يستخدم ذلك، أو أنه اختار ألا يُعثر عليه بهذه الطريقة.',
    findRateLimited: 'يكفي بحثًا اليوم. حاول مرة أخرى غدًا.',
    alreadyShared: 'تجمعكما مجموعة بالفعل',
    notSharedYet: 'لم تقاسم معه شيئًا بعد.',
    startGroup: 'ابدأ مجموعة',
  },
  exportData: {
    title: 'تصدير',
    body: 'كل ما في هذه المجموعة كملف، للاحتفاظ به أو فتحه في جدول بيانات.',
    csv: 'تنزيل CSV',
    json: 'تنزيل JSON',
    working: 'يتم إنشاء الملف…',
    row: 'تصدير البيانات',
    rowHint: 'JSON + CSV، بلا فقدان، مجانًا',
    accountTitle: 'تصدير بياناتك',
    everythingFree: 'كل شيء، مجانًا دائمًا',
    explain:
      'يتضمن JSON كل نسخة من كل مصروف، ومن دفع، ومن عليه، والتسويات مع توزيعها على كل مصروف، وسجل النشاط — بما يكفي لإعادة بناء دفترك تمامًا. أما CSV فهو العرض الجدولي، ويشمل تفاصيل التسوية لكل شخص.',
    format: 'الصيغة',
    formatJson: 'JSON (بلا فقدان)',
    formatCsv: 'CSV (جدول بيانات)',
    formatPdf: 'PDF (قابل للطباعة)',
    whatToExport: 'ما الذي تريد تصديره',
    allMyGroups: 'كل مجموعاتي',
    preparing: 'جارٍ التحضير…',
    action: 'تصدير',
    ready: 'التصدير جاهز',
    failed: 'تعذّر تصدير بياناتك. حاول مرة أخرى.',
  },
  developers: {
    title: 'المطوّرون',
    intro:
      'ابنِ على بيانات Waves الخاصة بك: رمز لبرنامجك النصي، أو تطبيق يستطيع الآخرون ربطه بحساباتهم.',
    notConfigured: 'واجهة المطوّرين غير مهيّأة في هذا النشر.',
    notConfiguredBody: 'اضبط NEXT_PUBLIC_WAVES_API_URL على عنوان واجهة Waves ثم أعد تحميل الصفحة.',
    copy: 'نسخ',
    copied: 'تم النسخ',
    copyFailed: 'انسخه يدويًا — لم يسمح المتصفّح للصفحة بفعل ذلك.',
    permissions: 'الأذونات',
    signInAgain: 'انتهت جلستك في Waves. سجّل الدخول من جديد ثم افتح هذا الرابط مرة أخرى.',
    tokens: {
      title: 'رموز الوصول الشخصية',
      body: 'يتصرّف الرمز نيابةً عنك، ضمن الأذونات التي تختارها فقط. عامله ككلمة مرور ولا تضعه في أي شيء تنشره.',
      empty: 'لم تُنشئ أي رمز بعد.',
      name: 'لأي غرض هو؟',
      namePlaceholder: 'برنامج النسخ الاحتياطي',
      expiryDays: 'ينتهي بعد (أيام)',
      expiryBody: 'اترك الحقل فارغًا لرمز لا ينتهي.',
      create: 'إنشاء رمز',
      creating: 'جارٍ الإنشاء…',
      revoke: 'إبطال',
      revoking: 'جارٍ الإبطال…',
      revokedTag: 'مُبطَل',
      expiredTag: 'منتهٍ',
      expires: 'ينتهي في {date}',
      neverExpires: 'بلا انتهاء',
      lastUsed: 'آخر استخدام في {date}',
      neverUsed: 'لم يُستخدم قط',
      createdTitle: 'رمزك الجديد',
      onlyOnce:
        'انسخه الآن. هذه هي المرة الوحيدة التي يظهر فيها — إذ لا يحتفظ Waves إلا ببصمته ولا يمكنه عرضه ثانية.',
      prefix: 'يبدأ بـ {prefix}',
    },
    apps: {
      title: 'التطبيقات',
      body: 'يطلب التطبيق الإذن من الآخرين ثم يتصرّف نيابةً عنهم. وكل من يربطه سيرى الاسم والموقع اللذين تكتبهما هنا.',
      empty: 'لم تسجّل أي تطبيق.',
      name: 'الاسم',
      namePlaceholder: 'مقسّم الرحلات',
      description: 'ماذا يفعل',
      website: 'الموقع الإلكتروني',
      redirects: 'عناوين الإعادة',
      redirectsBody: 'عنوان في كل سطر. لن يعيد Waves أحدًا إلا إلى عنوان مذكور هنا.',
      kind: 'أين يعمل؟',
      confidential: 'على خادم يستطيع حفظ السر',
      publicClient: 'على هاتف أو في متصفّح، حيث لا يستطيع',
      register: 'تسجيل التطبيق',
      registering: 'جارٍ التسجيل…',
      clientId: 'معرّف العميل',
      rotate: 'سر جديد',
      rotating: 'جارٍ الإنشاء…',
      enable: 'تفعيل',
      disable: 'تعطيل',
      disabledTag: 'معطّل',
      delete: 'حذف',
      deleteConfirm: 'حذف نهائي؟',
      deleting: 'جارٍ الحذف…',
      secretTitle: 'سرّ العميل الجديد',
      secretOnce:
        'انسخه الآن. هذه هي المرة الوحيدة التي يظهر فيها؛ وإنشاء سرّ جديد لا يُخرج أحدًا — إنما يوقف عمل السرّ القديم.',
      publicNote: 'العميل العام بلا سر، وPKCE هو ما يثبت أن الطلب جاء منه فعلًا.',
    },
    connections: {
      title: 'التطبيقات المرتبطة',
      body: 'تطبيقات سمحت لها بالتصرّف نيابةً عنك. وفصل أحدها يُبطل كل رموزه.',
      empty: 'لا شيء مرتبط بحسابك.',
      connected: 'ارتبط في {date}',
      lastUsed: 'آخر استخدام في {date}',
      neverUsed: 'لم يُستخدم بعد',
      disconnect: 'فصل',
      disconnecting: 'جارٍ الفصل…',
    },
    consent: {
      title: 'الموافقة على الوصول',
      wants: 'يريد {app} التصرّف نيابةً عنك',
      by: 'سجّله {owner}',
      website: 'الموقع الإلكتروني',
      ableTo: 'سيتمكّن من:',
      approve: 'موافقة',
      approving: 'جارٍ الموافقة…',
      cancel: 'إلغاء',
      refused: 'لن يعرض Waves هذا الطلب.',
      refusedBody:
        'التطبيق، أو العنوان الذي طلب الإعادة إليه، أو الإذن الذي طلبه، لا يطابق ما سجّله مطوّره. لم تتم مشاركة أي شيء ولا يوجد هنا ما يُوافَق عليه.',
      badRequest: 'ينقص هذا الرابط شيء يحتاجه Waves، فلا يوجد ما يُوافَق عليه.',
      back: 'العودة إلى صفحة المطوّرين',
    },
    scope: {
      'identity.read': 'رؤية اسمك وصورتك وعملتك الافتراضية.',
      'identity.write': 'تغيير بيانات ملفك الشخصي.',
      'groups.read': 'رؤية مجموعاتك ومن فيها وما على كل شخص.',
      'groups.write': 'إنشاء المجموعات وإعادة تسميتها وإضافة الأشخاص أو إزالتهم.',
      'expenses.read': 'رؤية المصروفات في مجموعاتك.',
      'expenses.write': 'إضافة المصروفات في مجموعاتك وتعديلها وحذفها.',
      'settlements.read': 'رؤية المدفوعات المسجّلة بينك وبين الآخرين.',
      'settlements.write': 'تسجيل المدفوعات وتأكيدها نيابةً عنك.',
      'friends.read': 'رؤية من تدين له ومن يدين لك، في كل المجموعات.',
      'categories.read': 'رؤية فئات مصروفاتك.',
      'categories.write': 'إضافة فئات مصروفاتك وتغييرها وإخفاؤها.',
      offline_access: 'البقاء متصلًا دون أن يسألك مرة أخرى.',
    },
  },
  agents: {
    signedInAs: 'مسجّل الدخول باسم {email}',
    willBeAbleTo: 'إذا وافقت، سيكون بإمكانه:',
    reads: 'قراءة مجموعاتك ومصروفاتك وأرصدتك ومن تتقاسم معهم',
    writes: 'إضافة مصروفات وإنشاء مجموعات وتسجيل التسويات',
    asYou: 'يتصرّف نيابة عنك. يصل إلى ما تصل إليه أنت فقط، ولا شيء غير ذلك.',
    neverMoves: 'لا يمكنه تحويل الأموال. التسويات تُسجَّل فقط؛ الدفع يبقى بيدك.',
    deny: 'رفض',
    denying: 'جارٍ الرفض…',
    unverified: 'لم تتحقّق Waves من هذا التطبيق.',
  },
  errors: {
    couldNotLoad: 'تعذّر تحميل هذا. حاول بعد قليل.',
    couldNotSignIn: 'تعذّر تسجيل الدخول. حاول مرة أخرى.',
    passwordTooShort: 'استخدم 8 أحرف على الأقل — عبارة أسهل في التذكّر من لغز.',
    passwordTooCommon: 'هذه من أوّل كلمات المرور التي يجرّبها أي شخص.',
    couldNotSave: 'لم يُحفظ ذلك. حاول بعد قليل.',
    offline: 'يبدو أنك غير متصل. تحقّق من اتصالك وحاول مجدداً.',
    tooMany: 'محاولات كثيرة متتالية. انتظر قليلاً ثم حاول مجدداً.',
    tryAgain: 'حاول مجدداً',
  },
  account: {
    title: 'حسابك',
    you: 'أنت',
    yourAccount: 'حسابك',
    yourAccountHint: 'اسمك، وأين أنت، والطرق إلى حسابك',
    guestTitle: 'حساب ضيف',
    guestBody:
      'كل ما أدخلته محفوظ بالفعل وهو ملكك. اربط حساب Google أو Apple متى أردت الوصول إليه من جهاز آخر — سيحتفظ بهذا الحساب بدل أن يبدأ حسابًا جديدًا.',
    detailsTitle: 'بياناتك',
    displayNameHint: 'يراه كل من تشاركه مجموعة.',
    countryNotSet: 'غير محدد',
    currencyFromCountry: 'يُضبط حسب بلدك',
    addressTitle: 'العنوان',
    addressHint: 'لا يُرسل إليه شيء. محفوظ لسجلك فقط.',
    addressPlaceholder: 'الشارع، المدينة، الرمز البريدي',
    signInMethodsTitle: 'طرق تسجيل الدخول',
    signInMethodsBody: 'اربط حسابًا وستتمكّن من تسجيل الدخول به في المرة القادمة، من أي جهاز.',
    signInFootnote:
      'لا يطلب Waves هذا ليسمح لك بالدخول، ولا يشاركه مع أحد في مجموعاتك. يرى الناس الاسم الذي تختاره، لا غير.',
    emailAddress: 'البريد الإلكتروني',
    alreadyAdded: 'مضاف بالفعل: {value}',
    notAddedYet: 'لم يُضَف بعد',
    link: 'ربط',
    linkProvider: 'ربط {provider}',
    linked: 'مرتبط',
    payingTitle: 'الدفع',
    howPeoplePayYou: 'كيف يدفع لك الناس',
    settlesWith: 'تُسوَّى عبر {rails}',
    handleWrong: 'هذا لا يبدو مثل {hint}.',
    railLinkNote: 'من يسوّي معك يدفع بضغطة واحدة. Waves لا يلمس المال أبدًا.',
    railManualNote: 'من يسوّي معك يرى هذا ليدفع لك من تطبيق مصرفه. Waves لا يلمس المال أبدًا.',
    nothingToAdd: 'لا شيء تضيفه — سيسجّل الناس ما دفعوه لك يدويًا.',
  },
  notifications: {
    title: 'الإشعارات',
    rowHint: 'ما يجوز لـ Waves أن يقاطعك بسببه',
    neverSpam:
      'لا يرسل Waves بريدًا عن نشاط المصروفات المعتاد. ستة أشياء فقط قد ترغب فعلًا في وصولها إلى بريدك، ويمكن إيقاف كل منها وحده.',
    pushSection: 'الإشعارات الفورية',
    pushOnWeb:
      'هذه الأربعة تقرّر ما يرسله إليك تطبيق الهاتف. والمتصفّح ليس جهازًا مسجَّلًا، فلا شيء هنا سيرنّ على هذا الجهاز.',
    involvesMe: 'ما يخصّني فقط',
    involvesMeBody: 'إشعار حين يكون عليك أو لك أو حين تُذكر — لا لكل مصروف في كل مجموعة.',
    settlementRequests: 'تأكيدات التسوية',
    settlementRequestsBody: 'حين يقول أحدهم إنه دفع لك، كي يبقى باقيك صحيحًا.',
    nudges: 'التذكيرات',
    nudgesBody: 'تذكير لطيف بالمال المستحق. مرة واحدة لكل شخص يوميًا، بحدٍّ في قاعدة البيانات.',
    digest: 'ملخص المجموعة اليومي',
    digestBody: 'كل ما تبقّى، مجمّعًا في إشعار واحد يوميًا بدل تدفق مستمر.',
    emailSection: 'عبر البريد',
    emailAll: 'راسلني بالبريد',
    emailAllBody:
      'التسويات والتذكيرات والملخص الأسبوعي. تنبيه الأمان عند تسجيل دخول جديد يصل مهما كان هذا الإعداد.',
    weeklyEmail: 'ملخص أسبوعي بالبريد',
    weeklyEmailBody: 'صافي باقيك والتأكيدات المعلّقة، مرة كل أسبوع. متوقف افتراضيًا.',
    footnote:
      'البريد لم يصل بعد. كل ما هنا موجود أيضًا في صندوقك، وهو سجل ما أخبرك به Waves سواء وصل إشعار أم لا.',
  },
  billing: {
    row: 'الخطة',
    rowHint: 'خطة مجانية — كل شيء مُتضمَّن، لا شيء للشراء',
    title: 'الخطة',
    nothingToBuy: 'لا شيء للشراء بعد',
    nothingToBuyBody:
      'هذا هو الباب، لا المتجر. حين يوجد ما يستحق الدفع سيكون هنا، بسعره ودون مفاجآت.',
    whatWouldCost: 'ما الذي قد يكلّف مالًا يومًا',
    moreScans: 'مسح فواتير أكثر',
    moreScansBody:
      'صوّر إيصالًا لتُقرأ أصنافه. كل عملية مسح تكلّف مالًا حقيقيًا، وهذا هو السبب الصريح لكونها الشيء الوحيد المحدود.',
    biggerTransfers: 'تصدير واستيراد أكبر',
    biggerTransfersBody:
      'بياناتك لك وتخرج كاملة مجانًا. الأعمال الأكبر والنسخ الاحتياطي المجدول هي الراحة التي تُدفع.',
    whatNeverWill: 'وما لن يكلّف أبدًا',
    whatNeverWillBody:
      'الدفتر. المجموعات والمصاريف والتقسيمات والأرصدة والتسوية، وإخراج كل ذلك مرة أخرى — {free}. الدفتر الذي لا تقرأ منه إلا نصفه ليس دفترًا.',
    freeForever: 'بلا حدود ومجاني، للأبد',
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
