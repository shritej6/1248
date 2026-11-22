import {
  DeskBoardSchema,
  OrgViewSchema,
  PartnerCardSchema,
  TrackingSchema,
  type MemberRecord,
} from "@vision/contracts";
import { describe, expect, it } from "vitest";
import zipsFile from "../../../data/synthetic/zip-centres.json" with { type: "json" };
import { deskView } from "../src/views/desk.js";
import { orgView } from "../src/views/organiser.js";
import { partnerView } from "../src/views/partner.js";
import { closedTracking, trackingView } from "../src/views/tracking.js";
import type { VaultReader, ViewContext } from "../src/views/common.js";
import { BASE_NOW, acceptedSnow, config, members, playbook, run, state } from "./helpers.js";

const ORG_NAME = "Test Group demo";
const emptyVault: VaultReader = { person: () => null, texts: () => [] };

const ctx: ViewContext = {
  now: BASE_NOW,
  newId: (prefix) => `${prefix}view`,
  playbook,
  members,
  offered: {},
  zips: zipsFile,
  config: { ...config, orgName: ORG_NAME },
  memberRecords: members.map((m): MemberRecord => ({ ...m, name: "Test Volunteer" })),
  partners: [{ id: "p_pantry", name: "Test Pantry" }],
  links: { partner: () => null },
};

describe("organisation name in views", () => {
  it("the desk board and the organiser view carry the hub organisation name", () => {
    const s = state(run(...acceptedSnow()));
    const board = deskView(s, emptyVault, ctx, { role: "desk", member: "m_d01" });
    expect(DeskBoardSchema.shape.orgName.parse(board.orgName)).toBe(ORG_NAME);
    const org = orgView(s, emptyVault, ctx);
    expect(OrgViewSchema.shape.orgName.parse(org.orgName)).toBe(ORG_NAME);
  });

  it("open and closed tracking carry the hub organisation name", () => {
    const s = state(run(...acceptedSnow()));
    const open = trackingView(s, emptyVault, ctx, "c_1");
    expect(open.closed).toBe(false);
    expect(TrackingSchema.shape.orgName.parse(open.orgName)).toBe(ORG_NAME);
    expect(trackingView(s, emptyVault, ctx, "c_9").orgName).toBe(ORG_NAME);
    expect(closedTracking(s, ctx).orgName).toBe(ORG_NAME);
  });

  it("the partner card carries the hub organisation name even when closed", () => {
    const partnerCtx = { now: BASE_NOW, playbook, partners: ctx.partners, forgetDays: 90, orgName: ORG_NAME };
    const card = partnerView(state(run()), { person: () => null }, partnerCtx, "p_pantry", "j_9");
    expect(card.state).toBe("closed");
    expect(PartnerCardSchema.shape.orgName.parse(card.orgName)).toBe(ORG_NAME);
  });
});
