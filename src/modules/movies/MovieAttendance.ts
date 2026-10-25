import type { Client, VoiceState } from 'discord.js';

export const MIN_ATTENDANCE_MS = 30 * 60 * 1000; // 30 mins

interface Session {
    joinedAt: number | null;
    totalMs: number;
}

interface Tracking {
    eventId: string;
    channelId: string | null;
    sessions: Map<string, Session>;
}

export class MovieAttendance {
    private tracking: Tracking | null = null;

    isTracking(eventId: string): boolean {
        return this.tracking?.eventId === eventId;
    }

    start(eventId: string, channelId: string | null, memberIds: string[], at: Date): void {
        const sessions = new Map<string, Session>();
        for (const userId of memberIds) sessions.set(userId, { joinedAt: at.getTime(), totalMs: 0 });
        this.tracking = { eventId, channelId, sessions };
        console.log(channelId
            ? `[MovieAttendance] Tracking ${memberIds.length} member(s) in ${channelId} for ${eventId}.`
            : `[MovieAttendance] No voice channel for ${eventId}; attendance isn't counted.`);
    }

    voiceStateChanged(oldState: VoiceState, newState: VoiceState): void {
        const channelId = this.tracking?.channelId;
        if (!channelId) return;
        const at = Date.now();
        if (newState.channelId === channelId && oldState.channelId !== channelId) this.join(newState.id, at);
        if (oldState.channelId === channelId && newState.channelId !== channelId) this.leave(newState.id, at);
    }

    reconcile(memberIds: string[], at: Date): void {
        if (!this.tracking?.channelId) return;
        const present = new Set(memberIds);
        for (const userId of present) this.join(userId, at.getTime());
        for (const [userId, session] of this.tracking.sessions) {
            if (session.joinedAt !== null && !present.has(userId)) this.leave(userId, at.getTime());
        }
    }

    finish(eventId: string, at: Date): string[] {
        if (!this.isTracking(eventId)) return [];
        const attendees = [...this.tracking!.sessions].flatMap(([userId, session]) => {
            const watchedMs = session.totalMs + (session.joinedAt !== null ? at.getTime() - session.joinedAt : 0);
            return watchedMs >= MIN_ATTENDANCE_MS ? [userId] : [];
        });
        this.tracking = null;
        return attendees;
    }

    stop(): void {
        this.tracking = null;
    }

    private join(userId: string, at: number): void {
        const session = this.tracking!.sessions.get(userId);
        if (!session) {
            this.tracking!.sessions.set(userId, { joinedAt: at, totalMs: 0 });
        } else if (session.joinedAt === null) {
            session.joinedAt = at;
        }
    }

    private leave(userId: string, at: number): void {
        const session = this.tracking!.sessions.get(userId);
        if (session?.joinedAt == null) return;
        session.totalMs += at - session.joinedAt;
        session.joinedAt = null;
    }
}

export async function getActiveVoiceMemberIds(client: Client, channelId: string): Promise<string[]> {
    const channel = await client.channels.fetch(channelId).catch((err: unknown) => {
        console.warn(`[MovieAttendance] Failed to inspect voice channel ${channelId}:`, err);
        return null;
    });
    return channel?.isVoiceBased() ? [...channel.members.keys()] : [];
}
