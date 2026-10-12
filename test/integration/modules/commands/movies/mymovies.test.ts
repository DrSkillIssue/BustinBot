import { SnowflakeUtil } from "discord.js";
import { describe, expect, test } from "../../../../fixtures.js";
import { IDS, apiMember } from "../../../../discord/payloads.js";

describe("/mymovies", () => {
    test("lists the member's movies still in the list, counted against the cap", async ({
        discord,
        slash,
        factories,
    }) => {
        await factories.movie.create({ id: "movie-1", title: "Inception" });
        await factories.movie.create({ id: "movie-2", title: "Arrival" });
        await factories.movie.create({ id: "movie-3", title: "Heat", watched: true });
        await factories.movie.create({ id: "movie-4", title: "Alien", addedBy: SnowflakeUtil.generate().toString() });

        const command = await slash("mymovies");

        const [reply] = discord.originalEdits(command);
        expect(reply?.content).toBe("You have added **2/3** movies. You can still add **1** more using /addmovie.");
        expect(reply?.embeds?.map((embed) => embed.title)).toEqual(["Inception", "Arrival"]);
    });

    test("says how many the member can add when they have none", async ({ discord, slash, factories }) => {
        await factories.movie.create({ title: "Heat", watched: true });

        const command = await slash("mymovies");

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({
                content: "You haven't added any movies yet. You can add up to 3 movies using /addmovie.",
            }),
        ]);
    });

    test("shows a movie night admin, who has no cap, just how many they have", async ({
        discord,
        slash,
        factories,
    }) => {
        for (const id of ["movie-1", "movie-2", "movie-3", "movie-4"]) await factories.movie.create({ id });

        const command = await slash("mymovies", [], { member: apiMember({ roles: [IDS.roles.movieAdmin] }) });

        const [reply] = discord.originalEdits(command);
        expect(reply?.content).toBe("You have added **4** movies.");
        expect(reply?.embeds).toHaveLength(4);
    });
});
