/**
 * Waivers & declarations: the HKFC Hockey Code of Conduct & Disclaimers
 * everyone agrees to each season, and the Parent or Guardian's Consent for
 * under-18s. The wording is the Fillout form's (form 10, as it stood on
 * 2026-09-30). The HockeyHK league declaration and HKHA's waiver clauses are
 * not asked this season (owner, 2026-09-30).
 *
 * Changing any wording means a new DECLARATIONS_VERSION: each signing records
 * the version it agreed to.
 */

export const DECLARATIONS_VERSION = "2026-09-30";

export const CODE_OF_CONDUCT = {
  title: "HKFC Hockey Code of Conduct & Disclaimers",
  intro: [
    "HKFC Hockey prides itself on fostering an open, welcoming community for individuals from all backgrounds — ensuring that everyone who wants to experience hockey can be involved, feel valued, and be safe.",
    "HKFC is dedicated to promoting and protecting the welfare of all participants, and urges everyone to uphold the values and integrity of our sport at all times.",
    "This Code of Conduct ensures that everyone — players, coaches, umpires, officials, and spectators — contributes to an environment that is safe, respectful, and enjoyable for all. By adhering to this code, we demonstrate the behaviours expected of participants: treating each other with respect, acting with integrity, involving others, and seeing hockey as a force for good.",
  ],
  examplesIntro: "Examples of inappropriate behaviour include, but are not limited to:",
  examples: [
    "Using inappropriate, insulting, foul, or discriminatory language or gestures during any hockey-related activity",
    "Abusing, ridiculing, or shouting at players, coaches, umpires, or officials",
    "Smoking while engaged in any hockey match or training session",
    "Consuming illegal substances during hockey-related events or on HKFC premises",
    "Endorsing or displaying behaviour that contradicts HKFC Hockey values and policies",
    "Making insulting or inappropriate statements about HKFC Hockey, its members, or any person or organisation covered by this Code",
    "Using involvement in hockey to promote beliefs or behaviours that conflict with those of HKFC Hockey",
    "Engaging in criminal or illegal activities",
    "Misrepresenting qualifications, exerting undue influence, or operating outside agreed parameters",
    "Engaging in any form of sexually inappropriate or unwanted behaviour — including innuendo, flirting, or gestures — whether in person or electronically",
    "Providing alcohol, cigarettes, or drugs to young participants",
    "Condoning rule violations, rough play, or the use of prohibited substances",
    "Using social or electronic media to publicly criticise players, parents, officials, or anyone involved in hockey",
    "Publicly questioning the decisions or integrity of umpires, coaches, or officials during games or training",
    "Taking any action that threatens the health and safety of anyone involved in hockey activities",
    "Entering the playing area without permission",
    "Urinating in public",
    "Failing to be impartial in decision-making",
  ],
  codeTitle: "Code of Conduct",
  code: [
    "Club members will not bring the section or the Club into disrepute, nor engage in behaviour unbecoming of a Club member — whether on the pitch during matches, as a spectator, or elsewhere.",
    "By representing HKFC Hockey, members are required to set the highest standards of conduct on the pitch, regardless of the standards set by others.",
    "Members are subject to the section's bye-laws on discipline (Section 11). Any breach of conduct reported to the committee may lead to removal from the section and other sanctions as described therein.",
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
