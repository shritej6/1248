# Same-event linking

This document explains the same-event linking job (key `link`). It is for a developer who changes the job and for the desk lead who decides how far to trust it. The job follows the supervision rules in `docs/ai-jobs.md`.

## Why the job exists

Neighbours often report the same downed tree or the same alley pile several times. Each report comes to the desk as a new card. The job tells the desk that two cards may be about one event, so the desk can read them together.

## Why a link never hides a report

In the sorter test, six reports were about the same alley pile. One of the six came from a woman who fell beside the pile and hurt her hip. Her report was an emergency, and the other five were not. So a link must never hide the urgency of one report.

For this reason, a link never merges, closes or lowers a card. Every card keeps its own urgency, holder, job and statement line. A group shows its highest urgency, and a high card in a group stays in the Emergency lane.

## How the job runs

1. A message becomes ready with a ZIP on a card that is not quiet. The core step `linkStep` in `packages/core/src/decide/link.ts` asks for the job with `askAi`.
2. The outbox item holds only the card id. The alarm sends it to `linkJob` in `apps/hub/src/ai/link.ts`.
3. The job reads the message from the vault and makes one call to `LINK_MODEL`. The default model is `@cf/baai/bge-m3`, which reads English and Spanish.
4. The job keeps the vector in the vault as a row of the kind `link_vector`. The row gets the forget date of the card, and no view ever gets it.
5. The job scores the vector against the stored vectors of other cards. A candidate card must be open, in the same ZIP and received within 7 days, and it must have no link with the card yet.
6. The job scores at most the 200 newest candidates. It reads their vectors 90 card ids at a time, because Durable Object SQLite takes about 100 bound values in one query. So in a storm with hundreds of reports in one ZIP, the job still runs, and it scores the 200 newest. A card sorted to a quiet service or a card whose vector failed still takes a place among the 200.
7. The job returns `link.result` with each match at or above `LINK_THRESHOLD`, at most 20, best first. Scores are rounded to 3 places.
8. The core checks each match again against the state. It writes `link.proposed` with the two card ids and the score, and then `ai.done`.

The core never asks for the job on a quiet card or on a card that only the lead may handle, and it never proposes a link to such a card. A card can still become quiet after a link is proposed, for example when the sorter puts it in a quiet service. So a view shows a link only when the viewer may see the other card, and only the lead may answer a link on a quiet card. This way the desk never learns about a card that it may not see.

One rule decides whether a card is quiet: `cardIsQuiet` in `packages/core/src/quiet.ts`. The link step, the proposal, the answer, the desk view and the audio route all use it. It reads the need of the card, or the suggested need of the sorted service when the desk has not confirmed a need yet.

## What the desk sees

| Place | Text |
|---|---|
| Card row | "Same event?" |
| Card panel | "This may be the same event as a report from ZIP {zip} at {time}. Score {score}." |
| Buttons | "Open side by side", "Same event", "Not the same" |
| After an answer | "Same event. The desk confirmed it." or "Not the same. The desk confirmed it." |
| Top of the Triage lane | "{n} reports, one event" and "Highest urgency: High" |
| Failed job | "The same-event check did not run. Read the reports yourself." |

High has the critical colour, the triangle mark and the word, so colour is never the only signal (C16). The answer writes `link.answered` and nothing else.

## The threshold

The owner set `LINK_THRESHOLD` to 0.75 on 2026-11-21 at 17:20 CT. At this point the job finds about a third of the true pairs, and it also proposes some wrong pairs. A person answers each proposal, and a wrong proposal costs one tap on "Not the same". A link never merges, closes or lowers a card, so a wrong proposal hides nothing.

The test `exam/test/link-check.test.ts` makes sure that `LINK_THRESHOLD` in `packages/core/src/linkscore.ts` is the operating point in the newest file in `exam/link-results/`.

The check `exam/src/link-check.ts` embeds the 100 exam messages in one batch. It scores every pair with the same code as the hub. A true pair has the same `event_group` in `exam/data/key.json`. Every other pair is a wrong pair. A wrong pair is a `near_miss_partner` pair, a pair from two event groups or a pair with a message with no event group.

The check reports 3 things:

- The operating point: the true pairs found at `LINK_THRESHOLD` and the wrong pairs proposed, split by kind.
- A sweep from 0.70 to 0.90 in steps of 0.01, with the same counts at each step.
- The lowest threshold with zero wrong pairs, under a strict rule and under a labelled rule.

Set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in the shell first, and never write the token to a file. Then run the check:

```sh
pnpm --filter ./exam exec tsx src/link-check.ts
```

## The result of 2026-11-21

The source of these numbers is `exam/link-results/2026-11-21.json`. The check scored 4950 pairs of the 100 messages with `@cf/baai/bge-m3`, and the saved run used 16.011 neurons. On 2026-11-21 the check made 3 real calls in all: two full runs and one probe, about 32 neurons. The `linked` flags in `sameEventWithHigh` were set from the saved scores at 0.75 after the second run, with no new call. Every value in the file matches what the current code gives from the saved scores.

| Item | Value |
|---|---|
| Operating point | 0.75 |
| True pairs found at 0.75 | 12 of 36 |
| Wrong pairs proposed at 0.75 | 15 |
| Look-alike pairs in the 15 | 1 |
| Pairs from two event groups in the 15 | 4 |
| Pairs with a message with no event group in the 15 | 10 |
| Lowest threshold with zero wrong pairs | 0.839, which finds 0 of 36 |
| The same, if pairs with a message with no event group do not count | 0.806, which finds 1 of 36 |

The sweep shows the trade. At 0.70 the job finds 23 of 36 true pairs and proposes 76 wrong pairs. At 0.80 it finds 3 of 36 and proposes 4 wrong pairs. At 0.84 and above it proposes nothing.

The scores of true pairs and of different events overlap. Two different neighbours who ask for snow work can score higher than two reports of one alley pile. Two reports with almost the same words score near 1, so the job proposes a link for a report that a person sends twice.

In the alley pile group, one report is an emergency from a woman who fell beside the pile. At 0.75 her report gets proposed links to 3 of the 5 other pile reports. Her card keeps its own high urgency and stays in the Emergency lane.

## Limits

- The exam messages have no ZIP. In the hub, the ZIP and the 7-day window remove many false joins before scoring, so the check is stricter than real use.
- The Workers AI reply for this model gives the neuron count in `meta`, not in `usage`. The check reads it from `meta`.
- The cap of 200 candidates means that, in a ZIP with more than 200 open reports in 7 days, the job does not score the oldest ones.
- A better score needs more than one vector for each whole message, for example a score on the place words. That is a new job, and it needs its own measured check.
