import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { GuildScopedRepository } from "./CoreRepo.js";
import type { Task } from "../../models/Task.js";
import type { TaskPoll } from "../../models/TaskPoll.js";
import { SubmissionStatus, type TaskSubmission } from "../../models/TaskSubmission.js";
import type { TaskEvent } from "../../models/TaskEvent.js";
import type { TaskFeedback, TaskFeedbackOutcome } from "../../models/TaskFeedback.js";
import type { ITaskRepository } from "./interfaces/ITaskRepo.js";
import type { TaskCategory } from "../../models/Task.js";
import { taskConverter, taskEventConverter, taskFeedbackConverter, taskPollConverter, taskSubmissionConverter } from "./converters.js";

export class TaskRepository extends GuildScopedRepository<Task> implements ITaskRepository {
    constructor(db: Firestore, guildId: string) {
        super(db, guildId, 'tasks', taskConverter);
    }

    // Fetch single task by ID
    async getTaskById(id: string): Promise<Task | null> {
        return await this.getById(id);
    }

    // Fetch all tasks
    async getAllTasks(): Promise<Task[]> {
        return await this.getAll();
    }

    async createTask(task: Task): Promise<void> {
        await this.collection.doc(task.id).set(task, { merge: true });
    }

    // Fetch all tasks of a specific category
    async getTasksByCategory(category: string): Promise<Task[]> {
        const snapshot = await this.collection.where("category", "==", category).get();
        return snapshot.docs.map(doc => doc.data());
    }

    private get pollsCollection() {
        return this.guildCollection('taskPolls', taskPollConverter);
    }

    async createTaskPoll(poll: TaskPoll): Promise<void> {
        await this.pollsCollection.doc(poll.id).set(poll);
    }

    async getTaskPollById(pollId: string): Promise<TaskPoll | null> {
        const doc = await this.pollsCollection.doc(pollId).get();
        return doc.data() ?? null;
    }

    async getActiveTaskPollByCategory(category: TaskCategory): Promise<TaskPoll | null> {
        const snapshot = await this.pollsCollection
            .where('category', '==', category)
            .where('isActive', '==', true)
            .limit(1)
            .get();

        return snapshot.docs[0]?.data() ?? null;
    }

    async getLatestTaskPollByCategory(category: TaskCategory): Promise<TaskPoll | null> {
        const snapshot = await this.pollsCollection
            .where('category', '==', category)
            .orderBy('createdAt', 'desc')
            .limit(1)
            .get();

        return snapshot.docs[0]?.data() ?? null;
    }

    async closeTaskPoll(pollId: string): Promise<void> {
        const docRef = this.pollsCollection.doc(pollId);
        await docRef.update({
            isActive: false,
            closedAt: new Date(),
        });
    }

    async clearTaskPolls(): Promise<void> {
        const snapshot = await this.pollsCollection.get();
        const batch = this.db.batch();
        snapshot.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
    }

    private get eventsCollection() {
        return this.guildCollection('taskEvents', taskEventConverter);
    }

    async createTaskEvent(event: TaskEvent): Promise<void> {
        await this.eventsCollection.doc(event.id).set(event);
    }

    async getTaskEventById(id: string): Promise<TaskEvent | null> {
        const doc = await this.eventsCollection.doc(id).get();
        return doc.data() ?? null;
    }

    async getLatestTaskEvent(): Promise<TaskEvent | null> {
        const snapshot = await this.eventsCollection
            .orderBy("createdAt", "desc")
            .limit(1)
            .get();

        return snapshot.docs[0]?.data() ?? null;
    }

    async getTaskEventsBetween(start: Date, end: Date): Promise<TaskEvent[]> {
        const snapshot = await this.eventsCollection
            .where("endTime", ">=", start)
            .where("endTime", "<=", end)
            .get();

        return snapshot.docs.map((doc) => doc.data());
    }
    async addCompletedUser(taskEventId: string, userId: string): Promise<void> {
        await this.eventsCollection.doc(taskEventId).set(
            {
                completedUserIds: FieldValue.arrayUnion(userId),
            },
            { merge: true }
        );
    }

    async removeCompletedUser(taskEventId: string, userId: string): Promise<void> {
        await this.eventsCollection.doc(taskEventId).set(
            {
                completedUserIds: FieldValue.arrayRemove(userId),
            },
            { merge: true }
        );
    }

    private get submissionsCollection() {
        return this.guildCollection('taskSubmissions', taskSubmissionConverter);
    }

    async createSubmission(submission: TaskSubmission): Promise<void> {
        await this.submissionsCollection.doc(submission.id).set(submission);
    }

    async getSubmissionById(submissionId: string): Promise<TaskSubmission | null> {
        const doc = await this.submissionsCollection.doc(submissionId).get();
        return doc.data() ?? null;
    }

    async getSubmissionsForTask(taskId: string): Promise<TaskSubmission[]> {
        const snapshot = await this.submissionsCollection.where('taskEventId', '==', taskId).get();
        return snapshot.docs.map(doc => doc.data());
    }

    async getSubmissionsByUser(userId: string): Promise<TaskSubmission[]> {
        const snapshot = await this.submissionsCollection.where('userId', '==', userId).get();
        return snapshot.docs.map(doc => doc.data());
    }

    async getSubmissionByUserAndTask(userId: string, taskEventId: string): Promise<TaskSubmission | null> {
        const snapshot = await this.submissionsCollection
            .where('userId', '==', userId)
            .where('taskEventId', '==', taskEventId)
            .where('status', 'in', [SubmissionStatus.Bronze, SubmissionStatus.Silver, SubmissionStatus.Gold])
            .orderBy('reviewedAt', 'desc')
            .limit(1)
            .get();

        return snapshot.docs[0]?.data() ?? null;
    }

    async updateSubmissionStatus(
        submissionId: string,
        status: "pending" | "approved" | "rejected" | "bronze" | "silver" | "gold",
        reviewedBy: string
    ): Promise<void> {
        const docRef = this.submissionsCollection.doc(submissionId);
        await docRef.update({
            status,
            reviewedBy,
            reviewedAt: new Date(),
        });
    }

    private get feedbackCollection() {
        return this.guildCollection('taskFeedback', taskFeedbackConverter);
    }

    // Records a member's 👍/👎 on a task and moves the task's weight by the change, in one transaction so that two
    // clicks at once are counted once. Each member has one vote per task, stored under a predictable id.
    async recordFeedback(feedback: Omit<TaskFeedback, "id">): Promise<TaskFeedbackOutcome> {
        const { taskId, userId, vote } = feedback;
        const taskRef = this.collection.doc(taskId);
        const voteRef = this.feedbackCollection.doc(`${taskId}_${userId}`);

        return this.db.runTransaction(async (transaction) => {
            const task = await transaction.get(taskRef);
            if (!task.exists) return "taskNotFound";

            const stored = await transaction.get(voteRef);
            // Votes cast before each member had one vote document per task were stored under other ids
            const legacy = stored.exists
                ? []
                : (await transaction.get(this.feedbackCollection.where("taskId", "==", taskId).where("userId", "==", userId))).docs;
            const previous = stored.data()?.vote ?? legacy[0]?.data().vote;
            if (previous === vote) return "unchanged";

            const step = vote === "up" ? 1 : -1;
            transaction.set(voteRef, { ...feedback, id: voteRef.id });
            for (const old of legacy) transaction.delete(old.ref);
            // Changing a vote undoes the old one as well as adding the new one
            transaction.update(taskRef, { weight: FieldValue.increment(previous ? 2 * step : step) });
            return previous ? "changed" : "added";
        });
    }

    async deleteAllTasks(): Promise<void> {
        const snapshot = await this.collection.get();
        const batch = this.db.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
    }

    async seedTasks(tasks: Task[]): Promise<void> {
        // Firestore caps a batch at 500 writes
        for (let start = 0; start < tasks.length; start += 500) {
            const batch = this.db.batch();
            tasks.slice(start, start + 500).forEach(task => {
                batch.set(this.collection.doc(task.id), task);
            });
            await batch.commit();
        }
    }

    async voteInPollOnce(pollId: string, userId: string, optionId: string): Promise<{ firstTime: boolean, updatedPoll: TaskPoll; }> {
        const pollRef = this.pollsCollection.doc(pollId);
        return this.db.runTransaction(async (tx) => {
            const snap = await tx.get(pollRef);
            const poll = snap.data();
            if (!poll) throw new Error("Poll not found.");

            poll.votes = poll.votes ?? {};
            const firstTime = !poll.votes[userId];

            poll.votes[userId] = optionId;
            tx.set(pollRef, poll, { merge: true });

            return { firstTime, updatedPoll: poll };
        });
    }
}
