import { SnowflakeUtil } from "discord.js";
import { describe, expect, test } from "../../../../fixtures.js";
import { AS, IDS } from "../../../../discord/payloads.js";

describe("/mymovies", () => {
    test("lists the member's movies still in the list, counted against the cap", async ({
        discord,
        slash,
        factories,
    }) => {
        await factories.movie.create({ id: "movie-1", title: "Inception", addedBy: IDS.user, watched: false });
        await factories.movie.create({ id: "movie-2", title: "Arrival", addedBy: IDS.user, watched: false });
        await factories.movie.create({ id: "movie-3", title: "Heat", addedBy: IDS.user, watched: true });
        await factories.movie.create({ id: "movie-4", title: "Alien", addedBy: SnowflakeUtil.generate().toString() });

        const command = await slash("mymovies");

        const [reply] = discord.originalEdits(command);
        expect(reply?.content).toBe("You have added **2/3** movies. You can still add **1** more using /addmovie.");
        expect(reply?.embeds?.map((embed) => embed.title)).toEqual(["Inception", "Arrival"]);
    });

    test("says how many the member can add when they have none", async ({ discord, slash, factories }) => {
        await factories.movie.create({ title: "Heat", addedBy: IDS.user, watched: true });

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
        for (const [index, title] of ["Inception", "Arrival", "Heat", "Alien"].entries()) {
            await factories.movie.create({ id: `movie-${index + 1}`, title, addedBy: IDS.user, watched: false });
        }

        const command = await slash("mymovies", [], AS.movieAdmin);

        const [reply] = discord.originalEdits(command);
        expect(reply?.content).toBe("You have added **4** movies.");
        expect(reply?.embeds?.map((embed) => embed.title)).toEqual(["Inception", "Arrival", "Heat", "Alien"]);
    });
});
