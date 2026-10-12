import { ApplicationCommandOptionType } from "discord-api-types/v10";
import { describe, expect, test } from "../../../../fixtures.js";
import { AS } from "../../../../discord/payloads.js";
import { tmdbMovie, tmdbSearch } from "../../../../tmdb.js";

const arrival = { id: 329865, title: "Arrival", release_date: "2016-11-10", overview: "Linguists meet visitors." };

describe("/testmovie", () => {
    test("previews what /addmovie would store for TMDb's top result", async ({ discord, slash, http }) => {
        tmdbSearch(http, "arrival", [arrival]);
        tmdbMovie(http, arrival, 116, "Denis Villeneuve");

        const command = await slash(
            "testmovie",
            [{ type: ApplicationCommandOptionType.String, name: "title", value: "arrival" }],
            AS.botAdmin,
        );

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({
                embeds: [
                    expect.objectContaining({
                        title: "Arrival (2016)",
                        description: "Linguists meet visitors.",
                        url: "https://www.themoviedb.org/movie/329865",
                        fields: [
                            { name: "Runtime", value: "116 mins", inline: true },
                            { name: "Director", value: "Denis Villeneuve", inline: true },
                            { name: "Rating", value: "8.2/10", inline: true },
                            { name: "Genres", value: "Action", inline: true },
                            { name: "Starring", value: "Keanu Reeves", inline: true },
                        ],
                    }),
                ],
            }),
        ]);
    });

    test("says so when TMDb finds nothing", async ({ discord, slash, http }) => {
        tmdbSearch(http, "zzzz", []);

        const command = await slash(
            "testmovie",
            [{ type: ApplicationCommandOptionType.String, name: "title", value: "zzzz" }],
            AS.botAdmin,
        );

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "No movie found for **zzzz**." }),
        ]);
    });
});
