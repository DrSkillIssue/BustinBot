export interface TaskFeedback {
    id: string;
    taskId: string;
    eventId: string;
    userId: string;
    vote: "up" | "down";
}

export type TaskFeedbackOutcome = "added" | "changed" | "unchanged" | "taskNotFound";
