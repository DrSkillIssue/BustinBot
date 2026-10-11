import { describe, expect, test } from "../../../tests/fixtures.js";
import { GuildRepository } from "../../../core/database/GuildRepo.js";
import { IDS, apiGuild, apiMember, apiUser, chatInputInteraction } from "../../../tests/discord/payloads.js";
import { buildGuild } from "../../../tests/fakes/builders.js";

// A member who isn't the server owner (the harness user owns the guild)
const asMember = (roles: string[] = []) => apiMember({ user: apiUser({ id: "100000000000000037" }), roles });

function listedCommands(description: string | undefined): string[] {
    return [...(description ?? "").matchAll(/\*\*(\/\w+)\*\*/g)].map(([, name]) => name!);
}

describe("/moviehelp", () => {
    test("lists the member commands for members, and the admin commands too for movie admins", async ({ discord, slash }) => {
        const member = await slash("moviehelp", [], { member: asMember() });
        const admin = await slash("moviehelp", [], { member: asMember([IDS.roles.movieAdmin]) });

        const commandsFor = (interaction: typeof member) => listedCommands(discord.originalEdits(interaction)[0]?.embeds?.[0]?.fields?.at(-1)?.value);
        expect(commandsFor(member)).toEqual(["/addmovie", "/listmovies", "/viewmovie", "/currentmovie", "/removemovie", "/mymovies"]);
        expect(commandsFor(admin)).toContain("/movienight");
    });

    test("recognises a movie admin whose member Discord sends as role ids", async ({ discord, interact, db }) => {
        // Interactions from a guild discord.js hasn't cached carry the member as raw data, roles as ids
        const uncachedGuild = "100000000000000012";
        await new GuildRepository(db).initGuild(uncachedGuild, buildGuild({ id: uncachedGuild }));
        discord.guild(apiGuild({ id: uncachedGuild }));

        const command = await interact(chatInputInteraction("moviehelp", [], { guild_id: uncachedGuild, member: asMember([IDS.roles.movieAdmin]) }));

        expect(discord.originalEdits(command)[0]?.embeds?.[0]?.fields?.at(-1)?.name).toBe("Available Commands (User + Admin)");
    });
});
