# Privacy

This document says what Vision stores about people, where it stores it, who can see it and when the hub erases it. It is for ComForce, for the desk and for a developer. All data in the repository and in the demo is synthetic (C29).

## What the hub stores

The hub keeps two kinds of data apart: the ledger and the vault.

| Store | Contents | Private detail |
|---|---|---|
| Ledger | Events: the need, the ZIP, the level, the flags, the status, the time and an opaque id of the actor | None. A ledger line holds no name, no address, no contact detail and no free text (C32). |
| Vault | The first name, the contact and the address of the person, the message texts, the quoted words, the notes and what an AI job makes from them | Yes. Each vault row has a forget date (C23). |
| Voicemail audio | The recording of a voicemail, in the table `vault_audio` | Yes. Each row has the forget date of the card. |
| Members and partners | The name, the contact, the roles, the skills and the home ZIP | Yes. Only staff views show them. |
| Links | The fingerprint of each tracking link and partner link | None. The hub stores only a SHA-256 fingerprint of the secret part (C26). |
| Sessions | The fingerprint of each session token | None |

## Who sees what

The hub applies the privacy rules, and a screen never decides what a person may see (C20).

- An offer to a volunteer shows the need, the rough distance, the time and what to bring. It never shows a name or an address (C18).
- The job card with the name and the address goes only to the holder of the job (C19).
- A partner sees the short note only after three yeses: the yes of the person, the yes of the partner and the accepted promise (C21).
- Only the lead sees a quiet card, and the machine sends nothing to the person on a quiet card (C22).
- A tracking link or a partner link opens one card only. The route code alone opens nothing.
- An old link, opened after the job closed or after the forget date, shows only "This request is closed" (C27).

## When the hub erases data

The default forget date is 90 days after the last job of the card closes (C24). The value is `forgetDays` in `data/synthetic/config.json`. The alarm of the hub erases each vault row and each outbox row on its forget date. Each erase run writes one ledger line of the type `vault.erased` with two counts only: the rows due and the rows erased. The statement shows the rows erased on time over the rows due.

## The public form

The request form has a limit for each network address: 5 requests in 10 minutes. It also has a hidden trap field and a size limit. It has no picture puzzle, because a puzzle blocks some users (C28). The limit stores a fingerprint of the network address, not the address.

## Logs

Logs hold no private detail (C25). The hub writes a short JSON line for a few events, for example `{"op":"form","card":"c_..."}`. A line holds an operation name and an id, and no text from a person.

## The AI sorter

The sorter is on (D27): `SORTER_MODEL` holds `@cf/google/gemma-4-26b-a4b-it`, which passed the exam (C66). The hub sends the text of each card to this open-weights model on Cloudflare Workers AI. The sort job in the outbox holds only the card id, not the message. The AI never writes its own words to a resident (C67).

Cloudflare states that Workers AI does not train on customer content. This is a statement of the provider, and Vision cannot check it.

## The AI jobs

The AI jobs follow the supervision rules in `docs/ai-jobs.md`. Anything that an AI job makes from personal text or audio is personal data.

| Data | Where it lives | Forget date |
|---|---|---|
| Voicemail audio | `vault_audio` | The forget date of the card |
| Transcript of a voicemail | Vault row of the kind `message_in` | The forget date of the card |
| Machine translation for the desk | Vault row of the kind `translation` | The forget date of the card |
| Vector of a message for linking | Vault row of the kind `link_vector` | The forget date of the card |
| Gist that the desk types for a voicemail | Vault row of the kind `message_in` | The forget date of the card |

The ledger holds only the status of each job, the language code and the link score between two card ids. An outbox item of an AI job holds only the card id. Logs name the job and the outbox row, never the text.

Each of these rows gets the forget date of its card when the last job of the card closes. The alarm of the hub erases the rows in `vault`, `vault_audio` and `outbox` on that date. A vector is machine data, so the vault reader never gives a vector to a view.

Only the desk and the lead can play a recording, and the hub sends it with `Cache-Control: no-store`. When the card becomes quiet, only the lead can play it. This holds as soon as the sorter suggests a quiet need, before the desk confirms the card, the same test that hides the card from the desk board. A same-event link shows only when the viewer may see the other card.

The hub sends personal data to Workers AI for three jobs: the recording for speech to text, the message for the vector, and the Spanish message for the translation. The smoke test of 2026-11-21 used synthetic data. Its ledger and its logs held none of the words of the transcript, the reports or the Spanish message.

## Where the AI runs

The laptop hub of `make dev` runs the Worker and its vault on the laptop. Its AI binding runs on Workers AI (D30), so the texts above leave the laptop for Cloudflare. The hub of `make dev-offline` uses `wrangler dev --local` and needs no network. That hub sends no text to Workers AI, and a person does each AI job. `make e2e` and CI also use `--local`.

## Resources

The Resources tab of the organiser website keeps three kinds of rows in the hub: the unit cost of each need, the state of each readiness item and the drafts. These rows hold totals, public funder facts and member ids. They never hold a name, a contact or the text of a request. Only an organiser can use Resources.

A draft uses only the totals of the statement, the forecast and one catalog row. The draft job sends only these facts to Workers AI. The totals come from the statement, which counts a quiet job as a number only and never shows its details. The forecast, the match and the facts for each need leave quiet jobs and quiet needs out.

The ledger lines `draft.asked`, `draft.done` and `draft.approved` hold ids, codes and the SHA-256 of the text, never the text. The text of a draft stays in the table `resource_drafts` of the hub. It has no forget date, because it holds no personal data.

## Limits

- The vault has no field encryption yet. A person with access to the Cloudflare account can read the vault.
- A vault row has no forget date until the last job of its card closes. A card that never gets a job keeps its vault rows, and a voice card keeps its recording.
- Sign-in uses join codes. Google sign-in is not built.
- The Google link copies the ledger and the statement to a Google Sheet. The ledger holds no private detail, but the mail that the script reads stays in the Gmail account until ComForce deletes it.
- Only test inboxes of the project are used. No real ComForce inbox, phone number or person is used (C30).
