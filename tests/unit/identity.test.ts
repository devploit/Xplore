import { describe, expect, it } from "vitest";
import { csrfToken, currentUserId } from "@/data/identity";

describe("identity cookies", () => {
  it("reads the user id from twid in both encodings", () => {
    expect(currentUserId("guest_id=1; twid=u%3D123456789; ct0=abc")).toBe("123456789");
    expect(currentUserId('twid="u=987"')).toBe("987");
    expect(currentUserId("ct0=abc")).toBeUndefined();
    expect(currentUserId("twid=garbage")).toBeUndefined();
  });
  it("reads ct0", () => {
    expect(csrfToken("a=1; ct0=deadbeef; b=2")).toBe("deadbeef");
    expect(csrfToken("a=1")).toBeUndefined();
  });
});
