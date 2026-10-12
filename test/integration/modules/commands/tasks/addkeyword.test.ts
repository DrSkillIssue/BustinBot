import { ApplicationCommandOptionType } from "discord-api-types/v10";
import { describe, expect, test } from "../../../../fixtures.js";
import { AS, chatInputInteraction } from "../../../../discord/payloads.js";

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
