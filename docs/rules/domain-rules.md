# Domain rules

These rules say how Vision holds a request from the first door to the report. They expand the Product, Privacy and Data rules of `CONSTITUTION.md`. The source is sections 2, 7 to 14 and 16 of the design. The words are defined in `docs/glossary.md`.

## The principle

- One holder: at every moment, one named person or partner holds each open job (C3).
- A receipt for every move: a job moves only when the next holder says ACCEPT or GOT IT (C4).
- A clock on every hold: when the clock ends, the job moves on by itself (C5).
- The books balance: each month, every job is accounted for (C11).

## Anti-goals

The system fails if it does one of these things, even if the software works.

- It scores, ranks or predicts a person (C12).
- It keeps an acceptance score for a volunteer (C13).
- A machine refuses, closes, delays or lowers a request (C6).
- It writes a name, an address or free text into the ledger (C32).
- It sends an automatic message to a person on a quiet card (C22).
- It uses real data about people (C29).
- It shows a name or an address to a volunteer before the accept (C18).

## Cards and jobs

A card holds one or more jobs. One job is one need for one person. Custody, clocks and closing apply to a job. The desk can add a second job to a card.

| Path | States in order |
|---|---|
| Volunteers | planned, offered, accepted, on my way, there, done |
| Partner | planned, consent asked, partner asked, partner yes, got it |
| After the check-back | helped (closed), unreached (closed), mismatch (open), partly (open) |
| No path left | unmet (open, on the unmet shelf) |
| Any time | withdrawn (closed: the person cancelled, or the card is a duplicate) |

Only helped, unreached and withdrawn close a job (C9). A mismatch or a "partly" answer returns the job to the desk, and the job goes out again.

## Holder

- The desk person on shift holds a job when it is planned, offered, done, mismatch, or waiting for a partner.
- A volunteer holds a job from ACCEPT until DONE.
- A partner holds a job from GOT IT.
- The owner of the need holds a job on the unmet shelf.
- A lead holds a level 3 job.
- A new desk person takes the shift with one tap. This tap is the receipt for all jobs that the desk holds.

## Clocks

All times are proposals. ComForce sets them in the playbook.

| Clock | Starts | Default | When it ends |
|---|---|---|---|
| Desk confirm | A sorted card reaches the desk | 15 minutes | The page list is paged |
| Page answer | A page is sent | 3 minutes | The page moves to the next person |
| Wave wait | A wave is sent | 5 minutes | The next wave goes out. After the last wave the job returns to the desk |
| Start travel | ACCEPT | 2 hours | The claim ends and the job returns to the desk |
| Visit safety | THERE | 60 minutes | The desk gets a check task |
| Consent wait | Consent is asked | 24 hours | The desk gets a call task |
| Partner reply | A partner is asked | 2 hours | The job moves to the next rung |
| GOT IT wait | A partner says YES | 24 hours | The job moves to the next rung |
| Check-back | DONE or GOT IT | 24 hours if urgent, else 3 days | The question is sent |
| Check-back reply | The question is sent | 24 hours, 3 tries | After try 3 the job is unreached |
| Promise | The receipt is sent | From the playbook row | The promise is marked late |
| Forget | The job closes | 90 days | The vault rows are erased |

When the demo clock jumps over many deadlines, each due timer fires once, in the order of its due time. Then the alarm is set to the next deadline.

## Intake

- The doors built now are the web form and the mail door.
- The form asks for a first name, a way to reach the person, a ZIP code, the message, an address and whether contact is safe.
- The form page shows the tracking link at once. No message is sent before the card is sorted.
- After the desk confirms, the hub issues a route code and sends the fixed receipt.
- The receipt has the route code, the promised time, the tracking link, the forget date and a line about 911.

## Sorting

- The AI sorter reads the message two times. Each pass returns the service, the division or none, the urgency, the quoted words and one reason.
- Code checks that the two passes agree, that each quote is in the message, that no word list hit was marked low, and that the AI answered.
- A failed check adds a flag. A flag never lowers a card.
- The AI can only raise urgency. Only a person can lower it (C7).
- The desk confirms the need and the team with one tap. The desk picks the urgency with two buttons that have no default.
- A high card goes to the emergency lane and pages the page list. A page must be answered.
- If the AI does not answer after 3 tries, the card goes to the desk with the flag "AI did not answer". A word list hit then pages.
- The sorter stays off until a model passes the exam and the owner switches it on (C64). With the sorter off, each card goes to the desk unsorted, and the system still works.

## Path and levels

- The playbook has one row for each need. A row gives the owner, the level, the ladder, the silent time for each rung, the promise time and the skill tag.
- Level 1 goes by itself. Level 2 needs one tap from the desk or the owner. Level 3 means that a person leads.
- ComForce sets the level of a need. The AI never sets it (C69).
- For one card the level can only go up (C8).
- A need starts at level 2. After 60 cards in a row with no desk change, the organiser can switch it to level 1.
- One serious miss switches a need back to level 2. One card in 10 at level 1 still gets a blind check by the desk.
- One master switch returns all needs to level 2.
- The paths built now are volunteers, partner and the unmet shelf. A "no" or silence moves the job to the next rung.
- A quiet card is a card for the extraction service, or a card where contact is not safe. Only the lead sees it (C22).

## Volunteers

- The hub filters members by skill tag and by the "on" switch. It drops a member who holds 3 open jobs.
- It orders members by the distance from the home ZIP of the member to the ZIP of the job. In a tie, the member who waited longest comes first.
- The nearest 10 get the offer. The offer shows the need, the rough distance, the time and what to bring (C18).
- The first ACCEPT takes the job (C36). The other phones show "Taken. Thank you." A pass is free (C13).
- If nobody accepts before the wave clock ends, the next 10 get the offer. After the last wave the job returns to the desk.
- A crew job has a count. It stays open until the count is full.
- After ACCEPT the job card shows the address, the words of the person, the promise and the access notes (C19).
- The status buttons are ON MY WAY, THERE, DONE, HELP and HAND OFF. DONE asks what happened from a short list.
- On a level 3 job, the lead starts the wave to trained members or offers the job to one member by name. That member must still ACCEPT.

## Partner

1. The hub asks the person through the tracking page and mail. It asks if ComForce may share the first name, the ZIP and the need with this partner.
2. On YES the partner gets a link. The partner card shows the need, the ZIP and the deadline, with YES, NO and WAIT.
3. A partner accepts a one-page promise one time before the first note is shown.
4. On YES the card shows the short note: first name, ZIP, need, deadline, how to reach the person, and what was tried (C21).
5. The partner sends GOT IT with a date and a contact name. Only then does the partner hold the job.
6. The person gets one message that names who has the request.
7. NO, WAIT or silence moves the job to the next rung. The last rung is the unmet shelf with the honest message.
8. After the check-back, the partner card shows the result and the counts for that partner only.

## Follow-up

- Two keys close a job: DONE or GOT IT from the helper, and the answer of the person.
- The check-back asks: "Did they help? 1 yes, 2 partly, 3 no."
- Yes closes the job as helped.
- No after DONE makes a mismatch. The card turns red on the desk, and the next offer leaves out the first volunteer.
- Partly returns the job to the desk, and a person decides the rest.
- No answer after 3 tries closes the job as unreached (C10).
- The finish list shows started jobs that are not finished, sorted by the days since the last tap.

## Record

- Each tap is one dated ledger line. Hours come from the taps with no typing.
- A ledger line has a number, a time, the card, the job, the type, the role of the actor, an opaque id of the actor, the data and two fingerprints (C33).
- A ledger line can hold the need, the ZIP, the level, the flags and the status (C32).
- The vault holds the person, the message texts, the quoted words, the notes and the private details of members.
- On the forget date the hub erases the vault rows and writes one ledger line with the count (C23).
- The organiser can download a full export at any time.
- Honest limit: the seal shows a change after writing. It does not prove that an entry was true.

## Statement

The unit is a job. The month uses Milwaukee time (`America/Chicago`).

`open at the start + new = helped + unreached + withdrawn + unmet + still open`

- Helped, unreached and withdrawn count jobs that closed in the month.
- Unmet counts jobs on the unmet shelf at the end of the month.
- Still open counts all other jobs at the end of the month.
- Each job is in exactly one group, so the line always balances (C11).
- The statement also shows what went wrong, the promise-kept rate, the unmet table, the hours, the share erased on time and the seal.
- Each figure shows its count and one sentence that says how it was counted.

## Tracking code and links

- The route code is readable, for example `SNOW-16-042`: the need, the last two digits of the ZIP and a number.
- A level 3 need uses the neutral word `CARE` in the route code.
- The tracking link has a random secret part. It exists from the moment of the request (C26).
- The page shows the route code after the desk confirms. The code alone opens nothing.
- The page shows status words and times only. For a partner it shows the name of the partner.
- An old link shows "This request is closed" with no private detail (C27).

## Sign-in and roles

- An organiser makes a join code for each member. The member types the code one time, and the device gets a session.
- The roles are desk, volunteer, organiser and lead. The hub checks the role and the holder on each command.
- The mail door and the Google script share one secret. The owner creates it.

## Demo clock and rehearsal

- The hub reads time through one clock part. In demo mode an organiser can move the clock forward by set steps.
- A jump writes a ledger line. Each screen shows a "demo clock" mark while the clock is moved.
- The rehearsal runs invented requests through the same rules in fast time, in the browser of the organiser.
- The rehearsal never touches the real ledger. The same seed gives the same result.
