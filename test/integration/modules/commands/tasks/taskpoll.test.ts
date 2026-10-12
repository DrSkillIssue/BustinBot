import { describe, expect, test, storePollableTasks } from "../../../../fixtures.js";
import { AS, IDS, chatInputInteraction } from "../../../../discord/payloads.js";
import { TaskCategory } from "../../../../../src/models/Task.js";

describe("/taskpoll", () => {
    test("posts the task polls now", async ({ discord, interact, services, factories }) => {
        await storePollableTasks(factories);
        discord.acceptMessages(IDS.channel);

        const command = await interact(chatInputInteraction("taskpoll", [], AS.botAdmin));

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "Task poll posted successfully." }),
        ]);
        expect(await services.repos.taskRepo.getActiveTaskPollByCategory(TaskCategory.PvM)).toMatchObject({
            isActive: true,
            channelId: IDS.channel,
        });
    });
});
