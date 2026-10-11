import { ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import type { MessageComponentInteraction } from "discord.js";
import type { Movie } from "../../models/Movie.js";
import type { ServiceContainer } from "../../core/services/ServiceContainer.js";

const PAGE_SIZE = 25;
const MAX_SELECTED = 5;

interface ManualPollSelection {
    selected: Set<string>;
    page: number;
}

// The movies each admin has picked so far for a poll they are putting together. Each guild has its own.
export class ManualPollSelections {
    private readonly selections = new Map<string, ManualPollSelection>();

    get(userId: string): ManualPollSelection {
        let selection = this.selections.get(userId);
        if (!selection) {
            selection = { selected: new Set<string>(), page: 0 };
            this.selections.set(userId, selection);
        }
        return selection;
    }

    select(userId: string, movieIds: string[]): void {
        const selection = this.get(userId);
        for (const id of movieIds) {
            if (selection.selected.size < MAX_SELECTED) selection.selected.add(id);
        }
    }

    clear(userId: string): void {
        this.selections.delete(userId);
    }
}

function getPaginatedMovies(page: number, movies: Movie[]) {
    const start = page * PAGE_SIZE;
    return movies.slice(start, start + PAGE_SIZE);
}

function normalizeLabel(title: string): string {
    const t = (title || "Untitled").trim();
    return t.length >= 5 ? t.slice(0, 100) : t.padEnd(5, ".");
}


// Shows the menu for picking a poll's movies, in place of the message the interaction came from. The interaction
// has been deferred, since the movie list is read first.
export async function showMovieManualPollMenu(services: ServiceContainer, interaction: MessageComponentInteraction) {
    const movieRepo = services.repos.movieRepo;

    const allMovies: Movie[] = (await movieRepo.getAllMovies())
        .filter((movie) => !movie.watched)
        .sort((a, b) => a.addedAt.getTime() - b.addedAt.getTime());
    if (!allMovies.length) {
        await interaction.followUp({
            content: "No active movies found.",
            flags: 1 << 6,
        });
        return;
    }

    const session = services.manualPolls.get(interaction.user.id);

    const pageMovies = getPaginatedMovies(session.page, allMovies);

    const options = pageMovies.map((movie) => {
        const fullIndex = allMovies.findIndex((m) => m.id === movie.id);
        const indexStr = fullIndex !== -1 ? `${fullIndex + 1}. ` : "";
        const year = movie.releaseDate ? ` (${movie.releaseDate})` : "";
        return {
            label: normalizeLabel(`${indexStr}${movie.title}${year}`),
            value: movie.id,
        };
    });

    const alreadySelected = session.selected.size;
    const remaining = Math.max(0, MAX_SELECTED - alreadySelected);

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId("movie_poll_manual_select")
        .setPlaceholder(
            remaining > 0
                ? `Pick up to ${remaining} more movie${remaining > 1 ? "s" : ""}`
                : "Selection limit reached (5)"
        )
        .setMinValues(0);

    if (options.length) {
        selectMenu.addOptions(options);
    }

    if (remaining > 0 && options.length > 0) {
        selectMenu.setMaxValues(Math.min(remaining, options.length));
    } else {
        // Disable further selection once the limit is reached to avoid invalid max_values payloads.
        selectMenu
            .setDisabled(true)
            .setMaxValues(Math.min(1, Math.max(options.length, 1)));
    }

    const controlRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId("movie_poll_manual_prev")
            .setLabel("◀️")
            .setStyle(ButtonStyle.Primary)
            .setDisabled(session.page === 0),
        new ButtonBuilder()
            .setCustomId("movie_poll_manual_next")
            .setLabel("▶️")
            .setStyle(ButtonStyle.Primary)
            .setDisabled((session.page + 1) * PAGE_SIZE >= allMovies.length),
        new ButtonBuilder()
            .setCustomId("movie_poll_manual_confirm")
            .setLabel("Confirm")
            .setStyle(ButtonStyle.Success)
            .setDisabled(session.selected.size < 2),
        new ButtonBuilder()
            .setCustomId("movie_poll_manual_cancel")
            .setLabel("Cancel")
            .setStyle(ButtonStyle.Danger)
    );

    const selectedTitles = allMovies
        .filter((movie) => session.selected.has(movie.id))
        .map((movie) => {
            const index = allMovies.findIndex((m) => m.id === movie.id);
            const number = index !== -1 ? `${index + 1}. ` : "";
            const year = movie.releaseDate ? ` (${movie.releaseDate})` : "";
            return `• ${number}${movie.title}${year}`;
        })
        .join("\n");

    const content = [
        `Select **up to 5** movies for the poll (Page ${session.page + 1})`,
        selectedTitles
            ? `\n**Currently selected:**\n${selectedTitles}`
            : `\n_No movies selected yet._`,
    ].join("\n");

    const components = [
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu),
        controlRow,
    ];

    await interaction.editReply({ content, components });
}

export async function changeManualPollPage(
    services: ServiceContainer,
    userId: string,
    delta: number
) {
    const movieRepo = services.repos.movieRepo;

    const allMovies: Movie[] = (await movieRepo.getAllMovies()).filter((movie) => !movie.watched);
    if (!allMovies.length) return;

    const session = services.manualPolls.get(userId);
    const totalPages = Math.ceil(allMovies.length / PAGE_SIZE);
    session.page = Math.max(0, Math.min(session.page + delta, totalPages - 1));
}
