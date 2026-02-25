import type { ITaskRepository } from "../../core/database/interfaces/ITaskRepo.js";
import type { TaskEvent } from "../../models/TaskEvent.js";
import { SubmissionStatus } from "../../models/TaskSubmission.js";
import { normaliseFirestoreDates } from "../../utils/DateUtils.js";

export type TaskPeriod = {
    start: Date;
    end: Date;
};

export type TaskStreakSummary = {
    currentStreak: number;
    longestStreak: number;
    currentPeriod?: TaskPeriod;
    hasCompletedCurrentPeriod: boolean;
    lastCompletedPeriodEnd?: Date;
};

const APPROVED_STATUSES = new Set<SubmissionStatus>([
    SubmissionStatus.Approved,
    SubmissionStatus.Bronze,
    SubmissionStatus.Silver,
    SubmissionStatus.Gold,
]);

const PERIOD_GAP_TOLERANCE_MS = 6 * 60 * 60 * 1000; // 6 hours

function isConsecutive(prevEnd: Date, nextStart: Date): boolean {
    const gapMs = nextStart.getTime() - prevEnd.getTime();
    return gapMs >= 0 && gapMs <= PERIOD_GAP_TOLERANCE_MS;
}

function formatUnit(value: number, unit: string): string {
    return `${value} ${unit}${value === 1 ? "" : "s"}`;
}

export function formatDuration(ms: number): string {
    if (ms <= 0) return "less than a minute";

    const totalMinutes = Math.ceil(ms / 60000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;

    const parts: string[] = [];
    if (days > 0) parts.push(formatUnit(days, "day"));
    if (hours > 0 && parts.length < 2) parts.push(formatUnit(hours, "hour"));
    if (minutes > 0 && parts.length < 2) parts.push(formatUnit(minutes, "minute"));

    return parts.join(" ");
}

export async function getCurrentTaskPeriod(
    repo: ITaskRepository,
    now: Date = new Date()
): Promise<TaskPeriod | null> {
    const latestEvent = await repo.getLatestTaskEvent();
    if (!latestEvent) return null;

    const event = normaliseFirestoreDates(latestEvent);
    if (!(event.startTime instanceof Date) || !(event.endTime instanceof Date)) return null;

    if (now < event.startTime || now > event.endTime) return null;

    return {
        start: event.startTime,
        end: event.endTime,
    };
}

async function hasTaskEventsBetween(
    repo: ITaskRepository,
    start: Date,
    end: Date
): Promise<boolean> {
    if (start.getTime() > end.getTime()) return false;
    try {
        const events = await repo.getTaskEventsBetween(start, end);
        return events.length > 0;
    } catch (err) {
        console.warn(`[TaskStreaks] Failed to load task events between ${start.toISOString()} and ${end.toISOString()}:`, err);
        return false;
    }
}

function buildSummary(base: {
    currentStreak: number;
    longestStreak: number;
    hasCompletedCurrentPeriod: boolean;
}, extras?: { currentPeriod?: TaskPeriod; lastCompletedPeriodEnd?: Date; }): TaskStreakSummary {
    const summary: TaskStreakSummary = {
        currentStreak: base.currentStreak,
        longestStreak: base.longestStreak,
        hasCompletedCurrentPeriod: base.hasCompletedCurrentPeriod,
    };

    if (extras?.currentPeriod) {
        summary.currentPeriod = extras.currentPeriod;
    }

    if (extras?.lastCompletedPeriodEnd) {
        summary.lastCompletedPeriodEnd = extras.lastCompletedPeriodEnd;
    }

    return summary;
}

export async function calculateTaskStreakSummary(
    userId: string,
    repo: ITaskRepository,
    now: Date = new Date()
): Promise<TaskStreakSummary> {
    const currentPeriod = await getCurrentTaskPeriod(repo, now);

    const submissionsRaw = await repo.getSubmissionsByUser(userId);
    const submissions = submissionsRaw.map((submission) => normaliseFirestoreDates(submission));

    const approvedSubmissions = submissions.filter((submission) => APPROVED_STATUSES.has(submission.status));
    if (approvedSubmissions.length === 0) {
        return buildSummary(
            {
                currentStreak: 0,
                longestStreak: 0,
                hasCompletedCurrentPeriod: false,
            },
            currentPeriod ? { currentPeriod } : undefined
        );
    }

    const eventIds = Array.from(new Set(approvedSubmissions.map((submission) => submission.taskEventId)));
    const events = await Promise.all(eventIds.map((eventId) => repo.getTaskEventById(eventId)));
    const eventMap = new Map<string, TaskEvent>();

    events.forEach((event, index) => {
        const eventId = eventIds[index];
        if (!event || !eventId) return;
        eventMap.set(eventId, normaliseFirestoreDates(event));
    });

    const periodMap = new Map<number, TaskPeriod>();

    for (const submission of approvedSubmissions) {
        const event = eventMap.get(submission.taskEventId);
        if (!event?.startTime || !event.endTime) continue;

        const submittedAt = submission.submittedAt ?? submission.createdAt;
        if (!(submittedAt instanceof Date)) continue;

        if (submittedAt.getTime() > event.endTime.getTime()) continue;

        const endKey = event.endTime.getTime();
        const existing = periodMap.get(endKey);
        if (!existing) {
            periodMap.set(endKey, { start: event.startTime, end: event.endTime });
        } else {
            if (event.startTime < existing.start) existing.start = event.startTime;
            if (event.endTime > existing.end) existing.end = event.endTime;
        }
    }

    const periods = Array.from(periodMap.values()).sort(
        (a, b) => a.end.getTime() - b.end.getTime()
    );

    if (periods.length === 0) {
        return buildSummary(
            {
                currentStreak: 0,
                longestStreak: 0,
                hasCompletedCurrentPeriod: false,
            },
            currentPeriod ? { currentPeriod } : undefined
        );
    }

    const runLengthByEnd = new Map<number, number>();
    let longest = 0;
    let run = 0;

    for (let i = 0; i < periods.length; i += 1) {
        const period = periods[i]!;
        const previous = i > 0 ? periods[i - 1] : null;

        if (previous) {
            const gapStart = new Date(previous.end.getTime() + 1);
            const gapEnd = new Date(period.start.getTime());
            const hasGapEvents = await hasTaskEventsBetween(repo, gapStart, gapEnd);
            const shouldContinue = isConsecutive(previous.end, period.start) || !hasGapEvents;
            run = shouldContinue ? run + 1 : 1;
        } else {
            run = 1;
        }

        runLengthByEnd.set(period.end.getTime(), run);
        if (run > longest) longest = run;
    }

    const lastCompleted = periods.at(-1);
    if (!lastCompleted) {
        return buildSummary(
            {
                currentStreak: 0,
                longestStreak: 0,
                hasCompletedCurrentPeriod: false,
            },
            currentPeriod ? { currentPeriod } : undefined
        );
    }

    let currentStreak = 0;
    let hasCompletedCurrentPeriod = false;

    if (currentPeriod) {
        const currentKey = currentPeriod.end.getTime();
        const currentRun = runLengthByEnd.get(currentKey);

        if (currentRun !== undefined) {
            currentStreak = currentRun;
            hasCompletedCurrentPeriod = true;
        } else {
            const gapStart = new Date(lastCompleted.end.getTime() + 1);
            const gapEnd = new Date(currentPeriod.start.getTime());
            const hasGapEvents = await hasTaskEventsBetween(repo, gapStart, gapEnd);
            if (isConsecutive(lastCompleted.end, currentPeriod.start) || !hasGapEvents) {
                currentStreak = runLengthByEnd.get(lastCompleted.end.getTime()) ?? 0;
            } else {
                currentStreak = 0;
            }
        }
    } else {
        currentStreak = runLengthByEnd.get(lastCompleted.end.getTime()) ?? 0;
    }

    return buildSummary(
        {
            currentStreak,
            longestStreak: longest,
            hasCompletedCurrentPeriod,
        },
        {
            ...(currentPeriod ? { currentPeriod } : {}),
            lastCompletedPeriodEnd: lastCompleted.end,
        }
    );
}
