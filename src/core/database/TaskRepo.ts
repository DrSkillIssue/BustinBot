import { FieldValue, type Firestore } from "firebase-admin/firestore";
import Fuse, { type IFuseOptions } from "fuse.js";
import { GuildScopedRepository } from "./CoreRepo.js";
import type { Task } from "../../models/Task.js";
import type { TaskPoll } from "../../models/TaskPoll.js";
import {
    SubmissionStatus,
    TIERS,
    highestTier,
    isTier,
    tierRank,
    type SubmissionReview,
    type SubmissionReviewOutcome,
    type SubmissionTier,
    type TaskSubmission,
    type TaskSubmissionDraft,
} from "../../models/TaskSubmission.js";
import type { TaskEvent } from "../../models/TaskEvent.js";
import type { TaskFeedback, TaskFeedbackOutcome } from "../../models/TaskFeedback.js";
import type { ITaskRepository } from "./interfaces/ITaskRepo.js";
import type { TaskCategory } from "../../models/Task.js";
import {
    taskConverter,
    taskEventConverter,
    taskFeedbackConverter,
    taskPollConverter,
    taskSubmissionConverter,
    taskSubmissionDraftConverter,
} from "./converters.js";

const TASK_SEARCH_OPTIONS: IFuseOptions<Task> = {
    keys: [
        { name: "id", weight: 0.5 },
        { name: "taskName", weight: 0.35 },
        { name: "shortName", weight: 0.15 },
    ],
    threshold: 0.35,
    ignoreLocation: true,
};

export class TaskRepository extends GuildScopedRepository<Task> implements ITaskRepository {
    private tasks: Task[] | null = null;
    private taskSearch: Fuse<Task> | null = null;

    constructor(db: Firestore, guildId: string) {
        super(db, guildId, "tasks", taskConverter);
    }

    // Fetch single task by ID
    async getTaskById(id: string): Promise<Task | null> {
        return await this.getById(id);
    }

    // Fetch all tasks
    async getAllTasks(): Promise<Task[]> {
        this.tasks ??= await this.getAll();
        return this.tasks;
    }

    async getTaskSearch(): Promise<Fuse<Task>> {
        this.taskSearch ??= new Fuse(await this.getAllTasks(), TASK_SEARCH_OPTIONS);
        return this.taskSearch;
    }

    async createTask(task: Task): Promise<void> {
        await this.collection.doc(task.id).set(task, { merge: true });
        if (!this.tasks) return;
        const index = this.tasks.findIndex((stored) => stored.id === task.id);
        if (index === -1) this.tasks.push(task);
        else this.tasks[index] = task;
        this.taskSearch?.setCollection(this.tasks);
    }

    async addTask(task: Task): Promise<boolean> {
        const added = await this.createIfAbsent(task.id, task);
        if (added && this.tasks) {
            this.tasks.push(task);
            this.taskSearch?.setCollection(this.tasks);
        }
        return added;
    }

    // Fetch all tasks of a specific category
    async getTasksByCategory(category: string): Promise<Task[]> {
        const snapshot = await this.collection.where("category", "==", category).get();
        return snapshot.docs.map((doc) => doc.data());
    }

    private get pollsCollection() {
        return this.guildCollection("taskPolls", taskPollConverter);
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
            .where("category", "==", category)
            .where("isActive", "==", true)
            .limit(1)
            .get();

        return snapshot.docs[0]?.data() ?? null;
    }

    async getLatestTaskPollByCategory(category: TaskCategory): Promise<TaskPoll | null> {
        const snapshot = await this.pollsCollection
            .where("category", "==", category)
            .orderBy("createdAt", "desc")
            .limit(1)
            .get();

        return snapshot.docs[0]?.data() ?? null;
    }

    async updateTaskPollOptions(pollId: string, options: TaskPoll["options"]): Promise<void> {
        await this.pollsCollection.doc(pollId).update({ options });
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
        return this.guildCollection("taskEvents", taskEventConverter);
    }

    async createTaskEvent(event: TaskEvent): Promise<void> {
        await this.eventsCollection.doc(event.id).set(event);
    }

    async getTaskEventById(id: string): Promise<TaskEvent | null> {
        const doc = await this.eventsCollection.doc(id).get();
        return doc.data() ?? null;
    }

    async getLatestTaskEvent(): Promise<TaskEvent | null> {
        const snapshot = await this.eventsCollection.orderBy("createdAt", "desc").limit(1).get();

        return snapshot.docs[0]?.data() ?? null;
    }

    async getTaskEventsBetween(start: Date, end: Date): Promise<TaskEvent[]> {
        const snapshot = await this.eventsCollection.where("endTime", ">=", start).where("endTime", "<=", end).get();

        return snapshot.docs.map((doc) => doc.data());
    }
    async updateTaskEventTask(
        taskEventId: string,
        task: TaskEvent["task"],
        amounts: TaskEvent["amounts"],
    ): Promise<void> {
        await this.eventsCollection.doc(taskEventId).update({ task, amounts });
    }

    private get submissionsCollection() {
        return this.guildCollection("taskSubmissions", taskSubmissionConverter);
    }

    private get draftsCollection() {
        return this.guildCollection("taskSubmissionDrafts", taskSubmissionDraftConverter);
    }

    newSubmissionId(): string {
        return this.submissionsCollection.doc().id;
    }

    async createSubmission(submission: TaskSubmission): Promise<void> {
        await this.submissionsCollection.doc(submission.id).set(submission);
    }

    async getSubmissionById(submissionId: string): Promise<TaskSubmission | null> {
        const doc = await this.submissionsCollection.doc(submissionId).get();
        return doc.data() ?? null;
    }

    async getSubmissionsForTask(taskId: string): Promise<TaskSubmission[]> {
        const snapshot = await this.submissionsCollection.where("taskEventId", "==", taskId).get();
        return snapshot.docs.map((doc) => doc.data());
    }

    async getSubmissionsByUser(userId: string): Promise<TaskSubmission[]> {
        const snapshot = await this.submissionsCollection.where("userId", "==", userId).get();
        return snapshot.docs.map((doc) => doc.data());
    }

    private approvedSubmissions(userId: string, taskEventId: string) {
        return this.submissionsCollection
            .where("userId", "==", userId)
            .where("taskEventId", "==", taskEventId)
            .where("status", "in", [...TIERS]);
    }

    async getHeldTier(userId: string, taskEventId: string): Promise<SubmissionTier | null> {
        const snapshot = await this.approvedSubmissions(userId, taskEventId).get();
        return highestTier(snapshot.docs.map((doc) => doc.data().status));
    }

    async saveSubmissionDraft(draft: TaskSubmissionDraft): Promise<void> {
        await this.draftsCollection.doc(draft.userId).set(draft);
    }

    async getSubmissionDraft(userId: string): Promise<TaskSubmissionDraft | null> {
        const doc = await this.draftsCollection.doc(userId).get();
        return doc.data() ?? null;
    }

    async deleteSubmissionDraft(userId: string): Promise<void> {
        await this.draftsCollection.doc(userId).delete();
    }

    async submitDraft(submission: TaskSubmission): Promise<boolean> {
        const draftRef = this.draftsCollection.doc(submission.userId);
        return this.db.runTransaction(async (transaction) => {
            const draft = (await transaction.get(draftRef)).data();
            if (draft?.taskEventId !== submission.taskEventId) return false;

            transaction.create(this.submissionsCollection.doc(submission.id), submission);
            transaction.delete(draftRef);
            return true;
        });
    }

    async reviewSubmission(review: SubmissionReview): Promise<SubmissionReviewOutcome> {
        const submissionRef = this.submissionsCollection.doc(review.submissionId);

        return this.db.runTransaction(async (transaction) => {
            const submission = (await transaction.get(submissionRef)).data();
            if (!submission) return { result: "notFound" };
            if (submission.status !== SubmissionStatus.Pending) return { result: "alreadyReviewed", submission };

            // Retrieve any previous submission by the same user for this task
            const approved = await transaction.get(this.approvedSubmissions(submission.userId, submission.taskEventId));
            const heldTier = highestTier(approved.docs.map((doc) => doc.data().status));

            // Update submission details
            const reviewed: TaskSubmission = {
                ...submission,
                status: review.decision,
                reviewedBy: review.reviewedBy,
                reviewedAt: new Date(),
                ...(review.decision === SubmissionStatus.Rejected
                    ? { rejectionReason: review.rejectionReason }
                    : { prizeRolls: 1 }),
            };
            // Persist updates
            transaction.set(submissionRef, reviewed);

            if (isTier(review.decision) && tierRank(review.decision) > tierRank(heldTier)) {
                transaction.update(this.eventsCollection.doc(submission.taskEventId), {
                    [`completionCounts.${review.decision}`]: FieldValue.increment(1),
                    ...(heldTier ? { [`completionCounts.${heldTier}`]: FieldValue.increment(-1) } : {}),
                    completedUserIds: FieldValue.arrayUnion(submission.userId),
                });
            }

            return { result: "reviewed", submission: reviewed, heldTier };
        });
    }

    private get feedbackCollection() {
        return this.guildCollection("taskFeedback", taskFeedbackConverter);
    }

    async recordFeedback(feedback: Omit<TaskFeedback, "id">): Promise<TaskFeedbackOutcome> {
        const { taskId, userId, vote } = feedback;
        const taskRef = this.collection.doc(taskId);
        const voteRef = this.feedbackCollection.doc(`${taskId}_${userId}`);
        const step = vote === "up" ? 1 : -1;

        const outcome = await this.db.runTransaction(async (transaction) => {
            const task = await transaction.get(taskRef);
            if (!task.exists) return "taskNotFound";

            const stored = await transaction.get(voteRef);
            // Votes cast before each member had one vote document per task were stored under other ids
            const legacy = stored.exists
                ? []
                : (
                      await transaction.get(
                          this.feedbackCollection.where("taskId", "==", taskId).where("userId", "==", userId),
                      )
                  ).docs;
            const previous = stored.data()?.vote ?? legacy[0]?.data().vote;
            // Same vote again
            if (previous === vote) return "unchanged";

            transaction.set(voteRef, { ...feedback, id: voteRef.id });
            for (const old of legacy) transaction.delete(old.ref);
            // Changing a vote undoes the old one as well as adding the new one
            transaction.update(taskRef, { weight: FieldValue.increment(previous ? 2 * step : step) });
            return previous ? "changed" : "added";
        });

        const kept = this.tasks?.find((stored) => stored.id === taskId);
        if (kept && (outcome === "added" || outcome === "changed")) {
            kept.weight = (kept.weight ?? 0) + (outcome === "changed" ? 2 * step : step);
        }
        return outcome;
    }

    async deleteAllTasks(): Promise<void> {
        const snapshot = await this.collection.get();
        const batch = this.db.batch();
        snapshot.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
        this.tasks = [];
        this.taskSearch?.setCollection(this.tasks);
    }

    async seedTasks(tasks: Task[]): Promise<void> {
        const batch = this.db.batch();
        for (const task of tasks) batch.set(this.collection.doc(task.id), task);
        await batch.commit();
        if (!this.tasks) return;
        for (const task of tasks) {
            const index = this.tasks.findIndex((stored) => stored.id === task.id);
            if (index === -1) this.tasks.push(task);
            else this.tasks[index] = task;
        }
        this.taskSearch?.setCollection(this.tasks);
    }

    async voteInPollOnce(
        pollId: string,
        userId: string,
        optionId: string,
    ): Promise<{ firstTime: boolean; updatedPoll: TaskPoll }> {
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
