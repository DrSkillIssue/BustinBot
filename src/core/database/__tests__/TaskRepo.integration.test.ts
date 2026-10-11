import { test as base, describe, expect } from '../../../tests/fixtures.js';
import { IDS, nextId } from '../../../tests/discord/payloads.js';
import { TaskRepository } from '../TaskRepo.js';
import { TaskCategory } from '../../../models/Task.js';
import { SubmissionStatus, type SubmissionTier } from '../../../models/TaskSubmission.js';
import { CONCURRENT_TRANSACTION_TIMEOUT_MS } from '../../../tests/firestoreEmulator.js';
import { buildTask, buildTaskEvent, buildTaskPoll, buildTaskSubmission } from '../../../tests/fakes/builders.js';

const test = base.extend('repo', ({ db }) => new TaskRepository(db, IDS.guild));
const otherUser = nextId();

describe('TaskRepository tasks', () => {
    test('creates, reads and lists tasks by category', async ({ repo }) => {
        await repo.createTask(buildTask({ id: 'PVM001', category: TaskCategory.PvM }));
        await repo.createTask(buildTask({ id: 'SKL001', category: TaskCategory.Skilling }));

        expect(await repo.getTaskById('PVM001')).toMatchObject({ id: 'PVM001' });
        expect(await repo.getTaskById('missing')).toBeNull();
        expect((await repo.getAllTasks()).map((task) => task.id).sort()).toEqual(['PVM001', 'SKL001']);
        expect((await repo.getTasksByCategory(TaskCategory.Skilling)).map((task) => task.id)).toEqual(['SKL001']);
    });

    test('seeds more tasks than fit in one Firestore batch and deletes them all', async ({ repo }) => {
        const tasks = Array.from({ length: 501 }, (_, index) => buildTask({ id: `TASK${index}` }));

        await repo.seedTasks(tasks);
        expect(await repo.getAllTasks()).toHaveLength(501);

        await repo.deleteAllTasks();
        expect(await repo.getAllTasks()).toEqual([]);
    });
});

describe('TaskRepository polls', () => {
    test('finds the active poll and the latest poll for a category', async ({ repo }) => {
        await repo.createTaskPoll(buildTaskPoll({ id: 'old', createdAt: new Date('2026-01-04T00:00:00.000Z'), isActive: false }));
        await repo.createTaskPoll(buildTaskPoll({ id: 'new', createdAt: new Date('2026-01-11T00:00:00.000Z') }));
        await repo.createTaskPoll(buildTaskPoll({ id: 'skilling', category: TaskCategory.Skilling }));

        expect((await repo.getActiveTaskPollByCategory(TaskCategory.PvM))?.id).toBe('new');
        expect((await repo.getLatestTaskPollByCategory(TaskCategory.PvM))?.id).toBe('new');
        expect(await repo.getTaskPollById('old')).toMatchObject({ id: 'old', isActive: false });
        expect(await repo.getActiveTaskPollByCategory(TaskCategory.MinigameMisc)).toBeNull();
    });

    test('closes polls and clears them all', async ({ repo }) => {
        await repo.createTaskPoll(buildTaskPoll());

        await repo.closeTaskPoll('poll-1');
        expect(await repo.getActiveTaskPollByCategory(TaskCategory.PvM)).toBeNull();

        await repo.clearTaskPolls();
        expect(await repo.getTaskPollById('poll-1')).toBeNull();
    });

    test('records votes and reports whether each was the voter\'s first', async ({ repo }) => {
        await repo.createTaskPoll(buildTaskPoll());

        const first = await repo.voteInPollOnce('poll-1', IDS.user, 'PVM001');
        const changed = await repo.voteInPollOnce('poll-1', IDS.user, 'PVM002');

        expect(first.firstTime).toBe(true);
        expect(changed.firstTime).toBe(false);
        expect((await repo.getTaskPollById('poll-1'))?.votes).toEqual({ [IDS.user]: 'PVM002' });
    });

    test('counts every vote when voters vote at the same time', async ({ repo }) => {
        await repo.createTaskPoll(buildTaskPoll());

        await Promise.all(
            Array.from({ length: 5 }, (_, voter) => repo.voteInPollOnce('poll-1', `user-${voter}`, 'PVM001'))
        );

        expect(Object.keys((await repo.getTaskPollById('poll-1'))?.votes ?? {})).toHaveLength(5);
    }, CONCURRENT_TRANSACTION_TIMEOUT_MS);
});

describe('TaskRepository events', () => {
    test('stores events and finds the latest and those ending in a range', async ({ repo }) => {
        await repo.createTaskEvent(buildTaskEvent({
            id: 'week-1', createdAt: new Date('2026-01-05T00:00:00.000Z'), endTime: new Date('2026-01-12T00:00:00.000Z'),
        }));
        await repo.createTaskEvent(buildTaskEvent({
            id: 'week-2', createdAt: new Date('2026-01-12T00:00:00.000Z'), endTime: new Date('2026-01-19T00:00:00.000Z'),
        }));

        expect(await repo.getTaskEventById('week-1')).toMatchObject({ id: 'week-1' });
        expect((await repo.getLatestTaskEvent())?.id).toBe('week-2');
        expect((await repo.getTaskEventsBetween(new Date('2026-01-13T00:00:00.000Z'), new Date('2026-01-31T00:00:00.000Z')))
            .map((event) => event.id)).toEqual(['week-2']);
    });
});

describe('TaskRepository submissions', () => {
    test('finds submissions by id, event and user', async ({ repo }) => {
        await repo.createSubmission(buildTaskSubmission({ id: 'a', userId: IDS.user, taskEventId: 'week-1' }));
        await repo.createSubmission(buildTaskSubmission({ id: 'b', userId: otherUser, taskEventId: 'week-1' }));
        await repo.createSubmission(buildTaskSubmission({ id: 'c', userId: IDS.user, taskEventId: 'week-2' }));

        expect(await repo.getSubmissionById('a')).toMatchObject({ userId: IDS.user });
        expect(await repo.getSubmissionById('missing')).toBeNull();
        expect((await repo.getSubmissionsForTask('week-1')).map((s) => s.id).sort()).toEqual(['a', 'b']);
        expect((await repo.getSubmissionsByUser(IDS.user)).map((s) => s.id).sort()).toEqual(['a', 'c']);
    });

    test('gives every new submission its own id', async ({ repo }) => {
        const ids = Array.from({ length: 50 }, () => repo.newSubmissionId());

        expect(new Set(ids).size).toBe(50);
    });

    test('finds the highest tier a member holds for a task', async ({ repo }) => {
        await repo.createSubmission(buildTaskSubmission({ id: 'silver', status: SubmissionStatus.Silver }));
        await repo.createSubmission(buildTaskSubmission({ id: 'bronze', status: SubmissionStatus.Bronze }));
        await repo.createSubmission(buildTaskSubmission({ id: 'rejected', status: SubmissionStatus.Rejected }));

        expect(await repo.getHeldTier(IDS.user, 'PVM001-20260105')).toBe(SubmissionStatus.Silver);
        expect(await repo.getHeldTier(otherUser, 'PVM001-20260105')).toBeNull();
    });
});

describe('TaskRepository submission drafts', () => {
    const draft = (taskEventId: string, createdAt = new Date('2026-01-06T00:00:00.000Z')) => ({ userId: IDS.user, taskEventId, createdAt });

    test('keeps one draft per member, the latest replacing the one before', async ({ repo }) => {
        await repo.saveSubmissionDraft(draft('week-1'));
        await repo.saveSubmissionDraft(draft('week-2', new Date('2026-01-06T01:00:00.000Z')));

        expect(await repo.getSubmissionDraft(IDS.user)).toEqual(draft('week-2', new Date('2026-01-06T01:00:00.000Z')));
        expect(await repo.getSubmissionDraft(otherUser)).toBeNull();
    });

    test('turns a draft into a submission once', async ({ repo }) => {
        await repo.saveSubmissionDraft(draft('PVM001-20260105'));

        expect(await repo.submitDraft(buildTaskSubmission({ id: 'first' }))).toBe(true);
        expect(await repo.submitDraft(buildTaskSubmission({ id: 'second' }))).toBe(false);

        expect(await repo.getSubmissionDraft(IDS.user)).toBeNull();
        expect((await repo.getSubmissionsByUser(IDS.user)).map((s) => s.id)).toEqual(['first']);
    });

    test('turns a draft into one submission when two arrive at the same moment', async ({ repo }) => {
        await repo.saveSubmissionDraft(draft('PVM001-20260105'));

        const outcomes = await Promise.all([repo.submitDraft(buildTaskSubmission({ id: 'a' })), repo.submitDraft(buildTaskSubmission({ id: 'b' }))]);

        expect(outcomes.sort()).toEqual([false, true]);
        expect(await repo.getSubmissionsByUser(IDS.user)).toHaveLength(1);
    }, CONCURRENT_TRANSACTION_TIMEOUT_MS);

    test('refuses a submission for another task than the draft is for', async ({ repo }) => {
        await repo.saveSubmissionDraft(draft('week-2'));

        expect(await repo.submitDraft(buildTaskSubmission({ taskEventId: 'week-1' }))).toBe(false);
        expect(await repo.getSubmissionDraft(IDS.user)).not.toBeNull();
    });
});

describe('TaskRepository reviews', () => {
    const approve = (submissionId: string, decision: SubmissionTier) => ({ submissionId, reviewedBy: 'admin-1', decision });

    test('approves a pending submission, moving the task\'s completion counts to the member\'s new tier', async ({ repo }) => {
        await repo.createTaskEvent(buildTaskEvent());
        await repo.createSubmission(buildTaskSubmission({ id: 'first' }));
        await repo.createSubmission(buildTaskSubmission({ id: 'upgrade' }));

        expect(await repo.reviewSubmission(approve('first', SubmissionStatus.Bronze))).toMatchObject({ result: 'reviewed', heldTier: null });
        expect(await repo.reviewSubmission(approve('upgrade', SubmissionStatus.Gold))).toMatchObject({ result: 'reviewed', heldTier: SubmissionStatus.Bronze });

        expect(await repo.getSubmissionById('upgrade')).toMatchObject({ status: 'gold', reviewedBy: 'admin-1', reviewedAt: expect.any(Date), prizeRolls: 1 });
        expect(await repo.getTaskEventById('PVM001-20260105')).toMatchObject({
            completionCounts: { bronze: 0, silver: 0, gold: 1 },
            completedUserIds: [IDS.user],
        });
    });

    test('resolves an approval at or below the member\'s tier without counting it', async ({ repo }) => {
        await repo.createTaskEvent(buildTaskEvent({ completionCounts: { bronze: 0, silver: 1, gold: 0 }, completedUserIds: [IDS.user] }));
        await repo.createSubmission(buildTaskSubmission({ id: 'held', status: SubmissionStatus.Silver }));
        await repo.createSubmission(buildTaskSubmission({ id: 'lower' }));

        expect(await repo.reviewSubmission(approve('lower', SubmissionStatus.Bronze))).toMatchObject({ result: 'reviewed', heldTier: SubmissionStatus.Silver });

        expect(await repo.getSubmissionById('lower')).toMatchObject({ status: 'bronze' });
        expect(await repo.getTaskEventById('PVM001-20260105')).toMatchObject({ completionCounts: { bronze: 0, silver: 1, gold: 0 } });
    });

    test('rejects a submission with its reason, leaving the tier the member holds', async ({ repo }) => {
        await repo.createTaskEvent(buildTaskEvent({ completionCounts: { bronze: 1, silver: 0, gold: 0 }, completedUserIds: [IDS.user] }));
        await repo.createSubmission(buildTaskSubmission({ id: 'held', status: SubmissionStatus.Bronze }));
        await repo.createSubmission(buildTaskSubmission({ id: 'retry' }));

        await repo.reviewSubmission({ submissionId: 'retry', reviewedBy: 'admin-1', decision: SubmissionStatus.Rejected, rejectionReason: 'No keyword' });

        expect(await repo.getSubmissionById('retry')).toMatchObject({ status: 'rejected', rejectionReason: 'No keyword', reviewedBy: 'admin-1' });
        expect(await repo.getTaskEventById('PVM001-20260105')).toMatchObject({ completionCounts: { bronze: 1, silver: 0, gold: 0 }, completedUserIds: [IDS.user] });
    });

    test('reviews a submission once', async ({ repo }) => {
        await repo.createTaskEvent(buildTaskEvent());
        await repo.createSubmission(buildTaskSubmission({ id: 'a' }));
        await repo.reviewSubmission(approve('a', SubmissionStatus.Bronze));

        expect(await repo.reviewSubmission(approve('a', SubmissionStatus.Gold))).toMatchObject({ result: 'alreadyReviewed', submission: { status: 'bronze' } });
        expect(await repo.reviewSubmission(approve('missing', SubmissionStatus.Gold))).toEqual({ result: 'notFound' });
        expect(await repo.getTaskEventById('PVM001-20260105')).toMatchObject({ completionCounts: { bronze: 1, silver: 0, gold: 0 } });
    });

    test('counts one review when two admins confirm at the same moment', async ({ repo }) => {
        await repo.createTaskEvent(buildTaskEvent());
        await repo.createSubmission(buildTaskSubmission({ id: 'a' }));

        const outcomes = await Promise.all([repo.reviewSubmission(approve('a', SubmissionStatus.Silver)), repo.reviewSubmission(approve('a', SubmissionStatus.Silver))]);

        expect(outcomes.map((outcome) => outcome.result).sort()).toEqual(['alreadyReviewed', 'reviewed']);
        expect(await repo.getTaskEventById('PVM001-20260105')).toMatchObject({ completionCounts: { bronze: 0, silver: 1, gold: 0 } });
    }, CONCURRENT_TRANSACTION_TIMEOUT_MS);

    test('counts one tier for a member when two of their submissions are approved at the same moment', async ({ repo }) => {
        await repo.createTaskEvent(buildTaskEvent());
        await repo.createSubmission(buildTaskSubmission({ id: 'a' }));
        await repo.createSubmission(buildTaskSubmission({ id: 'b' }));

        await Promise.all([repo.reviewSubmission(approve('a', SubmissionStatus.Bronze)), repo.reviewSubmission(approve('b', SubmissionStatus.Silver))]);

        expect(await repo.getTaskEventById('PVM001-20260105')).toMatchObject({ completionCounts: { bronze: 0, silver: 1, gold: 0 } });
    }, CONCURRENT_TRANSACTION_TIMEOUT_MS);
});

describe('TaskRepository feedback', () => {
    const vote = (userId: string, direction: 'up' | 'down') => ({ taskId: 'PVM001', eventId: 'week-1', userId, vote: direction });

    test('moves the task weight by a member\'s first vote, a changed vote and not a repeated one', async ({ repo }) => {
        await repo.createTask(buildTask({ id: 'PVM001', weight: 50 }));

        expect(await repo.recordFeedback(vote(IDS.user, 'up'))).toBe('added');
        expect(await repo.recordFeedback(vote(IDS.user, 'up'))).toBe('unchanged');
        expect(await repo.recordFeedback(vote(otherUser, 'down'))).toBe('added');
        expect(await repo.recordFeedback(vote(IDS.user, 'down'))).toBe('changed');

        expect(await repo.getTaskById('PVM001')).toMatchObject({ weight: 48 });
    });

    test('counts a member\'s votes at the same moment once', async ({ repo }) => {
        await repo.createTask(buildTask({ id: 'PVM001', weight: 50 }));

        const outcomes = await Promise.all([repo.recordFeedback(vote(IDS.user, 'up')), repo.recordFeedback(vote(IDS.user, 'up'))]);

        expect(outcomes.sort()).toEqual(['added', 'unchanged']);
        expect(await repo.getTaskById('PVM001')).toMatchObject({ weight: 51 });
    }, CONCURRENT_TRANSACTION_TIMEOUT_MS);

    test('treats a vote stored under an older id as the member\'s previous vote and moves it', async ({ repo, db }) => {
        await repo.createTask(buildTask({ id: 'PVM001', weight: 51 }));
        await db.doc(`guilds/${IDS.guild}/taskFeedback/1730000000000`).set({ id: '1730000000000', ...vote(IDS.user, 'up') });

        expect(await repo.recordFeedback(vote(IDS.user, 'down'))).toBe('changed');

        expect(await repo.getTaskById('PVM001')).toMatchObject({ weight: 49 });
        expect((await db.collection(`guilds/${IDS.guild}/taskFeedback`).get()).docs.map((doc) => doc.id)).toEqual([`PVM001_${IDS.user}`]);
    });

    test('records nothing for a task that doesn\'t exist', async ({ repo }) => {
        expect(await repo.recordFeedback(vote(IDS.user, 'up'))).toBe('taskNotFound');
    });
});

describe('TaskRepository dates', () => {
    test('reads task events, polls, submissions and drafts back exactly as stored', async ({ repo }) => {
        const event = buildTaskEvent();
        const poll = buildTaskPoll();
        const submission = buildTaskSubmission({
            submittedAt: new Date('2026-01-06T01:00:00.000Z'),
            reviewedAt: new Date('2026-01-06T02:00:00.000Z'),
        });
        await repo.createTaskEvent(event);
        await repo.createTaskPoll(poll);
        await repo.createSubmission(submission);
        const draft = { userId: IDS.user, taskEventId: event.id, createdAt: new Date('2026-01-06T00:30:00.000Z') };
        await repo.saveSubmissionDraft(draft);

        expect(await repo.getSubmissionDraft(IDS.user)).toEqual(draft);
        expect(await repo.getTaskEventById(event.id)).toEqual(event);
        expect(await repo.getTaskPollById(poll.id)).toEqual(poll);
        expect(await repo.getSubmissionById(submission.id)).toEqual(submission);
    });
});

