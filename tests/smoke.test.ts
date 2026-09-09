import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION } from "../src/core/model";

describe("amorçage", () => {
  it("expose la version de schéma", () => {
    expect(SCHEMA_VERSION).toBe(1);
  });
});
