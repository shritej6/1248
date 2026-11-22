import type { SlotSet } from "../deskSlots.js";
import { LangMark, TranslationNote } from "./Translation.js";

export const langSlots: SlotSet = { rowMarks: [LangMark], belowMessage: [TranslationNote] };
