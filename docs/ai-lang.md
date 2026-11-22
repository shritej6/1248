# Spanish support

This document tells how Vision supports residents who write in Spanish. It is for a developer who changes the language detector, the Spanish text or the translation job. The job key is `lang`. The job follows the supervision rules in `docs/ai-jobs.md`.

## What the job does

Six of the 100 exam messages are in Spanish. The sorter reads them already. Spanish support adds three parts:

1. The card has a language: `en` or `es`.
2. The resident pages and the resident messages use human-written Spanish when the card is Spanish.
3. The desk gets a machine translation of a Spanish message into English, under the original.

## How the card gets its language

| Door | Rule |
|---|---|
| Form | The resident chooses "English" or "Español" at the top of the ask form. The choice goes in `card.received`. The detector never changes it. |
| Form with no choice | The detector reads the message. |
| Mail and voice | The detector reads the message. When it says Spanish, the core writes `card.lang_set`. |

The core writes `card.lang_set` only when the language of the card is not known. A card with no language shows as English.

## The detector rule

The detector is `detectLanguage(text)` in `packages/core/src/language.ts`. It has no I/O and no model.

1. Split the text into words of letters. An apostrophe inside a word stays, so "O'Neil" is one word.
2. If the text has fewer than `MIN_WORDS` (3) words, the language is English.
3. Count the words that are in `SPANISH_WORDS`, a fixed list of Spanish function words such as de, la, que, el, en, y, los, por, con and para. The count folds case and accents.
4. A word with a capital first letter in the middle of a sentence is a name, such as "El Rey" or "La Causa". It does not count. A word in all capitals still counts.
5. Divide that count by the number of words. If the share is below `SPANISH_SHARE` (0.2), the language is English.
6. A text of fewer than `SHORT_WORDS` (8) words needs two different Spanish words, or a Spanish mark (ñ, ¿, ¡ or an accented vowel). Otherwise it is English.

The list does not have "no", "me", "hay" or "favor". English uses these words often, so a short English text such as "No heat. Help me." stays English.

The list also leaves out al, su, le, les, se, o, del and mi. Each is also an English name or a common abbreviation, such as Al, Su, Les, Del, SE and mi. So "Ride for Al to clinic" and "Snow on SE side" stay English. The list has "necesito" and "ayuda", which English never uses, so "Necesito ayuda, por favor" is Spanish.

On the exam messages, the lowest Spanish share is 0.28 (m062). m040, an English forward of a Spanish message, has 0.29. The highest English share is 0. The threshold 0.2 is between the two.

A false Spanish card sends the resident a Spanish receipt, check-back and tracking page. The desk has no command yet to set the language back to English. Open item O15 in `docs/decisions.md` records this.

## Resident text

The supervision rules and C37 and C67 say that the AI never writes to a resident. So every Spanish word that a resident sees is written by a person.

| Part | File |
|---|---|
| Ask form, receipt page, tracking page, 911 line | `apps/web/src/pages/spanish.ts` |
| Receipt and check-back messages | `data/synthetic/templates.json`, block `es` |
| Mail subject, tracking link line, link word | `MAIL_WORDS` in `apps/hub/src/render.ts` |

A Spanish template has the same slots as the English one and the 90 day line. A template with no Spanish text falls back to English. The message then uses the English link word, date format and mail subject, so one message never mixes the two languages. Spanish dates use the zone `America/Chicago`, as English dates do (C38).

The need labels come from the playbook, and the playbook is in English. So a Spanish receipt names the need in English, for example "Snow shovelling". The tracking steps come from the hub in English, and the tracking page shows the Spanish words for them.

Every Spanish string needs a check by a native speaker. Open item O14 in `docs/decisions.md` records this.

## The translation for the desk

1. When the card is Spanish and `TRANSLATE_MODEL` holds a model id, the core asks for the job with `ai.asked`.
2. `langJob.run` in `apps/hub/src/ai/lang.ts` reads `message_in` from the vault. It makes one call to the model from `es` to `en`.
3. The core handler for `lang.result` puts the text in the vault as `translation`. The ledger gets only `ai.done` with the outcome.
4. The desk card shows the chip "ES" on the row. Under the words of the resident, it shows "Machine translation from Spanish. It can miss or change words, so check the original above before you decide." and the translation. Design section 10 still has the shorter label "Machine translation from Spanish. The original is above." Open item O16 in `docs/decisions.md` asks the lead to change it.
5. Under the translation, the card shows the warning "Machine translation can drop details." When the AI sorted the card, the warning adds "The AI urgency comes from the original words." When the sorter is off or failed, the card has no AI urgency, so the warning leaves that sentence out. The component is `TranslationNote` in `apps/web/src/components/Translation/Translation.tsx`.

| Status | Desk line |
|---|---|
| `pending` | "The machine translation is on the way." |
| `failed` or `empty` | "The machine translation did not work. Read the original or ask a Spanish speaker." |
| `off` | No line. The desk reads the original. |

The warning is true because the sorter never reads the translation. The sort job in `apps/hub/src/outbox.ts` sends the first `message_in` text from the vault to the sorter. The core handler for `sort.result` checks the word list on that same text. The translation is a separate vault row of the kind `translation`.

A reply with no translated text counts as a failed try. After 3 failed tries, the job ends with `ai.done` `failed`. The translation gets the forget date of the card, and it never goes into the ledger or the logs.

## Measured check

The check is `exam/src/lang-check.ts`. It runs the detector on all 100 exam messages. It then translates the 6 Spanish messages once with `@cf/meta/m2m100-1.2b`. It writes `exam/lang-results/<date>.json`.

Each Spanish message has a short list of key facts in `exam/src/lang-facts.ts`, such as the baby, the oven left on and the phone number. The check records for each message which facts the English translation kept and which it lost. Some facts are safety facts, such as no heat, the baby and the open oven. The check passes only when the detector finds every Spanish message, marks no English message, and every translation keeps every safety fact.

To run it, set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in the shell, then run `pnpm exec tsx src/lang-check.ts` in `exam/`. The check stops above 200 neurons.

Result on 2026-11-21, in `exam/lang-results/2026-11-21.json`:

| Measure | Result |
|---|---|
| Spanish messages found | 6 of 6 (m008, m040, m060, m062, m071, m079) |
| English messages marked Spanish | 0 of 94 |
| Translations | 6 |
| Key facts lost | 1 of 20 (m060, "oven on for heat") |
| Translations that lost a safety fact | 1 of 6 (m060, "oven on for heat") |
| Neurons used | 31.8 |
| Passed | No. The m060 translation loses the open oven. |

The detector passes. The translation does not pass. So the desk card always shows the original above the translation. Residents get only human-written Spanish.

## The switch for the finals

The owner decided at 17:20 CT on 2026-11-21 to keep the translation job on for the finals. The decision adds the stronger warning under the translation. The check still records `passed: false`, and no check decides whether a job is on.

A person confirms each Spanish card, unless its need is at level 1. At level 1, a card that the sorter marks low urgency with no flags is confirmed with no person, and the language of the card does not change this. No need in the default playbook is at level 1. So in the finals a person confirms every card, unless someone sets a need to level 1 with `need.level_set`.

A voice card has the flag `voice_transcript`, so it never confirms with no person. Spanish cards have no such flag.

## What the translations show

The translations help the desk read fast, but they make errors. In m060 the resident sleeps in the kitchen "con el horno prendido", with the oven on for heat. The translation says "with the oven attached", so the danger of the open oven is lost. The translation of m008 drops the last sentence. The translation of m071 says "pale the snow" for "palear la nieve".

So the translation never replaces the original. The original stays above the translation, and the sorter and the word list read the original.
