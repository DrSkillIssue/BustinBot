import { describe, expect, test, storePollableTasks } from "../../../../fixtures.js";
import { AS, IDS, chatInputInteraction } from "../../../../discord/payloads.js";
import { TaskCategory } from "../../../../../src/models/Task.js";
import { postAllTaskPolls } from "../../../../../src/modules/tasks/HandleTaskPoll.js";

describe("/leagues", () => {
    test("switching Leagues on adds a Leagues poll to the next task polls", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        await services.guilds.updateToggle(IDS.guild, "toggles.leaguesEnabled", false, IDS.user);
        await storePollableTasks(factories, Object.values(TaskCategory));
        discord.acceptMessages(IDS.channel);

        const command = await interact(chatInputInteraction("leagues", [], AS.taskAdmin));
        await postAllTaskPolls(discord.client, services);

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "Leagues tasks have been **enabled**." }),
        ]);
        expect(await services.repos.taskRepo.getActiveTaskPollByCategory(TaskCategory.Leagues)).toMatchObject({
            isActive: true,
        });
    });

    test("switches Leagues back off", async ({ discord, interact, services }) => {
        await services.guilds.updateToggle(IDS.guild, "toggles.leaguesEnabled", true, IDS.user);

        const command = await interact(chatInputInteraction("leagues", [], AS.taskAdmin));

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "Leagues tasks have been **disabled**." }),
        ]);
        expect((await services.repos.guildRepo.getGuild(IDS.guild))?.toggles.leaguesEnabled).toBe(false);
    });
});
