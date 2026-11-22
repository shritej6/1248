# Sorter exam

The sorter reads each new card two times and suggests the need, the team and the urgency. No model is switched on before it passes this exam. Gemma 4 26B passed on 2026-11-21, and the owner switched the sorter on with it for the finals (D27).

## What the exam is

The exam uses 100 synthetic messages. 24 of these messages are emergencies. The messages and the answer key are copies of the sorter test of 2026-11-21.

| File | Contents |
|---|---|
| `exam/data/messages.json` | The 100 messages, with no answers |
| `exam/data/key.json` | The answer key for each message |
| `exam/data/saved-small1.json` | The saved answers of run 1 of the small model in the sorter test |
| `exam/results/record.json` | One row for each finished exam |

## How a model passes

A model passes when it finds all 24 emergencies in each of two runs. A message counts as an emergency when one of its two passes says `high`. A missing answer counts as a miss.

The exam also counts false alarms, the right need, the right team and the quotes that match the message. A second answer in the key also counts as right. These numbers do not decide the pass, but the desk can use them to judge the load.

## How the hub uses the sorter

The hub sends each pass to Workers AI as a separate call. The system message is version 1 of the sorter prompt, and the user message is the card id and the text as JSON. The hub asks for 300 tokens at most and sets no temperature. The hub also sends `chat_template_kwargs` with `enable_thinking` set to false, so a model that thinks before it answers gives its answer at once and the answer fits in the 300 tokens. A model that refuses this setting stops the exam at its first call.

The hub reads the text from the first `{` to the last `}` and checks it against the pass schema. A reply that fails this check is a failed try. After 3 failed tries, the card goes to the desk with the flag "AI did not answer". The sort job waits in the outbox and holds only the card id, not the message.

## How to run the exam

1. Type `npx wrangler login` in a shell.
2. Put `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in the shell, never in a file. The token needs only the Workers AI read and run rights. After the login, `npx wrangler auth token` prints a token that works for one run.
3. List the models with `npx wrangler ai models list --json`. Take the text generation models from the smallest to the largest.
4. Run `pnpm --filter @vision/exam exam -- --model <id> --runs 2` for one model.
5. Stop at the first model that passes.

The runner saves after each message. If the free daily allowance ends, the runner stops. Run the same command again later, and the runner continues from the last saved message.

At the end, the runner writes `exam/results/<date>-<model>.json` and adds one row to `exam/results/record.json`. The row holds the model id, the prompt fingerprint, the date, the score of each run and the result.

## How to switch the sorter on

Put the id of the passing model in `vars.SORTER_MODEL` in `apps/hub/wrangler.json`. The quality gate then checks that `exam/results/record.json` has a passing row for this model and this prompt fingerprint. If the prompt changes, the fingerprint changes, and the exam must run again.

## Status

Two models took the exam on 2026-11-21. The rows are in `exam/results/record.json`.

| Model | Emergencies found | False alarms in 76 ordinary messages | Right need in 100 | Result |
|---|---|---|---|---|
| `@cf/ibm-granite/granite-4.0-h-micro` | 19 of 24 in run 1, 19 of 24 in run 2 | 23 and 21 | 67 and 68 | Did not pass |
| `@cf/google/gemma-4-26b-a4b-it` | 24 of 24 in run 1, 24 of 24 in run 2 | 16 and 18 | 96 and 97 | Passed |

`vars.SORTER_MODEL` in `apps/hub/wrangler.json` holds `@cf/google/gemma-4-26b-a4b-it`, so the sorter is on for the finals (D27). `make exam` finds the passing row for this model and prompt fingerprint, and the desk sees the suggestion of the sorter and the quoted words, highlighted in the message. A person still confirms each card. With the variable empty, the sorter is off (C64), each card goes to the desk unsorted, and a word list hit pages at once.

## The measured checks of the AI jobs

Each AI job has a measured check on the synthetic exam messages (rule 7 of the supervision rules in `docs/ai-jobs.md`). The results go in `exam/voice-results/`, `exam/link-results/` and `exam/lang-results/`, never in `exam/results/`. No check decides whether a job is on, because a person confirms each output.

| Job | Check | Result of 2026-11-21 | Neurons |
|---|---|---|---|
| Voicemail door | `exam/src/voice-check.ts` speaks the 8 garbled voicemails, transcribes them and sorts the transcripts. | 79 wrong words in 720, a word error rate of 0.11. The 3 emergencies m020, m033 and m081 were all found in the transcripts. | 319 |
| Same-event linking | `exam/src/link-check.ts` embeds the 100 messages and scores the 4950 pairs. | At the owner's threshold of 0.75, the job finds 12 of 36 true pairs and proposes 15 wrong pairs: 1 look-alike, 4 from two event groups and 10 with a message with no event group. A person answers each proposal, and a wrong one costs one tap on "Not the same". | 16.011 |
| Spanish support | `exam/src/lang-check.ts` runs the detector on the 100 messages and translates the Spanish ones. | The detector found 6 of 6 Spanish messages and marked 0 English messages. In 1 of 6 translations a safety fact was lost (m060, "oven on for heat"), so the check did not pass and records `passed: false`. The owner kept the job on for the finals at 17:20 CT on 2026-11-21 with a stronger warning. The desk card always shows the original above the translation, and residents get only human-written Spanish. | 32 |

The link result means that the desk sees about a third of the true pairs and answers some wrong proposals. A link never merges, closes or lowers a card. Two reports of one fallen tree with the same facts in a different order scored 0.961 in the smoke test of 2026-11-21. The lost safety fact means that the desk must read the original Spanish words, and the desk label says so.

## Limits

The messages are synthetic. 0 misses in 24 emergencies still allows a miss rate near 12 percent. ComForce must repeat the exam on its own past messages.
