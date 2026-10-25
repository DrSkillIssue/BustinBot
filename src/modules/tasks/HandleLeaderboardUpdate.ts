import { EmbedBuilder, type Client, type Guild, type GuildTextBasedChannel } from "discord.js";
import type { ServiceContainer } from "../../core/services/ServiceContainer.js";
import { configuredChannel } from "../../utils/ChannelUtils.js";
import { SubmissionStatus } from "../../models/TaskSubmission.js";
import {
    awardTaskChampionRoles,
    championPlaces,
    ensureTaskLeaderboardsInitialized,
    finalizePeriodicLeaderboard,
    getUniquePeriodCount,
    isPeriodicLeaderboardEnabled,
    leaderboardName,
    leaderboardTable,
    periodicLabel,
    periodicRows,
    resolvePeriodicProgress,
    shouldFinalizePeriodicLeaderboard,
} from "./TaskLeaderboards.js";
import {
    leaderboardEntries,
    rankPeriodicEntries,
    resolvePeriodicPlacements,
    type PeriodicPlacements,
    type RankedEntry,
    type TaskLeaderboardPeriod,
    type TaskTierCounts,
} from "../../models/TaskLeaderboard.js";
import { isMentionSuppressed, withSuppressedMentions } from "../../utils/MentionUtils.js";

async function resolveTaskUserMention(services: ServiceContainer): Promise<string | null> {
    const roleId = (await services.guilds.get(services.guildId))?.roles?.taskUser;
    return roleId ? `<@&${roleId}>` : null;
}

async function sendLeaderboardEmbed(
    services: ServiceContainer,
    channel: GuildTextBasedChannel,
    embed: EmbedBuilder,
    mention: string | null
): Promise<void> {
    const suppressMentions = await isMentionSuppressed(services.guilds, services.guildId);

    if (mention) {
        await channel.send(withSuppressedMentions({ content: mention, embeds: [embed] }, suppressMentions));
        return;
    }

    await channel.send({ embeds: [embed] });
}

function leaderboardGuild(client: Client, services: ServiceContainer): Promise<Guild | null> {
    return client.guilds.fetch(services.guildId).catch(() => null);
}

async function notifyChampionWinners(
    client: Client,
    services: ServiceContainer,
    placements: PeriodicPlacements
): Promise<void> {
    const guild = await client.guilds.fetch(services.guildId);
    const guildConfig = await services.guilds.get(services.guildId);

    for (const { label, winners, configuredRoleId, awarded } of championPlaces(guild, guildConfig, placements)) {
        const roleName = configuredRoleId ? guild.roles.cache.get(configuredRoleId)?.name : undefined;
        for (const winner of winners) {
            try {
                const user = await client.users.fetch(winner.userId);
                const roleLine =
                    awarded && roleName
                        ? `You have been awarded the **${roleName}** role to flex.`
                        : "Your placement has been recorded by the task admins.";
                await user.send(
                    `🏆 Congratulations! You placed **${label}** on the periodic task leaderboard in **${guild.name}**.\n${roleLine}`
                );
            } catch (err) {
                console.warn(`[LeaderboardUpdate] Failed to DM leaderboard winner ${winner.userId}:`, err);
            }
        }
    }
}

async function buildFinalLeaderboardEmbed(
    client: Client,
    services: ServiceContainer,
    placements: PeriodicPlacements,
    ranked: RankedEntry[],
    options: {
        periodLabel: string;
        footer: { elapsed: number; total: number };
        tierCounts: Record<string, TaskTierCounts>;
        summaryNote?: string;
    }
): Promise<EmbedBuilder> {
    const guild = await leaderboardGuild(client, services);
    const winnerLines = await Promise.all(
        [
            { medal: "🥇", winners: placements.first },
            { medal: "🥈", winners: placements.second },
            { medal: "🥉", winners: placements.third },
        ].map(async ({ medal, winners }) => {
            if (winners.length === 0) return `${medal} — None`;
            const names = await Promise.all(winners.map((winner) => leaderboardName(client, guild, winner.userId)));
            return `${medal} ${names.join(", ")}`;
        })
    );

    const description = [
        "The leaderboard period has ended! Congratulations to our top finishers.",
        "Temporary Task Champion roles have been awarded to the top 3.",
        `${options.periodLabel} leaderboard standings have been reset.`,
        ...(options.summaryNote ? [options.summaryNote] : []),
    ];

    return new EmbedBuilder()
        .setTitle("🏆 Final Leaderboard Standings")
        .setDescription(description.join(" "))
        .setColor(0xa60000)
        .addFields(
            {
                name: "Our Task Champions",
                value: winnerLines.join("\n"),
            },
            {
                name: "Final Top 10",
                value: await leaderboardTable(client, guild, periodicRows(ranked, options.tierCounts)),
            }
        )
        .setFooter({ text: `Task events elapsed: ${options.footer.elapsed}/${options.footer.total}` });
}

export async function postWeeklyLeaderboardSnapshot(
    client: Client,
    services: ServiceContainer
): Promise<boolean> {
    try {
        await ensureTaskLeaderboardsInitialized(services);
    } catch (err) {
        console.warn("[LeaderboardUpdate] Leaderboard initialisation failed:", err);
        return false;
    }

    const leaderboard = await services.repos.taskLeaderboardRepo.getLeaderboard("periodic");
    if (!leaderboard?.period) return false;

    const ranked = rankPeriodicEntries(leaderboardEntries(leaderboard.points));
    const table = await leaderboardTable(client, await leaderboardGuild(client, services), periodicRows(ranked, leaderboard.tierCounts));
    const progress = await resolvePeriodicProgress(services, leaderboard.period);

    const embed = new EmbedBuilder()
        .setTitle("🏆 Current Leaderboard Standings")
        .setDescription("Leaderboard points are tallied from approved task submissions for the current period.")
        .setColor(0xa60000)
        .addFields({ name: "Current Top 10", value: table })
        .setFooter({ text: `Task events elapsed: ${progress.elapsed}/${leaderboard.period.length}` });

    const channel = await configuredChannel(client, services, "taskChannel");
    if (!channel) return false;

    await channel.send({ embeds: [embed] });
    return true;
}

export async function postFinalLeaderboardSnapshot(
    client: Client,
    services: ServiceContainer
): Promise<boolean> {
    try {
        await ensureTaskLeaderboardsInitialized(services);
    } catch (err) {
        console.warn("[LeaderboardUpdate] Leaderboard initialisation failed:", err);
        return false;
    }

    const leaderboard = await services.repos.taskLeaderboardRepo.getLeaderboard("periodic");
    if (!leaderboard?.period) return false;

    const channel = await configuredChannel(client, services, "taskChannel");
    if (!channel) return false;

    const completed = leaderboard.completedPeriod;
    if (leaderboard.period.eventIds.length === 0 && completed) {
        const ranked = rankPeriodicEntries(completed.topTen ?? completed.topThree);
        const elapsed = await getUniquePeriodCount(services, completed.eventIds);
        const finalEmbed = await buildFinalLeaderboardEmbed(client, services, resolvePeriodicPlacements(ranked), ranked, {
            periodLabel: periodicLabel(elapsed),
            footer: { elapsed, total: elapsed },
            tierCounts: completed.tierCounts ?? {},
            summaryNote: "No task events have completed yet for the new period; showing last period standings.",
        });
        await sendLeaderboardEmbed(services, channel, finalEmbed, await resolveTaskUserMention(services));
        return true;
    }

    const progress = await resolvePeriodicProgress(services, leaderboard.period);
    const ranked = rankPeriodicEntries(leaderboardEntries(leaderboard.points));
    const finalEmbed = await buildFinalLeaderboardEmbed(client, services, resolvePeriodicPlacements(ranked), ranked, {
        periodLabel: periodicLabel(leaderboard.period.length),
        footer: { elapsed: progress.elapsed, total: leaderboard.period.length },
        tierCounts: leaderboard.tierCounts ?? {},
    });
    await sendLeaderboardEmbed(services, channel, finalEmbed, await resolveTaskUserMention(services));
    return true;
}

export async function postPeriodicLeaderboardUpdate(
    client: Client,
    services: ServiceContainer
): Promise<void> {
    if (!(await isPeriodicLeaderboardEnabled(services))) {
        return;
    }

    try {
        await ensureTaskLeaderboardsInitialized(services);
    } catch (err) {
        console.warn("[LeaderboardUpdate] Leaderboard initialisation failed:", err);
        return;
    }

    const { ready, leaderboard } = await shouldFinalizePeriodicLeaderboard(services);
    if (!leaderboard?.period) return;

    if (ready) {
        await finaliseAndAnnounce(client, services, leaderboard.period);
        return;
    }

    const ranked = rankPeriodicEntries(leaderboardEntries(leaderboard.points));
    const table = await leaderboardTable(client, await leaderboardGuild(client, services), periodicRows(ranked, leaderboard.tierCounts));
    const progress = await resolvePeriodicProgress(services, leaderboard.period);

    const embed = new EmbedBuilder()
        .setTitle("🏆 Current Leaderboard Standings")
        .setDescription("Leaderboard points are tallied from approved task submissions for the current period.")
        .setColor(0xa60000)
        .addFields(
            { name: "Top 10", value: table },
            { name: "Period Progress", value: `Week ${progress.elapsed + 1} of ${leaderboard.period.length}` }
        )
        .setFooter({ text: `Task events elapsed: ${progress.elapsed}/${leaderboard.period.length}` });

    const channel = await configuredChannel(client, services, "taskChannel");
    if (!channel) return;

    await channel.send({ embeds: [embed] });
}

async function finaliseAndAnnounce(client: Client, services: ServiceContainer, period: TaskLeaderboardPeriod): Promise<void> {
    const progress = await resolvePeriodicProgress(services, period);
    const finalised = await finalizePeriodicLeaderboard(services, period.index);
    if (!finalised) {
        console.warn(`[LeaderboardUpdate] Period ${period.index} had already ended.`);
        return;
    }
    const { completed, placements } = finalised;

    await awardTaskChampionRoles(client, services, placements, completed.index);

    const channel = await configuredChannel(client, services, "taskChannel");
    if (channel) {
        const finalEmbed = await buildFinalLeaderboardEmbed(client, services, placements, rankPeriodicEntries(completed.topTen ?? []), {
            periodLabel: periodicLabel(period.length),
            footer: { elapsed: progress.elapsed, total: progress.total },
            tierCounts: completed.tierCounts ?? {},
        });
        await sendLeaderboardEmbed(services, channel, finalEmbed, await resolveTaskUserMention(services));
    }

    await notifyChampionWinners(client, services, placements);
}

export async function warnPendingLeaderboardFinalization(
    client: Client,
    services: ServiceContainer
): Promise<void> {
    if (!(await isPeriodicLeaderboardEnabled(services))) {
        return;
    }

    try {
        await ensureTaskLeaderboardsInitialized(services);
    } catch (err) {
        console.warn("[LeaderboardUpdate] Leaderboard initialisation failed:", err);
        return;
    }

    const { ready, leaderboard } = await shouldFinalizePeriodicLeaderboard(services);
    if (!ready || !leaderboard?.period) return;

    const submissions = await Promise.all(
        leaderboard.period.eventIds.map((eventId) => services.repos.taskRepo.getSubmissionsForTask(eventId))
    );
    const pendingTotal = submissions.flat().filter((submission) => submission.status === SubmissionStatus.Pending).length;
    if (pendingTotal === 0) return;

    const channel = await configuredChannel(client, services, "taskVerification");
    if (!channel) return;

    const adminRoleId = (await services.guilds.get(services.guildId))?.roles?.taskAdmin;
    const mention = adminRoleId ? `<@&${adminRoleId}>` : "Task Admins";
    const suppressMentions = await isMentionSuppressed(services.guilds, services.guildId);

    await channel.send(withSuppressedMentions({
        content: `${mention} There are ${pendingTotal} pending task submissions and the periodic leaderboard will finalise in ~24 hours. Please review before the update.`
    }, suppressMentions));
}
