import { readFileSync } from "node:fs";
import path from "node:path";
import { ComponentType, InteractionResponseType, MessageFlags } from "discord-api-types/v10";
import { describe, expect, test } from "../../../tests/fixtures.js";
import { PRIVATE_DEFERRAL, DiscordError } from "../../../tests/discord/harness.js";
import { IDS, apiMember } from "../../../tests/discord/payloads.js";
import { packageVersion } from "../../../utils/version.js";

const admin = { member: apiMember({ roles: [IDS.roles.admin] }) };
const announcements = JSON.parse(
    readFileSync(path.join(import.meta.dirname, "../../../../data/announcements.json"), "utf8"),
);

describe("/announce", () => {
    test("posts this version's announcement in the announcement channel and confirms privately", async ({
        discord,
        slash,
    }) => {
        discord.acceptMessages(IDS.channel);

        const interaction = await slash("announce", [], admin);

        expect(discord.callbacks(interaction)).toEqual([PRIVATE_DEFERRAL]);
        expect(discord.messagesSentTo(IDS.channel)).toEqual([
            expect.objectContaining({
                flags: MessageFlags.IsComponentsV2,
                components: expect.arrayContaining([
                    expect.objectContaining({
                        type: ComponentType.Section,
                        components: [{ type: ComponentType.TextDisplay, content: announcements[packageVersion].title }],
                    }),
                ]),
            }),
        ]);
        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({
                content: `Announcement for **v${packageVersion}** posted in <#${IDS.channel}>.`,
            }),
        ]);
    });

    test("is refused to members who are not bot admins", async ({ discord, slash }) => {
        const interaction = await slash("announce");

        expect(discord.callbacks(interaction)).toEqual([
            {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: expect.objectContaining({
                    content: "You don't have permission to use this command.",
                    flags: MessageFlags.Ephemeral,
                }),
            },
        ]);
        expect(discord.messagesSentTo(IDS.channel)).toEqual([]);
    });

    test("tells the admin when no announcement channel is configured", async ({ discord, services, slash }) => {
        await services.guilds.update(IDS.guild, { channels: { announcements: "" } });

        const interaction = await slash("announce", [], admin);

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "Announcement channel not configured. Please run `/setup` first." }),
        ]);
    });

    test("tells the admin when the configured channel can't be reached", async ({ discord, services, slash }) => {
        await services.guilds.update(IDS.guild, { channels: { announcements: IDS.missingChannel } });
        discord.refuse("GET", `/channels/${IDS.missingChannel}`, DiscordError.unknownChannel);

        const interaction = await slash("announce", [], admin);

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({
                content: `I can't reach the announcement channel <#${IDS.missingChannel}>. Check it still exists and that I can see it, or pick another with \`/setup\`.`,
            }),
        ]);
    });
});
