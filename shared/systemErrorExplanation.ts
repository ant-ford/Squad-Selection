import type { SystemErrorGroup } from './systemHealth';

/** Explanations describe the symptom, without guessing a proven root cause. */
export function explainSystemError(kind: SystemErrorGroup['kind']): { title: string; explanation: string; action: string } {
  switch (kind) {
    case 'screen-load':
      return {
        title: 'Screen-loading failure',
        explanation: 'A screen’s code could not be loaded or opened. An older app version or an interrupted download can cause this.',
        action: 'Reload Eddy. If it repeats, check the affected build and browser below.',
      };
    case 'database':
      return {
        title: 'Database request failed',
        explanation: 'Eddy could not complete a database request. The original message below identifies the request or database error.',
        action: 'Check the request details before retrying a save; it may already have completed.',
      };
    case 'server':
      return {
        title: 'Server request failed',
        explanation: 'The API could not complete a request.',
        action: 'Use the route, message and request id below to investigate.',
      };
    case 'scheduled':
      return {
        title: 'Scheduled job failed',
        explanation: 'A background job reported a failure.',
        action: 'Check the job’s latest run and its original error below.',
      };
    default:
      return {
        title: 'App error',
        explanation: 'Eddy reported an error in the browser. The message alone may not identify its cause.',
        action: 'Use the affected screen, build and browser below to investigate.',
      };
  }
}
