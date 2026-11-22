# Rules to checks

This table maps each rule of `CONSTITUTION.md` to the check that enforces it. A check is a `make check` target, a named test or a review. The `Makefile` holds the gate, and `make check` runs every target. A target with no code to check yet prints a skip message and passes.

The `make check` targets are `lint`, `typecheck`, `test`, `docs`, `comments`, `secrets`, `exam` and `android`. A rule with the kind "review" has no machine check, and a read-only reviewer checks it.

| Rule | Short form | Kind | Check |
|---|---|---|---|
| C1 | Product name is Vision | review | Docs reviewer |
| C2 | Plain public words | gate | `make docs` (`tools/check-docs.mjs`) fails on the technical name outside `docs/architecture.md` |
| C3 | One holder for each open job | test | `make test`: core property test, one holder |
| C4 | Move only on a receipt | test | `make test`: core unit tests for ACCEPT and GOT IT |
| C5 | A clock on every hold | test | `make test`: core deadline tests, `jump_fires_in_order` |
| C6 | No machine refusal, close, delay or lowering | test | `make test`: core property test, only a person lowers urgency |
| C7 | Only a person lowers urgency | test | `make test`: core property test |
| C8 | A level never goes down for one card | test | `make test`: core property test |
| C9 | Three closed states only | test | `make typecheck` and `make test`: core state tests |
| C10 | Silence is unreached | test | `make test`: core check-back tests |
| C11 | The statement balances | test | `make test`: core property test with random histories |
| C12 | No scoring of people | review | Rules reviewer |
| C13 | No offer list and no pass in the ledger | test | `make test`: core event tests, `make typecheck` on the event union |
| C14 | The desk taps for a volunteer | test | `make test`: core test for `job.tap_for` |
| C15 | Touch targets of the UI design system: 32 px desk and organiser, 44 px resident and partner, 48 dp app | review | Accessibility reviewer |
| C16 | Colour is never the only signal, AA contrast | review | Accessibility reviewer |
| C17 | Plain words on screens | review | Docs reviewer |
| C18 | No name or address in an offer | test | `make test`: core view tests, `make android` offer tests |
| C19 | Job card for the holder only | test | `make test`: core view tests, hub role tests |
| C20 | The hub applies privacy | test | `make test`: hub view tests |
| C21 | Three conditions for the short note | test | `make test`: core partner tests |
| C22 | Quiet card rule | test | `make test`: core quiet card tests |
| C23 | Erase on the forget date | test | `make test`: hub forget job tests |
| C24 | Forget after 90 days | test | `make test`: config and core clock tests |
| C25 | No private detail in logs | review | Security reviewer |
| C26 | One card for each link, secret stored as a fingerprint | test | `make test`: hub link tests |
| C27 | Old link shows closed | test | `make test`: `closed_job_shows_closed_only`, `link_after_forget_shows_closed` |
| C28 | Form limits and trap field | test | `make test`: hub form door tests |
| C29 | Synthetic data only | review | Rules reviewer and `make secrets` |
| C30 | No real inbox, number or person | review | Rules reviewer |
| C31 | Append-only ledger that rebuilds state | test | `make test`: core property test, snapshot equals rebuilt state |
| C32 | No name or free text in the ledger | test | `make typecheck` on the event schemas and `make test`: contract tests |
| C33 | SHA-256 seal | test | `make test`: core seal property test, a changed line fails |
| C34 | One writer for each organisation | test | `make test`: hub command path tests |
| C35 | A resent command returns the first result | test | `make test`: `commands_resend_returns_first_result` |
| C36 | Exactly one accept wins | test | `make test`: core property test, `two_accepts_one_wins` |
| C37 | Fixed templates only | test | `make typecheck` on `TemplateId` and `make test`: core message tests |
| C38 | Wire format and time zone | test | `make test`: contract fixture tests |
| C39 | Outbox with 3 tries | test | `make test`: hub outbox tests |
| C40 | No secret in the repository | gate | `make secrets` (secretlint with `.secretlintrc.json`) |
| C41 | No code comments | gate | `make lint` (`vision/no-comments` in `eslint.config.js`) and `make comments` (`tools/check-comments.mjs`) |
| C42 | 40 lines in a function, 500 in a file | gate | `make lint` (`max-lines-per-function`, `max-lines`) |
| C43 | TypeScript strict rules | gate | `make lint` (`strictTypeChecked`) and `make typecheck` (`tsconfig.base.json`) |
| C44 | Kotlin rules | review | Code reviewer and `make android` |
| C45 | Typed errors, no empty catch | gate | `make lint` and `make typecheck` |
| C46 | Shapes live in `contracts` | review | Code reviewer |
| C47 | No I/O in `core` | gate | `make lint` (`no-restricted-imports` in `packages/core`) |
| C48 | Thin clients | review | Code reviewer |
| C49 | Test first | review | Code reviewer |
| C50 | One quality gate | gate | `make check` |
| C51 | STE structure rules | review | Docs reviewer |
| C52 | At most 5 sentences in a paragraph | gate | `make docs` (`tools/check-docs.mjs`) |
| C53 | 80 percent of sentences pass the length rule | gate | `make docs` (`tools/check-docs.mjs`) |
| C54 | Glossary words | review | Docs reviewer |
| C55 | No em dash, en dash or emoji | gate | `make docs` (`tools/check-docs.mjs`) |
| C56 | One writer and two reviewers for each document | review | Lead |
| C57 | Work branches | review | Lead |
| C58 | No push without the owner | review | Lead |
| C59 | Imperative commit messages that say why | review | Lead |
| C60 | One writer for each file | review | Lead |
| C61 | Decisions in the log | review | Lead |
| C62 | No co-author trailer or credit line | review | Lead, helped by the local `commit-msg` and `pre-push` git hooks on the lead's laptop. Other clones and CI have no hook, so before each push from any clone the lead reads `git log <base>..HEAD --format=%B` by hand |
| C63 | No names of writing tools | review | Lead, helped by the local `pre-push` git hook on the lead's laptop. Other clones and CI have no hook, so before each push from any clone the lead reads `git status --ignored` and the new files by hand |
| C64 | Sorter off until a model passes and the owner switches it on | gate | `make exam`: a set `SORTER_MODEL` needs a passing row; `make test`: hub tests with the sorter off |
| C65 | Open-weights model, no paid model, no key | gate | `make exam` and `make secrets` |
| C66 | A passing exam record before a model is on | gate | `make exam` (`tools/check-exam-record.mjs`) |
| C67 | The AI writes no words to a resident | test | `make typecheck` on `TemplateId` and `make test`: core message tests |
| C68 | Refusal or error is "AI did not answer" | test | `make test`: core sort tests |
| C69 | The AI never sets a level | test | `make test`: core level tests |
| C70 | Retired by the owner on 2026-11-21 | none | None |
