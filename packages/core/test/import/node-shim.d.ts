// The core package carries no Node typings; fixtures are read with just this one function.
declare module 'node:fs' {
  export function readFileSync(path: URL): Uint8Array;
}
