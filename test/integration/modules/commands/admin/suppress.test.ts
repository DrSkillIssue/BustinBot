import { SnowflakeUtil } from "discord.js";
import { ApplicationCommandOptionType } from "discord-api-types/v10";
import { describe, expect, test, storePollableTasks } from "../../../../fixtures.js";
import { AS, IDS } from "../../../../discord/payloads.js";

describe("/suppress", () => {
    test("stops the bot pinging roles for the given minutes", async ({ discord, slash, factories }) => {
        await storePollableTasks(factories);
        discord.acceptMessages(IDS.channel);
        const sentAt = Date.now();

        const command = await slash(
            "suppress",
            [{ type: ApplicationCommandOptionType.Integer, name: "minutes", value: 30 }],
            { ...AS.botAdmin, id: SnowflakeUtil.generate({ timestamp: sentAt }).toString() },
        );
        await slash("taskpoll", [], AS.botAdmin);

        const until = Math.floor((sentAt + 30 * 60_000) / 1000);
        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({
                content: `Mention suppression enabled for **30** minutes. It will expire <t:${until}:R> (<t:${until}:F>).`,
            }),
        ]);
        const [announcement] = discord.messagesSentTo(IDS.channel);
        expect(announcement).toMatchObject({
            content: "**New task polls are live!** Cast your votes for each category below:",
            allowed_mentions: { parse: [], users: [], roles: [] },
        });
    });
});
