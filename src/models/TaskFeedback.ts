export interface TaskFeedback {
    id: string;
    taskId: string;
    eventId: string;
    userId: string;
    vote: 'up' | 'down';
}

// What recording a member's vote on a task did
export type TaskFeedbackOutcome = "added" | "changed" | "unchanged" | "taskNotFound";
