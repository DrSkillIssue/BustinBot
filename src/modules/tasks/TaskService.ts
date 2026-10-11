import type { Client } from 'discord.js';
import {
    SubmissionStatus,
    isTier,
    tierRank,
    type SubmissionReview,
    type SubmissionReviewOutcome,
    type SubmissionTier,
    type TaskSubmission,
} from '../../models/TaskSubmission.js';
import type { UserStats } from '../../models/UserStats.js';
import { archiveSubmission, notifyUser, postToAdminChannel, removeReviewPost } from './SubmissionActions.js';
import type { ITaskRepository } from '../../core/database/interfaces/ITaskRepo.js';
import { getTaskDisplayName } from './TaskEmbeds.js';
import type { ServiceContainer } from '../../core/services/ServiceContainer.js';
import { calculateTaskStreakSummary } from './TaskStreaks.js';
import { ensureTaskLeaderboardsInitialized, getStatusPoints, incrementLifetimePoints, recordPeriodicTierChange } from './TaskLeaderboards.js';
import { applyTaskMilestoneRoles } from './TaskMilestones.js';
import { refreshTaskEventMessage } from './HandleTaskStart.js';

const MAX_SCREENSHOTS = 10;

const TIER_STATS: Record<SubmissionTier, keyof UserStats> = {
    [SubmissionStatus.Bronze]: 'tasksCompletedBronze',
    [SubmissionStatus.Silver]: 'tasksCompletedSilver',
    [SubmissionStatus.Gold]: 'tasksCompletedGold',
};

// What reviewing a submission did. A reviewed submission also says whether it was archived.
export type ReviewResult =
    | Exclude<SubmissionReviewOutcome, { result: 'reviewed' }>
    | (Extract<SubmissionReviewOutcome, { result: 'reviewed' }> & { archived: boolean });

// Whether a review approved the member at a higher tier than they held for the task
export function raisedTier(outcome: SubmissionReviewOutcome): SubmissionTier | null {
    if (outcome.result !== 'reviewed') return null;
    const { submission, heldTier } = outcome;
    return isTier(submission.status) && tierRank(submission.status) > tierRank(heldTier) ? submission.status : null;
}

export class TaskService {
    private pendingTaskMap = new Map<string, string>();
    constructor(private repo: ITaskRepository) { }

    get repository() {
        return this.repo;
    }

    async createSubmission(userId: string, taskEventId: string): Promise<TaskSubmission> {
        // Check if this user already has an approved submission for this task
        const existing = await this.repo.getSubmissionsByUser(userId);
        const hasApproved = existing.some(
            s => s.userId === userId && s.taskEventId === taskEventId && s.status === SubmissionStatus.Approved
        );

        const taskEvent = await this.repo.getTaskEventById(taskEventId);
        if (!taskEvent) {
            throw new Error(`Task event ${taskEventId} not found`);
        }
        const taskName = getTaskDisplayName(taskEvent.task, taskEvent.selectedAmount);

        const submission: TaskSubmission = {
            id: Date.now().toString(),
            userId,
            taskEventId,
            screenshotUrls: [],
            status: SubmissionStatus.Pending,
            createdAt: new Date(),
            alreadyApproved: hasApproved,
            taskName,
        };

        await this.repo.createSubmission(submission);
        return submission;
    }

    async completeSubmission(client: Client, submissionId: string, screenshotUrls: string[], services: ServiceContainer, notes?: string): Promise<TaskSubmission | null> {
        const submission = await this.repo.getSubmissionById(submissionId);
        if (!submission) return null;

        submission.screenshotUrls = screenshotUrls.slice(0, MAX_SCREENSHOTS);
        submission.submittedAt = new Date();

        if (notes !== undefined) {
            submission.notes = notes;
        } else {
            delete submission.notes;
        }

        if (!submission.taskName) {
            const taskEvent = await this.repo.getTaskEventById(submission.taskEventId);
            if (taskEvent) {
                submission.taskName = getTaskDisplayName(taskEvent.task, taskEvent.selectedAmount);
            }
        }

        await postToAdminChannel(client, submission, services);
        await this.repo.createSubmission(submission);
        return submission;
    }

    async getPendingSubmission(
        userId: string,
        taskEventId?: string
    ): Promise<TaskSubmission | undefined> {
        const submissions = await this.repo.getSubmissionsByUser(userId);
        const pending = submissions.find(
            (s) =>
                s.userId === userId &&
                s.status === SubmissionStatus.Pending &&
                (!s.screenshotUrls || s.screenshotUrls.length === 0) &&
                (taskEventId ? s.taskEventId === taskEventId : true)
        );
        if (pending && !pending.taskName) {
            const taskEvent = await this.repo.getTaskEventById(pending.taskEventId);
            if (taskEvent) {
                pending.taskName = getTaskDisplayName(taskEvent.task, taskEvent.selectedAmount);
                await this.repo.createSubmission(pending);
            }
        }
        return pending;
    }


    setPendingTask(userId: string, taskEventId: string) {
        this.pendingTaskMap.set(userId, taskEventId);
    }

    hasPendingTask(userId: string): boolean {
        return this.pendingTaskMap.has(userId);
    }

    peekPendingTask(userId: string): string | undefined {
        return this.pendingTaskMap.get(userId);
    }

    consumePendingTask(userId: string): string | undefined {
        const taskId = this.pendingTaskMap.get(userId);
        this.pendingTaskMap.delete(userId);
        return taskId;
    }

    // Records an admin's decision on a submission, then what follows from it: the member's stats, points and roles
    // when they reached a higher tier, their DM, the archive copy, and removing the submission's review post
    async review(client: Client, review: SubmissionReview, services: ServiceContainer): Promise<ReviewResult> {
        // The lifetime leaderboard starts from members' stats, so it has to exist before this approval changes them
        if (review.decision !== SubmissionStatus.Rejected) {
            await ensureTaskLeaderboardsInitialized(services);
        }

        const outcome = await this.repo.reviewSubmission(review);
        if (outcome.result !== 'reviewed') return outcome;

        const { submission, heldTier } = outcome;
        const tier = raisedTier(outcome);
        const streakLine = tier ? await this.recordTierRaise(client, submission, tier, heldTier, services) : undefined;

        try {
            await notifyUser(client, submission, heldTier, streakLine);
        } catch (err) {
            console.warn(`[TaskService] Failed to DM user ${submission.userId} about ${submission.id}:`, err);
        }

        let archived = false;
        try {
            archived = await archiveSubmission(client, submission, services);
        } catch (err) {
            console.warn(`[TaskService] Failed to archive submission ${submission.id}:`, err);
        }

        await removeReviewPost(client, submission, services);

        return { ...outcome, archived };
    }

    // Counts a member reaching a higher tier on a task towards their stats, points and milestone roles, and redraws
    // the task's post with its new completion counts. Returns the member's task streak line for their DM.
    private async recordTierRaise(
        client: Client,
        submission: TaskSubmission,
        tier: SubmissionTier,
        heldTier: SubmissionTier | null,
        services: ServiceContainer
    ): Promise<string | undefined> {
        const { userId, taskEventId } = submission;
        const userRepo = services.repos.userRepo;

        if (userRepo) {
            try {
                if (heldTier) {
                    await userRepo.updateTierStat(userId, TIER_STATS[heldTier], TIER_STATS[tier]);
                } else {
                    await userRepo.incrementStat(userId, TIER_STATS[tier], 1);
                }
            } catch (err) {
                console.warn(`[Stats] Failed to update tier stats for ${userId}:`, err);
            }
        } else {
            console.warn("[Stats] UserRepo unavailable; skipping task completion increment.");
        }

        const points = getStatusPoints(tier) - (heldTier ? getStatusPoints(heldTier) : 0);
        await incrementLifetimePoints(services, userId, points);
        await recordPeriodicTierChange(services, taskEventId, { userId, points, from: heldTier, to: tier });
        try {
            await applyTaskMilestoneRoles(client, services, userId);
        } catch (err) {
            console.warn(`[TaskService] Failed to update milestone roles for ${userId}:`, err);
        }

        const event = await this.repo.getTaskEventById(taskEventId);
        if (event) {
            try {
                await refreshTaskEventMessage(client, event);
            } catch (err) {
                console.warn(`[TaskService] Failed to redraw task event ${taskEventId}:`, err);
            }
        }

        try {
            const streak = await calculateTaskStreakSummary(userId, this.repo);
            await userRepo?.updateUser(userId, { taskStreak: streak.currentStreak, longestTaskStreak: streak.longestStreak });
            return `\n🔥 Task streak: **${streak.currentStreak}** (Longest: **${streak.longestStreak}**).`;
        } catch (err) {
            console.warn(`[TaskService] Failed to compute streak summary for ${userId}:`, err);
            return undefined;
        }
    }
}
