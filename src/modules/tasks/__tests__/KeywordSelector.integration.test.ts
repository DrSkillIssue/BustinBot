import type { Firestore } from "firebase-admin/firestore";
import { test as base, afterEach, describe, expect, vi } from "../../../tests/fixtures.js";
import { KeywordRepository } from "../../../core/database/KeywordRepo.js";
import { KeywordSelector } from "../KeywordSelector.js";

const test = base.extend("repo", ({ db }) => new KeywordRepository(db, "guild-1"));

// Stores keywords that were each used once, the first most recently
async function storeKeywordsUsedInOrder(db: Firestore, words: string[]): Promise<void> {
    const lastUse = Date.UTC(2026, 0, 1);
    for (const [index, word] of words.entries()) {
        await db.doc(`guilds/guild-1/keywords/${word}`).set({
            id: word,
            word,
            lastUsedAt: new Date(lastUse - index * 60_000),
            lastUsedEventId: `earlier-event-${index}`,
            timesUsed: 1,
            usageHistory: [`earlier-event-${index}`],
        });
    }
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("KeywordSelector", () => {
    test("falls back to a placeholder when no keywords are stored", async ({ repo }) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        expect(await new KeywordSelector(repo).selectKeyword("event-1")).toBe("keyword");
        expect(warn).toHaveBeenCalledWith("[KeywordSelector] No keywords found in Firestore.");
    });

    test("never picks one of the 26 most recently used keywords, and records the pick", async ({ repo, db }) => {
        const words = Array.from({ length: 30 }, (_, index) => `word${String(index).padStart(2, "0")}`);
        vi.spyOn(console, "log").mockImplementation(() => {});

        for (const random of [0, 0.5, 0.99]) {
            await storeKeywordsUsedInOrder(db, words);
            vi.spyOn(Math, "random").mockReturnValue(random);

            const picked = await new KeywordSelector(repo).selectKeyword(`event-${random}`);

            expect(words.slice(26)).toContain(picked);
            expect(await repo.getKeywordById(picked)).toMatchObject({ lastUsedEventId: `event-${random}`, timesUsed: 2 });
        }
    });

    test("never repeats the keyword used last when there are only a few", async ({ repo, db }) => {
        vi.spyOn(console, "log").mockImplementation(() => {});

        for (const random of [0, 0.5, 0.99]) {
            await storeKeywordsUsedInOrder(db, ["alpha", "bravo", "charlie"]);
            vi.spyOn(Math, "random").mockReturnValue(random);

            expect(await new KeywordSelector(repo).selectKeyword("event-next")).not.toBe("alpha");
        }
    });
});
