import { describe, it, expect, beforeEach } from "vitest";
import {
  getAccessDenied,
  setAccessDenied,
  subscribeAccessDenied,
} from "../src/lib/accessDenied";

// Being refused access used to sign the player out. Authentication had
// succeeded - they are who they say they are - so throwing the session away
// meant another trip through the email on every load, which is what players
// reported as "I have to log in every time".

beforeEach(() => setAccessDenied(null));

describe("access denial state", () => {
  it("starts clear", () => {
    expect(getAccessDenied()).toBeNull();
  });

  it("holds the message the API gave, so the screen can quote it", () => {
    setAccessDenied("Your access is not active.");
    expect(getAccessDenied()).toBe("Your access is not active.");
  });

  it("notifies subscribers, which is what re-renders the gate", () => {
    let calls = 0;
    const stop = subscribeAccessDenied(() => calls++);
    setAccessDenied("denied");
    expect(calls).toBe(1);
    setAccessDenied(null);
    expect(calls).toBe(2);
    stop();
  });

  // useSyncExternalStore re-reads the snapshot on every notify; firing for a
  // value that has not changed would re-render on every failed request.
  it("stays quiet when the message has not changed", () => {
    let calls = 0;
    const stop = subscribeAccessDenied(() => calls++);
    setAccessDenied("denied");
    setAccessDenied("denied");
    expect(calls).toBe(1);
    stop();
  });

  it("stops notifying once unsubscribed", () => {
    let calls = 0;
    subscribeAccessDenied(() => calls++)();
    setAccessDenied("denied");
    expect(calls).toBe(0);
  });

  // A denial belongs to the session that earned it. Left set, the next
  // person to sign in on a shared phone would meet someone else's refusal.
  it("can be cleared, which sign-out and a new session both do", () => {
    setAccessDenied("denied");
    setAccessDenied(null);
    expect(getAccessDenied()).toBeNull();
  });
});
