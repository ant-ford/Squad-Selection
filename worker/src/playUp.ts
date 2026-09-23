import { linkId } from "../../shared/airtableValueUtils";
import type { Match, MatchCard, Player } from "../../shared/schema/domainTypes";

/**
 * How many play-ups a player may make in a season (Bye-Law 7.2(b), Sept
 * 2026). The appearance after the last one allowed re-registers the player
 * to the higher team, so selection above the registered team is blocked
 * once the count passes this number.
 *
 * U21 players get eight; everyone else three. U21 status is
 * `People.U21 Eligible` (under 21 on 1 September of the season).
 *
 * There must be exactly one definition of the allowance. The eligibility
 * engine and the Play-Up Watch both read it from here.
 */
export const STANDARD_PLAY_UP_ALLOWANCE = 3;
export const U21_PLAY_UP_ALLOWANCE = 8;

export function playUpAllowance(player: Pick<Player, "u21Eligible">): number {
  return player.u21Eligible === true ? U21_PLAY_UP_ALLOWANCE : STANDARD_PLAY_UP_ALLOWANCE;
}

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

/** Resolve the Match a Match Card belongs to, if it is loaded. */
export function matchForCard(
  card: MatchCard,
  matchesById: Map<string, Match>,
): Match | undefined {
  const id = linkId(card.match);
  return id ? matchesById.get(id) : undefined;
}

/**
 * THE single authoritative definition of a qualifying play-up appearance.
 *
 * Used by:
 *  - the eligibility engine (`calculatePlayUpCount`, Step 6 of evaluation),
 *  - the dashboard Play-Up Watch.
 *
 * A qualifying play-up is a Match Card where:
 *  - `Play Up?` is true,
 *  - the appearance was NOT as goalkeeper (GK exemption, Bye-Law 7.6 /
 *    HKFC Spec A11 - `Match Cards.Goalkeeper` is authoritative, never
 *    `People.Playing Position`),
 *  - the card belongs to the current season (cards with no season value are
 *    counted, matching the established eligibility-engine behaviour),
 *  - the fixture is NOT a friendly / warm-up game.
 *
 * `matchesById` is required rather than optional on purpose: passing the
 * allowance triggers re-registration, so a caller that cannot resolve the
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
