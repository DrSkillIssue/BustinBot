import { InteractionResponseType, MessageFlags } from "discord-api-types/v10";
import { describe, expect, test } from "../fixtures.js";
import { chatInputInteraction, AS } from "../discord/payloads.js";
import { packageVersion } from "../../src/utils/version.js";

function listedCommands(description: string | undefined): string[] {
    return [...(description ?? "").matchAll(/\*\*(\/\w+)\*\*/g)].flatMap(([, name]) => (name ? [name] : []));
}

describe("/help", () => {
    test("introduces the bot privately", async ({ discord, interact }) => {
        const command = await interact(chatInputInteraction("help"));

        expect(discord.callbacks(command)).toEqual([
            {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: expect.objectContaining({
                    flags: MessageFlags.Ephemeral,
                    embeds: [expect.objectContaining({ title: "🤖 Welcome to BustinBot" })],
                }),
            },
        ]);
    });
});

describe("/faq", () => {
    test("links the FAQ privately", async ({ discord, interact }) => {
        const command = await interact(chatInputInteraction("faq"));

        expect(discord.callbacks(command)).toEqual([
            {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: expect.objectContaining({
                    content:
                        "Need help? Click here to view the BustinBot FAQ: https://github.com/dossyb/BustinBot/wiki",
                    flags: MessageFlags.Ephemeral,
                }),
            },
        ]);
    });
});

describe("/support", () => {
    test("lists the ways to support the bot privately", async ({ discord, interact }) => {
        const command = await interact(chatInputInteraction("support"));

        expect(discord.callbacks(command)).toEqual([
            {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: expect.objectContaining({
                    flags: MessageFlags.Ephemeral,
                    embeds: [expect.objectContaining({ title: "❤️ Support BustinBot" })],
                }),
            },
        ]);
    });
});

describe("/botinfo", () => {
    test("shows the version and uptime privately", async ({ discord, interact }) => {
        const command = await interact(chatInputInteraction("botinfo"));

        expect(discord.callbacks(command)).toEqual([
            {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: expect.objectContaining({
                    flags: MessageFlags.Ephemeral,
                    embeds: [
                        expect.objectContaining({
                            title: "🤖 BustinBot Information",
                            fields: expect.arrayContaining([
                                { name: "Version", value: packageVersion, inline: true },
                                { name: "Uptime", value: expect.stringMatching(/^\d+d \d+h \d+m \d+s$/), inline: true },
                            ]),
                        }),
                    ],
                }),
            },
        ]);
    });
});

describe("/moviehelp", () => {
    test("lists the member commands for members, and the admin commands too for movie admins", async ({
        discord,
        interact,
    }) => {
        const member = await interact(chatInputInteraction("moviehelp"));
        const admin = await interact(chatInputInteraction("moviehelp", [], AS.movieAdmin));

        const commandsFor = (interaction: typeof member) =>
            listedCommands(discord.originalEdits(interaction)[0]?.embeds?.[0]?.fields?.at(-1)?.value);
        expect(commandsFor(member)).toEqual([
            "/addmovie",
            "/listmovies",
            "/viewmovie",
            "/currentmovie",
            "/removemovie",
            "/mymovies",
        ]);
        expect(commandsFor(admin)).toContain("/movienight");
    });

    test("recognises a movie admin whose member Discord sends as role ids", async ({
        discord,
        interact,
        uncachedGuild,
    }) => {
        // Interactions from a guild discord.js hasn't cached carry the member as raw data, roles as ids

        const command = await interact(chatInputInteraction("moviehelp", [], { ...uncachedGuild, ...AS.movieAdmin }));

        expect(discord.originalEdits(command)[0]?.embeds?.[0]?.fields?.at(-1)?.name).toBe(
            "Available Commands (User + Admin)",
        );
    });
});

describe("/taskhelp", () => {
    test("explains the task system privately", async ({ discord, interact }) => {
        const command = await interact(chatInputInteraction("taskhelp"));

        expect(discord.callbacks(command)).toEqual([
            {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: expect.objectContaining({
                    flags: MessageFlags.Ephemeral,
                    embeds: [expect.objectContaining({ title: "🗺️ OSRS Community Task Guide" })],
                }),
            },
        ]);
    });
});
