import type Fuse from "fuse.js";
import type { Task } from "../../../models/Task.js";
import type { TaskPoll } from "../../../models/TaskPoll.js";
import type {
    SubmissionReview,
    SubmissionReviewOutcome,
    SubmissionTier,
    TaskSubmission,
    TaskSubmissionDraft,
} from "../../../models/TaskSubmission.js";
import type { TaskEvent } from "../../../models/TaskEvent.js";
import type { TaskFeedback, TaskFeedbackOutcome } from "../../../models/TaskFeedback.js";
import type { TaskCategory } from "../../../models/Task.js";

export interface ITaskRepository {
    getAllTasks(): Promise<Task[]>;
    getTaskSearch(): Promise<Fuse<Task>>;
    getTaskById(id: string): Promise<Task | null>;
    createTask(task: Task): Promise<void>;
    addTask(task: Task): Promise<boolean>;
    getTasksByCategory(category: string): Promise<Task[]>;

    // Task polls
    createTaskPoll(poll: TaskPoll): Promise<void>;
    getTaskPollById(pollId: string): Promise<TaskPoll | null>;
    getActiveTaskPollByCategory(category: TaskCategory): Promise<TaskPoll | null>;
    getLatestTaskPollByCategory(category: TaskCategory): Promise<TaskPoll | null>;
    updateTaskPollOptions(pollId: string, options: TaskPoll["options"]): Promise<void>;
    closeTaskPoll(pollId: string): Promise<void>;
    clearTaskPolls(): Promise<void>;

    // Task events
    createTaskEvent(event: TaskEvent): Promise<void>;
    getLatestTaskEvent(): Promise<TaskEvent | null>;
    getTaskEventById(id: string): Promise<TaskEvent | null>;
    getTaskEventsBetween(start: Date, end: Date): Promise<TaskEvent[]>;
    updateTaskEventTask(taskEventId: string, task: TaskEvent["task"], amounts: TaskEvent["amounts"]): Promise<void>;

    // Submissions
    newSubmissionId(): string;
    createSubmission(submission: TaskSubmission): Promise<void>;
    getSubmissionById(submissionId: string): Promise<TaskSubmission | null>;
    getSubmissionsForTask(taskId: string): Promise<TaskSubmission[]>;
    getSubmissionsByUser(userId: string): Promise<TaskSubmission[]>;
    getHeldTier(userId: string, taskEventId: string): Promise<SubmissionTier | null>;
    saveSubmissionDraft(draft: TaskSubmissionDraft): Promise<void>;
    getSubmissionDraft(userId: string): Promise<TaskSubmissionDraft | null>;
    deleteSubmissionDraft(userId: string): Promise<void>;
    submitDraft(submission: TaskSubmission): Promise<boolean>;
    reviewSubmission(review: SubmissionReview): Promise<SubmissionReviewOutcome>;

    // Feedback
    recordFeedback(feedback: Omit<TaskFeedback, "id">): Promise<TaskFeedbackOutcome>;

    // Utilities
    deleteAllTasks(): Promise<void>;
    seedTasks(tasks: Task[]): Promise<void>;
    voteInPollOnce(
        pollId: string,
        userId: string,
        optionId: string,
    ): Promise<{ firstTime: boolean; updatedPoll: TaskPoll }>;
}
