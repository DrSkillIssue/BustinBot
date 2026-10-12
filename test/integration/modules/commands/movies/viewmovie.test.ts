import { SnowflakeUtil } from "discord.js";
import { ApplicationCommandOptionType } from "discord-api-types/v10";
import { describe, expect, test } from "../../../../fixtures.js";

describe("/viewmovie", () => {
    test("shows the closest match to a misspelt title, with who added it", async ({ discord, slash, factories }) => {
        const submitter = SnowflakeUtil.generate().toString();
        await factories.movie.create({ id: "movie-1", title: "Inception" });
        await factories.movie.create({
            id: "movie-2",
            title: "Arrival",
            overview: "Linguists meet visitors.",
            addedBy: submitter,
        });

        const command = await slash("viewmovie", [
            { type: ApplicationCommandOptionType.String, name: "title", value: "arival" },
        ]);

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({
                embeds: [
                    expect.objectContaining({
                        title: "🎬 Arrival",
                        description: `Linguists meet visitors.\n\n*Added by <@${submitter}>*`,
                    }),
                ],
            }),
        ]);
    });

    test("says so when nothing matches", async ({ discord, slash, factories }) => {
        await factories.movie.create({ title: "Inception" });

        const command = await slash("viewmovie", [
            { type: ApplicationCommandOptionType.String, name: "title", value: "Godfather" },
        ]);

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "No matching movie found for **Godfather**." }),
        ]);
    });

    test("says so when the list is empty", async ({ discord, slash }) => {
        const command = await slash("viewmovie", [
            { type: ApplicationCommandOptionType.String, name: "title", value: "Inception" },
        ]);

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "No movies are currently in the watchlist." }),
        ]);
    });
});
