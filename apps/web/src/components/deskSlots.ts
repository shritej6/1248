import type { ComponentType } from "react";
import type { DeskBoard, DeskCard } from "@vision/contracts";
import type { Auth } from "../api.js";
import type { DeskSend } from "./deskCommand.js";
import { linkSlots } from "./SameEvent/slots.js";
import { langSlots } from "./Translation/slots.js";
import { voiceSlots } from "./Voicemail/slots.js";

export type DeskHub = { org: string; auth: Auth };
export type CardSlotProps = { card: DeskCard; send: DeskSend; hub: DeskHub | null };
export type BoardSlotProps = { board: DeskBoard; send: DeskSend; hub: DeskHub | null };

type CardSlot = ComponentType<CardSlotProps>;
type BoardSlot = ComponentType<BoardSlotProps>;

export type DeskSlots = {
  rowMarks: readonly CardSlot[];
  aboveMessage: readonly CardSlot[];
  belowMessage: readonly CardSlot[];
  afterLabels: readonly CardSlot[];
  tools: readonly BoardSlot[];
  triage: readonly BoardSlot[];
};
export type SlotSet = Partial<DeskSlots>;

export const NO_SLOTS: DeskSlots = {
  rowMarks: [],
  aboveMessage: [],
  belowMessage: [],
  afterLabels: [],
  tools: [],
  triage: [],
};

export const mergeSlots = (sets: readonly SlotSet[]): DeskSlots => ({
  rowMarks: sets.flatMap((set) => set.rowMarks ?? []),
  aboveMessage: sets.flatMap((set) => set.aboveMessage ?? []),
  belowMessage: sets.flatMap((set) => set.belowMessage ?? []),
  afterLabels: sets.flatMap((set) => set.afterLabels ?? []),
  tools: sets.flatMap((set) => set.tools ?? []),
  triage: sets.flatMap((set) => set.triage ?? []),
});

export const DESK_SLOTS = mergeSlots([voiceSlots, linkSlots, langSlots]);
