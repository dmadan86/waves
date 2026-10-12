/**
 * The import screen's step machine, as a reducer.
 *
 * Source, then (for a plain spreadsheet) Columns, then People, Review, Commit and
 * Result. Keeping every transition here, pure, is what makes the rules testable
 * without a renderer: the Columns step is skipped for a format whose columns are
 * known, "back" always lands on the step the person actually came through, a
 * name keeps its answer when the columns change under it, and a retry after a
 * dropped connection reuses the batch and row ids so it replays rather than
 * duplicates.
 *
 * It holds the person's choices, not what is derived from them. The draft, the
 * resolved rows and the review model are computed from this state by the screen,
 * so there is one source of truth and nothing here can drift from it.
 */

import type { DetectedLayout, ImportDateOrder, DecimalStyle, TableRead } from '@waves/core';

import { remapColumn, type ColumnChoice } from './columns';
import { GHOST, seedMapping } from './people';
import type { ReviewFilter, RowEdit } from './review';

export type Step = 'source' | 'columns' | 'people' | 'review' | 'commit' | 'result';
export type SheetName = 'examples' | 'upsell';
export type ReadStage = 'reading' | 'parsing';

/** What went wrong reading the file, as a key the screen turns into a sentence. */
export type SourceError =
  'too_large' | 'too_many_rows' | 'empty' | 'encoding' | 'unreadable' | 'no_columns' | 'no_rows';

/** The counts a finished import reports. */
export interface ImportOutcome {
  batchId: string;
  expenses: number;
  settlements: number;
  ghosts: number;
}

export type UndoState =
  | { phase: 'idle' }
  | { phase: 'working' }
  | { phase: 'done'; expenses: number }
  | { phase: 'failed'; message: string };

export interface ImportState {
  step: Step;
  sheet: SheetName | null;
  stage: ReadStage | null;
  error: SourceError | null;
  fileName: string | null;
  fileKind: 'csv' | 'xlsx' | null;
  table: TableRead | null;
  layout: DetectedLayout | null;
  /** The layout as first detected, to tell the columns we found from the ones the person set. */
  detected: DetectedLayout | null;
  /** Whether the file's columns were not known, so the Columns step is part of the way. */
  needsColumns: boolean;
  /** File name to member id, or `'ghost'`. A name with no entry has not been answered. */
  mapping: Record<string, string>;
  /** Names matched by the app rather than chosen, for the "Matched by name" badge. */
  matched: Record<string, true>;
  filter: ReviewFilter;
  edits: Record<string, RowEdit>;
  ticks: Record<string, boolean>;
  /** Fixed when the import is first started and kept for every retry. */
  batchId: string | null;
  ids: Record<string, string>;
  outcome: ImportOutcome | null;
  undo: UndoState;
}

export const INITIAL_STATE: ImportState = {
  step: 'source',
  sheet: null,
  stage: null,
  error: null,
  fileName: null,
  fileKind: null,
  table: null,
  layout: null,
  detected: null,
  needsColumns: false,
  mapping: {},
  matched: {},
  filter: 'all',
  edits: {},
  ticks: {},
  batchId: null,
  ids: {},
  outcome: null,
  undo: { phase: 'idle' },
};

export type ImportAction =
  | { type: 'openSheet'; sheet: SheetName }
  | { type: 'closeSheet' }
  | { type: 'readStage'; stage: ReadStage }
  | { type: 'readFailed'; error: SourceError }
  | {
      type: 'loaded';
      fileName: string;
      fileKind: 'csv' | 'xlsx';
      table: TableRead;
      layout: DetectedLayout;
    }
  | { type: 'setColumn'; column: number; choice: ColumnChoice }
  | { type: 'setDateOrder'; order: ImportDateOrder }
  | { type: 'setDecimalStyle'; style: DecimalStyle }
  | {
      type: 'toPeople';
      people: readonly string[];
      matches: Readonly<Record<string, string>>;
    }
  | { type: 'mapPerson'; name: string; target: string }
  | { type: 'mapRestAsNew'; people: readonly string[] }
  | { type: 'toReview' }
  | { type: 'setFilter'; filter: ReviewFilter }
  | { type: 'tick'; key: string; ticked: boolean }
  | { type: 'editRow'; key: string; edit: RowEdit }
  | { type: 'clearEdit'; key: string }
  | { type: 'commitStarted'; batchId: string; ids: Record<string, string> }
  | { type: 'commitDone'; outcome: ImportOutcome }
  | { type: 'commitAbandoned' }
  | { type: 'undoStarted' }
  | { type: 'undoDone'; expenses: number }
  | { type: 'undoFailed'; message: string }
  | { type: 'back' }
  | { type: 'restart' };

/** The step before this one, for the way the person actually came. */
export function stepBefore(state: ImportState): Step {
  switch (state.step) {
    case 'columns':
      return 'source';
    case 'people':
      return state.needsColumns ? 'columns' : 'source';
    case 'review':
      return 'people';
    case 'commit':
      return 'review';
    default:
      return 'source';
  }
}

export function reduce(state: ImportState, action: ImportAction): ImportState {
  switch (action.type) {
    case 'openSheet':
      return { ...state, sheet: action.sheet };
    case 'closeSheet':
      return { ...state, sheet: null };

    case 'readStage':
      return { ...state, stage: action.stage, error: null };
    case 'readFailed':
      return { ...state, stage: null, error: action.error };

    case 'loaded': {
      const generic = action.layout.kind === 'generic';
      return {
        ...INITIAL_STATE,
        fileName: action.fileName,
        fileKind: action.fileKind,
        table: action.table,
        layout: action.layout,
        detected: action.layout,
        needsColumns: generic,
        step: generic ? 'columns' : 'people',
      };
    }

    case 'setColumn': {
      if (!state.layout || !state.table) return state;
      const header = state.table.rows[state.layout.headerRow] ?? [];
      return {
        ...state,
        layout: remapColumn(state.layout, header, action.column, action.choice),
      };
    }
    case 'setDateOrder':
      return state.layout
        ? { ...state, layout: { ...state.layout, dateOrder: action.order, dateAmbiguous: false } }
        : state;
    case 'setDecimalStyle':
      return state.layout
        ? {
            ...state,
            layout: { ...state.layout, decimalStyle: action.style, decimalAmbiguous: false },
          }
        : state;

    case 'toPeople': {
      // Anything the person already answered stays answered, even when the
      // columns changed around it; only names that have gone are dropped.
      const { mapping, matched } = seedMapping(
        action.people,
        Object.fromEntries(
          Object.entries(state.mapping).filter(([name]) => action.people.includes(name)),
        ),
        action.matches,
      );
      const kept: Record<string, true> = {};
      for (const name of Object.keys(matched)) kept[name] = true;
      for (const name of Object.keys(state.matched)) {
        if (mapping[name] !== undefined) kept[name] = true;
      }
      return { ...state, step: 'people', mapping, matched: kept };
    }
    case 'mapPerson': {
      const { [action.name]: _dropped, ...matched } = state.matched;
      return {
        ...state,
        mapping: { ...state.mapping, [action.name]: action.target },
        matched,
      };
    }
    case 'mapRestAsNew': {
      const mapping = { ...state.mapping };
      for (const name of action.people) mapping[name] ??= GHOST;
      return { ...state, mapping };
    }

    case 'toReview':
      return { ...state, step: 'review', filter: 'all' };
    case 'setFilter':
      return { ...state, filter: action.filter };
    case 'tick':
      return { ...state, ticks: { ...state.ticks, [action.key]: action.ticked } };
    case 'editRow':
      return {
        ...state,
        // An edit may fix a row that was left out: offer it ticked.
        ticks: { ...state.ticks, [action.key]: true },
        edits: { ...state.edits, [action.key]: { ...state.edits[action.key], ...action.edit } },
      };
    case 'clearEdit': {
      const { [action.key]: _edit, ...edits } = state.edits;
      return { ...state, edits };
    }

    case 'commitStarted':
      return {
        ...state,
        step: 'commit',
        batchId: state.batchId ?? action.batchId,
        ids: { ...action.ids, ...state.ids },
      };
    case 'commitDone':
      return { ...state, step: 'result', outcome: action.outcome, undo: { phase: 'idle' } };
    case 'commitAbandoned':
      // Back to the review with the batch forgotten: nothing landed (or the person
      // chose to leave what did), so the next go is a new import with new ids.
      return { ...state, step: 'review', batchId: null, ids: {} };

    case 'undoStarted':
      return { ...state, undo: { phase: 'working' } };
    case 'undoDone':
      return { ...state, undo: { phase: 'done', expenses: action.expenses } };
    case 'undoFailed':
      return { ...state, undo: { phase: 'failed', message: action.message } };

    case 'back':
      return state.step === 'source' || state.step === 'result' || state.step === 'commit'
        ? state
        : { ...state, step: stepBefore(state), error: null };
    case 'restart':
      return INITIAL_STATE;
  }
}
