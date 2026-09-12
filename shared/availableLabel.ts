/**
 * Wording for the "Available" state on a fixture.
 *
 * Before the squad is picked, a player is stating availability, so the button
 * says exactly that. Once they have been selected it is no longer a statement
 * of intent - they are in the side - and "Going" is what they would say
 * themselves.
 *
 * Only the wording changes. The value written is "Available" either way,
 * because that is what the availability model stores; selection is the
 * coach's decision and lives elsewhere.
 *
 * Shared, not app-only: the subscribed calendar feed says the same thing on
 * the same rule, and the two drifting apart is what made a selected player's
 * calendar still read "Available".
 */
export function availableLabel(isSelected: boolean): string {
  return isSelected ? "Going" : "Available";
}
