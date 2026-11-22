export type KeyFact = { fact: string; pattern: RegExp; safety: boolean };
export type Fidelity = { id: string; kept: string[]; lost: string[]; safetyLost: string[] };

const NO_HEAT: KeyFact = { fact: "no heat", pattern: /\bheat(ing|er)?\b/iu, safety: true };
const BABY: KeyFact = { fact: "a baby", pattern: /\bbaby\b/iu, safety: true };
const NO_CAR: KeyFact = { fact: "no car", pattern: /\bcar\b/iu, safety: false };
const FOOD: KeyFact = { fact: "food", pattern: /\bfood\b/iu, safety: false };
const phone = (number: string): KeyFact => ({
  fact: `phone ${number}`,
  pattern: new RegExp(number, "u"),
  safety: false,
});

export const KEY_FACTS: Readonly<Record<string, readonly KeyFact[]>> = {
  m008: [FOOD, NO_CAR, { fact: "papers to bring", pattern: /\b(papers|documents|ID)\b/u, safety: false }],
  m040: [
    NO_HEAT,
    BABY,
    { fact: "a place to stay", pattern: /\bstay\b/iu, safety: false },
    phone("414-555-0136"),
  ],
  m060: [
    NO_HEAT,
    BABY,
    {
      fact: "oven on for heat",
      pattern: /\boven\s+(on|lit|turned on|running|burning)\b|\b(lit|turned on)\s+the\s+oven\b/iu,
      safety: true,
    },
    phone("414-555-0190"),
  ],
  m062: [{ fact: "English classes", pattern: /\benglish\b/iu, safety: false }, phone("414-555-0188")],
  m071: [
    { fact: "snow", pattern: /\bsnow\b/iu, safety: false },
    { fact: "age 76", pattern: /\b(seventy-six|76)\b/iu, safety: false },
    { fact: "lives alone", pattern: /\balone\b/iu, safety: false },
    phone("414-555-0171"),
  ],
  m079: [FOOD, NO_CAR, { fact: "5 people", pattern: /\b(5|five)\s+people\b/iu, safety: false }],
};

export const checkFidelity = (id: string, translation: string): Fidelity => {
  const facts = KEY_FACTS[id] ?? [];
  const lost = facts.filter((f) => !f.pattern.test(translation));
  return {
    id,
    kept: facts.filter((f) => !lost.includes(f)).map((f) => f.fact),
    lost: lost.map((f) => f.fact),
    safetyLost: lost.filter((f) => f.safety).map((f) => f.fact),
  };
};
