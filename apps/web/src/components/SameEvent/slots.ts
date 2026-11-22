import type { SlotSet } from "../deskSlots.js";
import { EventGroups, SameEventMark, SameEventSection } from "./SameEvent.js";

export const linkSlots: SlotSet = {
  rowMarks: [SameEventMark],
  afterLabels: [SameEventSection],
  triage: [EventGroups],
};
