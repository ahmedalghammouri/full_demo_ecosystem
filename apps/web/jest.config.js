/**
 * The web app's test runner.
 *
 * ── Why it resolves ts-jest from the API workspace ──────────────────────────
 * This app had no test runner at all, and adding one meant either new
 * devDependencies and a lockfile change, or reusing what the monorepo already
 * installs. The edge gateway's config takes the same route for the same reason.
 *
 * That is a compromise and worth naming: `pnpm --filter web test` works from a
 * checkout that has installed the API workspace, and not otherwise. If the web
 * app grows a real suite, give it its own devDependency and delete this note.
 *
 * ── What belongs here ───────────────────────────────────────────────────────
 * Pure logic — the decisions a component makes before it draws anything. There
 * is no DOM environment configured, deliberately: a rendering test needs jsdom
 * and testing-library, and pretending to offer that while offering neither
 * would be worse than saying plainly that this runs pure functions.
 */
const path = require('path');

const API = path.resolve(__dirname, '../api');
const tsJest = require.resolve('ts-jest', { paths: [API] });

module.exports = {
  rootDir: path.resolve(__dirname, 'src'),
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  testRegex: '.*\\.spec\\.tsx?$',
  transform: {
    // tsconfig.spec.json, not the app's — the app config excludes specs so that
    // `next build` (and the Docker web stage, which has no API workspace to
    // borrow jest's types from) never needs them.
    '^.+\\.tsx?$': [tsJest, {
      tsconfig: path.resolve(__dirname, 'tsconfig.spec.json'),
      isolatedModules: true,
    }],
  },
  moduleNameMapper: {
    '^@/(.*)$': path.resolve(__dirname, 'src/$1'),
  },
};
