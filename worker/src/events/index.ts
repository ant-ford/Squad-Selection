/**
 * Special events (migration 20261003120000; owner, 3 Oct 2026): trials,
 * social functions, team socials, tournaments and tours, with a poster and
 * the details people need. Members say Going, Maybe or Not going, for
 * themselves and for other players, with +1 guests; whoever signs someone
 * up pays for them.
 *
 *  - Who keeps them: a team's social secretaries (team_people role
 *    social_secretary) that team's events; the overall Social Secretary
 *    (offices role social_secretary) and the Section Captains any event.
 *  - Who's invited: a filter over the chairman's email-list groups
 *    (shared/events.ts EVENT_GROUP_KEYS), matched against the chairman's
 *    directory when read. A team's own event is always for that team.
 *  - Unanswered is not Going. An open event with no answer is a My Tasks
 *    line; Going and Maybe go into the person's calendar feed.
 *  - No emails (Resend's daily limit): social secretaries share the link on
 *    WhatsApp.
 */

export { getMyEvents, respondToEvent, searchEventPeople } from "./player";
export { eventTasks } from "./tasks";
export type { EventTask } from "./tasks";
export { calendarEventsFor } from "./calendarFeed";
export type { CalendarEvent } from "./calendarFeed";
export { getManageView, eventColumns, saveEvent, setEventStatus, deleteEvent, uploadPoster, getEventResponses, countAudience, findPeople, setSocialSecretaries } from "./manage";
export { uploadPaymentProof, getCharges, markChargesSent, confirmPayment, waiveCharge } from "./payments";
export { checkinLink, setAttendance, tickEveryone, setRegisterTaken, getCheckIn, checkIn, registerTasks } from "./register";
