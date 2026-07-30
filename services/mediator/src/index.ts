// services/mediator/src/index.ts
// The mediator's public surface. Other services talk to it over HTTP for
// anything stateful; only pure helpers are shared as code, so the queue rules
// stay in exactly one process.
export * from './target.interface';
export * from './stripe.webhook';
