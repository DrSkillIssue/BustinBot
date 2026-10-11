import type { Interaction } from "discord.js";
import { handleMoviePickChooseModalSubmit, handleConfirmRandomMovie, handleRerollRandomMovie, handleMoviePollVote, handleManualPollInteraction, handlePickMovieButton, handleRandomPollCountSelect } from "./PickMovieInteractions.js";
import { handleMovieNightDate, handleMovieNightTime } from "./MovieScheduler.js";
import { showMovieManualPollMenu } from "./MovieManualPoll.js";
import { MOVIE_LIST_BUTTON, buildMovieListPage, movieListButtonPage } from "./MovieList.js";
import type { ServiceContainer } from "../../core/services/ServiceContainer.js";

export async function handleMovieInteraction(
    interaction: Interaction,
    services: ServiceContainer
) {
    if (interaction.isModalSubmit()) {
        const { customId } = interaction;
        if (customId === "movie_pick_choose_modal") {
            await handleMoviePickChooseModalSubmit(services, interaction);
            return;
        }

        if (customId.startsWith("movienight-time-")) {
            await handleMovieNightTime(interaction, services);
            return;
        }
    }

    if (interaction.isButton()) {
        const { customId } = interaction;
        const userId = interaction.user.id;

        if (customId.startsWith("confirm_random_movie")) {
            await handleConfirmRandomMovie(services, interaction);
            return;
        }

        if (customId === "reroll_random_movie") {
            await handleRerollRandomMovie(services, interaction);
            return;
        }

        if (customId.startsWith("movie_vote_")) {
            await handleMoviePollVote(services, interaction);
            return;
        }

        if (customId.startsWith("movie_poll_manual_")) {
            await handleManualPollInteraction(services, interaction);
            return;
        }

        if (["movie_pick_choose", "movie_pick_random", "movie_poll_random", "movie_poll_manual"].includes(customId)) {
            await handlePickMovieButton(services, interaction);
            return;
        }

        if (customId.startsWith(MOVIE_LIST_BUTTON)) {
            await interaction.deferUpdate();
            await interaction.editReply(await buildMovieListPage(services, movieListButtonPage(customId)));
            return;
        }

        if (customId === "moviesetup_confirm") {
            const selections = services.setup.getSelections("movie", userId);
            const missing = services.setup.getMissingFields("movie", selections);

            if (missing.length) {
                await interaction.reply({
                    content: `Please select: ${missing.join(", ")} before confirming.`,
                    flags: 1 << 6,
                });
                return;
            }

            await services.setup.persist("movie", services.guilds, interaction.guildId!, selections!);
            services.setup.clearSelections("movie", userId);

            await interaction.update({
                content: "Movie module setup complete! Movie roles and channels have been saved.",
                components: [],
            });
            return;
        }

        if (customId === "moviesetup_cancel") {
            services.setup.clearSelections("movie", userId);
            await interaction.update({
                content: "Movie setup cancelled. No changes were made.",
                components: [],
            });
            return;
        }
    }

    if (interaction.isStringSelectMenu()) {
        switch (interaction.customId) {
            case "movie_poll_random_count":
                await handleRandomPollCountSelect(services, interaction);
                return;
            case "movie_poll_manual_select":
                await interaction.deferUpdate();
                services.manualPolls.select(interaction.user.id, interaction.values);
                await showMovieManualPollMenu(services, interaction);
                return;
            case "movienight-select-date":
                await handleMovieNightDate(interaction, services);
                return;
            default:
                break;
        }
    }

    if (interaction.isChannelSelectMenu()) {
        const userId = interaction.user.id;
        const channelId = interaction.values[0];
        if (!channelId) {
            await interaction.reply({ content: "No channel selected.", flags: 1 << 6 });
            return;
        }

        switch (interaction.customId) {
            case "moviesetup_channel":
                services.setup.setSelection("movie", userId, "movieNight", channelId);
                break;
            case "moviesetup_voice_channel":
                services.setup.setSelection("movie", userId, "movieVC", channelId);
                break;
            default:
                return;
        }

        await interaction.deferUpdate();
    }

    if (interaction.isRoleSelectMenu()) {
        const userId = interaction.user.id;
        const roleId = interaction.values[0];
        if (!roleId) {
            await interaction.reply({ content: "No role selected.", flags: 1 << 6 });
            return;
        }

        switch (interaction.customId) {
            case "moviesetup_admin_role":
                services.setup.setSelection("movie", userId, "movieAdmin", roleId);
                break;
            case "moviesetup_user_role":
                services.setup.setSelection("movie", userId, "movieUser", roleId);
                break;
            default:
                return;
        }

        await interaction.deferUpdate();
    }
}
