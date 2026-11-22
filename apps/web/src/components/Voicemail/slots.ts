import type { SlotSet } from "../deskSlots.js";
import { AddVoicemail } from "./AddVoicemail.js";
import { VoicemailCard } from "./VoicemailCard.js";

export const voiceSlots: SlotSet = { tools: [AddVoicemail], aboveMessage: [VoicemailCard] };
