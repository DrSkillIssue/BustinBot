import { ApplicationCommandOptionType } from "discord-api-types/v10";
import { describe, expect, test as base, vi, type StoringFactories } from "../fixtures.js";
import { AS, chatInputInteraction, IDS } from "../discord/payloads.js";
import { DateTime } from "luxon";
import { KeywordRepository } from "../../src/core/database/KeywordRepo.js";
import { KeywordSelector } from "../../src/modules/tasks/KeywordSelector.js";
import { keywordFactory } from "../factories.js";

const test = base.extend("repo", ({ db }) => new KeywordRepository(db, IDS.guild));

// Stores keywords that were each used once, the first most recently
async function storeKeywordsUsedInOrder(factories: StoringFactories, words: string[]): Promise<void> {
    const lastUse = DateTime.fromISO("2026-01-01T00:00:00Z");
    for (const [index, word] of words.entries()) {
        await factories.keyword.create({
            id: word,
            word,
            lastUsedAt: lastUse.minus({ minutes: index }).toJSDate(),
            lastUsedEventId: `earlier-event-${index}`,
            timesUsed: 1,
            usageHistory: [`earlier-event-${index}`],
        });
    }
}

describe("/addkeyword", () => {
    test("adds the keyword to the pool under its normalised id", async ({ discord, interact, services }) => {
        const command = await interact(
            chatInputInteraction(
                "addkeyword",
                [{ type: ApplicationCommandOptionType.String, name: "word", value: "Bustin Bot!" }],
                AS.taskAdmin,
            ),
        );

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: 'Keyword **"Bustin Bot!"** has been added successfully!' }),
        ]);
        expect(await services.repos.keywordRepo.getKeywordById("bustin_bot")).toMatchObject({
            word: "Bustin Bot!",
            timesUsed: 0,
        });
    });

    test("refuses a keyword already in the pool", async ({ discord, interact, factories }) => {
        await factories.keyword.create({ id: "bustin", word: "Bustin" });

        const command = await interact(
            chatInputInteraction(
                "addkeyword",
                [{ type: ApplicationCommandOptionType.String, name: "word", value: "bustin" }],
                AS.taskAdmin,
            ),
        );

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: 'The keyword **"bustin"** already exists in the database.' }),
        ]);
    });
});

describe("KeywordSelector", () => {
    test("falls back to a placeholder when no keywords are stored", async ({ repo }) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        expect(await new KeywordSelector(repo).selectKeyword("event-1")).toBe("keyword");
        expect(warn).toHaveBeenCalledWith("[KeywordSelector] No keywords found in Firestore.");
    });

    test("never picks one of the 26 most recently used keywords, and records the pick", async ({ repo, factories }) => {
        const words = Array.from({ length: 30 }, (_, index) => `word${String(index).padStart(2, "0")}`);

        for (const random of [0, 0.5, 0.99]) {
            await storeKeywordsUsedInOrder(factories, words);
            vi.spyOn(Math, "random").mockReturnValue(random);

            const picked = await new KeywordSelector(repo).selectKeyword(`event-${random}`);

            expect(words.slice(26)).toContain(picked);
            expect(await repo.getKeywordById(picked)).toMatchObject({
                lastUsedEventId: `event-${random}`,
                timesUsed: 2,
            });
        }
    });

    test("never repeats the keyword used last when there are only a few", async ({ repo, factories }) => {
        for (const random of [0, 0.5, 0.99]) {
            await storeKeywordsUsedInOrder(factories, ["alpha", "bravo", "charlie"]);
            vi.spyOn(Math, "random").mockReturnValue(random);

            expect(await new KeywordSelector(repo).selectKeyword("event-next")).not.toBe("alpha");
        }
    });
});

describe("KeywordRepository", () => {
    test("adds a keyword under a normalised id with no usage", async ({ repo }) => {
        await repo.addKeyword("New Keyword!");

        const keyword = await repo.getKeywordById("new_keyword");
        expect(keyword).toMatchObject({ id: "new_keyword", word: "New Keyword!", timesUsed: 0, usageHistory: [] });
        expect(keyword?.lastUsedAt.getTime()).toBe(0);
        expect(await repo.getAllKeywords()).toHaveLength(1);
    });

    test("records usage with the most recent event first, keeping the last 20", async ({ repo }) => {
        await repo.addKeyword("rare");
        for (let event = 1; event <= 21; event++) {
            await repo.markKeywordUsed("rare", `event-${event}`);
        }

        const keyword = await repo.getKeywordById("rare");
        expect(keyword?.timesUsed).toBe(21);
        expect(keyword?.lastUsedEventId).toBe("event-21");
        expect(keyword?.usageHistory).toHaveLength(20);
        expect(keyword?.usageHistory[0]).toBe("event-21");
        expect(keyword?.lastUsedAt.getTime()).toBeGreaterThan(0);
    });

    test("ignores usage of a keyword that does not exist", async ({ repo }) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        await repo.markKeywordUsed("missing", "event-1");

        expect(await repo.getKeywordById("missing")).toBeNull();
        expect(warn).toHaveBeenCalledWith("[KeywordRepo] Keyword missing not found");
    });

    test("picks only from keywords outside the most recently used ones", async ({ repo, db }) => {
        for (const [index, word] of ["a", "b", "c", "d"].entries()) {
            await db
                .doc(`guilds/${IDS.guild}/keywords/${word}`)
                .set(keywordFactory.build({ id: word, word, lastUsedAt: new Date(1000 - index), timesUsed: 1 }));
        }
        vi.spyOn(Math, "random").mockReturnValue(0.99);

        expect(await repo.getRandomKeyword(2)).toMatchObject({ id: "d" });
        expect(await repo.getRandomKeyword(4)).toBeNull();
    });

    test("resets usage on every keyword and deletes single keywords", async ({ repo }) => {
        await repo.addKeyword("alpha");
        await repo.addKeyword("beta");
        await repo.markKeywordUsed("alpha", "event-1");

        await repo.resetAllUsage();
        expect(await repo.getKeywordById("alpha")).toMatchObject({
            timesUsed: 0,
            lastUsedEventId: "",
            usageHistory: [],
        });

        await repo.deleteKeyword("beta");
        expect(await repo.getKeywordById("beta")).toBeNull();
    });
});
