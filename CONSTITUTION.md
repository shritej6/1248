# Constitution of Vision

This file holds the rules of the project. Each rule has a number and one sentence. Other documents refer to a rule by its number, for example C3. The owner, Shritej, can change a rule, and each change goes in `docs/decisions.md`.

The detail behind the rules is in `docs/rules/`. The checks for the rules are listed in `docs/rules/rules-to-checks.md`.

## Product

- **C1.** The product name is Vision.
- **C2.** Public text says "one holder, hand to hand, never dropped", and the technical name of the principle appears only in `docs/architecture.md`.
- **C3.** Every open job has exactly one holder at every moment.
- **C4.** A job moves to a new holder only when that holder gives a receipt, such as ACCEPT or GOT IT.
- **C5.** Every hold has a clock, and when the clock ends, the job moves to the next holder by itself.
- **C6.** A machine never refuses, closes, delays or lowers a request.
- **C7.** The AI sorter can raise the urgency of a card, and only a person can lower it.
- **C8.** For one card, the level of a job can only go up.
- **C9.** Only the states helped, unreached and withdrawn close a job.
- **C10.** A job with no answer after the last check-back try closes as unreached and is never counted as helped.
- **C11.** The monthly statement always balances: open at the start plus new equals helped, unreached, withdrawn, unmet and still open.
- **C12.** The system never scores, ranks or predicts a person.
- **C13.** A pass is free, and the ledger records no offer list and no pass, so no acceptance score can exist.
- **C14.** The desk can tap on behalf of a volunteer who has no smartphone.
- **C15.** Each touch target meets the minimum of section 2 of the UI design system: 32 px on the desk website and the organiser view (24 px for an icon button in a table), 44 px on the partner card and the resident pages, and 48 dp in the Android app.
- **C16.** Colour is never the only signal, and text meets the WCAG 2.1 AA contrast level.
- **C17.** Screens and messages use plain words.

## Privacy

- **C18.** An offer never shows a name or an address.
- **C19.** A job card with the name and the address goes only to the holder of the job.
- **C20.** The hub applies the privacy rules, and a screen never decides what a person may see.
- **C21.** The short note for a partner needs the yes of the person, the yes of the partner and the accepted promise.
- **C22.** Only the lead sees a quiet card, and the machine sends nothing to the person on a quiet card.
- **C23.** Each vault row has a forget date, and the hub erases the row on that date.
- **C24.** The default forget date is 90 days after the job closes.
- **C25.** Logs hold no private detail.
- **C26.** A tracking link or a partner link opens one card only, and the hub stores its secret part as a fingerprint.
- **C27.** An old link, opened after the job closed or the forget date, shows only "This request is closed" and never an error page.
- **C28.** The public form has a limit for each network address, a hidden trap field and a size limit, and it has no picture puzzle.

## Data

- **C29.** All data in the repository and in the demo is synthetic.
- **C30.** The project uses only its own test inboxes and never a real ComForce inbox, phone number or person.
- **C31.** The ledger is an append-only list of events, and the state of each card can be rebuilt from it.
- **C32.** The ledger never holds a name, an address, a contact detail or free text.
- **C33.** The fingerprint of a ledger line is SHA-256 over the fingerprint of the line before and the content of the line.
- **C34.** The Durable Object of an organisation is the only writer of its data.
- **C35.** Each command has its own id, and a second send with the same id returns the first result and adds no ledger line.
- **C36.** Of many accepts for one offer, exactly one wins.
- **C37.** A message from the machine to a resident or a partner comes only from a fixed template with slots.
- **C38.** The wire format is JSON with camelCase fields, times are epoch milliseconds, and months and days use the time zone `America/Chicago`.
- **C39.** An outside call goes through the outbox and is tried again with exponential backoff at most 3 times, and then a person is told.
- **C40.** No secret, password or key is in the repository.

## Code

- **C41.** No source or config file has a code comment.
- **C42.** A function has at most 40 lines, and a file has at most 500 lines.
- **C43.** TypeScript uses strict mode, `const`, discriminated unions, no `any` and no non-null assertion.
- **C44.** Kotlin uses `val`, sealed classes for screen state and coroutines for work that waits.
- **C45.** Each error is typed with a `RejectionCode`, and no catch block is empty.
- **C46.** The package `contracts` holds every shape that crosses a boundary.
- **C47.** The package `core` holds every rule and has no I/O, and the clock, the random source and the hash are passed in.
- **C48.** The websites and the Android app are thin clients that send commands and show views.
- **C49.** Each change has a test, and the failing test is written before the code.
- **C50.** The command `make check` is the one quality gate, and it passes before each report and each merge.

## Documents

- **C51.** Documents use simple sentences and the structure rules of ASD-STE100.
- **C52.** A paragraph has at most 5 sentences.
- **C53.** At least 80 percent of the sentences in a document have 25 words or fewer.
- **C54.** The project glossary in `docs/glossary.md` takes the place of the closed STE dictionary.
- **C55.** No file has an em dash, an en dash or an emoji, and JSON data stores each one as an escape such as `\u2014`.
- **C56.** Each document has one writer, and two read-only reviewers check the facts and the rules.

## Git

- **C57.** Work happens on the branch `feature/vision-build` and on the track branches `feature/vision-<track>`.
- **C58.** No push, pull request, merge to main, tag or visibility change happens without a separate command from the owner.
- **C59.** A commit message is in the imperative mood and says why.
- **C60.** Each file or folder has one writer at a time.
- **C61.** Each decision of the owner goes in `docs/decisions.md` with his name and the date.

## AI

- **C62.** No commit, file or document has a co-author trailer or a credit line for a tool.
- **C63.** No tracked file names the editor or the writing tools of a team member.
- **C64.** The AI sorter stays off until a model passes the exam, the owner switches it on with a D row in `docs/decisions.md` (D27), and with the sorter off each card goes to the desk unsorted.
- **C65.** The sorter uses only an open-weights model on Workers AI, and no paid model and no API key are used.
- **C66.** A model is switched on only with a saved exam result for that model and prompt that found 24 of 24 emergencies twice.
- **C67.** The AI never writes its own words to a resident.
- **C68.** A refusal or an error from the model counts as "AI did not answer".
- **C69.** The AI never sets the level of a need.
- **C70.** Retired by the owner on 2026-11-21: no line about AI use in the build goes in the README or anywhere in the repository (D28).
