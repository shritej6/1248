# Voicemail door

This document tells how the voicemail door works and how it follows the supervision rules. It is for a developer who changes the door, and for ComForce. The shared parts of all AI jobs are in `docs/ai-jobs.md`.

## Why the door exists

Many people who ComForce serves call. They do not type. The voicemail door lets a recording become a card on the desk board. A speech model makes a transcript, and the transcript goes through the normal sorter and word list. A person always listens and confirms.

## How a voicemail becomes a card

1. A recording arrives at the phone door or through "Add a voicemail" on the desk.
2. The hub checks the type, the size and the length.
3. In one transaction, the hub writes the audio to `vault_audio` in parts of at most 512 KiB and applies `voice.received`.
4. The core writes `card.received` with the door `voice`. The vault gets the first name "Caller" and the callback number, if there is one. The card is on the board at once, with no words.
5. When `VOICE_MODEL` holds a model id, the core writes `ai.asked`, and the outbox gets one item with only the card id.
6. The alarm sends the audio to the model once for each try. The core writes `ai.done`, and an ok transcript becomes the message of the card in the vault.
7. The message goes through the sorter and the word list, as a form message does.
8. When the job is off, fails or hears no words, the card says "Listen to the voicemail". The desk then types the gist, and the gist goes through the sorter and the word list.

Every voice card carries the flag `voice_transcript`. The sorter result gets the flag, and a confirm or an added job counts it for a voice card even when no transcript or gist exists yet. The flag keeps the card off auto-confirm, so the machine never confirms a voicemail, and it puts every voice job at level 2 or higher.

A transcript that comes after every job of the card is closed writes only `ai.done`. It adds no words to the vault and starts no sorter, page or other AI job. The desk cannot type a gist on such a card.

## The door contract

The phone door is `POST /api/v1/o/{org}/doors/voice`. It is generic. Parsing the webhook of one phone provider is out of scope. A small adapter for the chosen provider must turn its webhook into this form.

| Part | Rule |
|---|---|
| Auth | The header `X-Door-Secret` equals `DOOR_SECRET`. A wrong secret gives 401. |
| Body | `multipart/form-data` |
| `recordingId` | Text, 1 to 200 characters. The card id comes from it, so a second send of one recording adds no card. |
| `audio` | A file of the type WAV, MP3, OGG, WEBM or M4A, at most 2 MB |
| `seconds` | The length of the recording, more than 0 and at most 120 |
| `callback` | Optional. A phone number of 3 to 40 characters: digits, spaces, `(`, `)`, `.`, `-` and a leading `+`. An email address gives `invalid`, so the receipt and the check-back never go to an address the caller did not choose. |
| `zip` | Optional. A ZIP code that the hub serves. |
| Answer | `201 { card, repeated: false }`, or `200 { card, repeated: true }` for a second send |

A file over 2 MB gives `too_large`. A wrong type, a wrong field or a length over 120 seconds gives `invalid`. The hub reads at most 2 MB plus 64 KiB of form overhead.

## The desk routes

| Route | Auth | Answer |
|---|---|---|
| `POST /api/v1/o/{org}/voicemails` | A session with the role desk or lead | `201 { card }`. The fields are the same as the phone door, with no `recordingId`. |
| `GET /api/v1/o/{org}/audio/{card}` | A session with the role desk or lead | The audio bytes with their type and `Cache-Control: no-store` |

No session gives 401. Another role gives 403. Only the lead gets the audio of a quiet card.

The desk player fetches the audio with the token in the `Authorization` header. It plays a blob URL, so the token is never in a URL. The dialog checks the type, the size and the length in the browser before it sends. The hub checks them again.

## The supervision rules for this job

| Rule | How the door holds it |
|---|---|
| 1. One off switch | `VOICE_MODEL` in `apps/hub/wrangler.json`. Empty means off, and the desk types the gist. |
| 2. Suggest and show evidence | The player is above the words. The line "Transcript by speech AI. Listen before you confirm." shows only for a real transcript. |
| 3. Only add caution | A transcript only adds words to the vault. Every voice card counts the flag `voice_transcript`, with or without a transcript. The job never lowers, closes or assigns. |
| 4. A person confirms | Auto-confirm never takes a voice card. |
| 5. Fall back to a person | After 3 failed tries, `ai.done` is `failed` and the card says "Listen to the voicemail". |
| 6. Personal data stays in the vault | The audio, the transcript and the gist are in the vault with the card forget date. The ledger holds only statuses. Logs hold only `{ op, card }`. |
| 7. A measured check | `exam/src/voice-check.ts`, with the result in `exam/voice-results/` |

## Why the transcript never replaces the audio

Speech recognition is not equal for all speakers. In a study of five commercial systems, the average word error rate was 0.35 for Black speakers and 0.19 for white speakers (Koenecke et al. 2020). Whisper also invented phrases that nobody said in about 1 percent of transcripts (Koenecke et al. 2024). Some of these phrases were violent or false. So the desk always has the audio, and the transcript is only a help.

## The measured check

The check takes the 8 exam messages with the tag `speech_to_text_errors`. It makes speech from each message and transcribes the speech with `VOICE_MODEL`. It gives the word error rate of each message and of all 8. It asks the word list, and the sorter when a sorter model is given, if each emergency is still raised. It also transcribes `data/synthetic/voicemail-demo.mp3` once.

Run it from `exam/` with `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` set in the shell only:

```
pnpm exec tsx src/voice-check.ts --sorter @cf/google/gemma-4-26b-a4b-it
```

The check stops above 600 neurons. It writes `exam/voice-results/<date>.json`, never `exam/results/`.

### Where the speech comes from

The design asked for speech from `@cf/deepgram/aura-2-en`. A real call showed that aura-2-en costs about 2.73 neurons for each character. The demo voicemail of 253 characters cost 690 neurons. The 8 exam messages have about 3,460 characters, so the speech would cost about 9,434 neurons. That is far over the 600 neuron cap and almost the full free day.

So the check makes the speech on the Mac with the `say` voice Samantha, as a 16 kHz WAV file, at no cost. The option `--speech aura` uses aura-2-en, and it stops before a call that would pass the cap.

### Result of 2026-11-21

The result file is `exam/voice-results/2026-11-21.json`. The voice model was `@cf/openai/whisper-large-v3-turbo`, and the sorter was `@cf/google/gemma-4-26b-a4b-it`.

| Measure | Value |
|---|---|
| Word error rate of all 8 | 0.110 (79 errors in 720 words) |
| Word error rate of one message | 0.032 to 0.191 |
| Emergencies | m020, m033, m081 |
| Word list on the exam text | m020 and m033 |
| Word list on the transcript | m020 and m033 |
| Sorter on the transcript | m020, m033 and m081 high |
| Every emergency still raised | Yes |
| Low messages raised by the sorter | m016 and m083 |
| Demo voicemail | Word list hit on "gas smell" |
| Neurons | 319.2 in all: 160.4 to transcribe, 158.8 to sort, 0 for speech |

The word list alone did not find m081, a head injury, on the exam text or on the transcript. The sorter found it. So the word list is a floor, not a full check.

### How to read the numbers

The reference text is the exam text, which already has planted speech errors such as "shuffle" for "shovel". Whisper often wrote the right word, and the check counts that as an error against the reference. The synthetic voice is clear and has no accent and no noise. Real callers will get more errors, so these numbers are a best case.

## Limits

- The hub does not decode the audio. The `seconds` field comes from the sender. The size limit is the hard guard. A 2 MB file at a low bitrate can run 10 minutes or more, and the speech model is paid per audio minute, so one long file can cost several hundred neurons.
- A desk that confirms a voice card before a transcript or a gist gets a level 2 job from the flag `voice_transcript`, but the sorter and the word list have read nothing. The desk must listen first.
- The dialog reads the length with an Audio element. A file that the browser cannot play is refused as a wrong type.
