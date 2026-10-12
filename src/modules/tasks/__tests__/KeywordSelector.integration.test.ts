import type { Firestore } from "firebase-admin/firestore";
import { DateTime } from "luxon";
import { test as base, describe, expect, vi } from "../../../tests/fixtures.js";
import { IDS } from "../../../tests/discord/payloads.js";
import { KeywordRepository } from "../../../core/database/KeywordRepo.js";
import { KeywordSelector } from "../KeywordSelector.js";

const test = base.extend("repo", ({ db }) => new KeywordRepository(db, IDS.guild));

// Stores keywords that were each used once, the first most recently
async function storeKeywordsUsedInOrder(db: Firestore, words: string[]): Promise<void> {
    const lastUse = DateTime.fromISO("2026-01-01T00:00:00Z");
    for (const [index, word] of words.entries()) {
        await db.doc(`guilds/${IDS.guild}/keywords/${word}`).set({
            id: word,
            word,
            lastUsedAt: lastUse.minus({ minutes: index }).toJSDate(),
            lastUsedEventId: `earlier-event-${index}`,
            timesUsed: 1,
            usageHistory: [`earlier-event-${index}`],
        });
    }
}

describe("KeywordSelector", () => {
    test("falls back to a placeholder when no keywords are stored", async ({ repo }) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        expect(await new KeywordSelector(repo).selectKeyword("event-1")).toBe("keyword");
        expect(warn).toHaveBeenCalledWith("[KeywordSelector] No keywords found in Firestore.");
    });

    test("never picks one of the 26 most recently used keywords, and records the pick", async ({ repo, db }) => {
        const words = Array.from({ length: 30 }, (_, index) => `word${String(index).padStart(2, "0")}`);

        for (const random of [0, 0.5, 0.99]) {
            await storeKeywordsUsedInOrder(db, words);
            vi.spyOn(Math, "random").mockReturnValue(random);

            const picked = await new KeywordSelector(repo).selectKeyword(`event-${random}`);

            expect(words.slice(26)).toContain(picked);
            expect(await repo.getKeywordById(picked)).toMatchObject({ lastUsedEventId: `event-${random}`, timesUsed: 2 });
        }
    });

    test("never repeats the keyword used last when there are only a few", async ({ repo, db }) => {
        for (const random of [0, 0.5, 0.99]) {
            await storeKeywordsUsedInOrder(db, ["alpha", "bravo", "charlie"]);
            vi.spyOn(Math, "random").mockReturnValue(random);

            expect(await new KeywordSelector(repo).selectKeyword("event-next")).not.toBe("alpha");
        }
    });
});
