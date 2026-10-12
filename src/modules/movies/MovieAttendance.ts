import type { Client, VoiceState } from 'discord.js';

export const MIN_ATTENDANCE_MS = 30 * 60 * 1000; // 30 mins

interface Session {
    // When the member last joined the voice channel, or null while they are out of it
    joinedAt: number | null;
    // Time spent in the channel before that
    totalMs: number;
}

interface Tracking {
    eventId: string;
    // The movie night's voice channel, or null when none is configured and nothing can be counted
    channelId: string | null;
    sessions: Map<string, Session>;
}

// Who watches a guild's movie night: the time each member spends in its voice channel from when its movie is picked.
// Each guild has its own. The scheduler's sweep starts it once the movie is picked with the members already in the
// channel, keeps it
// in line with the channel every minute, and finishes it when the night ends; voice events record joins and leaves
// in between. A restart starts it again from the members in the channel at that moment.
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

    // Brings the sessions in line with who is in the channel, in case a voice event was missed
    reconcile(memberIds: string[], at: Date): void {
        if (!this.tracking?.channelId) return;
        const present = new Set(memberIds);
        for (const userId of present) this.join(userId, at.getTime());
        for (const [userId, session] of this.tracking.sessions) {
            if (session.joinedAt !== null && !present.has(userId)) this.leave(userId, at.getTime());
        }
    }

    // Stops counting and returns the members who watched at least 30 minutes of the given movie night
    finish(eventId: string, at: Date): string[] {
        if (!this.isTracking(eventId)) return [];
        const attendees = [...this.tracking!.sessions].flatMap(([userId, session]) => {
            const watchedMs = session.totalMs + (session.joinedAt !== null ? at.getTime() - session.joinedAt : 0);
            return watchedMs >= MIN_ATTENDANCE_MS ? [userId] : [];
        });
        this.tracking = null;
        return attendees;
    }

    // Stops counting without recording anyone, when a movie night is cancelled or replaced
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

// The members in a voice channel, as discord.js knows them from voice state events
export async function getActiveVoiceMemberIds(client: Client, channelId: string): Promise<string[]> {
    const channel = await client.channels.fetch(channelId).catch((err: unknown) => {
        console.warn(`[MovieAttendance] Failed to inspect voice channel ${channelId}:`, err);
        return null;
    });
    return channel?.isVoiceBased() ? [...channel.members.keys()] : [];
}
