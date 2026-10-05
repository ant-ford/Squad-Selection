/**
 * Waivers & declarations: the HKFC Hockey Code of Conduct & Disclaimers
 * everyone agrees to each season, and the Parent or Guardian's Consent for
 * under-18s. The Code of Conduct is the owner's approved rewrite of the
 * Fillout form's (2026-09-30): the same points, grouped and reworded. The
 * two confirmations and the four disclaimers are the Fillout form's words,
 * unchanged. The HockeyHK league declaration and HKHA's waiver clauses are
 * not asked this season (owner, 2026-09-30).
 *
 * Changing any wording means a new DECLARATIONS_VERSION: each signing records
 * the version it agreed to.
 */

export const DECLARATIONS_VERSION = "2026-09-30-v2";

export const CODE_OF_CONDUCT = {
  title: "HKFC Hockey Code of Conduct & Disclaimers",
  intro: [
    "HKFC Hockey is an open, welcoming community where everyone who wants to play hockey can take part, feel valued and be safe. Players, coaches, umpires, officials and spectators all share responsibility for keeping it that way: treating each other with respect, acting with integrity, including others, and making hockey a force for good.",
  ],
  examplesIntro: "Behaviour we don't accept (including, but not limited to):",
  examples: [
    {
      heading: "Respect",
      items: [
        "Insulting, abusive, foul or discriminatory language or gestures",
        "Abusing, ridiculing or shouting at players, coaches, umpires, officials or spectators",
        "Publicly questioning the decisions or integrity of umpires, coaches or officials",
        "Criticising players, parents, officials or anyone involved in hockey on social or other media",
      ],
    },
    {
      heading: "Safety and wellbeing",
      items: [
        "Any action that puts the health or safety of others at risk",
        "Sexually inappropriate or unwanted behaviour of any kind, in person or online",
        "Providing alcohol, tobacco or drugs to young participants",
        "Smoking or vaping during matches or training, or using illegal substances at hockey events or on HKFC premises",
      ],
    },
    {
      heading: "Fair play and integrity",
      items: [
        "Condoning rule-breaking, rough play or the use of prohibited substances",
        "Misrepresenting qualifications, exerting undue influence or acting outside agreed roles",
        "Failing to be impartial when making decisions",
        "Entering the playing area without permission",
      ],
    },
    {
      heading: "Reputation",
      items: [
        "Conduct, on or off the pitch, that brings HKFC Hockey or the Club into disrepute, including unlawful behaviour",
        "Using hockey to promote beliefs or behaviour that conflict with HKFC Hockey's values",
      ],
    },
  ],
  codeTitle: "Our commitment",
  code: [
    "Members must not bring the Section or the Club into disrepute, whether playing, spectating or elsewhere. When representing HKFC Hockey, members set the highest standards of conduct, whatever the standards of others. Members are subject to the Section's bye-laws on discipline (Section 11); a reported breach may lead to removal from the Section and other sanctions set out there.",
  ],
  disclaimersTitle: "Disclaimers",
} as const;

/** The boxes everyone ticks, in order. Keys are stored with each signing. */
export const DECLARATION_ITEMS = [
  { key: "conduct_read", section: "code", text: "I confirm that I have read and understood the inappropriate behaviours listed above and the HKFC Hockey Code of Conduct. I agree to comply with its terms at all times." },
  { key: "conduct_breach", section: "code", text: "I acknowledge that any failure to comply with the Code of Conduct may result in suspension or termination of my HKFC membership." },
  { key: "general", section: "disclaimers", label: "General", text: "I will follow the rules and regulations set by the coaches and comply with all HKFC Codes of Conduct and Bye-Laws." },
  { key: "photos", section: "disclaimers", label: "Photographs & Videos", text: "I understand that HKFC may take or receive photographs and videos of participants in hockey-related activities, and that these may be published — along with names, activities, and accomplishments — in HKFC publications, websites, and social media channels for promotional and organisational purposes." },
  { key: "privacy", section: "disclaimers", label: "Privacy", text: "Your personal details will be held privately and securely for internal data collection. We may share your name, HKID, nationality, and contact information with the HK Hockey Association for league registration, and with third parties where strictly required for externally organised events (e.g. tournaments, tours)." },
  { key: "injury", section: "disclaimers", label: "Personal Injury & Death", text: "In the event of injury whilst participating in hockey-related activities, I agree that the Hong Kong Football Club (“HKFC”) and its representatives may take whatever action they deem necessary, including calling Emergency Services, and I agree to indemnify and hold harmless HKFC and its representatives against all liabilities and expenses incurred. I understand that HKFC does not carry insurance for accidents or injuries to hockey participants, and I confirm I will maintain valid and comprehensive insurance for these risks. I will not hold HKFC, HKFC Hockey Section, or any of their representatives, employees, or contractors responsible for any injury, death, damage, or loss of property during my participation." },
] as const;

export const REQUIRED_KEYS: string[] = DECLARATION_ITEMS.map((i) => i.key);

/** Under-18s: the parent or guardian's consent (HKHA's wording), with their name put in. */
export function guardianConsent(guardianName: string): string[] {
  return [
    `I, ${guardianName || "_____"} (the “Parent or Guardian”), hereby confirm that I:`,
    "1. Am the abovenamed player's parent, or legally appointed guardian.",
    "2. Consent, in respect of the player whose particulars are described above (the “Player”) to:",
    "a. the Player being registered by Hockey Hong Kong, China (“HockeyHK”) as a player for HKFC (the “Club”) in order to play in the HockeyHK Men’s Leagues;",
    "b. the Player participating in hockey matches, tournaments and events organised by HockeyHK;",
    "c. the usage of images and video of the Player being used by HockeyHK in promotional materials and grant all rights in respect of the usage of such images to HockeyHK; and",
    "d. data regarding the Player being retained by HockeyHK in accordance with Hong Kong law.",
    "3. Acknowledge and agree that the Player will be playing in matches and participating in practice sessions with players who are over the age of 18.",
    "4. Acknowledge that I have responsibility to provide protective gears to the Player, including mouth guard, shin guard and other appropriate protections, in order to ensure Player’s safety and comply with international convention.",
    "5. Understand and agree that neither the HockeyHK, nor their officials shall be held responsible for or have any liability in respect of any incident, accident or injury sustained by the Player or any damage or loss to the Player’s possessions as a result of their participation in hockey as a player, spectator, or official.",
    "6. Will communicate any revocation of my consent to the above matters in respect of the Player to the Club in writing and by email to HockeyHK and that neither the Club nor HockeyHK will be deemed to have any knowledge of the revocation of such consent until such communication is received.",
  ];
}

export const GUARDIAN_CONFIRM = { key: "guardian_consent", text: "As Guardian/Parent, I confirm that I have read, understood and consent to the above." } as const;

/** GET /api/declarations/me. */
export interface DeclarationsView {
  season: string;
  /** When they last signed for this season, if they have. */
  signedThisSeasonAt: string | null;
  underEighteen: boolean;
  playerName: string;
  guardian: { surname: string; givenNames: string; mobileNo: string; email: string };
  version: string;
}

export interface DeclarationsSubmission {
  version: string;
  accepted: string[];
  guardian?: { surname: string; givenNames: string; mobileNo: string; email: string };
  /** The guardian's signature (PNG data URL); under-18s only. */
  signature?: string;
}

/** Under 18 today, Hong Kong time: born less than 18 years before today (YYYY-MM-DD). */
export function isUnderEighteen(dateOfBirth: string | null, today: string): boolean {
  if (!dateOfBirth) return false;
  const [y, m, d] = today.split("-").map(Number);
  const eighteenth = `${y - 18}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return dateOfBirth.slice(0, 10) > eighteenth;
}
