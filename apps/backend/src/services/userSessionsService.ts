/**
 * Active login sessions for the signed-in user, sourced from the Clerk Backend API.
 *
 * Clerk's frontend SDK only ever exposes the session of the browser making the
 * request, which is why the account page used to list a single synthesized
 * device. The Backend API is the only place that can enumerate a user's sessions
 * across devices, so listing and revoking both go through here.
 */

import { clerkClient } from '@clerk/express';

export interface UserSessionRow {
    id: string;
    current: boolean;
    browserName?: string;
    deviceType?: string;
    isMobile: boolean;
    ipAddress?: string;
    city?: string;
    country?: string;
    lastActiveAt: string;
    createdAt: string;
}

export class ClerkNotConfiguredError extends Error {
    constructor() {
        super('CLERK_NOT_CONFIGURED');
        this.name = 'ClerkNotConfiguredError';
    }
}

export class SessionNotOwnedError extends Error {
    constructor() {
        super('SESSION_NOT_OWNED');
        this.name = 'SessionNotOwnedError';
    }
}

export function isClerkConfigured(): boolean {
    return Boolean(process.env.CLERK_SECRET_KEY?.trim());
}

function toIso(value: number | undefined): string {
    return new Date(value ?? Date.now()).toISOString();
}

export async function listUserSessions(
    clerkUserId: string,
    currentSessionId?: string
): Promise<UserSessionRow[]> {
    if (!isClerkConfigured()) throw new ClerkNotConfiguredError();

    const response = await clerkClient.sessions.getSessionList({
        userId: clerkUserId,
        status: 'active',
        limit: 100,
    });

    const rows = response.data.map((session) => {
        const activity = session.latestActivity;
        return {
            id: session.id,
            current: Boolean(currentSessionId) && session.id === currentSessionId,
            browserName: activity?.browserName || undefined,
            deviceType: activity?.deviceType || undefined,
            isMobile: Boolean(activity?.isMobile),
            ipAddress: activity?.ipAddress || undefined,
            city: activity?.city || undefined,
            country: activity?.country || undefined,
            lastActiveAt: toIso(session.lastActiveAt),
            createdAt: toIso(session.createdAt),
        } satisfies UserSessionRow;
    });

    // Current device first, then most recently active.
    rows.sort((a, b) => {
        if (a.current !== b.current) return a.current ? -1 : 1;
        return b.lastActiveAt.localeCompare(a.lastActiveAt);
    });
    return rows;
}

/**
 * Revoke one session. The ownership check is the security boundary here — the
 * session id arrives from the client, so without it any signed-in user could
 * sign out any other user.
 */
export async function revokeUserSession(
    clerkUserId: string,
    sessionId: string
): Promise<void> {
    if (!isClerkConfigured()) throw new ClerkNotConfiguredError();

    const session = await clerkClient.sessions.getSession(sessionId);
    if (session.userId !== clerkUserId) throw new SessionNotOwnedError();

    await clerkClient.sessions.revokeSession(sessionId);
}
