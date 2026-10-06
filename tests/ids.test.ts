import { describe, expect, it } from "vitest";
import { isRowId } from "../worker/src/data/ids";

const REC = "recAfcgxZQ3GWcu3I";
const UUID = "a0818f1e-7782-40cd-9b25-8b55e49a3059";

describe("isRowId", () => {
  it("accepts imported and Eddy-created ids", () => {
    expect(isRowId(REC)).toBe(true);
    expect(isRowId(UUID)).toBe(true);
  });

  it("refuses anything else", () => {
    for (const bad of [undefined, null, 42, "", "rec123", `${REC}x`, UUID.toUpperCase(), `${UUID}"`, "a0818f1e778240cd9b258b55e49a3059"]) {
      expect(isRowId(bad)).toBe(false);
    }
  });
});
