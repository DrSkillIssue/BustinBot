import { describe, expect, test } from "../../../../fixtures.js";
import { IDS, chatInputInteraction, apiMember } from "../../../../discord/payloads.js";

function listedCommands(description: string | undefined): string[] {
    return [...(description ?? "").matchAll(/\*\*(\/\w+)\*\*/g)].map(([, name]) => name!);
}

describe("/moviehelp", () => {
    test("lists the member commands for members, and the admin commands too for movie admins", async ({
        discord,
        slash,
    }) => {
        const member = await slash("moviehelp");
        const admin = await slash("moviehelp", [], { member: apiMember({ roles: [IDS.roles.movieAdmin] }) });

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

        const command = await interact(
            chatInputInteraction("moviehelp", [], {
                ...uncachedGuild,
                member: apiMember({ roles: [IDS.roles.movieAdmin] }),
            }),
        );

        expect(discord.originalEdits(command)[0]?.embeds?.[0]?.fields?.at(-1)?.name).toBe(
            "Available Commands (User + Admin)",
        );
    });
});
