# Cost

This document lists each service that Vision uses, its price and the free allowance. The target is about 0 dollars each month (D10). Each price has its source and the date of the research note that read it. Prices change, so check each source before you plan a budget.

## Prices

| Service | Use in Vision | Free allowance | Paid price | Source | Read on |
|---|---|---|---|---|---|
| Cloudflare Workers | The hub and the websites | 100,000 requests a day, 10 ms CPU for each request | 5 dollars a month for the paid plan | https://developers.cloudflare.com/workers/platform/pricing/ | 2026-11-20 |
| Cloudflare Durable Objects (SQLite) | One database for each organisation | 100,000 requests a day, 5 GB of storage | Inside the paid Workers plan | https://developers.cloudflare.com/durable-objects/platform/pricing/ | 2026-11-20 |
| Cloudflare Workers AI | The sorter and the AI jobs, only when they are on | 10,000 neurons a day | 0.011 dollars for each 1,000 neurons | https://developers.cloudflare.com/workers-ai/platform/pricing/ | 2026-11-20 |
| Google Apps Script | Mail in and out, the playbook sheet, the record | Consumer account: 100 mail recipients a day, 6 minutes for each run, 90 minutes of trigger time a day | Free | https://developers.google.com/apps-script/guides/services/quotas | 2026-11-20 |
| Google Workspace for Nonprofits | A ComForce mailbox and Drive, if ComForce qualifies | 0 dollars for each user for an eligible nonprofit | Not used | https://www.google.com/nonprofits/offerings/workspace/ | 2026-11-20 |
| GitHub | The code and the quality gate | A free account with GitHub Actions | Not used | Not checked | Not checked |

The source notes are in `research/round4-notes/03-orchestration-and-data-stack.md`, `research/round4-notes/04-model-and-inference-stack.md` and `research/round4-notes/05-interface-stack.md`, outside this repository.

## What this means for ComForce

- The sorter is on for the finals (D27). With the sorter off, Vision uses only the free Workers plan, the free Durable Object allowance and a free Google account.
- With the sorter on, each card uses two model calls. The neurons for each call depend on the model, and the daily volume of ComForce was not measured. Check the daily use on the Cloudflare dashboard after one week.
- A Workspace for Nonprofits account lifts the Apps Script mail limit from 100 to 1,500 recipients a day.
- No paid model and no API key are used (C65).

## The draft job of Resources

Vision writes at most 20 drafts a day for each organisation, and each draft makes at most 3 model calls. So the draft job makes at most 60 calls a day. The day is the real Chicago date, so a jump of the demo clock does not reset the count. The measured check gives the neurons for each draft.

| Check | Drafts | Model calls | Neurons | Date |
|---|---|---|---|---|
| `exam/src/draft-check.ts` | 6 synthetic drafts | Not run yet | Not run yet | Not run yet |

The check stops at 500 neurons. With `DRAFT_MODEL` empty, the draft job makes no call and costs nothing.

## Limits

- The prices are from research notes of 2026-11-20. They were not read again for this document.
- Google says that charges for use over the Sheets and Gmail API quotas can start later in 2026, with 90 days of notice. Each ledger send to the sheet carries every line not yet sent, so the hub makes few calls.
- The free Workers plan allows 10 ms of CPU for each request. A wait for a model or for Google is not CPU time.
