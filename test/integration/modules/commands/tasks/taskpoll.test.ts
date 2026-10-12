import { describe, expect, test, vi } from "../../../../fixtures.js";
import { IDS, apiMember } from "../../../../discord/payloads.js";
import { TaskCategory } from "../../../../../src/models/Task.js";

const botAdmin = { member: apiMember({ roles: [IDS.roles.admin] }) };

describe("/taskpoll", () => {
    test("posts the task polls now", async ({ discord, slash, services, factories }) => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        for (const id of ["PVM001", "PVM002", "PVM003"])
            await factories.task.create({ id, category: TaskCategory.PvM });
        discord.acceptMessages(IDS.channel);

        const command = await slash("taskpoll", [], botAdmin);

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "Task poll posted successfully." }),
        ]);
        expect(await services.repos.taskRepo.getActiveTaskPollByCategory(TaskCategory.PvM)).toMatchObject({
            isActive: true,
            channelId: IDS.channel,
        });
    });
});
