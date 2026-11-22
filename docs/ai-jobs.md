# AI jobs

This document gives the supervision rules and the parts that every AI job in Vision shares. It is for a developer who builds or changes an AI job. The sorter has its own document, `docs/exam.md`.

## The supervision rules

Every AI job in Vision follows the supervision rules. A new job must follow all seven rules before it is merged.

1. Each job has one off switch. The switch is an environment variable that holds the model id. An empty variable means off, and the system still works fully without the job.
2. The AI only suggests, and it always shows its evidence.
3. The AI can only add caution or information. It never lowers urgency, never closes or merges a card and never chooses who helps.
4. A person confirms.
5. A failure or a refusal falls back to a person with a flag, after at most 3 tries.
6. Anything that the AI makes from personal text or audio is personal data. It lives in the vault with the forget date of the card. It never goes into the ledger or the logs.
7. Each job has a measured check on synthetic data in the repository.

## The jobs

| Key | Job | Variable | Default model | Measured check |
|---|---|---|---|---|
| `voice` | Voicemail door: speech to text | `VOICE_MODEL` | `@cf/openai/whisper-large-v3-turbo` | `exam/src/voice-check.ts` |
| `link` | Same-event linking | `LINK_MODEL` | `@cf/baai/bge-m3` | `exam/src/link-check.ts` |
| `lang` | Spanish support: translation for the desk | `TRANSLATE_MODEL` | `@cf/meta/m2m100-1.2b` | `exam/src/lang-check.ts` |
| `draft` | Resources: the impact post and the funder letter | `DRAFT_MODEL` | `@cf/google/gemma-4-26b-a4b-it` | `exam/src/draft-check.ts` |

The first three variables are set in `vars` of `apps/hub/wrangler.json`, so those jobs are on (D31). A person always confirms their output. The sorter is on too: `SORTER_MODEL` holds `@cf/google/gemma-4-26b-a4b-it`, which passed the sorter exam (C64, C66, D27).

`DRAFT_MODEL` holds its default model too, and the owner decides whether the draft job stays on for the finals (O20). The draft guard in `packages/core/src/resources/guard.ts` checks each draft, and a draft that it stops falls back to the fixed template with a flag. `docs/resources.md` describes the draft job.

## AI on a laptop

The AI binding in `apps/hub/wrangler.json` is `"ai": { "binding": "AI", "remote": true }` (D30). The laptop hub has two ways to start.

| Command | Hub | AI |
|---|---|---|
| `make dev` | `wrangler dev` without `--local` | The Worker runs on the laptop, and the AI binding runs on Workers AI. Run `npx wrangler login` once first. |
| `make dev-offline` | `wrangler dev --local` | No network. Each job goes to a person at once. The sorter tries 3 times, for about 1.3 seconds, and the card then reaches the desk with the flag "AI did not answer". |

With `--local`, the binding answers "Binding AI needs to be run remotely". Each job then falls back to a person with the flag at once, with no retries. The sorter does not take this short path: `packages/core/src/sorter.ts` tries 3 times and waits 250 ms and then 1000 ms between tries. `make e2e` and CI use `--local`, so they make no AI call.

## Live check of 2026-11-21

A hub started with `wrangler dev` without `--local` on port 8793 got three synthetic messages at 17:39 CT. The desk board then showed every AI result.

| Message | What the desk board showed |
|---|---|
| Dana's snow request through the request form | The sorter suggestion: snow, urgency low, source `ai` |
| `data/synthetic/voicemail-demo.mp3` through the desk voicemail upload | The transcript, with the flag `voice_transcript`. The sorter suggested High and quoted "gas smell in the kitchen". |
| A Spanish snow request through the request form | `lang: es`, the sorter suggestion, and an English translation for the desk |

The Workers AI analytics of the account counted 14 model calls and 109.4 neurons in the time of the check. These counts are for the whole account in that time, not from the log of this hub, so they can include other calls on the same account. The hub makes one `bge-m3` call for each link run, so the 6 `bge-m3` calls are more than these three messages explain.

| Model | Calls | Neurons |
|---|---|---|
| `@cf/google/gemma-4-26b-a4b-it` (sorter, two reads for each card) | 6 | 63.8 |
| `@cf/baai/bge-m3` (same-event vectors) | 6 | 32.2 |
| `@cf/openai/whisper-large-v3-turbo` (transcript) | 1 | 11.2 |
| `@cf/meta/m2m100-1.2b` (translation) | 1 | 2.2 |

The hub tests and the end-to-end tests set every model variable empty. `apps/hub/vitest.config.ts` and `apps/web/playwright.config.ts` do this, and `tools/test/modelvars.test.mjs` checks it. A hub test that needs a job puts a fake AI binding on the hub, as `apps/hub/test/sorter.test.ts` does.

## How a job runs

1. A message becomes ready. This happens at intake, after a transcript, or after the desk types the gist of a voicemail.
2. The core runs `messageReady` in `packages/core/src/decide/intake.ts`. It runs the sort step, the link step and the language step.
3. A step that needs a model calls `askAi`. When the job is on, `askAi` writes `ai.asked` and one outbox item of the kind `ai.<key>`. The item holds only the card id.
4. The alarm sends the item to the job in `apps/hub/src/ai/registry.ts`. The job makes one model call and returns a system command, for example `voice.result`.
5. The core decides on the result. It writes ledger lines with no text, and it puts the text in the vault.
6. A failed call is tried again by the outbox with a growing wait. After the third failed try, the registry applies the result with the outcome `failed`. The desk then sees a flag.

The draft job of Resources starts when an organiser asks for a draft, not when a message is ready. Its item in the outbox holds only the draft id, and `docs/resources.md` gives its path.

## The parts each job fills

| Part | Shared file, written once | File of the job |
|---|---|---|
| Core step and result handlers | `packages/core/src/decide/intake.ts`, `packages/core/src/decide.ts` | `packages/core/src/decide/<voice, link, lang>.ts` |
| Hub job | `apps/hub/src/ai/registry.ts`, `apps/hub/src/ai/types.ts` | `apps/hub/src/ai/<voice, link, lang>.ts` |
| Desk slots | `apps/web/src/components/deskSlots.ts` | `apps/web/src/components/<Voicemail, SameEvent, Translation>/slots.ts` |
| Measured check | `exam/src/checks.ts` | `exam/src/<voice, link, lang>-check.ts` |

A desk slot is a React component that the desk shows in a fixed place: on a card row, above or below the words of the resident, after the sorter labels, in the desk tools or at the top of the Triage lane.

## Ledger events

| Event | Data | Meaning |
|---|---|---|
| `ai.asked` | `job` | The job has an item in the outbox. |
| `ai.done` | `job`, `outcome` | The job finished: `ok`, `empty`, `failed` or `off`. |
| `card.lang_set` | `lang` | The language detector set the language of the card. |
| `card.gist_typed` | none | The desk typed the gist of a voicemail. |
| `link.proposed` | `other`, `score` | The link job proposes that two cards report the same event. |
| `link.answered` | `other`, `answer` | The desk answered `same` or `not_same`. |
| `draft.asked` | `draft`, `kind`, `month`, `resource`, `by` | An organiser asked for a draft, and the draft job has an item in the outbox. |
| `draft.done` | `draft`, `source`, `flag`, `textHash` | The draft is ready: the AI text that passed the draft guard, or the fixed template. |
| `draft.approved` | `draft`, `textHash`, `by` | An organiser approved the draft with this text fingerprint. |

No event holds a transcript, a translation, a vector, a draft or any other text.
