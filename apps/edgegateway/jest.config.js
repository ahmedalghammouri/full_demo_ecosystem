/**
 * Test config for the edge gateway.
 *
 * The gateway had no tests at all, which is a poor place for that gap: it is the
 * component that decides what a machine's state IS, and everything downstream —
 * downtime events, availability, OEE — inherits that decision.
 *
 * jest and ts-jest resolve through the pnpm workspace root rather than a local
 * dependency, so run this from the repo root or via the package script.
 */
module.exports = {
  rootDir: 'src',
  testEnvironment: 'node',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    // The gateway's Prisma client is generated at build time; these unit tests
    // inject a stub instead, so type-checking the generated client buys nothing
    // and would fail on a clean checkout.
    '^.+\\.(t|j)s$': ['ts-jest', { diagnostics: false }],
  },
};
