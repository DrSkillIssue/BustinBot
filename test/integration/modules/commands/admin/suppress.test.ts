import { ApplicationCommandOptionType } from "discord-api-types/v10";
import { describe, expect, test, storePollableTasks } from "../../../../fixtures.js";
import { AS, IDS } from "../../../../discord/payloads.js";

describe("/suppress", () => {
    test("stops the bot pinging roles for the given minutes", async ({ discord, slash, factories }) => {
        await storePollableTasks(factories);
        discord.acceptMessages(IDS.channel);
        const before = Math.floor(Date.now() / 1000);

        const command = await slash(
            "suppress",
            [{ type: ApplicationCommandOptionType.Integer, name: "minutes", value: 30 }],
            AS.botAdmin,
        );
        await slash("taskpoll", [], AS.botAdmin);

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
