# Architecture

This document explains how the parts of Vision fit together. It is for a developer who must change or keep the code. It is the only document that uses the technical name of the custody principle.

## The principle

Vision keeps a chain of custody for each job. Public text says the same thing in plain words: one holder, hand to hand, never dropped.

- Every open job has exactly one holder at every moment (C3).
- A job moves to a new holder only on a receipt, such as ACCEPT or GOT IT (C4).
- Every hold has a clock, and when the clock ends, the job moves on by itself (C5).
- Only the states helped, unreached and withdrawn close a job (C9).

## The parts

| Part | Folder | Job |
|---|---|---|
| Contracts | `contracts/` | Zod schemas for every shape that crosses a boundary, and example files |
| Core | `packages/core/` | Every rule, with no I/O |
| Hub | `apps/hub/` | A Cloudflare Worker and one Durable Object for each organisation |
| Websites | `apps/web/` | The desk, the organiser view, the partner card and the resident pages |
| Volunteer app | `apps/android/` | Kotlin and Jetpack Compose |
| Google link | `google/` | One Apps Script for mail, the playbook sheet and the record |
| Exam | `exam/` | The sorter exam and its saved results |
| Tools | `tools/` | The quality gate scripts and the seal tool |

## How a command flows

1. A client sends a command to `POST /api/v1/o/{org}/commands`. Each command has its own id.
2. The Worker sends the request to the Durable Object of the organisation. This object is the only writer of its data (C34).
3. The object checks the session and the role of the caller.
4. In one synchronous transaction, the object runs `decide` from the core. `decide` returns the new ledger lines or a typed rejection.
5. The object seals the new lines, folds them into the state with `evolve`, and stores the result for the command id.
6. The object sets one alarm for the earliest clock.
7. The object pushes a change message to each open screen over a WebSocket.

A second send with the same command id returns the first result and adds no ledger line (C35). Of many accepts for one offer, exactly one wins, because one object runs the commands one at a time (C36).

## The core

The core is pure TypeScript in strict mode. The clock, the random source and the hash are passed in (C47). The main functions are these:

- `decide` takes the state, a command and a context, and returns ledger lines or a rejection.
- `evolve` folds one ledger line into the state.
- The view functions in `packages/core/src/views/` build each view for one role.
- `verifySeal` checks the fingerprints of a list of ledger lines.
- The rehearsal in `packages/core/src/rehearsal/` runs invented requests through the same rules in fast time.

Because every rule is in the core, the organiser view runs the rehearsal in the browser with the same code as the hub. The rehearsal never touches the real ledger.

## The ledger and the seal

The ledger is an append-only list of events. The state of each card can be rebuilt from it (C31). A ledger line holds no name, no address, no contact detail and no free text (C32). Private details live in the vault, apart from the ledger.

The fingerprint of a line is SHA-256 over the fingerprint of the line before and the content of the line (C33). The first line uses 64 zeros as the fingerprint before it. The content is canonical JSON of the fields `seq`, `at`, `card`, `job`, `type`, `actor` and `data`. The organiser view has the button "Check the seal", and `tools/verify-seal.mjs` checks a downloaded file.

Honest limit: the seal shows a change after writing. It does not prove that an entry was true.

## Storage in the hub

Each Durable Object has its own SQLite database. The tables are in `apps/hub/src/schema.ts`.

| Table | Contents |
|---|---|
| `events` | The sealed ledger lines |
| `snapshot` | The folded state, for a fast start |
| `vault` | Private details, each with a forget date |
| `vault_audio` | Voicemail recordings, each with a forget date |
| `members`, `partners` | The people of the organisation |
| `offers` | The open offers for each volunteer |
| `links` | Fingerprints of tracking links and partner links |
| `sessions`, `join_codes` | Sign-in |
| `commands` | The first result of each command id |
| `outbox` | Outside calls that wait or retry |
| `playbook` | The playbook versions |

## Clocks and the alarm

The hub keeps one alarm for each organisation. The alarm time is the earliest of the next job deadline, the next outbox try and the next forget date. When the alarm fires, the hub runs every due timer in order of its due time and sets the alarm again. In demo mode an organiser can move the demo clock forward, and each jump writes a ledger line.

## Outside calls

Calls to Workers AI, to the Google script and for mail go through the outbox (C39). A failed call is tried again with exponential backoff, at most 3 times. Then the desk board shows it under failed sends.

## The AI jobs and the supervision rules

Every AI part of Vision follows the supervision rules. `docs/ai-jobs.md` holds the full text, and each rule has a place in the code.

| Rule | Where the code holds it |
|---|---|
| 1. One off switch for each job: a variable that holds the model id. Empty means off, and the system still works. | `SORTER_MODEL`, `VOICE_MODEL`, `LINK_MODEL` and `TRANSLATE_MODEL` in `apps/hub/wrangler.json`. `aiOn` in `apps/hub/src/ai/registry.ts` fills `Config.aiOn`, and `askAi` in `packages/core/src/decide/aiask.ts` writes nothing for a job that is off. |
| 2. The AI only suggests and always shows its evidence. | The desk shows the recording above the transcript, both reports of a link side by side, and the original above the translation. |
| 3. The AI can only add caution or information. | The result handlers in the core only add flags, add vault text, raise or propose. `link.answered` changes no card, and the flag `voice_transcript` can only raise a level. |
| 4. A person confirms. | Each output waits for a desk tap: confirm, "Same event" or "Not the same". A machine translation never goes to a resident. |
| 5. A failure or a refusal falls back to a person with a flag, after at most 3 tries. | The outbox tries each item at most 3 times with a growing wait. Then `aiGiveUp` applies the result with the outcome `failed`. |
| 6. What the AI makes from personal text or audio is personal data. | The vault holds the audio, the transcript, the translation and the vector, with the forget date of the card. The ledger holds only statuses, a language code and a score. |
| 7. Each job has a measured check on synthetic data. | `exam/src/voice-check.ts`, `exam/src/link-check.ts` and `exam/src/lang-check.ts`. `docs/exam.md` gives the results. |

The three jobs share one path. When a message is ready, `messageReady` in `packages/core/src/decide/intake.ts` runs the sort step, the link step and the language step. A step that needs a model writes `ai.asked` and one outbox item of the kind `ai.<key>`, which holds only the card id. The alarm sends the item to the job in `apps/hub/src/ai/registry.ts`, and the job returns one system command for the core.

| Job | Key | What it does | Document |
|---|---|---|---|
| Voicemail door | `voice` | The hub keeps the recording in `vault_audio` and asks speech AI for a transcript. The transcript then goes through the sorter and the word list. Every voice card has the flag `voice_transcript`. | `docs/ai-voice.md` |
| Same-event linking | `link` | The hub embeds the message and scores it against open cards from the same ZIP code in the last 7 days. A score at or above `LINK_THRESHOLD` proposes a link. A link never merges, closes or lowers a card. | `docs/ai-link.md` |
| Spanish support | `lang` | The core detects Spanish mail and voice cards with no I/O. The hub asks for a translation for the desk. Residents get only human-written Spanish templates. | `docs/ai-lang.md` |

The sorter is on with `@cf/google/gemma-4-26b-a4b-it`, which passed the exam (D27). The AI binding in `apps/hub/wrangler.json` has `"remote": true` (D30). So `make dev` runs the Worker on the laptop and the AI binding on Workers AI. `make dev-offline`, `make e2e` and CI run `wrangler dev --local`, which has no AI binding. Each AI call then fails with "needs to be run remotely", and `aiSender` in `apps/hub/src/ai/registry.ts` gives each of the three jobs to a person with the outcome `failed` at once, with no retries.

The sorter is not one of these jobs: it tries 3 times, for about 1.3 seconds, and the card then reaches the desk with the flag "AI did not answer".

## The clients

The websites and the Android app are thin clients (C48). They send commands and show views. They do not decide what a person may see, because the hub applies the privacy rules (C20). After a reconnect, each screen fetches its views again, because it missed pushes while it was away.

The websites are one React and Vite build. The hub serves the files from `apps/web/dist`, and the routes are in `apps/web/src/router.ts`. The Android app reads the hub address from `BuildConfig.HUB_URL` in `apps/android/app/build.gradle.kts`.
