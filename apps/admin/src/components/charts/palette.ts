/**
 * The chart palette and the ink around it, in one place.
 *
 * ECharts paints into its own tree and cannot read the CSS custom properties
 * the rest of the console uses, so the hues are duplicated here as plain hex
 * and kept in step with the `--c-*` tokens in `globals.css` by hand. They are
 * the reference dashboard's accent ramp: Tailwind blue/emerald/amber/red/
 * violet at the 500 step.
 *
 * The hues are fixed across light and dark on purpose — a series that changed
 * colour with the OS theme would be recolouring the data. The *chrome* around
 * them (axis lines, tick labels, the number in the doughnut's hole) is not
 * data and does have to follow the theme, so it lives in `AXIS` and is picked
 * by the one client hook below.
 */

export const PALETTE = {
  blue: '#3b82f6',
  green: '#10b981',
  amber: '#f59e0b',
  red: '#ef4444',
  purple: '#8b5cf6',
} as const;

/** The order slices and series cycle through when a colour is not named. */
export const WHEEL = [
  PALETTE.blue,
  PALETTE.purple,
  PALETTE.green,
  PALETTE.amber,
  PALETTE.red,
  '#06b6d4',
  '#ec4899',
  '#84cc16',
] as const;

export interface ChartInk {
  /** Axis lines and the doughnut's gaps. */
  line: string;
  /** Split lines behind the plot. */
  grid: string;
  /** Tick labels and legend text. */
  label: string;
  /** The one big number in the middle of a doughnut. */
  ink: string;
  /** Tooltip card. */
  tooltipBg: string;
  tooltipBorder: string;
}

export const AXIS: Record<'light' | 'dark', ChartInk> = {
  light: {
    line: '#e5e7eb', // gray-200
    grid: '#f3f4f6', // gray-100
    label: '#6b7280', // gray-500
    ink: '#111827', // gray-900
    tooltipBg: '#ffffff',
    tooltipBorder: '#e5e7eb',
  },
  dark: {
    line: '#4b5563', // gray-600
    grid: '#374151', // gray-700
    label: '#9ca3af', // gray-400
    ink: '#f9fafb', // gray-50
    tooltipBg: '#1f2937', // gray-800
    tooltipBorder: '#4b5563',
  },
};
