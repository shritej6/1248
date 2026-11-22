# Documentation rules

These rules apply to every document in the repository. They expand rules C51 to C56 of `CONSTITUTION.md`. The script `tools/check-docs.mjs` checks the rules that a machine can check. Two read-only reviewers check the other rules.

## Scope

The rules apply to each Markdown file that git tracks. The dash and emoji rule applies to every tracked text file, with no exception. A JSON file, such as the exam data and the saved model answers, stores each dash and emoji as an escape, for example `\u2014` for an em dash. Text in code blocks and in tables is not counted for the sentence and paragraph rules.

## Sentences

- Write one idea in each sentence.
- Use the active voice when you can.
- Use simple tenses: the present, the simple past and the simple future.
- Use an article or a demonstrative before a noun when you can.
- Do not use a chain of more than three nouns.
- Write instructions as commands, with one instruction in each sentence.
- Keep each sentence to 25 words or fewer when you can (C53).
- At least 80 percent of the sentences in a document must pass the length rule.

## Paragraphs

- A paragraph has at most 5 sentences (C52).
- A paragraph has one topic.
- Put the main point in the first sentence.
- Each item in a list counts as one paragraph.

## Words

- Use the words of `docs/glossary.md` with the meaning given there (C54).
- Use one word for one thing. Do not use a synonym for a glossary word.
- Use plain words in public text. Public text says "one holder, hand to hand, never dropped" (C2).
- The technical name of the custody principle appears only in `docs/architecture.md`. The docs check fails if it appears in any other file.
- Write numbers as digits when they measure something, for example 5 minutes or 24 hours.
- Write times in Central time, and give the time zone.

## Characters

- Do not use an em dash (U+2014) or an en dash (U+2013) (C55). Use a comma, a colon, a full stop or the word "to".
- Do not use an emoji.
- Use straight quotation marks.

## Structure

- Start each document with one heading and one short paragraph that says what the document is for.
- Use headings for sections. Do not skip a heading level.
- Use a numbered list for steps in order. Use a bullet list for items with no order.
- Use a table for facts that have the same parts, for example a version or a time.
- Put each command in a code block. Each command in a document must run.

## Facts

- Each fact has a source in the repository, in the spec or in a test.
- Each figure shows its count and how it was counted.
- State an honest limit when one exists. For example, the seal shows a change after writing, but it does not prove that an entry was true.
- Use only synthetic names, addresses and numbers (C29).

## Authors and reviews

- Each document has one writer (C56).
- One reviewer checks each fact against the spec and the code.
- One reviewer checks the writing rules in this file.
- Reviewers read and report. They do not edit.
- A document names no writing tool of a team member and has no co-author or credit line (C62, C63).
