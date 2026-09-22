/**
 * Three people and a plus — "start a group", as one mark.
 *
 * Supplied rather than composed. The icon set has no glyph for this: Ionicons
 * offers `people` (two figures) and `person-add` (one figure, plus included),
 * and neither is right — a pair is not a group, and adding *a person* already
 * means something else in this app, a 1:1 ledger with them. An earlier version
 * of this file drew the mark from circles and rounded rectangles; this is the
 * artwork that replaced it, kept as the single path it arrived as so that it
 * stays the thing that was chosen rather than a redrawing of it.
 *
 * It is an outline mark, and the holes are part of the path — hence
 * `fillRule="evenodd"`, without which the figures fill solid and the whole
 * thing reads as a blob at icon size.
 *
 * The `viewBox` is the artwork's own bounds, not the 100×125 box it was
 * exported in. That export carries an empty strip at the bottom and slack at
 * the top; used as-is the mark renders at about half the height it is given and
 * sits high in its box. These numbers are the measured extent of the path
 * (x 4.8–95.2, y 20.3–79.7) with a hair of padding, so `size` means what it
 * means for an Ionicon: the height the mark actually occupies.
 */
import Svg, { Path } from 'react-native-svg';

/** The artwork's own bounds. Changing the path means re-measuring these. */
const VIEW_BOX = { x: 4, y: 20, width: 92, height: 60.5 };

const GROUP_ADD_PATH =
  'M89.612,67.837c0.003,0.728-0.278,1.415-0.793,1.932c-0.52,0.522-1.215,0.812-1.96,0.812l-6.44-0.032l0.034,6.425' +
  'c0.002,0.745-0.283,1.444-0.805,1.966c-0.515,0.52-1.196,0.804-1.927,0.804H77.71c-1.501-0.008-2.729-1.247-2.74-2.765' +
  'l-0.029-6.457l-6.66-0.036c-1.516-0.006-2.758-1.231-2.765-2.735c-0.003-0.73,0.277-1.415,0.792-1.933' +
  'c0.522-0.523,1.219-0.812,1.96-0.812l6.644,0.035l-0.031-6.634c-0.005-0.745,0.28-1.444,0.803-1.967' +
  'c0.512-0.518,1.196-0.802,1.926-0.802c1.518,0.007,2.743,1.245,2.75,2.766l0.034,6.663l6.455,0.029' +
  'C88.363,65.104,89.603,66.332,89.612,67.837z M63.81,73.647H31.024c-2.151,0-3.897-1.743-3.897-3.897' +
  'c0-0.822,0.059-1.627,0.144-2.422H8.72c-2.152,0-3.896-1.746-3.896-3.898c0-6.979,4.081-13.023,9.981-15.874' +
  'c-2.598-2.181-4.251-5.45-4.251-9.1c0-6.551,5.329-11.88,11.879-11.88c6.553,0,11.882,5.33,11.882,11.88' +
  'c0,3.649-1.654,6.919-4.251,9.1c2.178,1.052,4.104,2.542,5.672,4.348c2.016-1.615,4.298-2.908,6.786-3.77' +
  'c-4.458-2.588-7.465-7.418-7.465-12.935c0-8.24,6.701-14.944,14.941-14.944c8.239,0,14.943,6.704,14.943,14.944' +
  'c0,5.517-3.006,10.347-7.468,12.935c2.489,0.862,4.771,2.155,6.786,3.77c1.571-1.806,3.495-3.296,5.672-4.348' +
  'c-2.598-2.181-4.251-5.45-4.251-9.1c0-6.551,5.332-11.88,11.881-11.88c6.552,0,11.883,5.33,11.883,11.88' +
  'c0,3.649-1.652,6.919-4.251,9.1c5.899,2.851,9.981,8.895,9.981,15.874c0,1.051-0.421,2.004-1.098,2.701' +
  'c-0.425-1.754-1.474-3.269-2.899-4.299c-0.793-6.819-6.581-12.117-13.616-12.117c-4.2,0-7.956,1.894-10.472,4.871' +
  'c1.211,1.366,2.255,2.878,3.115,4.505l0.005,1.247l-1.919-0.009c-0.587,0-1.16,0.072-1.713,0.201' +
  'c-0.481-0.867-1.03-1.692-1.639-2.468c-0.854-1.089-1.82-2.087-2.886-2.967c-3.277-2.699-7.478-4.32-12.056-4.32' +
  'c-4.579,0-8.776,1.621-12.055,4.32c-1.067,0.88-2.034,1.878-2.887,2.967c-1.254,1.601-2.26,3.408-2.951,5.367' +
  'c-0.439,1.245-0.752,2.548-0.923,3.898c-0.102,0.793-0.16,1.6-0.16,2.422h30.105C61.578,71.326,62.535,72.683,63.81,73.647z' +
  ' M77.562,46.439c4.41,0,7.985-3.575,7.985-7.983c0-4.409-3.575-7.983-7.985-7.983c-4.408,0-7.982,3.575-7.982,7.983' +
  'C69.58,42.864,73.154,46.439,77.562,46.439z M49.999,46.242c6.101,0,11.045-4.945,11.045-11.044' +
  'c0-6.101-4.944-11.047-11.045-11.047c-6.101,0-11.044,4.947-11.044,11.047C38.955,41.297,43.898,46.242,49.999,46.242z' +
  ' M22.434,46.439c4.408,0,7.984-3.575,7.984-7.983c0-4.409-3.576-7.983-7.984-7.983c-4.408,0-7.981,3.575-7.981,7.983' +
  'C14.453,42.864,18.026,46.439,22.434,46.439z M32.909,54.586c-2.516-2.978-6.271-4.871-10.476-4.871' +
  'c-7.573,0-13.713,6.139-13.713,13.715h19.314C28.989,60.11,30.673,57.104,32.909,54.586z';

export function GroupAddIcon({ size = 22, color }: { size?: number; color: string }) {
  // The caller sizes by height, the same way an Ionicon's `size` means its line
  // height; the mark is wider than it is tall, so width follows from its ratio.
  const width = (size * VIEW_BOX.width) / VIEW_BOX.height;
  return (
    <Svg
      width={width}
      height={size}
      viewBox={`${VIEW_BOX.x} ${VIEW_BOX.y} ${VIEW_BOX.width} ${VIEW_BOX.height}`}
      fill="none"
    >
      <Path d={GROUP_ADD_PATH} fill={color} fillRule="evenodd" />
    </Svg>
  );
}
