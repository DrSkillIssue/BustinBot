import { describe, expect, test, storePollableTasks } from "../../../../fixtures.js";
import { AS, IDS } from "../../../../discord/payloads.js";
import { TaskCategory } from "../../../../../src/models/Task.js";
import { postAllTaskPolls } from "../../../../../src/modules/tasks/HandleTaskPoll.js";

describe("/leagues", () => {
    test("switching Leagues on adds a Leagues poll to the next task polls", async ({
        discord,
        slash,
        services,
        factories,
    }) => {
        await storePollableTasks(factories, Object.values(TaskCategory));
        discord.acceptMessages(IDS.channel);

        const command = await slash("leagues", [], AS.taskAdmin);
        await postAllTaskPolls(discord.client, services);

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "Leagues tasks have been **enabled**." }),
        ]);
        expect(await services.repos.taskRepo.getActiveTaskPollByCategory(TaskCategory.Leagues)).toMatchObject({
            isActive: true,
        });
    });

    test("switches Leagues back off", async ({ discord, slash, services }) => {
        await slash("leagues", [], AS.taskAdmin);

        const command = await slash("leagues", [], AS.taskAdmin);

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "Leagues tasks have been **disabled**." }),
        ]);
        expect((await services.guilds.get(IDS.guild))?.toggles.leaguesEnabled).toBe(false);
    });
});
