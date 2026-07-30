// packages/db/src/index.ts
// The @ngl/db surface: one pool, one migration runner. Services import from
// here and never reach into src/ directly.
export * from './pool';
export * from './migrate';
