/** Squad sends report push-service acceptance, rather than whether a person read the alert. */
export interface SquadPushResult {
  players: number;
  reached: number;
  devices: number;
  /** Optional while an older API deployment is still serving the frontend. */
  people?: number;
  pruned?: number;
  skipped?: number;
}

export function squadPushMessage(result: SquadPushResult): string {
  if (result.reached > 0) {
    return result.reached === result.players
      ? `Sent to ${result.reached} player${result.reached === 1 ? '' : 's'}`
      : `Sent to ${result.reached} of ${result.players} selected players`;
  }
  if (result.players === 0) return 'No notifications sent: no saved selections were found. Save your squad and try again.';
  if (result.people === 0) return 'No notifications sent: no selected players have a registered device. Enable notifications on their device, or turn them off and back on if already enabled.';
  if (result.devices === 0 && (result.skipped ?? 0) > 0) return 'No notifications sent: the device sending limit was reached. Try again.';
  if (result.devices > 0 && result.pruned === result.devices) return 'No notifications sent: the contacted devices have expired registrations. Turn notifications off and back on, then try again.';
  if (result.devices > 0) return "Notifications couldn't be delivered. Try again. If it continues, ask the System owner to check delivery errors.";
  // Older APIs don't report registration, expiry or budget counts: don't invent a reason.
  return 'No notifications were sent. Check that selected players have notifications enabled, then try again.';
}
