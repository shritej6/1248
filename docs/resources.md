# Resources

This document tells ComForce and the judges how the Resources tab of the organiser website works. Resources turns the sealed record into funding. It finds money, goods and skills that fit the work, shows what ComForce must have ready, and writes drafts that a person approves.

Status: built on 2026-11-22 for the finals demo. A part marked "after the demo" is not built.

## The short version

- Code forecasts the next 12 months of work from the record. The forecast uses no AI.
- Code matches the forecast to a catalog of funders and programs. Each match shows why it fits and each caution.
- The readiness list shows what ComForce needs before money can arrive.
- An AI job writes a draft impact post or a draft funder letter. The draft guard, which is code, checks every number and stops quotes and stories.
- The organiser approves a draft with one tap. The approval goes in the ledger.
- Vision never sends, posts or applies. A person copies the approved text and sends it from their own account.

## The closed loop

| Step | What happens | Who does it | Where it shows |
|---|---|---|---|
| 1. Record | Each request, job and volunteer hour goes in the sealed ledger. | The desk, the volunteers and the hub | Ledger and statement |
| 2. Forecast | Code turns the monthly record into a range for the next 12 months. | Code in core | Resources tab |
| 3. Match | Code ranks the catalog against the forecast, the readiness list and the deadlines. | Code in core | Resources tab |
| 4. Get ready | The organiser marks each item of the readiness list. | Organiser | Resources tab |
| 5. Draft | The AI job writes a draft from fixed facts. The draft guard checks it. | AI job, then code | Resources tab |
| 6. Approve | The organiser reads the draft and taps Approve. | Organiser | Ledger line `draft.approved` |
| 7. Send | A person copies the text and sends or posts it. | A person | Outside Vision |
| 8. Report | The next statement counts the work that the money paid for. | Code in core | Statement |

The loop closes at step 8. Money pays for work, the work goes in the record, and the record feeds the next forecast.

## What is automatic

Automatic means that code does the step. One tap means that code prepares the step and a person confirms it. A person means that only a person can do it.

| Step | Verdict | In the demo | Reason |
|---|---|---|---|
| Find | Automatic | The catalog is a file of public facts that a person checked on 2026-11-22. | The facts are public. Live discovery comes after the demo. |
| Match | One tap | Code ranks each row, and the organiser decides which rows to follow. | A mistake about eligibility costs time and money. |
| Forecast | Automatic inside Vision. One tap before it reaches a funder. | The forecast shows in the tab. A forecast number leaves Vision only in an approved draft. | A forecast in an ask is a claim to a third party. |
| Draft | Automatic | The AI job or the fixed template writes the draft. | Drafting is safe. Sending is the risk. |
| Approve | One tap | The organiser taps Approve, and the ledger gets a line. | A person owns every word that leaves. |
| Post | A person | Vision gives Copy and Download only. | Vision never posts. |
| Ask | One tap for a known contact. A person for a first contact. | Not in Vision. | Donors and funders expect a person. |
| Apply | A person | Not in Vision. | Only an authorised person can submit on Grants.gov, and a false statement carries penalties. |
| Thank | Automatic receipt only with 501(c)(3) status. One tap for a personal note. | After the demo. | An IRS receipt is valid only from a 501(c)(3). |
| Report | Automatic statement. A person signs any certification. | The statement exists today. | A certification needs a signature. |

## The forecast

The forecast is code in `packages/core/src/resources/`. It uses no AI, and the same input always gives the same output.

### Inputs

- The record: the number of jobs for each need in each month, from the `job.planned` lines of the ledger. Months use Chicago time.
- The hours on the volunteer records. Hours count in the month that the job was planned.
- In demo mode, a synthetic history of 24 months. A seeded generator with the seed 20261122 makes it, and the tab labels it synthetic.
- From the first full month of the record, the record replaces the synthetic months.
- With demo mode off, only the record counts. Vision shows no forecast until the record has 12 full months.
- Quiet work never counts in the forecast. The forecast skips each quiet job and each need with a quiet playbook row.

### Seasons

- Snow removal follows the Milwaukee snowfall normals of 1991 to 2020.
- Shelter and food follow the heating season, from 1 October to 15 May. Code compares the months in the season with the other months of the history.
- Lawn care, cleanup and youth stipends follow the month pattern of their own history.
- Every other need has the same weight in each month.

| Month | Oct | Nov | Dec | Jan | Feb | Mar | Apr | May to Sep |
|---|---|---|---|---|---|---|---|---|
| Snowfall normal, inches | 0.3 | 2.5 | 10.4 | 14.9 | 11.8 | 6.7 | 2.1 | 0 |

The annual normal is 48.7 inches at Mitchell airport.

### Method

1. For each need, code finds a weight for each calendar month from its season rule.
2. Code finds the level of the need: the average of the last 12 months, each month divided by its weight. A month with a weight under 0.2 does not count.
3. The likely jobs of a future month are the level times the weight of that month.
4. The low and high ends come from how far each past month was from its own likely value. Code takes the 10th and the 90th percentile of that ratio.
5. With fewer than 4 usable months, the band is 30 percent below and above the likely value.
6. Hours are the jobs times the hours for each job in the history.

The method is simple on purpose. A person can check it by hand.

### Money

- Volunteer time counts at $34.67 an hour. This is the Wisconsin value of a volunteer hour for 2025, from Independent Sector. The value is preliminary. It is in-kind value and never cash.
- Cash is the jobs times the unit cost that the organiser enters for the need. Each entry shows "Estimate" until ComForce enters the cost from receipts.
- A need with no unit cost shows "Unit cost not yet measured". No Milwaukee source publishes the cost of a snow job, a motel night or a food box, so Vision does not guess it.

### Output

For each need and each of the next 12 months, the forecast gives jobs, hours, the value of volunteer time and cash. Each one has a low, a likely and a high value. The chart shows the likely jobs of each month with a line from low to high. A table under the chart gives every number.

## The catalog

The catalog is the file `data/resources/catalog.json`. It holds real public facts about funders and programs. It holds no name of a person and no contact detail.

| Field | What it holds |
|---|---|
| Kind | Grant; people and crowdfunding; company; goods, space and skills |
| Amount | The lowest and the highest award in whole dollars, or nothing when the page does not say |
| Eligibility | Needs a 501(c)(3), takes a fiscal sponsor, takes a resident group, invitation only, federal money, a partner applies |
| Dates | The known deadlines, or rolling |
| Fit | The playbook needs and divisions that the row fits, or general support |
| Cautions | Limits from the funder page, for example "no stipends" |
| Source | The URL, the date a person checked it, and the quality of the source |

Source quality has four values. "Opened" means a person read the page itself. "Search summary" means a person saw only a search result. "Third party" means a news site or a directory. "Old" means a source from before 2025.

A person updates the catalog. They open each source page, change the row and set the checked date. The hub never calls a funder site.

### The rows for the demo

All rows were checked on 2026-11-22.

| Row | Kind | Amount | Who can apply | Next date | Source |
|---|---|---|---|---|---|
| Safe & Sound Good Neighbor Grant Fund | Grant | Up to $2,500 | A resident group with a Milwaukee lead aged 18 or more. An LLC or a nonprofit cannot apply. | Rolling | Opened |
| Community Connections Small Grants | Grant | $50 to $600, with a match | 3 unrelated adult residents | Not published. The 2026 date of 20 August has passed. | Opened |
| Bader Philanthropies, preliminary application | Grant | Not stated | Not stated. Realistic with a sponsor. | 30 November 2026, then 31 May 2027 | Opened |
| Greater Milwaukee Foundation, grant cycles | Grant | Not stated on the pages read | A 501(c)(3), or a signed fiscal sponsor agreement | Not published | Opened |
| Greater Milwaukee Foundation, Reasons for Hope | Grant | $1,000 to $10,000 | Through a fiscal sponsor, in named neighbourhoods | Not published for 2027 | Opened |
| Wisconsin Community Safety Fund | Grant | Not published | Has funded an LLC through a fiscal sponsor | Not announced | Opened |
| Lions Clubs International Foundation, Emergency Grant | Grant | $5,000 to $15,000 | A Lions district governor applies | Rolling | Third party |
| Emergency Food and Shelter Program, county board | Grant, federal | Not published | A local nonprofit or a fiscal agent | Not found | Old |
| United Way Urgent Need Fund | Grant | Up to $15,000 | A 501(c)(3) | Closed, funding exhausted | Opened |
| We Energies Foundation | Company | Not stated | A 501(c)(3), one grant a year | 31 January 2027, then each quarter | Opened |
| Walmart Spark Good Local Grants | Company | $250 to $5,000 | A 501(c)(3). The page does not mention sponsors. | 30 November or 31 December 2026. The sources disagree. | Opened |
| Brewers Community Foundation | Company | $1,000 to $10,000, not checked | Not confirmed | 1 November each year, not checked, so not in the catalog | Search summary |
| Givebutter, through the sponsor | People | Platform fee near zero with tips on | Through the EIN of the sponsor | Rolling | Opened |
| Every.org, through the sponsor | People | No platform fee | Through the sponsor | Rolling | Opened |
| Taproot Plus | Goods, space and skills | Free skilled volunteers | Reported to take sponsored groups | Rolling | Third party |
| Milwaukee Area Time Exchange | Goods, space and skills | Time credits | No 501(c)(3) needed | Rolling, activity not confirmed | Third party |
| Hunger Task Force network | Goods, space and skills | Free food for members | Network rules from 2018 | Rolling | Old |
| Feeding America Eastern Wisconsin | Goods, space and skills | Food for partner pantries | A 501(c)(3) with 6 months of food work | Rolling | Search summary |
| Milwaukee Habitat for Humanity ReStore | Goods, space and skills | Building materials at low prices, not free | No group program found | Rolling | Search summary |

## The match

Code ranks every catalog row with a score out of 100. Fit counts for 45 points, reach for 35 points and timing for 20 points.

- Fit: the share of the forecast jobs in the needs that the row fits. A row for general support counts at least half.
- Reach: how ComForce can apply today. The ways are direct, through a fiscal sponsor, only with its own 501(c)(3), through a partner, by invitation, or ask first when the page does not say.
- Timing: a rolling row or a deadline in 8 to 120 days counts in full. A deadline in 7 days or less, a deadline after 120 days or no open deadline counts less. A closed row counts zero.

Each match shows its reasons and its cautions. A reason is a fact in favour, for example "A resident group can apply". A caution is a fact that can stop or slow the money, for example "Needs a signed fiscal sponsor agreement", "Deadline in 8 days", "By invitation only" or "Search summary only".

Cautions can be added and never removed. The match always shows the cautions of the catalog row. Only a fact that the organiser records can change a caution, and a sponsor caution stays: "Needs a signed fiscal sponsor agreement" becomes "Through the fiscal sponsor". The AI has no part in the match.

The match ranks funders and programs, never a person (C12).

## The readiness list

The money path is a fiscal sponsor now and the own 501(c)(3) status of ComForce later. The readiness list shows the four items on that path. The organiser marks the state of each item, and the match uses the states. For each item and each unit cost, the hub keeps the time and the member of the last change, in its own tables and not in the ledger.

| Item | States | Why it matters |
|---|---|---|
| Fiscal sponsor agreement | Not started, talking, signed | Most grants and online giving need a 501(c)(3). A sponsor lends its status, holds the money, answers for compliance and takes a fee. |
| Wisconsin DFI charitable registration | Not checked, DFI confirmed the exemption, registered | A charity registers under chapter 202 before it asks the public in Wisconsin for money, unless it is exempt. |
| Own 501(c)(3) status, later | No, applied, yes | Tax receipts and many foundations need it. The legal form of ComForce must be settled first. |
| SAM.gov and a UEI, for federal money only | Not needed, needed, active | A federal grant needs a UEI, and a person renews the registration each year. |

| Sponsor | Fee | Note |
|---|---|---|
| Center for Community Stewardship, Madison | 9 percent, or 15 percent for government money, plus $250 a year | Sponsors charitable work. Its rules for unincorporated groups are not stated. |
| Embolden WI, Madison | 8 percent for the pre-approved grant model, 10 percent full service, 15 percent for government money | One directory source. |
| Safe & Sound Inc., Milwaukee | Not published | It is already the fiscal agent of Flood Hope 500. Ask it first. |

## Drafts

### What a draft is

- An impact post for one month, from the statement of that month.
- A funder letter for one catalog row, from the statement, the forecast and the row.

Each draft starts from a list of facts. The hub makes the list from the sealed ledger, the forecast and the catalog row, so the browser cannot add a number. A fact has a label and its exact text, for example the label "Jobs closed as helped" with the count of the month as its text. The labels use the words of the statement.

A draft uses totals only. It never names a person, a ZIP code or the details of a request. The totals come from the statement, which counts a quiet job as a number only. The facts for each need, such as the needs that a funder fits, leave quiet needs out.

### How the AI job runs

1. The organiser taps "Write the impact post", or "Write a letter" on a match.
2. The hub saves the facts, writes the ledger line `draft.asked` and puts one item in the outbox.
3. The alarm sends the item to the draft job, after every other due item of the outbox. Each run of the alarm sends at most one draft, so a page that comes in meanwhile goes before the next draft. The job makes one model call with the facts only.
4. The draft guard checks the text. A failed check or a failed call is tried again, with at most 3 model calls in all.
5. If no text passes, Vision uses the fixed template and shows a flag.
6. The hub adds a fixed footer with the month and the seal line, and writes the ledger line `draft.done`.

The fixed template uses the same facts in fixed sentences, so a draft is ready even with the AI off. The footer is code. It names the month and the ledger line of the seal, and a letter with a synthetic forecast adds "The forecast uses synthetic history."

The hub refuses some asks with an error. A letter goes only to a grant or a company row that is not closed. The Write a letter button uses the same rule. A fact text with a link, a bare domain or an invisible format mark stops the ask, since the fixed template prints facts unchecked. The 21st ask of one Chicago day gets 429.

### The fixed template

The fixed template is code in `packages/core/src/resources/template.ts`. It uses only the facts of the draft.

- The impact post names the group and the month. It gives one line for each total of the month, as the label and the text, and it thanks the volunteers.
- The funder letter greets the team of the funder by the part of the row name before the first comma, for example "Bader Philanthropies". It introduces the group and lists the totals of the month. It asks whether the group can apply to the row, by its full name, and it signs with the group name.
- When the forecast is ready and the row fits a need, the letter adds one sentence of this form: `For the 12 months from December 2026 to November 2027, our forecast for <needs> is <low> to <high> jobs and <low> to <high> volunteer hours.`
- A letter to a row that a person read on the funder page itself also gives the award size and the next deadline, when the page states them. The hub counts the next deadline from the Chicago date of the ask.

### The draft guard

The draft guard is code in `packages/core/src/resources/guard.ts`. First it removes every invisible format mark, such as a zero-width space or a soft hyphen, and puts the text in NFKC form. It checks that text, and Vision keeps that same text. It stops a draft that has any of these:

- A number that is not in the facts. Years, dates and amounts count as numbers.
- A number with a size or a plus after it, such as `12K`, `3 M`, `9x` or `10+`, even when the number is a fact.
- A percent sign or the word "percent".
- A number written as a word, for example "twelve", "a dozen" or "twice".
- A word for a multiple, for example "doubled", "tripled", "halved", "twofold" or "12-fold".
- A quotation mark: straight, curly or angle quotes, a backtick, or a single quote that opens a quote.
- A quote, a testimonial or a story about a person, for example "said", "in her words" or a title such as `Mrs.` with a name.
- A link that starts with `http://`, `https://` or `www.`, any `@` sign, as in an email address, or a bare domain such as `comforce.org` or `bit.ly/give`.
- A claim of tax status or of a fiscal sponsor that the readiness list does not show. "Nonprofit", "not-for-profit", "charity", "tax-exempt" and "deductible" count as a claim of 501(c)(3) status.
- A text that is too short or too long.

A bare domain is a letter or a digit, a dot and at least two letters. So `e.g.`, `a.m.`, `p.m.`, `U.S.`, `St. Louis`, `Ph.D`, `1.5` and `$34.67` are not links.

The draft guard can only stop text. It never adds a number or changes a fact. It checks that each number is a fact, but not that the number is in the right place, so the person who approves checks that.

Before the quote, story and status checks, the guard replaces each fact text with a placeholder. A group name or a need label may then hold a word that those checks stop, and the fixed template prints it unchecked (O27).

### Known false rejects

The draft guard is strict on purpose, so it also stops some safe text. A stopped text falls back to the fixed template. These cases are known, and the guard stays strict:

- "Each one of our volunteers" counts as a number word, because "one" is a number.
- "We would like to meet Bader Philanthropies" counts as a story, because "meet" before a name starts a story about a person.
- A word that ends in "fold", such as "unfold" or "scaffold", counts as a word for a multiple.
- A full stop with no space after it, as in `helped.Thank`, counts as a bare domain.

### Approve, copy and download

- Approve is one tap by the organiser. The hub writes the ledger line `draft.approved` with the SHA-256 of the full text and the member who approved it.
- Copy and Download show only after approval.
- No ledger line holds text. The text stays in the hub, and the hash in the ledger proves which words the organiser approved.

### The supervision rules

The draft job follows the seven supervision rules of `docs/ai-jobs.md`.

| Rule | How the draft job follows it |
|---|---|
| 1. One off switch | `DRAFT_MODEL` holds the model id. Empty means that every draft uses the fixed template, and the tab still works. |
| 2. The AI suggests and shows its evidence | Each draft shows the facts that it may use. |
| 3. The AI can only add caution | The draft guard can only stop text. The AI never changes the forecast, the match or a caution. |
| 4. A person confirms | The organiser approves each draft before Copy shows. |
| 5. A fallback after at most 3 tries | After 3 model calls the fixed template is used with a flag. A failure of the outbox item itself also ends in the template. |
| 6. Nothing personal in the ledger or the logs | The job sees totals and public funder facts only. The ledger lines and the log lines hold no text. |
| 7. A measured check | `exam/src/draft-check.ts` runs the job on synthetic facts and saves the result in `exam/draft-results/`. |

### Cost

The draft job uses Gemma 4 26B on Workers AI, the model of the sorter. The live check of 2026-11-21 counted 63.8 neurons for 6 sorter calls, about 10.6 neurons a call. A draft is longer than a sorter answer, so the measured check gives the real number.

Vision makes at most 20 drafts a day for each organisation, so at most 60 model calls. The day is the real Chicago date, so a jump of the demo clock does not reset the count. Even at 50 neurons a call, that is 3,000 neurons, under the free allowance of 10,000 neurons a day.

## Compliance notes

This is not legal advice. A lawyer or the Wisconsin DFI must confirm these points before ComForce asks the public for money.

- Fiscal sponsor: the Greater Milwaukee Foundation takes a group without 501(c)(3) status only with a signed fiscal sponsor agreement. The sponsor answers for compliance and reporting.
- Wisconsin registration: a charity registers under chapter 202 before it asks for money in Wisconsin. The exemption for a small group needs all three of these: $25,000 or less in a year, no paid employees and only unpaid volunteers.
- Wisconsin registration: a public donation website counts as asking in Wisconsin. The application fee is $15, the renewal is $54, and the renewal is due each year before 31 July.
- IRS receipts: a gift of $250 or more needs a written acknowledgment. A payment of more than $75 that gets goods or services back needs a disclosure. Only a 501(c)(3) can give a receipt for a tax deduction.
- Fake reviews and testimonials: the FTC rule has been in force since 2024-10-21. It covers testimonials from people who do not exist. The draft guard stops quotes and stories for this reason.
- Federal money: only an Authorized Organization Representative submits on Grants.gov. SAM.gov needs a UEI and a renewal each year, and a false statement carries criminal and civil penalties.
- Email: CAN-SPAM asks for a clear sender, a postal address and an opt-out that works. Vision sends no email, and a person who sends one follows these rules.
- Platforms: post only to the pages of ComForce. Do not post into the groups of other people, and do not scrape.
- Privacy: the forecast, the match and the facts for each need leave quiet work out. The totals of a draft come from the statement, which counts a quiet job as a number only. A draft uses totals only, and the details of a request never go into fundraising text.

## What Vision never does

- It never sends an email or a message to a funder or a donor.
- It never posts to a page.
- It never submits an application.
- It never calls a funder site. The catalog is a file in the repository.
- It never keeps a secret in code.

## Open items

| No. | Item | Owner |
|---|---|---|
| O20 | `DRAFT_MODEL` holds `@cf/google/gemma-4-26b-a4b-it`. The measured draft check has not run yet, and the owner decides whether the draft job stays on for the finals. | Shritej |
| O26 | Resolved on 2026-11-22. The draft guard stops a bare domain such as `comforce.org`, a quote in backticks and a word with an invisible format mark. | Lead |
| O27 | The guard replaces each fact text with a placeholder before its quote, story and status checks, and the fixed template prints fact texts unchecked. The hub refuses a fact text with a link, a bare domain or a format mark, but a group name or a need label may still hold a quote or a claim of status. | Lead |

`docs/decisions.md` holds the full rows.

## After the demo

1. Live funder discovery. A scheduled job reads the Simpler.Grants.gov search API and the USAspending API through the outbox. Each new row waits for a person to check it before it enters the catalog.
2. The sponsor workflow. Vision keeps the sponsor agreement, its fee and its reporting dates, and it adds the fee to each cash forecast.
3. Donor thank-you receipts. A fixed template fills the IRS content from the payment record, only for a 501(c)(3) or through the sponsor. A person approves a personal note.
4. A seasonal campaign calendar. It shows GivingTuesday on 1 December 2026, the snow season, the heating season and the summer youth work, each with the matching forecast.
5. A forecast for year one from public data. Daily snowfall from NOAA and the energy assistance season give a labelled range before the record has 12 months.
6. Edit a draft. The draft guard then shows its findings as cautions, and the person decides.
7. Funder search in the public 990-PF files of the IRS, to see which foundations fund groups like ComForce in Milwaukee.

## Risks

| Risk | What Vision does |
|---|---|
| The legal form of ComForce is not known. No EIN or 990 was found. | The readiness list starts with the sponsor agreement, and the match shows "needs a fiscal sponsor". |
| The Wisconsin exemption may not apply, for example if the group has paid staff. | The readiness list shows the DFI check, and each row for public giving shows a caution until the check is done. |
| A draft repeats a number with no method, such as "10K+ served". | The draft guard stops any number that is not a fact of the sealed record or the forecast, and a number with a size or a plus after it. |
| A draft invents a quote or a story. | The draft guard stops quotation marks, quotes and stories, and a person approves each draft. |
| A forecast built on synthetic history reaches a funder. | Demo mode labels the history synthetic, and the footer of each letter says so. With demo mode off, only the record counts. |
| A catalog row is out of date. | Each row shows its checked date and its source quality. A row older than 30 days gets a caution. |
| A funder refuses text that an AI wrote. | A person owns and edits every application. The fixed template is always there. |
| The AI uses too much of the free allowance. | At most 20 drafts a day, each with at most 3 model calls. |
| Fundraising text exposes a person. | Drafts use totals only. The statement counts a quiet job as a number only, and the forecast, the match and the facts for each need leave quiet work out. |

## Sources

All sources were checked on 2026-11-22. The source notes are in `research/round8-funding/`, outside this repository.

- [Milwaukee snowfall normals, NWS](https://www.weather.gov/mkx/Climate_Snow). Search summary.
- [Wisconsin Home Energy Assistance Program](https://energyandhousing.wi.gov/Pages/AgencyResources/energy-assistance.aspx). Search summary.
- [Value of volunteer time, Independent Sector](https://independentsector.org/research/value-of-volunteer-time/). Opened.
- [Wisconsin DFI charitable organization FAQ](https://dfi.wi.gov/Pages/BusinessServices/CharitableProfessionalOrganizations/CharitableOrganizationsFAQ.aspx). Opened.
- [Wisconsin DFI fees](https://dfi.wi.gov/Pages/BusinessServices/CharitableProfessionalOrganizations/Fees.aspx). Search summary.
- [IRS written acknowledgments](https://www.irs.gov/charities-non-profits/charitable-organizations/charitable-contributions-written-acknowledgments). Opened.
- [FTC rule on fake reviews and testimonials](https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials). Search summary.
- [FTC CAN-SPAM guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business). Opened.
- [Grants.gov registration for organizations](https://grants.gov/help/register/organizations). Search summary.
- [Simpler.Grants.gov search API](https://wiki.simpler.grants.gov/product/api/search-opportunities). Opened.
- [USAspending API](https://api.usaspending.gov/docs/endpoints). Search summary.
- [Greater Milwaukee Foundation fiscal sponsorship](https://www.greatermilwaukeefoundation.org/grantseekers/fiscal-sponorship). Opened.
- [Center for Community Stewardship FAQ](https://www.community-stewardship.org/faq). Opened.
- The source of each catalog row is in `data/resources/catalog.json`.
