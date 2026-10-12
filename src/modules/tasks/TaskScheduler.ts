import cron from 'node-cron';
import { CronExpressionParser } from 'cron-parser';
import { DateTime } from 'luxon';
import { Client, TextChannel } from 'discord.js';
import { postAllTaskPolls } from './HandleTaskPoll.js';
import { startAllTaskEvents } from './HandleTaskStart.js';
import { generatePrizeDrawSnapshot, rollWinnerForSnapshot, announcePrizeDrawWinner } from './HandlePrizeDraw.js';
import type { ServiceContainer } from '../../core/services/ServiceContainer.js';
import { SchedulerStatusReporter } from '../../core/services/SchedulerStatusReporter.js';
import { postPeriodicLeaderboardUpdate, warnPendingLeaderboardFinalization } from './HandleLeaderboardUpdate.js';

// Store next trigger times for console log
let nextPollTime: Date | null = null;
let nextEventTime: Date | null = null;
let nextPrizeTime: Date | null = null;

export function getNextPollDate() { return nextPollTime; }
export function getNextEventDate() { return nextEventTime; }
export function getNextPrizeDrawDate() { return nextPrizeTime; }

// TODO: Replace with config store (admin editable)
const defaultSchedule = {
    pollDay: 0, // 0 = Sunday, 1 = Monday, ...
    pollHourUTC: 0,
    pollDurationHours: 24,
    taskDurationDays: 7,
    prizeFrequencyWeeks: 2,
    prizeDay: 2, // Tuesday
    prizeHourUTC: 0,
    prizeWeekOffset: 0,
};

const schedulerTimezone = 'UTC';

function getNextRunDate(expression: string): Date | null {
    try {
        const interval = CronExpressionParser.parse(expression, {
            currentDate: new Date(),
            tz: schedulerTimezone,
        });
        return interval.next().toDate();
    } catch (err) {
        console.warn('[TaskScheduler] Failed to parse cron expression:', expression, err);
        return null;
    }
}

function getNextMatchingRunDate(
    expression: string,
    predicate: (date: Date) => boolean,
    baseDate: Date = new Date()
): Date | null {
    try {
        const interval = CronExpressionParser.parse(expression, {
            currentDate: baseDate,
            tz: schedulerTimezone,
        });

        for (let i = 0; i < 12; i++) {
            const next = interval.next().toDate();
            if (predicate(next)) {
                return next;
            }
        }
        return null;
    } catch (err) {
        console.warn('[TaskScheduler] Failed to evaluate matching cron expression:', expression, err);
        return null;
    }
}

// Test config
function isTestMode() {
    return process.env.BOT_MODE === "dev";
}
const testIntervalMinutes = 7;

// Each guild's jobs are kept in node-cron's own registry under names that start with this prefix and the guild id
const JOB_PREFIX = 'taskScheduler';

function jobOptions(guildId: string, job: string) {
    return { timezone: schedulerTimezone, name: `${JOB_PREFIX}:${guildId}:${job}` };
}

function updateTestModeNextTimes(reference: Date = new Date()) {
    const base = new Date(reference);
    base.setSeconds(0, 0);

    const baseMinutes = base.getMinutes();
    const remainder = baseMinutes % testIntervalMinutes;

    const pollOffset = ((testIntervalMinutes - 1 - remainder + testIntervalMinutes) % testIntervalMinutes) || testIntervalMinutes;
    const eventOffset = ((testIntervalMinutes - remainder) % testIntervalMinutes) || testIntervalMinutes;

    const cycleMinutes = 2 * testIntervalMinutes;
    const prizeRemainder = ((baseMinutes - 1) % cycleMinutes + cycleMinutes) % cycleMinutes;
    const prizeOffset = ((cycleMinutes - prizeRemainder) % cycleMinutes) || cycleMinutes;

    const pollTime = new Date(base);
    pollTime.setMinutes(baseMinutes + pollOffset);
    nextPollTime = pollTime;

    const eventTime = new Date(base);
    eventTime.setMinutes(baseMinutes + eventOffset);
    nextEventTime = eventTime;

    const prizeTime = new Date(base);
    prizeTime.setMinutes(baseMinutes + prizeOffset);
    nextPrizeTime = prizeTime;
}

// A Tuesday the prize draw ran on. Draws run every prizeFrequencyWeeks weeks counted from it, which keeps them evenly
// spaced across new years; calendar week numbers restart each January and put three weeks between two draws.
const PRIZE_DRAW_ANCHOR = DateTime.fromISO('2026-10-13T00:00:00Z', { zone: 'utc' });

// Whether the prize draw runs in the week of this date
export function isPrizeDrawWeek(date: Date): boolean {
    const { prizeFrequencyWeeks, prizeWeekOffset } = defaultSchedule;
    const weeks = Math.floor(DateTime.fromJSDate(date, { zone: 'utc' }).diff(PRIZE_DRAW_ANCHOR, 'weeks').weeks) + prizeWeekOffset;
    return ((weeks % prizeFrequencyWeeks) + prizeFrequencyWeeks) % prizeFrequencyWeeks === 0;
}

// Snapshots the draw's entries, rolls a winner and announces them, as of `now`, the time the draw runs at
async function drawPrize(client: Client, services: ServiceContainer, now: Date): Promise<void> {
    const { prizeRepo, taskRepo } = services.repos;
    const snapshot = await generatePrizeDrawSnapshot(prizeRepo, taskRepo, now);
    const winner = await rollWinnerForSnapshot(prizeRepo, snapshot.id, services, now);
    if (!winner) {
        console.log('[PrizeDraw] No eligible entries - skipping announcement.');
        return;
    }
    const announced = await announcePrizeDrawWinner(client, services, prizeRepo, snapshot.id);
    if (!announced) {
        console.warn(`[PrizeDraw] Winner rolled but announcement failed for ${snapshot.id}.`);
    }
}

// The prize draw job, which runs every Tuesday and draws on prize draw weeks; `now` is the time the job runs at
export async function runPrizeDrawJob(client: Client, services: ServiceContainer, now: Date): Promise<void> {
    if (!isPrizeDrawWeek(now)) return;

    console.log('[TaskScheduler] Running prize draw...');
    try {
        await drawPrize(client, services, now);
    } catch (err) {
        console.error('[TaskScheduler] Prize draw job failed:', err);
    }
}

export async function getDefaultChannel(client: Client, services: ServiceContainer): Promise<TextChannel | null> {
    const guildId = services.guildId;
    const guildConfig = guildId ? await services.guilds.get(guildId) : null;
    const channelId = guildConfig?.channels?.taskChannel;
    if (!guildId || !channelId) return null;

    const guild = await client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(channelId).catch((err) => {
        console.warn(`[TaskScheduler] Can't reach the task channel ${channelId} in ${guildId}:`, err);
        return null;
    });
    return channel?.isTextBased() ? (channel as TextChannel) : null;
}

// Schedules the guild's task jobs, replacing any it already has
export async function initTaskScheduler(client: Client, services: ServiceContainer): Promise<void> {
    console.log('[TaskScheduler] Initialising default task schedule...');

    const prizeExpression = `0 ${defaultSchedule.prizeHourUTC} * * ${defaultSchedule.prizeDay}`;

    const { guildId } = services;
    await stopTaskScheduler(guildId);

    if (isTestMode()) {
        // ------------------------------
        // TEST MODE (minute-base cycle)
        // ------------------------------
        const T = testIntervalMinutes;
        updateTestModeNextTimes();

        cron.schedule('* * * * *', async ({ date: now }) => {
            const minute = now.getMinutes();
            updateTestModeNextTimes(now);

            if (minute % T === (T - 1)) {
                console.log('[TaskScheduler] [TEST] Running poll...');
                await postAllTaskPolls(client, services);
                if (nextPollTime) {
                    SchedulerStatusReporter.onNewTrigger('[TEST] Task Poll', nextPollTime);
                }
            }

            if (minute % T === 0) {
                console.log('[TaskScheduler] [TEST] Starting task event...');
                await startAllTaskEvents(client, services);
                if (nextEventTime) {
                    SchedulerStatusReporter.onNewTrigger('[TEST] Task Event', nextEventTime);
                }
            }

            if ((minute - 1) % (2 * T) === 0) {
                console.log('[TaskScheduler] [TEST] Running prize draw...');
                await drawPrize(client, services, now);
                if (nextPrizeTime) {
                    SchedulerStatusReporter.onNewTrigger('[TEST] Prize Draw', nextPrizeTime);
                }
            }
            console.log('[TaskScheduler] Test mode active (interval: every 7 minutes)');
            return;
        }, jobOptions(guildId, 'test'));
    } else {
        // ------------------------------
        // PRODUCTION MODE (admin-configured cycle)
        // ------------------------------
        cron.schedule(
            `0 ${defaultSchedule.pollHourUTC} * * ${defaultSchedule.pollDay}`,
            async () => {
                console.log('[TaskScheduler] Running weekly task poll post...');
                const channel = await getDefaultChannel(client, services);
                if (channel) {
                    await postAllTaskPolls(client, services);
                }
                const pollExpr = `0 ${defaultSchedule.pollHourUTC} * * ${defaultSchedule.pollDay}`;
                nextPollTime = getNextRunDate(pollExpr);
                if (nextPollTime) SchedulerStatusReporter.onNewTrigger('Task Poll', nextPollTime);
            },
            jobOptions(guildId, 'poll')
        );

        cron.schedule(
            `0 ${defaultSchedule.pollHourUTC} * * ${(defaultSchedule.pollDay + 1) % 7}`,
            async () => {
                console.log('[TaskScheduler] Closing poll and starting task event...');
                const channel = await getDefaultChannel(client, services);
                if (channel) {
                    await startAllTaskEvents(client, services,);
                }
                const eventExpr = `0 ${defaultSchedule.pollHourUTC} * * ${(defaultSchedule.pollDay + 1) % 7}`;
                nextEventTime = getNextRunDate(eventExpr);
                if (nextEventTime) SchedulerStatusReporter.onNewTrigger('Task Event', nextEventTime);
            },
            jobOptions(guildId, 'taskStart')
        );

        const scheduleNextPrize = (reference: Date) => {
            nextPrizeTime = getNextMatchingRunDate(prizeExpression, isPrizeDrawWeek, reference);
            if (nextPrizeTime) {
                SchedulerStatusReporter.onNewTrigger('Prize Draw', nextPrizeTime);
            }
        };

        cron.schedule(
            prizeExpression,
            async ({ date }) => {
                await runPrizeDrawJob(client, services, date);
                scheduleNextPrize(date);
            },
            jobOptions(guildId, 'prizeDraw')
        );
        cron.schedule(
            '0 0 * * 2',
            async () => {
                try {
                    await warnPendingLeaderboardFinalization(client, services);
                } catch (err) {
                    console.error('[TaskScheduler] Leaderboard warning job failed:', err);
                }
            },
            jobOptions(guildId, 'leaderboardWarning')
        );

        cron.schedule(
            '0 0 * * 3',
            async () => {
                try {
                    await postPeriodicLeaderboardUpdate(client, services);
                } catch (err) {
                    console.error('[TaskScheduler] Leaderboard update job failed:', err);
                }
            },
            jobOptions(guildId, 'leaderboardUpdate')
        );
        const pollExpr = `0 ${defaultSchedule.pollHourUTC} * * ${defaultSchedule.pollDay}`;
        nextPollTime = getNextRunDate(pollExpr);
        if (nextPollTime) SchedulerStatusReporter.onNewTrigger('Task Poll', nextPollTime);

        const eventExpr = `0 ${defaultSchedule.pollHourUTC} * * ${(defaultSchedule.pollDay + 1) % 7}`;
        nextEventTime = getNextRunDate(eventExpr);
        if (nextEventTime) SchedulerStatusReporter.onNewTrigger('Task Event', nextEventTime);

        scheduleNextPrize(new Date());
    }
    console.log('[TaskScheduler] Production mode schedule initialised.');
}

// Removes the guild's task jobs, leaving other guilds' running
export async function stopTaskScheduler(guildId: string): Promise<void> {
    const guildJobs = [...cron.getTasks().values()].filter((job) => job.name?.startsWith(`${JOB_PREFIX}:${guildId}:`));
    await Promise.all(guildJobs.map((job) => job.destroy()));
    if (guildJobs.length) console.log(`[TaskScheduler] Stopped ${guildJobs.length} jobs for ${guildId}.`);
}
