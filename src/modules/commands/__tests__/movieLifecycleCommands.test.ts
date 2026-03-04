import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../movies/MovieLifecycle", () => ({
    finishMovieNight: vi.fn(),
}));

const { finishMovieNight } = vi.mocked(await import("../../movies/MovieLifecycle.js"));
const { default: endmovie } = await import("../movies/endmovie.js");
const { default: listmovies } = await import("../movies/listmovies.js");

describe("movie lifecycle commands", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("endmovie returns lifecycle failure message when no active event exists", async () => {
        finishMovieNight.mockResolvedValueOnce({
            success: false,
            message: "No active movie event found to end.",
        });

        const interaction: any = {
            user: { username: "ModUser" },
            client: {},
            deferReply: vi.fn().mockResolvedValue(undefined),
            editReply: vi.fn().mockResolvedValue(undefined),
        };
        const services: any = {};

        await endmovie.execute({ interaction, services });

        expect(finishMovieNight).toHaveBeenCalledWith("ModUser", services, interaction.client);
        expect(interaction.editReply).toHaveBeenCalledWith("No active movie event found to end.");
    });

    it("endmovie sends thanks message with movie title on success", async () => {
        finishMovieNight.mockResolvedValueOnce({
            success: true,
            message: "The movie night for **Inception** has ended and been archived.",
            finishedMovie: {
                id: "movie-1",
                title: "Inception",
                addedBy: "user-1",
                addedAt: new Date(),
                watched: true,
            },
        });

        const send = vi.fn().mockResolvedValue(undefined);
        const interaction: any = {
            user: { username: "ModUser" },
            client: {},
            guild: {
                channels: {
                    cache: {
                        find: vi.fn().mockReturnValue({
                            isTextBased: () => true,
                            send,
                        }),
                    },
                },
            },
            deferReply: vi.fn().mockResolvedValue(undefined),
            editReply: vi.fn().mockResolvedValue(undefined),
        };
        const services: any = {};

        await endmovie.execute({ interaction, services });

        expect(send).toHaveBeenCalledWith(
            expect.objectContaining({ content: expect.stringContaining("Inception") })
        );
        expect(interaction.editReply).toHaveBeenCalledWith(
            "The movie night for **Inception** has ended and been archived."
        );
    });

    it("listmovies reports empty active queue when all movies are watched", async () => {
        const interaction: any = {
            deferReply: vi.fn().mockResolvedValue(undefined),
            editReply: vi.fn().mockResolvedValue(undefined),
        };
        const services: any = {
            repos: {
                movieRepo: {
                    getAllMovies: vi.fn().mockResolvedValue([
                        { id: "movie-1", title: "Old 1", watched: true, addedBy: "user-1", addedAt: new Date() },
                        { id: "movie-2", title: "Old 2", watched: true, addedBy: "user-2", addedAt: new Date() },
                    ]),
                },
            },
        };

        await listmovies.execute({ interaction, services });

        expect(interaction.editReply).toHaveBeenCalledWith(
            "No unwatched movies are currently queued. Add a new one with `/addmovie`!"
        );
    });
});
