// packages/contracts/src/index.ts
// The @ngl/contracts surface. Every strand imports its shared types from here
// instead of inventing its own — that is what keeps five parallel strands from
// building past each other.
export * from './targets';
export * from './egress';
export * from './stream';
export * from './api';
