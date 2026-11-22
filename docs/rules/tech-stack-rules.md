# Tech stack rules

These rules set the technology and the code rules of Vision. They expand rules C34 to C50 of `CONSTITUTION.md`. The source is section 15 of the design and the implementation plan.

## Parts

| Part | Decision |
|---|---|
| Core rules | TypeScript in strict mode. Pure code with no platform imports. The clock, the random source and the hash are passed in. |
| Hub | Cloudflare Worker with one Durable Object for each organisation. The object has its own SQLite database, one alarm for the clocks, and WebSockets. Free plan. |
| Websites | TypeScript, React and Vite. One build with a route for each system. The hub serves the files. |
| Volunteer app | Kotlin, Jetpack Compose, coroutines and one activity. It runs on the Android emulator for the demo. |
| Google link | One Apps Script (V8) in a Google account. It reads and sends mail, serves the playbook sheet, and writes the ledger and statement tabs. |
| AI sorter | An open-weights model on Workers AI behind one interface. It stays off until a model passes the exam, and it is on for the finals with Gemma 4 26B (D27). |
| Fallback | The same hub runs on the laptop with the local Cloudflare tool. The emulator reaches it at `10.0.2.2`. |
| Checks | `make check` on the Mac. GitHub Actions runs the same gate after the first push. |

The hub works without Google. Then mail shows on the screen, the playbook comes from a file in the repository, and the ledger is a download.

## Versions

| Tool | Version |
|---|---|
| Node | 26.13.1 |
| pnpm | 10.34.1 |
| TypeScript | 6.0.3 |
| Zod | 4.6.7 |
| @noble/hashes | 2.4.0 |
| fast-check | 4.10.3 |
| Vitest | 4.1.12 |
| wrangler | 4.166.0 |
| @cloudflare/vitest-plugin | 1.9.0 |
| @cloudflare/workers-types | 5.20261121.1 |
| React | 19.3.1 |
| Vite | 8.3.8 |
| @vitejs/plugin-react | 6.3.0 |
| @testing-library/react | 16.3.3 |
| jsdom | 31.0.1 |
| Playwright | 1.65.1 |
| ESLint | 10.15.0 |
| typescript-eslint | 8.73.0 |
| Prettier | 3.10.1 |
| secretlint | 14.0.1 |
| Gradle | 9.1.0 |
| Android Gradle Plugin | 9.0.1, with built-in Kotlin |
| Kotlin plugins | 2.2.10 |
| Android SDK | compileSdk 36, minSdk 26 |
| Java | 17 |
| Compose BOM | 2025.10.01 |
| activity-compose | 1.11.0 |
| lifecycle | 2.9.4 |
| datastore-preferences | 1.1.7 |
| core-ktx | 1.17.0 |
| OkHttp | 4.12.0 |
| kotlinx-serialization-json | 1.9.0 |
| kotlinx-coroutines | 1.10.2 |
| JUnit | 4.13.2 |

Use the exact version in this table. If a version is not on the registry, use the closest published version. Then record the change in `docs/decisions.md` and tell the lead.

## Package boundaries

- `contracts` holds every shape that crosses a boundary, as Zod schemas and example files (C46).
- `packages/core` holds every rule and has no I/O (C47).
- `apps/hub` holds storage, transport, sign-in and outside calls.
- `apps/web` and `apps/android` hold screens only (C48).
- `exam` holds the sorter test. `tools` holds the scripts of the quality gate.
- A package imports only from a package below it: `contracts`, then `core`, then the apps.
- No circular dependency is allowed.

## TypeScript

- Use strict mode with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and `verbatimModuleSyntax` (C43).
- Use `const`. Do not use `var`.
- Use discriminated unions for state and for results.
- Do not use `any` or a non-null assertion.
- Use async and await, and handle each rejection.
- Put types such as `vite/client` in the `types` field of the config, never in a triple-slash line.

## Kotlin

- Use `val`. Use `var` only when a value must change (C44).
- Use sealed classes for the state of each screen.
- Use coroutines for work that waits. Never block the main thread.
- Each touch target is at least 48 dp (C15).

## Code shape

- A function has at most 40 lines. A file has at most 500 lines (C42).
- No code comments in any source or config file (C41). This covers TS, TSX, JS, MJS, Kotlin, KTS, Apps Script, XML, YAML, TOML, properties and the Makefile.
- Files that a build tool writes are not checked for comments: `gradlew`, `gradlew.bat`, `gradle/wrapper/*` and `pnpm-lock.yaml`.
- The reference for the code comes from the types and the schemas.

## Errors and outside calls

- Each rejection has a `RejectionCode` (C45). The HTTP status follows the table in the Contract Reference of the plan.
- No catch block is empty.
- An outside call goes through the outbox (C39). It is tried again with exponential backoff, at most 3 times. Then a person is told.

## Tests

- Write the failing test first (C49).
- The core has a unit test for each state change and property tests with random histories.
- The hub tests run inside the local Cloudflare runtime.
- Each example file in `contracts` must pass in the hub tests, the website tests and the Android tests.
- The Android app has unit tests for the state of each screen.
- The website has one end-to-end test of the demo thread.
- A flaky test is fixed or deleted, never skipped.

## Secrets and cost

- No secret is in the repository (C40). Local secrets go in `.dev.vars`, which git ignores.
- The running cost target is about 0 dollars each month.
- No paid model and no API key are used (C65).
