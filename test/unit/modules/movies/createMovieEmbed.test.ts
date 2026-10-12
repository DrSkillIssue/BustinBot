import { describe, expect, test } from "vitest";
import { createMovieEmbed } from "../../../../src/modules/movies/MovieEmbeds.js";

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
