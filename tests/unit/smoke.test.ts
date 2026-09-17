import { describe, expect, it } from "vitest";

describe("test environment", () => {
  it("provides indexedDB and a DOM", () => {
    expect(typeof indexedDB).toBe("object");
    expect(typeof document).toBe("object");
  });
});
