import { ApplicationCommandOptionType } from "discord-api-types/v10";
import { describe, expect, test } from "../../../../fixtures.js";
import { IDS, apiMember } from "../../../../discord/payloads.js";

const taskAdmin = { member: apiMember({ roles: [IDS.roles.taskAdmin] }) };

describe("/addkeyword", () => {
    test("adds the keyword to the pool under its normalised id", async ({ discord, slash, services }) => {
        const command = await slash(
            "addkeyword",
            [{ type: ApplicationCommandOptionType.String, name: "word", value: "Bustin Bot!" }],
            taskAdmin,
        );

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: 'Keyword **"Bustin Bot!"** has been added successfully!' }),
        ]);
        expect(await services.repos.keywordRepo.getKeywordById("bustin_bot")).toMatchObject({
            word: "Bustin Bot!",
            timesUsed: 0,
        });
    });

    test("refuses a keyword already in the pool", async ({ discord, slash, factories }) => {
        await factories.keyword.create({ id: "bustin", word: "Bustin" });

        const command = await slash(
            "addkeyword",
            [{ type: ApplicationCommandOptionType.String, name: "word", value: "bustin" }],
            taskAdmin,
        );

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: 'The keyword **"bustin"** already exists in the database.' }),
        ]);
    });
});
