import type { MatchCard } from "../../src/generated/domainTypes";

/**
 * THE single authoritative definition of a qualifying play-up appearance.
 *
 * Used by:
 *  - the eligibility engine (`calculatePlayUpCount`, Step 6 of evaluation),
 *  - the dashboard Play-Up Watch,
 *  - the automatic re-registration service (`worker/src/registration.ts`).
 *
 * A qualifying play-up is a Match Card where:
 *  - `Play Up?` is true,
 *  - the appearance was NOT as goalkeeper (GK exemption, Bye-Law 7.5 /
 *    HKFC Spec A11 - `Match Cards.Goalkeeper` is authoritative, never
 *    `People.Playing Position`),
 *  - the card belongs to the current season (cards with no season value are
 *    counted, matching the established eligibility-engine behaviour).
 *
 * There must be exactly one definition of a qualifying play-up in the
 * codebase. Do NOT inline this filter anywhere else - import this helper.
 */
export function isQualifyingPlayUpCard(card: MatchCard, currentSeason: string): boolean {
  if (card.playUp !== true) return false;
  if (card.goalkeeper === true) return false; // GK exemption (A11)
  if (card.season && card.season !== currentSeason) return false;
  return true;
}
