import type { Client, Guild, InteractionEditReplyOptions } from "discord.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { textTable, truncate } from "../../utils/TextUtils.js";
import type { ServiceContainer } from "../../core/services/ServiceContainer.js";
import type { Guild as GuildConfig } from "../../models/Guild.js";
import {
    leaderboardEntries,
    newPeriod,
    rankLifetimeEntries,
    rankPeriodicEntries,
    type FinalisedPeriod,
    type PeriodicPlacements,
    type RankedEntry,
    type TaskLeaderboard,
    type TaskLeaderboardId,
    type TaskLeaderboardPeriod,
    type TaskTierChange,
    type TaskTierCounts,
} from "../../models/TaskLeaderboard.js";
import type { TaskEvent } from "../../models/TaskEvent.js";
import type { UserStats } from "../../models/UserStats.js";
import { SubmissionStatus } from "../../models/TaskSubmission.js";

const TIER_POINTS = {
    bronze: 1,
    silver: 3,
    gold: 6,
};

const STATUS_POINTS: Partial<Record<SubmissionStatus, number>> = {
    [SubmissionStatus.Bronze]: TIER_POINTS.bronze,
    [SubmissionStatus.Silver]: TIER_POINTS.silver,
    [SubmissionStatus.Gold]: TIER_POINTS.gold,
};

export function getStatusPoints(status?: SubmissionStatus): number {
    if (!status) return 0;
    return STATUS_POINTS[status] ?? 0;
}

const DEFAULT_PERIOD_EVENTS = 4;

function resolvePeriodKey(event: TaskEvent): string {
    return `start:${event.startTime.toISOString().slice(0, 10)}`;
}

async function loadPeriodicEvents(services: ServiceContainer, eventIds: string[]): Promise<TaskEvent[]> {
    const events = await Promise.all(eventIds.map((eventId) => services.repos.taskRepo.getTaskEventById(eventId)));
    return events.filter((event): event is TaskEvent => !!event);
}

async function weekEndTimes(services: ServiceContainer, eventIds: string[]): Promise<number[] | null> {
    const events = await loadPeriodicEvents(services, eventIds);
    if (events.length === 0) return null;
    return [...Map.groupBy(events, resolvePeriodKey).values()].map((week) =>
        Math.max(...week.map((event) => event.endTime.getTime()))
    );
}

export async function getUniquePeriodCount(services: ServiceContainer, eventIds: string[]): Promise<number> {
    return (await weekEndTimes(services, eventIds))?.length ?? eventIds.length;
}

export async function resolvePeriodicProgress(
    services: ServiceContainer,
    period: TaskLeaderboardPeriod,
    asOf: Date = new Date()
): Promise<{ started: number; elapsed: number; total: number }> {
    const weekEnds = await weekEndTimes(services, period.eventIds);
    if (!weekEnds) {
        return { started: period.eventIds.length, elapsed: period.eventIds.length, total: period.length };
    }
    const elapsed = weekEnds.filter((endTime) => endTime <= asOf.getTime()).length;
    return { started: weekEnds.length, elapsed, total: period.length };
}

export function calculateLifetimePoints(stats: UserStats): number {
    return (
        stats.legacyTasksCompleted +
        stats.tasksCompletedBronze * TIER_POINTS.bronze +
        stats.tasksCompletedSilver * TIER_POINTS.silver +
        stats.tasksCompletedGold * TIER_POINTS.gold
    );
}

async function resolvePeriodLength(services: ServiceContainer): Promise<number> {
    const guildConfig = await services.guilds.get(services.guildId);
    return guildConfig?.taskSettings?.periodEvents ?? DEFAULT_PERIOD_EVENTS;
}

export async function isPeriodicLeaderboardEnabled(services: ServiceContainer): Promise<boolean> {
    const guildConfig = await services.guilds.get(services.guildId);
    return guildConfig?.toggles?.taskLeaderboard ?? true;
}

export async function ensureTaskLeaderboardsInitialized(services: ServiceContainer): Promise<void> {
    const repo = services.repos.taskLeaderboardRepo;

    const now = new Date().toISOString();
    const [lifetime, periodic] = await Promise.all([
        repo.getLeaderboard("lifetime"),
        repo.getLeaderboard("periodic"),
    ]);

    if (!lifetime) {
        const users = await services.repos.userRepo.getAllUsers();
        const points = Object.fromEntries(
            users.flatMap((stats) => {
                const total = calculateLifetimePoints(stats);
                return total > 0 ? [[stats.userId, total]] : [];
            })
        );
        await repo.createLeaderboard({ id: "lifetime", points, createdAt: now, updatedAt: now });
    }

    if (!periodic) {
        await repo.createLeaderboard({
            id: "periodic",
            points: {},
            tierCounts: {},
            createdAt: now,
            updatedAt: now,
            period: newPeriod(await resolvePeriodLength(services), 1, now),
        });
    } else if (!periodic.period) {
        await repo.updateLeaderboard("periodic", {
            period: newPeriod(await resolvePeriodLength(services), 1, now),
            tierCounts: periodic.tierCounts ?? {},
            updatedAt: now,
        });
    }
}

export async function incrementLifetimePoints(
    services: ServiceContainer,
    userId: string,
    amount: number
): Promise<void> {
    try {
        await services.repos.taskLeaderboardRepo.incrementPoints("lifetime", userId, amount);
    } catch (err) {
        console.warn(`[TaskLeaderboards] Failed to increment lifetime points for ${userId}:`, err);
    }
}

export async function recordPeriodicTierChange(
    services: ServiceContainer,
    taskEventId: string,
    change: TaskTierChange
): Promise<void> {
    const repo = services.repos.taskLeaderboardRepo;

    const leaderboard = await repo.getLeaderboard("periodic");
    const within = leaderboard?.period?.eventIds.includes(taskEventId)
        ? undefined
        : leaderboard?.pendingPeriod?.period.eventIds.includes(taskEventId)
            ? "pendingPeriod"
            : null;
    if (within === null) return;

    try {
        await repo.recordTierChange("periodic", change, within);
    } catch (err) {
        console.warn(`[TaskLeaderboards] Failed to record periodic points for ${change.userId}:`, err);
    }
}

export async function registerPeriodicTaskEvent(
    services: ServiceContainer,
    taskEventId: string
): Promise<void> {
    const repo = services.repos.taskLeaderboardRepo;

    let leaderboard = await repo.getLeaderboard("periodic");
    if (!leaderboard) {
        try {
            await ensureTaskLeaderboardsInitialized(services);
            leaderboard = await repo.getLeaderboard("periodic");
        } catch (err) {
            console.warn("[TaskLeaderboards] Leaderboard initialisation failed:", err);
            return;
        }
    }

    if (!leaderboard?.period) return;

    if (leaderboard.period.eventIds.includes(taskEventId)) return;

    const registeredEvents = await loadPeriodicEvents(services, [
        ...leaderboard.period.eventIds,
        taskEventId,
    ]);
    const taskEvent = registeredEvents.find((event) => event.id === taskEventId);
    const currentPeriodEvents = registeredEvents.filter((event) => event.id !== taskEventId);
    const currentPeriodKeys = new Set(currentPeriodEvents.map(resolvePeriodKey));

    // A weekly task period contains multiple category event IDs. Once the first
    // category fills the final week, the remaining categories must stay with it.
    const inCurrentWeek = !!taskEvent && currentPeriodKeys.has(resolvePeriodKey(taskEvent));
    const uniqueCount = currentPeriodEvents.length > 0
        ? currentPeriodKeys.size
        : leaderboard.period.eventIds.length;

    if (!inCurrentWeek && uniqueCount >= leaderboard.period.length) {
        const pendingPeriod = leaderboard.pendingPeriod ?? {
            period: newPeriod(await resolvePeriodLength(services), leaderboard.period.index + 1, new Date().toISOString()),
            points: {},
            tierCounts: {},
        };

        if (pendingPeriod.period.eventIds.includes(taskEventId)) return;

        await repo.updateLeaderboard("periodic", {
            pendingPeriod: {
                ...pendingPeriod,
                period: {
                    ...pendingPeriod.period,
                    eventIds: [...pendingPeriod.period.eventIds, taskEventId],
                },
            },
            updatedAt: new Date().toISOString(),
        });
        return;
    }

    await repo.updateLeaderboard("periodic", {
        period: {
            ...leaderboard.period,
            eventIds: [...leaderboard.period.eventIds, taskEventId],
        },
        updatedAt: new Date().toISOString(),
    });
}

export async function shouldFinalizePeriodicLeaderboard(
    services: ServiceContainer,
    asOf: Date = new Date()
): Promise<{ ready: boolean; leaderboard?: TaskLeaderboard }> {
    const leaderboard = await services.repos.taskLeaderboardRepo.getLeaderboard("periodic");
    if (!leaderboard?.period) return { ready: false };

    const progress = await resolvePeriodicProgress(services, leaderboard.period, asOf);
    return { ready: progress.elapsed >= leaderboard.period.length, leaderboard };
}

export async function finalizePeriodicLeaderboard(
    services: ServiceContainer,
    periodIndex: number
): Promise<FinalisedPeriod | null> {
    return services.repos.taskLeaderboardRepo.endPeriod(periodIndex, await resolvePeriodLength(services));
}

export async function resetPeriodicLeaderboard(services: ServiceContainer): Promise<void> {
    const repo = services.repos.taskLeaderboardRepo;

    await ensureTaskLeaderboardsInitialized(services);
    const leaderboard = await repo.getLeaderboard("periodic");
    if (!leaderboard) return;

    const now = new Date().toISOString();
    await repo.updateLeaderboard("periodic", {
        points: {},
        period: newPeriod(await resolvePeriodLength(services), leaderboard.period?.index ?? 1, now),
        tierCounts: {},
        updatedAt: now,
    });
}

export function championPlaces(guild: Guild, guildConfig: GuildConfig | null, placements: PeriodicPlacements) {
    const awarded = { first: true, second: true, third: true, ...guildConfig?.taskSettings?.championRoles };
    const configured = {
        first: guildConfig?.roles?.taskChampionFirst || null,
        second: guildConfig?.roles?.taskChampionSecond || null,
        third: guildConfig?.roles?.taskChampionThird || null,
    };
    const roleNamed = (name: string) => guild.roles.cache.find((role) => role.name === name)?.id ?? null;

    return [
        {
            place: "first",
            label: "1st",
            winners: placements.first,
            configuredRoleId: configured.first,
            roleId: configured.first ?? roleNamed("Task Champion (1st)"),
            awarded: awarded.first,
            stat: "taskChampionFirsts",
        },
        {
            place: "second",
            label: "2nd",
            winners: placements.second,
            configuredRoleId: configured.second,
            roleId: configured.second ?? roleNamed("Task Champion (2nd)"),
            awarded: awarded.second,
            stat: "taskChampionSeconds",
        },
        {
            place: "third",
            label: "3rd",
            winners: placements.third,
            configuredRoleId: configured.third,
            roleId: configured.third ?? roleNamed("Task Champion (3rd)"),
            awarded: awarded.third,
            stat: "taskChampionThirds",
        },
    ] as const;
}

export async function awardTaskChampionRoles(
    client: Client,
    services: ServiceContainer,
    placements: PeriodicPlacements,
    periodIndex: number,
): Promise<void> {
    const repo = services.repos.taskLeaderboardRepo;

    const leaderboard = await repo.getLeaderboard("periodic");
    const guildConfig = await services.guilds.get(services.guildId);
    if (!leaderboard || !guildConfig) return;

    const guild = await client.guilds.fetch(services.guildId);
    const places = championPlaces(guild, guildConfig, placements);

    for (const { place, roleId } of places) {
        if (!roleId) continue;
        for (const userId of leaderboard.champions?.[place] ?? []) {
            try {
                const member = await guild.members.fetch(userId);
                if (member.roles.cache.has(roleId)) {
                    await member.roles.remove(roleId);
                }
            } catch (err) {
                console.warn(`[TaskLeaderboards] Failed to remove champion role from ${userId}:`, err);
            }
        }
    }

    for (const { winners, roleId, awarded } of places) {
        if (!roleId || !awarded) continue;
        for (const winner of winners) {
            try {
                const member = await guild.members.fetch(winner.userId);
                if (!member.roles.cache.has(roleId)) {
                    await member.roles.add(roleId);
                }
            } catch (err) {
                console.warn(`[TaskLeaderboards] Failed to assign champion role to ${winner.userId}:`, err);
            }
        }
    }

    for (const { winners, stat } of places) {
        for (const winner of winners) {
            try {
                await services.repos.userRepo.incrementStat(winner.userId, stat, 1);
            } catch (err) {
                console.warn(`[TaskLeaderboards] Failed to update champion stats for ${winner.userId}:`, err);
            }
        }
    }

    await repo.updateLeaderboard("periodic", {
        champions: {
            first: placements.first.map((entry) => entry.userId),
            second: placements.second.map((entry) => entry.userId),
            third: placements.third.map((entry) => entry.userId),
            awardedAt: new Date().toISOString(),
            periodIndex,
        },
    });
}

export function periodicLabel(length?: number): string {
    switch (length) {
        case 2:
            return "Fortnightly";
        case 4:
            return "Monthly";
        case 8:
            return "Bi-Monthly";
        case 12:
            return "Quarterly";
        default:
            return "Periodic";
    }
}

export async function leaderboardName(client: Client, guild: Guild | null, userId: string): Promise<string> {
    // Ignore and fall back
    const name =
        (await guild?.members.fetch(userId).then((member) => member.displayName, () => null)) ??
        (await client.users.fetch(userId).then((user) => user.username, () => null)) ??
        userId;
    return name.replaceAll("`", "'");
}

export type LeaderboardRow = RankedEntry & { bronze: number; silver: number; gold: number; streak: string | null };

export function periodicRows(ranked: RankedEntry[], tierCounts: Record<string, TaskTierCounts> = {}): LeaderboardRow[] {
    return ranked.slice(0, 10).map((entry) => {
        const counts = tierCounts[entry.userId];
        return { ...entry, bronze: counts?.bronze ?? 0, silver: counts?.silver ?? 0, gold: counts?.gold ?? 0, streak: null };
    });
}

const MEDALS: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

export async function leaderboardTable(client: Client, guild: Guild | null, rows: LeaderboardRow[]): Promise<string> {
    if (!rows.length) return "No points recorded yet.";

    const withStreak = rows.some((row) => row.streak !== null);
    const cells = await Promise.all(
        rows.map(async (row) => [
            `${rows.filter((other) => other.rank === row.rank).length > 1 ? "=" : ""}${MEDALS[row.rank] ?? `${row.rank}.`}`,
            truncate(await leaderboardName(client, guild, row.userId), withStreak ? 10 : 14),
            ...[row.points, row.bronze, row.silver, row.gold].map(String),
            ...(row.streak === null ? [] : [row.streak]),
        ])
    );
    const header = ["Rank", "Name", "Pts", "B", "S", "G", ...(withStreak ? ["Str"] : [])];
    const table = textTable([header, ...cells], ["l", "l", "r", "r", "r", "r", "r"], " ");
    return ["```", table, "```"].join("\n");
}

export async function buildLeaderboardMessage(
    services: ServiceContainer,
    view: TaskLeaderboardId,
    viewerId: string,
    client: Client,
    guild: Guild | null
): Promise<InteractionEditReplyOptions> {
    await ensureTaskLeaderboardsInitialized(services);
    const leaderboard = await services.repos.taskLeaderboardRepo.getLeaderboard(view);

    if (!leaderboard) {
        const embed = new EmbedBuilder()
            .setTitle("Task Leaderboard")
            .setDescription("Leaderboard data is unavailable.")
            .setColor(0xa60000);
        return { embeds: [embed], components: [] };
    }

    let ranked: RankedEntry[];
    let rows: LeaderboardRow[];
    if (view === "lifetime") {
        const stats = new Map((await services.repos.userRepo.getAllUsers()).map((member) => [member.userId, member]));
        const rankedLifetime = rankLifetimeEntries(
            leaderboardEntries(leaderboard.points).map((entry) => ({
                ...entry,
                currentStreak: stats.get(entry.userId)?.taskStreak ?? 0,
            }))
        );
        ranked = rankedLifetime;
        rows = rankedLifetime.slice(0, 10).map((entry) => {
            const member = stats.get(entry.userId);
            const longest = member?.longestTaskStreak ?? 0;
            const active = longest > 0 && entry.currentStreak === longest;
            return {
                ...entry,
                bronze: member?.tasksCompletedBronze ?? 0,
                silver: member?.tasksCompletedSilver ?? 0,
                gold: member?.tasksCompletedGold ?? 0,
                streak: `${longest}${active ? "*" : ""}`,
            };
        });
    } else {
        ranked = rankPeriodicEntries(leaderboardEntries(leaderboard.points));
        rows = periodicRows(ranked, leaderboard.tierCounts);
    }

    const rank = ranked.find((entry) => entry.userId === viewerId)?.rank;
    const viewerPoints = leaderboard.points[viewerId] ?? 0;
    const periodEvents = await resolvePeriodLength(services);
    const periodLabel = periodicLabel(view === "periodic" ? leaderboard.period?.length ?? periodEvents : periodEvents);

    const embed = new EmbedBuilder()
        .setTitle(`🏆 Task Leaderboard - ${view === "lifetime" ? "All Time" : periodLabel} 🏆`)
        .setColor(0xa60000)
        .addFields(
            {
                name: "Top 10",
                value: await leaderboardTable(client, guild, rows),
            },
            {
                name: "Your Rank",
                value: `${rank ? `#${rank}` : "Unranked"} - ${viewerPoints} pts`,
            }
        );

    if (view === "periodic" && leaderboard.period) {
        const progress = await resolvePeriodicProgress(services, leaderboard.period);
        embed.setDescription("Leaderboard points are tallied from approved task submissions for the current period.");
        embed.setFooter({ text: `Task events elapsed: ${progress.elapsed}/${leaderboard.period.length}` });
    } else if (view === "lifetime") {
        embed.setFooter({ text: "Longest streaks are displayed. Any streak with an * indicates this streak is active." });
    }

    const viewButton = (target: TaskLeaderboardId, label: string) =>
        new ButtonBuilder()
            .setCustomId(`task-leaderboard|${target}`)
            .setLabel(label)
            .setStyle(view === target ? ButtonStyle.Primary : ButtonStyle.Secondary);

    return {
        embeds: [embed],
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(viewButton("lifetime", "All Time"), viewButton("periodic", periodLabel))],
    };
}
