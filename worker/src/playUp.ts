import type { Match, MatchCard } from "../../src/generated/domainTypes";

/**
 * Friendlies are not competitive fixtures and must never count towards any
 * official total.
 *
 * `Matches.Competition Type` is an Airtable formula over `Division` that
 * emits exactly one of "LEAGUE", "KNOCKOUT" or "FRIENDLY" (and blank for a
 * division the formula does not recognise). "P FDLY", "WARM-UP" and
 * "FRIENDLY" all map to FRIENDLY, so warm-up games are covered by the same
 * check.
 */
export function isFriendly(match: Match | undefined | null): boolean {
  if (!match) return false;
  return (match.competitionType || "").trim().toUpperCase() === "FRIENDLY";
}

/** First linked record id, tolerating Airtable's array-or-missing shape. */
function linkedMatchId(value: unknown): string | null {
  if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : null;
  return typeof value === "string" ? value : null;
}

/** Resolve the Match a Match Card belongs to, if it is loaded. */
export function matchForCard(
  card: MatchCard,
  matchesById: Map<string, Match>,
): Match | undefined {
  const id = linkedMatchId(card.match);
  return id ? matchesById.get(id) : undefined;
}

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
 *    counted, matching the established eligibility-engine behaviour),
 *  - the fixture is NOT a friendly / warm-up game.
 *
 * `matchesById` is required rather than optional on purpose: four play-ups
 * trigger automatic re-registration, so a caller that cannot resolve the
 * fixture must not be able to silently count friendlies.
 *
 * There must be exactly one definition of a qualifying play-up in the
 * codebase. Do NOT inline this filter anywhere else - import this helper.
 */
export function isQualifyingPlayUpCard(
  card: MatchCard,
  currentSeason: string,
  matchesById: Map<string, Match>,
): boolean {
  if (card.playUp !== true) return false;
  if (card.goalkeeper === true) return false; // GK exemption (A11)
  if (card.season && card.season !== currentSeason) return false;
  if (isFriendly(matchForCard(card, matchesById))) return false;
  return true;
}
