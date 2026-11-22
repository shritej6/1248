# Glossary

This glossary takes the place of the closed STE dictionary (C54). Each document uses these words with the meaning given here. Use one word for one thing, and do not use a synonym for a word in this list.

## Terms

- **AI job**: One supervised task that a model does for the desk: the voicemail transcript, the same-event link or the Spanish translation. Each AI job has a key: `voice`, `link` or `lang`.
- **card**: The record of one request for help from one person. A card holds one or more jobs.
- **check-back**: The question that the hub sends to the person after DONE or GOT IT: "Did they help? 1 yes, 2 partly, 3 no." The answer of the person is the second key that closes a job.
- **demo clock**: The clock part of the hub in demo mode. An organiser can move it forward by set steps, and each jump writes a ledger line.
- **gist**: The short words that the desk types for a voicemail when no transcript comes. The gist goes in the vault and then through the sorter and the word list.
- **holder**: The one named person or partner who holds a job at a given moment. Every open job has exactly one holder.
- **job**: One need for one person. Custody, clocks and closing apply to a job.
- **ladder**: The ordered list of rungs for one need in the playbook. The last rung is always the unmet shelf.
- **ledger**: The append-only list of events for one organisation. A ledger line holds no name, no address, no contact detail and no free text.
- **level**: How much a person takes part in the path of a need. Level 1 goes by itself, level 2 needs one tap, and at level 3 a person leads.
- **machine translation**: The English text that a model makes from a Spanish message, for the desk only. It never goes to a resident.
- **mismatch**: The state of a job when the helper said DONE and the person answered "no" at the check-back. The job returns to the desk and goes out again without the first volunteer.
- **off switch**: The environment variable of one AI part that holds the model id. An empty variable turns that part off.
- **offer**: The message that a volunteer gets for an open job. It shows the need, the rough distance, the time and what to bring, and it shows no name and no address.
- **partner card**: The web page that a partner opens by a link with no account. It shows one job and the buttons YES, NO, WAIT and GOT IT.
- **playbook**: The table of rules from ComForce, with one row for each need. A row gives the owner, the level, the ladder, the promise time and the skill tag.
- **quiet card**: A card for the extraction service, or a card where contact is not safe. Only the lead sees it, and the machine sends nothing to the person.
- **rehearsal**: A run of invented requests through the same rules in fast time, in the browser of the organiser. It never touches the real ledger.
- **route code**: The readable code of a card, for example `SNOW-16-042`. The code alone opens nothing.
- **rung**: One step of a ladder: volunteers, one partner or the unmet shelf. A "no" or silence moves the job to the next rung.
- **same-event link**: A proposal by the link job that two cards report the same event. Only a person answers it, with "Same event" or "Not the same". A link never merges, closes or lowers a card.
- **seal**: The chain of SHA-256 fingerprints over the ledger lines. A changed line fails the seal check.
- **statement**: The monthly report that accounts for every job. It always balances.
- **supervision rules**: The seven rules that every AI part of Vision follows. `docs/ai-jobs.md` holds them.
- **tracking link**: The link with a random secret part that a resident gets at once after a request. It opens the tracking page of one card.
- **transcript**: The text that speech AI makes from a voicemail. The desk sees it under the recording and listens before it confirms.
- **unmet shelf**: The place for jobs that have no path left. The owner of the need holds each job on the unmet shelf.
- **vault**: The store of private details apart from the ledger. Each vault row has a forget date.
- **wave**: One group of up to 10 volunteers who get the same offer at the same time. If nobody accepts before the wave clock ends, the next wave goes out.

## Other words

- **desk**: The person on shift who confirms cards and holds jobs that wait. The desk uses the desk website.
- **door**: A way in for a request. The doors built now are the web form, the mail door and the voicemail door.
- **event group**: Cards that a person linked with "Same event". The desk sees the group and its highest urgency, and each card keeps its own job.
- **flag**: A mark on a card that asks a person to look, for example "AI did not answer" or "Voicemail. A person must confirm it." A flag raises the level of a job to 2 at least.
- **forget date**: The date on which the hub erases a vault row. The default is 90 days after the job closes.
- **page**: A full-screen alert with a sound for a person on the page list. A page must be answered.
- **receipt**: A tap that says the next holder has the job, such as ACCEPT or GOT IT. It is also the fixed message to a person after the desk confirms the card.
