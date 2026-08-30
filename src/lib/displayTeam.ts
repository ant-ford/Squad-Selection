import type { Player } from "../generated/domainTypes";

/**
 * The team name the app DISPLAYS for a player.
 *
 * Display rule: "Selected Team EOS", falling back to "Selected Team SOS",
 * then the true Registered Team. This is a PRESENTATION value only - every
 * business rule (eligibility, play-up limits, suspensions, recommendations
 * scoring, automatic re-registration) keeps using People.Registered Team.
 * The Section Captain manages both Selected Team fields directly in Airtable
 * (SOS static for the season; EOS adjustable to change the optics).
 */
export function selectedDisplayTeam(
  p: Pick<Player, "selectedTeamEos" | "selectedTeamSos" | "registeredTeam">,
): string {
  return p.selectedTeamEos || p.selectedTeamSos || p.registeredTeam || "";
}
