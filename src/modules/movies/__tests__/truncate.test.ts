import { describe, expect, test } from "vitest";
import { truncate } from "../MovieEmbeds.js";

describe("truncate", () => {
    test("leaves short text unchanged", () => {
        const result = truncate("Hello world", 20);
        expect(result).toBe("Hello world");
    });

    test("cuts text that is too long and ends it with an ellipsis", () => {
        const input = "This is a very long sentence that needs to be cut short.";
        const result = truncate(input, 20);
        expect(result).toBe("This is a very lo...");
    });

    test("leaves text of exactly the limit unchanged", () => {
        const input = "12345";
        const result = truncate(input, 5);
        expect(result).toBe("12345");
    });
});
