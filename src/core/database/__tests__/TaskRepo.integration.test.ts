import { test as base, describe, expect } from '../../../tests/fixtures.js';
import { TaskRepository } from '../TaskRepo.js';
import { TaskCategory } from '../../../models/Task.js';
import { SubmissionStatus } from '../../../models/TaskSubmission.js';
import { CONCURRENT_TRANSACTION_TIMEOUT_MS } from '../../../tests/firestoreEmulator.js';
import { buildTask, buildTaskEvent, buildTaskPoll, buildTaskSubmission } from '../../../tests/fakes/builders.js';

const test = base.extend('repo', ({ db }) => new TaskRepository(db, 'guild-1'));

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

        const first = await repo.voteInPollOnce('poll-1', 'user-1', 'PVM001');
        const changed = await repo.voteInPollOnce('poll-1', 'user-1', 'PVM002');

        expect(first.firstTime).toBe(true);
        expect(changed.firstTime).toBe(false);
        expect((await repo.getTaskPollById('poll-1'))?.votes).toEqual({ 'user-1': 'PVM002' });
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

    test('adds and removes completed users without duplicates', async ({ repo }) => {
        await repo.createTaskEvent(buildTaskEvent({ id: 'week-1' }));

        await repo.addCompletedUser('week-1', 'user-1');
        await repo.addCompletedUser('week-1', 'user-1');
        await repo.addCompletedUser('week-1', 'user-2');
        await repo.removeCompletedUser('week-1', 'user-1');

        expect((await repo.getTaskEventById('week-1'))?.completedUserIds).toEqual(['user-2']);
    });
});

describe('TaskRepository submissions', () => {
    test('finds submissions by id, event and user', async ({ repo }) => {
        await repo.createSubmission(buildTaskSubmission({ id: 'a', userId: 'user-1', taskEventId: 'week-1' }));
        await repo.createSubmission(buildTaskSubmission({ id: 'b', userId: 'user-2', taskEventId: 'week-1' }));
        await repo.createSubmission(buildTaskSubmission({ id: 'c', userId: 'user-1', taskEventId: 'week-2' }));

        expect(await repo.getSubmissionById('a')).toMatchObject({ userId: 'user-1' });
        expect(await repo.getSubmissionById('missing')).toBeNull();
        expect((await repo.getSubmissionsForTask('week-1')).map((s) => s.id).sort()).toEqual(['a', 'b']);
        expect((await repo.getSubmissionsByUser('user-1')).map((s) => s.id).sort()).toEqual(['a', 'c']);
    });

    test('records the reviewer and status of a submission', async ({ repo }) => {
        await repo.createSubmission(buildTaskSubmission({ id: 'a' }));

        await repo.updateSubmissionStatus('a', SubmissionStatus.Silver, 'admin-1');

        expect(await repo.getSubmissionById('a')).toMatchObject({ status: 'silver', reviewedBy: 'admin-1' });
    });

    test('returns the most recently reviewed tiered submission for a user and event', async ({ repo }) => {
        await repo.createSubmission(buildTaskSubmission({ id: 'bronze', status: SubmissionStatus.Pending }));
        await repo.createSubmission(buildTaskSubmission({ id: 'rejected', status: SubmissionStatus.Pending }));
        await repo.createSubmission(buildTaskSubmission({ id: 'gold', status: SubmissionStatus.Pending }));
        await repo.updateSubmissionStatus('bronze', SubmissionStatus.Bronze, 'admin-1');
        await repo.updateSubmissionStatus('gold', SubmissionStatus.Gold, 'admin-1');
        await repo.updateSubmissionStatus('rejected', SubmissionStatus.Rejected, 'admin-1');

        expect((await repo.getSubmissionByUserAndTask('user-1', 'PVM001-20260105'))?.id).toBe('gold');
        expect(await repo.getSubmissionByUserAndTask('user-2', 'PVM001-20260105')).toBeNull();
    });
});

describe('TaskRepository feedback', () => {
    const vote = (userId: string, direction: 'up' | 'down') => ({ taskId: 'PVM001', eventId: 'week-1', userId, vote: direction });

    test('moves the task weight by a member\'s first vote, a changed vote and not a repeated one', async ({ repo }) => {
        await repo.createTask(buildTask({ id: 'PVM001', weight: 50 }));

        expect(await repo.recordFeedback(vote('user-1', 'up'))).toBe('added');
        expect(await repo.recordFeedback(vote('user-1', 'up'))).toBe('unchanged');
        expect(await repo.recordFeedback(vote('user-2', 'down'))).toBe('added');
        expect(await repo.recordFeedback(vote('user-1', 'down'))).toBe('changed');

        expect(await repo.getTaskById('PVM001')).toMatchObject({ weight: 48 });
    });

    test('counts a member\'s votes at the same moment once', async ({ repo }) => {
        await repo.createTask(buildTask({ id: 'PVM001', weight: 50 }));

        const outcomes = await Promise.all([repo.recordFeedback(vote('user-1', 'up')), repo.recordFeedback(vote('user-1', 'up'))]);

        expect(outcomes.sort()).toEqual(['added', 'unchanged']);
        expect(await repo.getTaskById('PVM001')).toMatchObject({ weight: 51 });
    }, CONCURRENT_TRANSACTION_TIMEOUT_MS);

    test('treats a vote stored under an older id as the member\'s previous vote and moves it', async ({ repo, db }) => {
        await repo.createTask(buildTask({ id: 'PVM001', weight: 51 }));
        await db.doc('guilds/guild-1/taskFeedback/1730000000000').set({ id: '1730000000000', ...vote('user-1', 'up') });

        expect(await repo.recordFeedback(vote('user-1', 'down'))).toBe('changed');

        expect(await repo.getTaskById('PVM001')).toMatchObject({ weight: 49 });
        expect((await db.collection('guilds/guild-1/taskFeedback').get()).docs.map((doc) => doc.id)).toEqual(['PVM001_user-1']);
    });

    test('records nothing for a task that doesn\'t exist', async ({ repo }) => {
        expect(await repo.recordFeedback(vote('user-1', 'up'))).toBe('taskNotFound');
    });
});

describe('TaskRepository dates', () => {
    test('reads task events, polls and submissions back exactly as stored', async ({ repo }) => {
        const event = buildTaskEvent();
        const poll = buildTaskPoll();
        const submission = buildTaskSubmission({
            submittedAt: new Date('2026-01-06T01:00:00.000Z'),
            reviewedAt: new Date('2026-01-06T02:00:00.000Z'),
        });
        await repo.createTaskEvent(event);
        await repo.createTaskPoll(poll);
        await repo.createSubmission(submission);

        expect(await repo.getTaskEventById(event.id)).toEqual(event);
        expect(await repo.getTaskPollById(poll.id)).toEqual(poll);
        expect(await repo.getSubmissionById(submission.id)).toEqual(submission);
    });
});

