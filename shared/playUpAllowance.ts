/**
 * How many play-ups a player may make in a season (Bye-Law 7.2(b), Sept
 * 2026). The appearance after the last one allowed re-registers the player
 * to the higher team, so selection above the registered team is blocked
 * once the count passes this number.
 *
 * U21 players get eight; everyone else three. U21 status is
 * `People.U21 Eligible` (under 21 on 1 September of the season).
 *
 * There must be exactly one definition of the allowance. It lives in
 * shared/ because both sides need it: the eligibility engine blocks and
 * scores against it, and the squad screen colours each player's play-up
 * count by it.
 */
export const STANDARD_PLAY_UP_ALLOWANCE = 3;
export const U21_PLAY_UP_ALLOWANCE = 8;

export function playUpAllowance(player: { u21Eligible?: boolean }): number {
  return player.u21Eligible === true ? U21_PLAY_UP_ALLOWANCE : STANDARD_PLAY_UP_ALLOWANCE;
}
