import { describe, expect, test } from "vitest";
import { createMovieEmbed, truncate } from "../../../../src/modules/movies/MovieEmbeds.js";

describe("createMovieEmbed", () => {
    test("shows the movie's TMDb details", () => {
        const embed = createMovieEmbed({
            title: "Inception",
            releaseDate: 2010,
            runtime: 148,
            director: "Christopher Nolan",
            rating: 8.4,
            genres: ["Action", "Thriller"],
            cast: ["Leonardo DiCaprio", "Joseph Gordon-Levitt"],
            infoUrl: "https://www.themoviedb.org/movie/27205",
        }).toJSON();

        expect(embed).toMatchObject({ title: "Inception (2010)", url: "https://www.themoviedb.org/movie/27205" });
        expect(embed.fields).toEqual([
            { name: "Runtime", value: "148 mins", inline: true },
            { name: "Director", value: "Christopher Nolan", inline: true },
            { name: "Rating", value: "8.4/10", inline: true },
            { name: "Genres", value: "Action, Thriller", inline: true },
            { name: "Starring", value: "Leonardo DiCaprio, Joseph Gordon-Levitt", inline: true },
        ]);
    });

    test("fills in what TMDb doesn't know", () => {
        const embed = createMovieEmbed({ title: "Unknown Film" }).toJSON();

        expect(embed).toMatchObject({ description: "No description available.", url: "https://www.themoviedb.org/" });
        expect(embed.fields?.map((field) => field.value)).toEqual([
            "Unknown",
            "Unknown",
            "Unrated",
            "Unknown",
            "Unknown",
        ]);
    });
});

describe("truncate", () => {
    test("leaves short text unchanged", () => {
        const result = truncate("Hello world", 20);
        expect(result).toBe("Hello world");
    });

    test("cuts text that is too long and ends it with an ellipsis", () => {
        const input = "This is a very long sentence that needs to be cut short.";
        const result = truncate(input, 20);
        expect(result).toBe("This is a very lo...");
    });

    test("leaves text of exactly the limit unchanged", () => {
        const input = "12345";
        const result = truncate(input, 5);
        expect(result).toBe("12345");
    });

    test("never returns more than the limit, even one too short for the ellipsis", () => {
        expect(truncate("Hello world", 2)).toBe("He");
    });
});
