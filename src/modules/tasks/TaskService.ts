import type { Client } from 'discord.js';
import {
    SubmissionStatus,
    isTier,
    tierRank,
    type SubmissionReview,
    type SubmissionReviewOutcome,
    type SubmissionTier,
    type TaskSubmission,
    type TaskSubmissionDraft,
} from '../../models/TaskSubmission.js';
import type { UserStats } from '../../models/UserStats.js';
import { MAX_SCREENSHOTS, archiveSubmission, notifyUser, postToAdminChannel, removeReviewPost, type ReviewPost } from './SubmissionActions.js';
import type { ITaskRepository } from '../../core/database/interfaces/ITaskRepo.js';
import { getTaskDisplayName } from './TaskEmbeds.js';
import type { ServiceContainer } from '../../core/services/ServiceContainer.js';
import { calculateTaskStreakSummary } from './TaskStreaks.js';
import { ensureTaskLeaderboardsInitialized, getStatusPoints, incrementLifetimePoints, recordPeriodicTierChange } from './TaskLeaderboards.js';
import { applyTaskMilestoneRoles } from './TaskMilestones.js';
import { refreshTaskEventMessage } from './HandleTaskStart.js';

const TIER_STATS: Record<SubmissionTier, keyof UserStats> = {
    [SubmissionStatus.Bronze]: 'tasksCompletedBronze',
    [SubmissionStatus.Silver]: 'tasksCompletedSilver',
    [SubmissionStatus.Gold]: 'tasksCompletedGold',
};

// What sending screenshots for a draft did
export type SubmitOutcome =
    | { result: 'submitted'; submission: TaskSubmission }
    | { result: 'taskNotFound' }
    | { result: 'adminsUnreachable' }
    | { result: 'alreadySubmitted' };

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
    constructor(private repo: ITaskRepository) { }

    get repository() {
        return this.repo;
    }

    // Remembers, in Firestore so it survives restarts, that a member is about to DM their screenshots for a task
    async startSubmission(userId: string, taskEventId: string): Promise<TaskSubmissionDraft> {
        const draft: TaskSubmissionDraft = { userId, taskEventId, createdAt: new Date() };
        await this.repo.saveSubmissionDraft(draft);
        return draft;
    }

    async getSubmissionDraft(userId: string): Promise<TaskSubmissionDraft | null> {
        return this.repo.getSubmissionDraft(userId);
    }

    // Turns a member's draft and the screenshots they sent into a submission for the task admins to review. It is
    // posted first and stored after, so a stored submission is always one the admins can see; if storing fails, the
    // post is removed and the draft kept for the member to try again.
    async submit(client: Client, draft: TaskSubmissionDraft, screenshotUrls: string[], notes: string | undefined, services: ServiceContainer): Promise<SubmitOutcome> {
        const event = await this.repo.getTaskEventById(draft.taskEventId);
        if (!event) {
            await this.repo.deleteSubmissionDraft(draft.userId);
            return { result: 'taskNotFound' };
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
        const heldTier = await this.repo.getHeldTier(draft.userId, draft.taskEventId);

        let posted: ReviewPost;
        try {
            posted = await postToAdminChannel(client, submission, event, heldTier, services);
        } catch (err) {
            console.warn(`[TaskService] Couldn't post submission ${submission.id} for review:`, err);
            return { result: 'adminsUnreachable' };
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
            return { result: 'alreadySubmitted' };
        }
        return { result: 'submitted', submission: stored };
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
