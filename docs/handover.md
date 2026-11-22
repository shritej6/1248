# Handover

This guide tells ComForce how to take over Vision with no developer. It covers the accounts, the deploy, the Google link, backups, unplugging the Google link and shutting Vision down. Each command runs from the repository folder unless a step says otherwise.

## The accounts

Vision uses three accounts. Move each one to a mailbox that ComForce owns, not the mailbox of one volunteer. A shared mailbox stays when a person leaves.

| Account | What it holds | How to move it |
|---|---|---|
| Cloudflare | The hub, the websites, the data of each organisation and the hub secrets | Add the ComForce mailbox as a member with the Super Administrator role. Then remove the old members. |
| Google | The Apps Script, the sheet "Vision record", the Gmail label and the trigger | Make the script and the sheet in a ComForce account. The trigger runs under the account that made it, so a copy in a personal account stops when that person leaves. |
| GitHub | The code and the quality gate | Transfer the repository to an organisation of ComForce, or add a ComForce owner. |

After each move, make new values for `BOOTSTRAP_CODE`, `DOOR_SECRET` and `GOOGLE_SECRET`. The old holders of the accounts knew the old values.

## Deploy the hub

1. Sign in to Cloudflare from the hub folder. A browser window opens.

   ```bash
   cd apps/hub && npx wrangler login
   ```

2. Set the hub secrets. Each command asks for the value. Set `GOOGLE_URL` and `GOOGLE_SECRET` only if you use the Google link.

   ```bash
   cd apps/hub && npx wrangler secret put BOOTSTRAP_CODE
   ```

   ```bash
   cd apps/hub && npx wrangler secret put DOOR_SECRET
   ```

3. Set `PUBLIC_ORIGIN` in `vars` in `apps/hub/wrangler.json` to the address of the deployed hub. Set `DEMO_MODE` to `off` for real use, so that nobody can move the clock.

4. Build the websites and deploy.

   ```bash
   pnpm --filter ./apps/web run build
   ```

   ```bash
   cd apps/hub && npx wrangler deploy
   ```

5. Load the first members. Change the address to the address of the deployed hub. The seed reads `BOOTSTRAP_CODE` from `apps/hub/.dev.vars`, so put the deployed value there first.

   ```bash
   HUB_URL=https://vision.example.test node --env-file=apps/hub/.dev.vars apps/hub/scripts/seed.ts
   ```

The seed prints one join code for each member. The seed loads the synthetic people of `data/synthetic/`. For real use, add the real members on the organiser view instead. Never put a real person in the repository (C29).

## Google setup

The Google link is one Apps Script in one Google account of ComForce. It reads mail, sends mail, serves the playbook sheet and writes the ledger and statement tabs. The hub works without it. Then mail is shown on screen, the playbook comes from a file in the repository, and the ledger is a download.

Use only a test account for the demo. Do not use a real inbox of ComForce until the owner approves it.

### Make three secrets

Make three long random secrets. Do not write them in the repository.

| Name            | Where it goes                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `DOOR_SECRET`   | A hub secret and a script property. The script sends it to the mail door.                                                            |
| `SCRIPT_SECRET` | The hub secret `GOOGLE_SECRET` and a script property. The hub sends it to the script.                                                |
| `HUB_URL`       | A script property only. It is the hub address of the organisation, for example `https://vision.example.test/api/v1/o/comforce-demo`. |

### Make the sheet and the script

1. Open Google Sheets in the test account and make a new sheet with the name "Vision record".

2. Add a tab with the name "Playbook". Put these headers in row 1: `need`, `label`, `service`, `defaultForService`, `code`, `level`, `owner`, `skill`, `promiseHours`, `quiet`, `crew`, `bring`, `ladder`.

3. Write one row for each need. In the `ladder` column, separate the rungs with `>`, for example `volunteers > partner p_ID 60 > unmet`.

4. In the sheet, open Extensions and then Apps Script.

5. Copy `google/Vision.gs` and `google/appsscript.json` from the repository into the script project.

### Set the properties and deploy

1. Open Project Settings and add the script properties `HUB_URL`, `DOOR_SECRET` and `SCRIPT_SECRET`.

2. Select Deploy, then New deployment, then Web app.

3. Set "Execute as" to the account and "Who has access" to anyone. The secret protects each call.

4. Copy the web app address.

5. Run the function `installTrigger` one time and accept the permissions. The script then reads the inbox every 5 minutes.

### Connect the hub

1. Set the hub secrets with `wrangler secret put GOOGLE_URL`, `wrangler secret put GOOGLE_SECRET` and `wrangler secret put DOOR_SECRET`.

2. Use the web app address for `GOOGLE_URL` and the value of `SCRIPT_SECRET` for `GOOGLE_SECRET`.

3. In Gmail of the test account, make the label `vision-in` and a filter that puts new mail under this label.

### Test the link

1. Send one test mail from a second test inbox to the test account.

2. Wait 5 minutes. The card must appear on the desk with the door "email".

3. On the organiser view, select "Load playbook from the sheet". The playbook tab of the organiser view must show the rows of the sheet.

4. Select "Save statement to Drive". A tab with the name "Statement" and the month must appear in the sheet.

5. Look at the tab "Ledger". It gets new lines after each change on the hub.

### What the link does

The hub sends mail, ledger lines and statements through the outbox. A failed call is tried 3 times with a growing wait. After that, the desk board shows it under failed sends. Each ledger send carries every line from the oldest line not yet sent, so the lines of a failed send go with the next ledger send and the ledger tab has no gaps.

The mail door takes each message one time. A second send of the same message id adds no card. A mail to a resident goes out only when the contact is a mail address and contact is safe. A card from the mail door counts as safe to contact, because the resident wrote from that address.

The ledger tab carries the line number and the fingerprint of each line. ComForce can compare the last fingerprint with the statement and with the seal check of the hub.

## Back up

Make a backup at the end of each month, after the statement.

1. Open the organiser view and select "Download the ledger". The browser saves `vision-ledger.json`.
2. Check the file with the seal tool. The tool must print "Seal OK".

   ```bash
   node tools/verify-seal.mjs ~/Downloads/vision-ledger.json
   ```

3. Compare the last line number and fingerprint with the statement of the month.
4. Keep the file in the ComForce Drive. The ledger holds no name, no address and no contact detail.

The ledger download does not hold the vault. The vault is erased on each forget date by design, so a backup of the vault is not kept. The Google link also copies each ledger line to the tab "Ledger".

## Unplug the Google link

Do these steps when you change the Google account or when you stop the mail door.

1. In the script project, open Triggers and delete the trigger for `pollInbox`. The script stops reading the inbox.
2. Select Deploy, then Manage deployments, and archive the web app.
3. Remove the hub secrets of the link.

   ```bash
   cd apps/hub && npx wrangler secret delete GOOGLE_URL
   ```

   ```bash
   cd apps/hub && npx wrangler secret delete GOOGLE_SECRET
   ```

The hub works without the link. Mail is then shown on screen, the playbook comes from the file in the repository, and the ledger is a download.

## Shut down

Do these steps only when ComForce stops using Vision.

1. Tell the members and the partners the last day.
2. Make a last backup with the steps in "Back up".
3. Unplug the Google link with the steps above.
4. Delete the hub from Cloudflare. This removes the hub and the websites. Treat the data of the organisation as gone after this step.

   ```bash
   cd apps/hub && npx wrangler delete
   ```

5. In the Google account, delete the sheet "Vision record" and the label `vision-in`, or keep the sheet as the record.
