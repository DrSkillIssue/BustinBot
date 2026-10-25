import type { Client } from "discord.js";
import {
    SubmissionStatus,
    isTier,
    tierRank,
    type SubmissionReview,
    type SubmissionReviewOutcome,
    type SubmissionTier,
    type TaskSubmission,
    type TaskSubmissionDraft,
} from "../../models/TaskSubmission.js";
import type { UserStats } from "../../models/UserStats.js";
import {
    MAX_SCREENSHOTS,
    archiveSubmission,
    notifyUser,
    postToAdminChannel,
    removeReviewPost,
    type ReviewPost,
} from "./SubmissionActions.js";
import type { ITaskRepository } from "../../core/database/interfaces/ITaskRepo.js";
import { getTaskDisplayName } from "./TaskEmbeds.js";
import type { ServiceContainer } from "../../core/services/ServiceContainer.js";
import { calculateTaskStreakSummary } from "./TaskStreaks.js";
import {
    ensureTaskLeaderboardsInitialized,
    getStatusPoints,
    incrementLifetimePoints,
    incrementPeriodicPoints,
} from "./TaskLeaderboards.js";
import { applyTaskMilestoneRoles } from "./TaskMilestones.js";
import { refreshTaskEventMessage } from "./HandleTaskStart.js";

const TIER_STATS: Record<SubmissionTier, keyof UserStats> = {
    [SubmissionStatus.Bronze]: "tasksCompletedBronze",
    [SubmissionStatus.Silver]: "tasksCompletedSilver",
    [SubmissionStatus.Gold]: "tasksCompletedGold",
};

export type SubmitOutcome =
    | { result: "submitted"; submission: TaskSubmission }
    | { result: "taskNotFound" }
    | { result: "adminsUnreachable" }
    | { result: "alreadySubmitted" };

export type ReviewResult =
    | Exclude<SubmissionReviewOutcome, { result: "reviewed" }>
    | (Extract<SubmissionReviewOutcome, { result: "reviewed" }> & { archived: boolean });

export function raisedTier(outcome: SubmissionReviewOutcome): SubmissionTier | null {
    if (outcome.result !== "reviewed") return null;
    const { submission, heldTier } = outcome;
    return isTier(submission.status) && tierRank(submission.status) > tierRank(heldTier) ? submission.status : null;
}

export class TaskService {
    constructor(private repo: ITaskRepository) {}

    get repository() {
        return this.repo;
    }

    async startSubmission(userId: string, taskEventId: string): Promise<TaskSubmissionDraft> {
        const draft: TaskSubmissionDraft = { userId, taskEventId, createdAt: new Date() };
        await this.repo.saveSubmissionDraft(draft);
        return draft;
    }

    async getSubmissionDraft(userId: string): Promise<TaskSubmissionDraft | null> {
        return this.repo.getSubmissionDraft(userId);
    }

    async submit(
        client: Client,
        draft: TaskSubmissionDraft,
        screenshotUrls: string[],
        notes: string | undefined,
        services: ServiceContainer,
    ): Promise<SubmitOutcome> {
        const event = await this.repo.getTaskEventById(draft.taskEventId);
        if (!event) {
            await this.repo.deleteSubmissionDraft(draft.userId);
            return { result: "taskNotFound" };
        }

        const now = new Date();
        const submission: TaskSubmission = {
            id: this.repo.newSubmissionId(),
            userId: draft.userId,
            taskEventId: draft.taskEventId,
            taskName: getTaskDisplayName(event.task, event.selectedAmount),
            screenshotUrls: screenshotUrls.slice(0, MAX_SCREENSHOTS),
            ...(notes ? { notes } : {}),
            status: SubmissionStatus.Pending,
            createdAt: now,
            submittedAt: now,
        };
        // Check if this user already has an approved submission for this task
        const heldTier = await this.repo.getHeldTier(draft.userId, draft.taskEventId);

        let posted: ReviewPost;
        try {
            posted = await postToAdminChannel(client, submission, event, heldTier, services);
        } catch (err) {
            console.warn(`[TaskService] Couldn't post submission ${submission.id} for review:`, err);
            return { result: "adminsUnreachable" };
        }

        const stored: TaskSubmission = { ...submission, ...posted };
        let submitted: boolean;
        try {
            submitted = await this.repo.submitDraft(stored);
        } catch (err) {
            await removeReviewPost(client, stored, services);
            throw err;
        }
        if (!submitted) {
            await removeReviewPost(client, stored, services);
            return { result: "alreadySubmitted" };
        }
        return { result: "submitted", submission: stored };
    }

    async review(client: Client, review: SubmissionReview, services: ServiceContainer): Promise<ReviewResult> {
        if (review.decision !== SubmissionStatus.Rejected) {
            await ensureTaskLeaderboardsInitialized(services);
        }

        const outcome = await this.repo.reviewSubmission(review);
        if (outcome.result !== "reviewed") return outcome;

        const { submission, heldTier } = outcome;
        const tier = raisedTier(outcome);
        const streakLine = tier ? await this.recordTierRaise(client, submission, tier, heldTier, services) : undefined;

        // Notify the member and archive the submission
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

        // Delete original messages from admin channel
        await removeReviewPost(client, submission, services);

        return { ...outcome, archived };
    }

    private async recordTierRaise(
        client: Client,
        submission: TaskSubmission,
        tier: SubmissionTier,
        heldTier: SubmissionTier | null,
        services: ServiceContainer,
    ): Promise<string | undefined> {
        const { userId, taskEventId } = submission;
        const userRepo = services.repos.userRepo;

        try {
            if (heldTier) {
                await userRepo.updateTierStat(userId, TIER_STATS[heldTier], TIER_STATS[tier]);
            } else {
                await userRepo.incrementStat(userId, TIER_STATS[tier], 1);
            }
        } catch (err) {
            console.warn(`[Stats] Failed to update tier stats for ${userId}:`, err);
        }
        const points = getStatusPoints(tier) - (heldTier ? getStatusPoints(heldTier) : 0);
        await incrementLifetimePoints(services, userId, points);
        await incrementPeriodicPoints(services, userId, points, taskEventId, tier);
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
            await userRepo.updateUser(userId, {
                taskStreak: streak.currentStreak,
                longestTaskStreak: streak.longestStreak,
            });
            return `\n🔥 Task streak: **${streak.currentStreak}** (Longest: **${streak.longestStreak}**).`;
        } catch (err) {
            console.warn(`[TaskService] Failed to compute streak summary for ${userId}:`, err);
            return undefined;
        }
    }
}
