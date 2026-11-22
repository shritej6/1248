# Demo script: the P0 thread

This script shows one request from the form to DONE. It uses the desk website, the tracking page and two volunteer phones. All people and data are synthetic.

## Before the demo

1. Copy `apps/hub/.dev.vars.example` to `apps/hub/.dev.vars`. Set `BOOTSTRAP_CODE` and `DOOR_SECRET` to long random values.
2. Delete `apps/hub/.wrangler` for a clean organisation. The seed works only on an empty organisation.
3. Sign in to Cloudflare once, so the hub can reach Workers AI.

   ```bash
   npx wrangler login
   ```

4. Start the hub with live AI in one terminal, from the repository folder. `make dev` builds the websites first. Wait for "Ready on http://127.0.0.1:8787". The hub listens on this laptop only, so nobody else on the venue Wi-Fi can reach the board.

   ```bash
   make dev
   ```

   With no network, start the hub with `make dev-offline` instead. Then each AI job goes to the desk at once, and after about 1.3 seconds each new card shows "AI did not answer".

5. Load the demo people in a second terminal, from the repository folder. The join codes are in `.demo-codes.txt`.

   ```bash
   make seed
   ```

6. Build the app.

   ```bash
   cd apps/android && ./gradlew assembleDebug
   ```

7. Start the two phone emulators.

   ```bash
   "$ANDROID_HOME/emulator/emulator" -avd Vision_Volunteer_A &
   "$ANDROID_HOME/emulator/emulator" -avd Vision_Volunteer_B &
   ```

8. Install the app on both phones. Use the two serial numbers that `adb devices` lists, if they are not `emulator-5554` and `emulator-5556`.

   ```bash
   "$ANDROID_HOME/platform-tools/adb" devices
   "$ANDROID_HOME/platform-tools/adb" -s emulator-5554 install -r apps/android/app/build/outputs/apk/debug/app-debug.apk
   "$ANDROID_HOME/platform-tools/adb" -s emulator-5556 install -r apps/android/app/build/outputs/apk/debug/app-debug.apk
   ```

## The AI in the demo

The sorter and the three AI jobs are on in `apps/hub/wrangler.json` (D27, D31). `make dev` runs the AI binding on Workers AI (D30), so the AI runs live in the demo. The desk sees the suggestion of the sorter and the quoted words, highlighted in the message. Snow shovelling is a level 2 need, so the desk still confirms the card in step 5.

The hub of `make dev-offline` runs with `--local` and has no AI binding. There each AI job falls back to the desk at once. The sorter tries 3 times, for about 1.3 seconds, and each card then reaches the desk with the flag "AI did not answer", so the desk sorts it by hand. The thread below works the same way in both cases.

## People in the demo

| Screen | Person | Code in `.demo-codes.txt` |
|---|---|---|
| Desk website | Morgan Desk (test) | desk code |
| Phone 1 | Avery Snow (test) | volunteer code, skills snow and lawn |
| Phone 2 | Blake Frost (test) | volunteer code, skills snow and cleanup |
| Request form | A synthetic resident | none |

Both volunteers live in ZIP code 53216. The seed turns both volunteers on.

## The thread

1. On each phone, open Vision. Type the join code and tap JOIN. The home screen shows LIVE and "OFFERS (0)".
2. In a browser, open `http://localhost:8787/comforce-demo/join`. Type the desk code and select Join. The desk board opens.
3. On the desk, select TAKE SHIFT, then Confirm. The shift line shows Morgan Desk (test).
4. In a second browser window, open `http://localhost:8787/comforce-demo/ask`. Type a snow request with ZIP code 53216, select Yes for safe contact and send it. Keep the tracking link from the receipt.
5. On the desk, the card appears in TRIAGE. Open it, choose "Snow shovelling" and LOW, then select CONFIRM. The job SNOW-16-001 appears with the state CONFIRMED.
6. Select APPROVE PLAN. The state changes to OFFERED. Both phones show the offer with the need, the distance, the promise time and "Bring: Shovel and salt".
7. On phone 1, tap ACCEPT. Phone 1 opens the job card. Phone 2 shows "Taken. Thank you." and the offer goes away.
8. Open the tracking link. It shows "A volunteer has it".
9. On phone 1, tap ON MY WAY. Wait 2 seconds for the undo time to end. Then tap I AM THERE.
10. On phone 1, hold DONE. Choose "Done as asked" and tap SEND. The phone returns to the home screen and the record shows 1 job.
11. Reload the tracking link. It shows On the way, Arrived and Done, each with a time.
12. On the desk, the job shows DONE, CHECKING.

## Optional beat: a voicemail

Do this beat after step 12, so it does not change the thread. It shows the voicemail door. The recording is synthetic: a calm caller asks for snow help and mentions a gas smell at the end.

1. On the desk, select "Add a voicemail". Choose the file `data/synthetic/voicemail-demo.mp3`, type `414-555-0177` as the callback number and `53216` as the ZIP code, and select Add.
2. Open the new card in TRIAGE. The card shows the door "Voicemail", the player "Voicemail recording" and "Voicemail. A person must confirm it."
3. On the hub of `make dev-offline`, the card says "Listen to the voicemail". Play it, type the gist "Snow on the front walk. Gas smell in the kitchen since last night." and select "Save the gist". The words "gas smell" page the desk. Select "Got it", and the card shows "Word list hit".
4. On the hub of `make dev`, the card says "Transcript by speech AI. Listen before you confirm." The sorter suggests High, highlights "gas smell in the kitchen" and pages the desk. Select "Got it".
5. Choose "Snow shovelling" and High, then select CONFIRM.

## Demo clock between THERE and DONE

The visit clock starts at THERE and runs for 60 minutes. If you jump the demo clock between THERE and DONE, use "+15 min", not "+1 hour". Wait until the phone and the desk both show THERE before you jump. A jump of 1 hour fires the visit clock, and the desk shows "Check on the visit" in the middle of the demo.

## If one emulator does not start

Use only phone 1 and leave out the "Taken" step. The desk can also stand in for a phone. Select "Tap accept for" on the job, pick the volunteer and select CONFIRM (item O4 in `docs/decisions.md`). For DONE, select "Tap done for", pick the volunteer and select CONFIRM. Then choose what happened, "Done as asked", "Part done" or "Could not do it", and select SEND.

## Evidence

The screenshots of a full run on 2026-11-21 are outside the repository in `demo-evidence/`. Files `p0-*` show the first run. Files `r2-*` show a second run, where phone 2 took the job.
