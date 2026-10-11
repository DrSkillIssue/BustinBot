export enum SubmissionStatus {
    Pending = 'pending',
    Approved = 'approved',
    Rejected = 'rejected',
    Bronze = 'bronze',
    Silver = 'silver',
    Gold = 'gold',
}

export interface TaskSubmission {
    // Unique identifier for the submission
    id: string;

    // ID of the user who made the submission
    userId: string;

    // ID for the associated task event
    taskEventId: string;

    // Human-friendly task name at time of submission
    taskName?: string;

    // URLs to the screenshot or evidence provided
    screenshotUrls: string[];

    // Optional submission notes
    notes?: string;

    // Current status of the submission
    status: SubmissionStatus;

    // Admin who reviewed the submission (if applicable)
    reviewedBy?: string;

    // Timestamp when the submission was created
    createdAt: Date;

    // Timestamp when the user actually submitted screenshots/notes
    submittedAt?: Date;

    // Timestamp when the submission was reviewed
    reviewedAt?: Date;

    // Reason for rejection (if applicable)
    rejectionReason?: string;

    // Optional storage of message ID in admin verification channel
    message?: string;

    prizeRolls?: number;

    // Optional storage of screenshot message ID in admin verification channel
    screenshotMessage?: string;

    // Flag if submission is a duplicate of one already approved
    alreadyApproved?: boolean;
}

// The tiers a submission can be approved at, lowest first
export const TIERS = [SubmissionStatus.Bronze, SubmissionStatus.Silver, SubmissionStatus.Gold] as const;
export type SubmissionTier = typeof TIERS[number];

export function isTier(status: SubmissionStatus): status is SubmissionTier {
    return (TIERS as readonly SubmissionStatus[]).includes(status);
}

// How a tier ranks: 0 for no tier, then 1 for bronze up to 3 for gold
export function tierRank(tier: SubmissionTier | null): number {
    return tier ? TIERS.indexOf(tier) + 1 : 0;
}

// The highest tier among a member's submissions for a task, if any was approved
export function highestTier(statuses: SubmissionStatus[]): SubmissionTier | null {
    return statuses.filter(isTier).reduce<SubmissionTier | null>((best, tier) => (tierRank(tier) > tierRank(best) ? tier : best), null);
}

// An admin's decision on a pending submission
export type SubmissionReview = { submissionId: string; reviewedBy: string } & (
    | { decision: SubmissionTier }
    | { decision: SubmissionStatus.Rejected; rejectionReason: string }
);

// What reviewing a submission did. heldTier is the tier the member held for the task before this review.
export type SubmissionReviewOutcome =
    | { result: "notFound" }
    | { result: "alreadyReviewed"; submission: TaskSubmission }
    | { result: "reviewed"; submission: TaskSubmission; heldTier: SubmissionTier | null };
