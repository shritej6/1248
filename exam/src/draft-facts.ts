import type { DraftFact, DraftFacts, FactKey } from "@vision/contracts";

const fact = (key: FactKey, label: string, text: string): DraftFact => ({ key, label, text });

const ORG = fact("org", "Group", "ComForce demo");
const IN_KIND = "Value of volunteer time at $34.67 an hour";
const UNMET_END = "Jobs on the unmet shelf at the end of the month";
const UNMET_NOW = "Jobs on the unmet shelf now";
const NEEDS = "Needs that this funder fits";
const JOBS = "Forecast jobs in these needs, low to high";
const HOURS = "Forecast volunteer hours in these needs, low to high";
const DEADLINE = "Next deadline on the funder page";
const WINDOW = fact("window", "Forecast window", "December 2026 to November 2027");
const HORIZON = fact("horizon", "Forecast months", "12");
const NO_CLAIMS = { c3: false, sponsor: false };
const SYNTHETIC = " The forecast uses synthetic history.";

const SEPTEMBER = [
  fact("month", "Month", "September 2026"),
  fact("new", "Jobs planned", "41"),
  fact("helped", "Jobs closed as helped", "33"),
];
const OCTOBER = [
  fact("month", "Month", "October 2026"),
  fact("new", "Jobs planned", "52"),
  fact("helped", "Jobs closed as helped", "44"),
];
const NOVEMBER = [
  fact("month", "Month", "November 2026 so far"),
  fact("new", "Jobs planned", "29"),
  fact("helped", "Jobs closed as helped", "21"),
];
const SEPTEMBER_TIME = [fact("hours", "Volunteer hours", "119"), fact("in_kind", IN_KIND, "$4,126")];
const OCTOBER_TIME = [fact("hours", "Volunteer hours", "163"), fact("in_kind", IN_KIND, "$5,651")];
const NOVEMBER_TIME = [fact("hours", "Volunteer hours", "74"), fact("in_kind", IN_KIND, "$2,566")];

const SEPTEMBER_FOOTER = "Source: the Vision record for September 2026, sealed at line 812.";
const OCTOBER_FOOTER = "Source: the Vision record for October 2026, sealed at line 1204.";
const NOVEMBER_FOOTER = "Source: the Vision record for November 2026 so far, sealed at line 1391.";

export const DRAFT_CHECK_FACTS: readonly { id: string; facts: DraftFacts }[] = [
  {
    id: "post-2026-09",
    facts: {
      kind: "impact_post",
      month: "2026-09",
      resource: null,
      facts: [ORG, ...SEPTEMBER, fact("unmet", UNMET_END, "5"), ...SEPTEMBER_TIME],
      claims: NO_CLAIMS,
      footer: SEPTEMBER_FOOTER,
    },
  },
  {
    id: "post-2026-10",
    facts: {
      kind: "impact_post",
      month: "2026-10",
      resource: null,
      facts: [ORG, ...OCTOBER, fact("unmet", UNMET_END, "6"), ...OCTOBER_TIME],
      claims: NO_CLAIMS,
      footer: OCTOBER_FOOTER,
    },
  },
  {
    id: "post-2026-11",
    facts: {
      kind: "impact_post",
      month: "2026-11",
      resource: null,
      facts: [ORG, ...NOVEMBER, fact("unmet", UNMET_NOW, "4"), ...NOVEMBER_TIME],
      claims: NO_CLAIMS,
      footer: NOVEMBER_FOOTER,
    },
  },
  {
    id: "letter-bader_preliminary",
    facts: {
      kind: "funder_letter",
      month: "2026-10",
      resource: "bader_preliminary",
      facts: [
        ORG,
        fact("funder", "Funder", "Bader Philanthropies, preliminary application"),
        ...OCTOBER,
        ...OCTOBER_TIME,
        WINDOW,
        HORIZON,
        fact("needs", NEEDS, "Youth stipend information, Community clean up, Job search help"),
        fact("forecast_jobs", JOBS, "131 to 214"),
        fact("forecast_hours", HOURS, "346 to 562"),
        fact("deadline", DEADLINE, "30 November 2026"),
      ],
      claims: NO_CLAIMS,
      footer: `${OCTOBER_FOOTER}${SYNTHETIC}`,
    },
  },
  {
    id: "letter-safe_sound_good_neighbor",
    facts: {
      kind: "funder_letter",
      month: "2026-11",
      resource: "safe_sound_good_neighbor",
      facts: [
        ORG,
        fact("funder", "Funder", "Safe & Sound Good Neighbor Grant Fund"),
        ...NOVEMBER,
        ...NOVEMBER_TIME,
        WINDOW,
        HORIZON,
        fact("needs", NEEDS, "Community clean up, Lawn mowing, Snow shovelling, Food from a pantry"),
        fact("forecast_jobs", JOBS, "402 to 618"),
        fact("forecast_hours", HOURS, "764 to 986"),
        fact("amount", "Award size on the funder page", "up to $2,500"),
      ],
      claims: NO_CLAIMS,
      footer: `${NOVEMBER_FOOTER}${SYNTHETIC}`,
    },
  },
  {
    id: "letter-we_energies_foundation",
    facts: {
      kind: "funder_letter",
      month: "2026-09",
      resource: "we_energies_foundation",
      facts: [
        ORG,
        fact("funder", "Funder", "We Energies Foundation"),
        ...SEPTEMBER,
        ...SEPTEMBER_TIME,
        WINDOW,
        HORIZON,
        fact("needs", NEEDS, "Shelter for tonight, Food from a pantry, Snow shovelling"),
        fact("forecast_jobs", JOBS, "487 to 735"),
        fact("forecast_hours", HOURS, "1,180 to 1,790"),
        fact("deadline", DEADLINE, "31 January 2027"),
      ],
      claims: NO_CLAIMS,
      footer: `${SEPTEMBER_FOOTER}${SYNTHETIC}`,
    },
  },
];
