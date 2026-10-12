import { ApplicationCommandOptionType } from "discord-api-types/v10";
import { describe, expect, test, vi } from "../../../../fixtures.js";
import { IDS, apiMember, apiRole } from "../../../../discord/payloads.js";
import { TaskCategory } from "../../../../../src/models/Task.js";

const botAdmin = { member: apiMember({ roles: [IDS.roles.admin] }) };

describe("/suppress", () => {
    test("stops the bot pinging roles for the given minutes", async ({ discord, slash, services, factories }) => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const taskUsers = apiRole({ name: "Task Users" });
        await discord.addRole(IDS.guild, taskUsers);
        await services.guilds.update(IDS.guild, { roles: { taskUser: taskUsers.id } });
        for (const id of ["PVM001", "PVM002", "PVM003"])
            await factories.task.create({ id, category: TaskCategory.PvM });
        discord.acceptMessages(IDS.channel);
        const before = Math.floor(Date.now() / 1000);

        const command = await slash(
            "suppress",
            [{ type: ApplicationCommandOptionType.Integer, name: "minutes", value: 30 }],
            botAdmin,
        );
        await slash("taskpoll", [], botAdmin);

        const after = Math.floor(Date.now() / 1000);
        const [reply] = discord.originalEdits(command);
        const [, until] =
            /^Mention suppression enabled for \*\*30\*\* minutes\. It will expire <t:(\d+):R> \(<t:\1:F>\)\.$/.exec(
                reply?.content ?? "",
            ) ?? [];
        expect(Number(until)).toBeGreaterThanOrEqual(before + 30 * 60);
        expect(Number(until)).toBeLessThanOrEqual(after + 30 * 60);
        const [announcement] = discord.messagesSentTo(IDS.channel);
        expect(announcement).toMatchObject({
            content: "**New task polls are live!** Cast your votes for each category below:",
            allowed_mentions: { parse: [], users: [], roles: [] },
        });
    });
});
