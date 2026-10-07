import { describe, it, expect } from "vitest";
import { ROUTES, GUARDED_SCOPES } from "../worker/src/routes";
import { GUARDS, findRoute, findScope } from "../worker/src/router";

// Every route the Worker answers, with its guard, in the order the router
// tries them (worker/src/routes.ts, router.ts). A new route, a moved one or
// a changed guard fails here until this list is updated on purpose, so a
// change to who may call what is always visible in review.
//
// "+coach-of-..." is the coach check the handler makes itself, after the
// guard, because what it checks is in the body or the player record.
// tests/authorization-routes.test.ts checks the guards really hold.

describe("the route table", () => {
  it("lists every route, its guard and its order", () => {
    const actual = ROUTES.map((r) => `${r.method} ${r.path} ${r.guard}${r.also ? ` +${r.also}` : ""}`);
    expect(actual).toEqual(EXPECTED_ROUTES);
  });

  it("lists the guarded scopes (a path under one answers its 401 / 403 before the 404)", () => {
    const actual = GUARDED_SCOPES.map((s) => `${s.path} ${s.guard}${s.postBody ? " +post-body" : ""}`);
    expect(actual).toEqual(EXPECTED_SCOPES);
  });

  it("has no route twice", () => {
    const keys = ROUTES.map((r) => `${r.method} ${r.path}`);
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
  });

  it("gives every route and scope a known guard", () => {
    for (const r of [...ROUTES, ...GUARDED_SCOPES]) expect(GUARDS, r.path).toContain(r.guard);
  });

  it("puts a handler's own coach check only on coach routes", () => {
    for (const r of ROUTES.filter((r) => r.also)) expect(r.guard, r.path).toBe("coach");
  });

  it("serves only /health, signed file links and the signed calendar feeds without a session", () => {
    const open = ROUTES.filter((r) => ["public", "signed-file", "calendar-hmac"].includes(r.guard)).map((r) => `${r.method} ${r.path}`);
    expect(open).toEqual([
      "GET /health",
      "GET /api/files/:id([0-9a-f-]{36})",
      "GET /api/calendar/feed.ics",
      "GET /api/calendar/team-feed.ics",
    ]);
  });

  it("matches a specific path before a pattern that also fits it", () => {
    expect(findRoute(ROUTES, "GET", "/api/joiners/options")?.route.path).toBe("/api/joiners/options");
    // No POST /api/joiners/options: it is a joiner id, as it always was.
    expect(findRoute(ROUTES, "POST", "/api/joiners/options")).toMatchObject({ route: { path: "/api/joiners/:id([A-Za-z0-9-]{3,40})" }, params: { id: "options" } });
    expect(findRoute(ROUTES, "GET", "/api/quizzes/scores")?.route.path).toBe("/api/quizzes/scores");
    expect(findRoute(ROUTES, "POST", "/api/quizzes/scores")?.params).toEqual({ key: "scores" });
  });

  it("hands over path parameters as sent, and holds them to their pattern", () => {
    expect(findRoute(ROUTES, "GET", "/api/match/rec%201/players")?.params).toEqual({ id: "rec%201" });
    expect(findRoute(ROUTES, "POST", "/api/reviews/r1/sponsor")?.params).toEqual({ id: "r1", step: "sponsor" });
    expect(findRoute(ROUTES, "POST", "/api/reviews/r1/other")).toBeNull();
    expect(findRoute(ROUTES, "GET", "/api/files/not-a-uuid")).toBeNull();
    expect(findRoute(ROUTES, "GET", "/api/match/recM1/players/extra")).toBeNull();
    expect(findRoute(ROUTES, "GET", "/api/calendar/feedXics")).toBeNull();
  });

  it("has no 405: a known path with another method matches nothing", () => {
    expect(findRoute(ROUTES, "POST", "/api/my-profile")).toBeNull();
    expect(findRoute(ROUTES, "HEAD", "/health")).toBeNull();
    expect(findScope(GUARDED_SCOPES, "/api/my-profile")).toBeNull();
  });

  it("covers an unknown path under a guarded group with that group's guard", () => {
    expect(findScope(GUARDED_SCOPES, "/api/kit/nothing")?.scope.guard).toBe("section:kit");
    expect(findScope(GUARDED_SCOPES, "/api/eventsX")?.scope.path).toBe("/api/events*");
    expect(findScope(GUARDED_SCOPES, "/api/quizzes")?.scope.path).toBe("/api/quizzes");
    expect(findScope(GUARDED_SCOPES, "/api/quizzesX")).toBeNull();
    expect(findScope(GUARDED_SCOPES, "/api/admin/anything")).toBeNull();
  });
});

const EXPECTED_ROUTES = [
  "GET /health public",
  "GET /api/files/:id([0-9a-f-]{36}) signed-file",
  "GET /api/match/:id/team-availability signed-in",
  "GET /api/match/:id/players coach-of-match",
  "GET /api/match/:id/recommendations coach-of-match",
  "GET /api/match/:id/availability coach-of-match",
  "POST /api/match/:id/availability coach-of-match",
  "POST /api/player/:id/opt-in-only coach +coach-of-player",
  "POST /api/match/:id/auto-select coach-of-match",
  "GET /api/my-availability-rules signed-in",
  "POST /api/my-availability-rules signed-in",
  "POST /api/my-availability-rules/:id signed-in",
  "POST /api/match/:id/kit coach +coach-of-match-side",
  "GET /api/team/auto-select-players coach +coach-of-team",
  "POST /api/team/auto-select-players coach +coach-of-team",
  "GET /api/player-stats/:id self-or-coach",
  "GET /api/player-attendance/:id self-or-coach",
  "GET /api/team-attendance coach",
  "GET /api/my-profile signed-in",
  "GET /api/stats/season signed-in",
  "GET /api/my-tasks signed-in",
  "POST /api/client-error signed-in",
  "GET /api/system signed-in",
  "GET /api/my-fixtures signed-in",
  "GET /api/upcoming-fixtures signed-in",
  "GET /api/recent-changes coach",
  "POST /api/set-my-availability-for-date signed-in",
  "POST /api/set-my-availability signed-in",
  "POST /api/squad/sync coach +coach-of-match-side",
  "POST /api/squad/notified coach +coach-of-match-side",
  "POST /api/squad/changes coach +coach-of-match-side",
  "GET /api/ranking coach",
  "GET /api/ranking/inactive coach",
  "POST /api/ranking/config coach",
  "POST /api/ranking/reorder coach +coach-of-player",
  "POST /api/ranking/activate section-captain",
  "POST /api/ranking/deactivate section-captain",
  "GET /api/membership/board section:membership",
  "GET /api/membership/insights section:membership",
  "GET /api/membership/forms-due section:membership",
  "GET /api/membership/active-members section:membership",
  "GET /api/membership/number-holders section:membership",
  "POST /api/membership/approve section:membership",
  "GET /api/membership/statements section:membership",
  "POST /api/membership/statements/notify section:membership",
  "GET /api/declarations/me signed-in",
  "POST /api/declarations signed-in",
  "GET /api/season-plan/me signed-in",
  "POST /api/season-plan signed-in",
  "GET /api/season-plan/board signed-in",
  "GET /api/details/me signed-in",
  "POST /api/details/sections/:section([a-z]+) signed-in",
  "POST /api/details/files/:kind([a-z]+) signed-in",
  "POST /api/details/kit signed-in",
  "POST /api/details/read-id signed-in",
  "POST /api/details/confirm signed-in",
  "POST /api/details/delete-profile signed-in",
  "GET /api/apply/me signed-in",
  "POST /api/apply/family signed-in",
  "POST /api/apply/clubs signed-in",
  "POST /api/apply/trials signed-in",
  "POST /api/apply/submit signed-in",
  "POST /api/apply/polish signed-in",
  "POST /api/apply/files/:kind([a-z_]+) signed-in",
  "POST /api/apply/family/:member([0-9a-f-]{36})/files/:kind([a-z_]+) signed-in",
  "GET /api/joiners/options signed-in",
  "GET /api/joiners/:id([A-Za-z0-9-]{3,40}) signed-in",
  "POST /api/joiners signed-in",
  "POST /api/joiners/:id([A-Za-z0-9-]{3,40}) signed-in",
  "POST /api/joiners/:id([A-Za-z0-9-]{3,40})/invite signed-in",
  "POST /api/joiners/:id([A-Za-z0-9-]{3,40})/kit signed-in",
  "POST /api/joiners/:id([A-Za-z0-9-]{3,40})/registration signed-in",
  "POST /api/joiners/:id([A-Za-z0-9-]{3,40})/practice-trial signed-in",
  "POST /api/joiners/:id([A-Za-z0-9-]{3,40})/decline signed-in",
  "GET /api/quizzes signed-in",
  "GET /api/quizzes/scores signed-in",
  "GET /api/quizzes/:key([^/]{1,80}) signed-in",
  "POST /api/quizzes/:key([^/]{1,80}) signed-in",
  "POST /api/join/register verified-email",
  "GET /api/trials/me signed-in",
  "GET /api/trials/sessions signed-in",
  "POST /api/trials/sessions/:id([0-9a-f-]{36})/remove signed-in",
  "POST /api/trials/me signed-in",
  "POST /api/trials/submit signed-in",
  "POST /api/trials/sessions signed-in",
  "GET /api/events/mine signed-in",
  "GET /api/events/manage signed-in",
  "GET /api/events/find-people signed-in",
  "GET /api/events/:id([0-9a-f-]{36})/people signed-in",
  "GET /api/events/:id([0-9a-f-]{36})/responses signed-in",
  "GET /api/events/:id([0-9a-f-]{36})/charges signed-in",
  "GET /api/events/:id([0-9a-f-]{36})/checkin signed-in",
  "GET /api/events/:id([0-9a-f-]{36})/checkin-link signed-in",
  "POST /api/events signed-in",
  "POST /api/events/audience signed-in",
  "POST /api/events/social-secretaries signed-in",
  "POST /api/events/:id([0-9a-f-]{36})/respond signed-in",
  "POST /api/events/:id([0-9a-f-]{36})/status signed-in",
  "POST /api/events/:id([0-9a-f-]{36})/poster signed-in",
  "POST /api/events/:id([0-9a-f-]{36})/delete signed-in",
  "POST /api/events/:id([0-9a-f-]{36})/charges-sent signed-in",
  "POST /api/events/:id([0-9a-f-]{36})/payment-proof signed-in",
  "POST /api/events/:id([0-9a-f-]{36})/confirm-payment signed-in",
  "POST /api/events/:id([0-9a-f-]{36})/waive signed-in",
  "POST /api/events/:id([0-9a-f-]{36})/attendance signed-in",
  "POST /api/events/:id([0-9a-f-]{36})/tick-everyone signed-in",
  "POST /api/events/:id([0-9a-f-]{36})/register-taken signed-in",
  "POST /api/events/:id([0-9a-f-]{36})/checkin signed-in",
  "GET /api/applications/:id([A-Za-z0-9-]{3,40})/sign signed-in",
  "POST /api/applications/:id([A-Za-z0-9-]{3,40})/drafts signed-in",
  "POST /api/applications/:id([A-Za-z0-9-]{3,40})/sign signed-in",
  "POST /api/applications/:id([A-Za-z0-9-]{3,40})/pdf signed-in",
  "POST /api/applications/:id([A-Za-z0-9-]{3,40})/send signed-in",
  "GET /api/club-docs/:name([a-z-]+) signed-in",
  "GET /api/reactivation verified-email",
  "POST /api/reactivation verified-email",
  "GET /api/reactivation/:id([0-9a-f-]{36}) signed-in",
  "POST /api/reactivation/:id([0-9a-f-]{36}) signed-in",
  "GET /api/joiner-tasks/:id([0-9a-f-]{36}) signed-in",
  "POST /api/joiner-tasks/:id([0-9a-f-]{36})/done signed-in",
  "GET /api/history signed-in",
  "GET /api/admin/people section:people",
  "GET /api/admin/people/:id([A-Za-z0-9-]{3,64}) section:people",
  "POST /api/admin/people/:id([A-Za-z0-9-]{3,64})/squad section:people",
  "POST /api/admin/people/:id([A-Za-z0-9-]{3,64})/membership section:membership",
  "POST /api/admin/people/:id([A-Za-z0-9-]{3,64})/stage section:membership",
  "GET /api/admin/offices section:club",
  "GET /api/admin/teams section:club",
  "POST /api/admin/offices section:club",
  "POST /api/admin/people section:club",
  "POST /api/admin/offices/:id([A-Za-z0-9-]{3,64}) section:club",
  "POST /api/admin/teams/:id([A-Za-z0-9-]{3,64}) section:club",
  "GET /api/registration/board section:registration",
  "GET /api/registration/export section:registration",
  "POST /api/registration/registered section:registration",
  "POST /api/registration/unregistered section:registration",
  "POST /api/registration/details section:registration",
  "POST /api/admin/registration-events/:id/resolve section:dataChecks",
  "GET /api/discipline/suspensions section:discipline",
  "POST /api/discipline/suspensions section:discipline",
  "POST /api/discipline/suspensions/:id([^/]{1,64})/clear section:discipline",
  "POST /api/discipline/suspensions/:id([^/]{1,64}) section:discipline",
  "GET /api/admin/data-checks section:dataChecks",
  "POST /api/admin/match-cards/:id([^/]{1,64})/link section:dataChecks",
  "GET /api/volunteering/me signed-in",
  "POST /api/volunteering signed-in",
  "GET /api/volunteering/board signed-in",
  "GET /api/umpiring signed-in",
  "POST /api/umpiring/seen signed-in",
  "GET /api/umpiring/report signed-in",
  "POST /api/umpiring/duties/:id([0-9a-f-]{36})/take signed-in",
  "POST /api/umpiring/duties/:id([0-9a-f-]{36})/assign signed-in",
  "POST /api/umpiring/assignments/:id([0-9a-f-]{36})/withdraw signed-in",
  "POST /api/umpiring/assignments/:id([0-9a-f-]{36})/confirm signed-in",
  "POST /api/umpiring/assignments/:id([0-9a-f-]{36})/no-show signed-in",
  "GET /api/kit/me signed-in",
  "POST /api/kit/move signed-in",
  "POST /api/kit/confirm signed-in",
  "GET /api/kit/board section:kit",
  "GET /api/kit/uncollected section:kit",
  "GET /api/kit/top-up section:kit",
  "GET /api/kit/sets/:id/history section:kit",
  "POST /api/kit/sets/:id/sizes section:kit",
  "POST /api/kit/allocate section:kit",
  "POST /api/kit/release section:kit",
  "POST /api/kit/swap section:kit",
  "POST /api/kit/new-number section:kit",
  "POST /api/kit/orders/:id/received section:kit",
  "POST /api/kit/orders/:id/expected section:kit",
  "GET /api/reviews/:id signed-in",
  "POST /api/reviews/:id/:step(member|sponsor|officer) signed-in",
  "GET /api/messages/templates signed-in",
  "POST /api/messages/log signed-in",
  "GET /api/chairman/directory section:chairman",
  "POST /api/chairman/export-log section:chairman",
  "GET /api/calendar/link signed-in",
  "GET /api/calendar/feed.ics calendar-hmac",
  "GET /api/calendar/team-link signed-in",
  "GET /api/calendar/team-feed.ics calendar-hmac",
];

const EXPECTED_SCOPES = [
  "/api/details/* signed-in +post-body",
  "/api/apply/* signed-in +post-body",
  "/api/joiners* signed-in +post-body",
  "/api/quizzes signed-in",
  "/api/quizzes/* signed-in",
  "/api/trials/* signed-in +post-body",
  "/api/events* signed-in +post-body",
  "/api/applications/:id([A-Za-z0-9-]{3,40})/:step(sign|drafts|pdf|send) signed-in",
  "/api/reactivation verified-email",
  "/api/reactivation/:id([0-9a-f-]{36}) signed-in",
  "/api/joiner-tasks/* signed-in",
  "/api/registration/* section:registration +post-body",
  "/api/discipline/* section:discipline +post-body",
  "/api/umpiring* signed-in",
  "/api/kit/* section:kit +post-body",
  "/api/reviews/:id signed-in",
  "/api/reviews/:id/:step(member|sponsor|officer) signed-in",
];
