// services/api/src/tokens.ts
// Injection tokens for the two dependencies that are not classes of our own: the
// database pool and whatever implements the intake port. Keeping them here means
// no controller has to import the wiring it is injected with.
export const POOL = Symbol('POOL');
export const EVENT_INTAKE = Symbol('EVENT_INTAKE');
