// ============================================
// ملف: models/HeadHunterSearchHistory.ts
// سجلّ بحوث الهيد هانتر — على الخادم بدل متصفّح واحد
// ============================================
//
// Why this collection exists (2026-09-16).
//
// Head-hunter searches were the ONLY product artefact that never reached the
// database. Campaigns, candidates and evaluations are all stored; the search
// history lived in `localStorage` under a key suffixed with the USER id, so it
// was invisible from another device, invisible after clearing site data, and
// invisible when the same person signed in with a second account — which is
// exactly how the owner lost sight of three searches on 2026-09-16. Every one of
// those searches costs credits, so losing the result is losing money already
// spent.
//
// SCOPE IS THE ORGANIZATION, not the user. That is the tenancy rule everywhere
// else in this codebase, and a search paid for by an org belongs to the org: a
// colleague who takes over the role should see it. The originating user is kept
// on the row for attribution, never for filtering.
//
// No TTL. Durability is the entire point of moving this off the browser. Volume
// is bounded per organization instead — see MAX_HISTORY_PER_ORG in the routes.

import mongoose, { Schema, type Document } from 'mongoose';

export interface IHeadHunterSearchHistory extends Document {
    organizationId: string;
    /** The id the client minted for this row; stable across updates. */
    entryId: string;
    /** The n8n search this row reports on, when there is one. */
    searchId?: string;
    position: string;
    location: string;
    yearsExperience?: string;
    ageRange?: string;
    query?: string;
    minCandidateCount?: number;
    aiCompareTop?: boolean;
    availableEmployeesOnly?: boolean;
    arabicTranslation?: boolean;
    /** When the result came back — what the list is ordered by. */
    receivedAt: Date;
    /** The candidate set as the UI received it. Shape owned by the front end. */
    payload?: unknown;
    createdByClerkUserId?: string;
    createdAt: Date;
    updatedAt: Date;
}

const HeadHunterSearchHistorySchema = new Schema<IHeadHunterSearchHistory>(
    {
        organizationId: { type: String, required: true },
        entryId: { type: String, required: true },
        searchId: { type: String },
        position: { type: String, required: true },
        location: { type: String, default: '' },
        yearsExperience: { type: String },
        ageRange: { type: String },
        query: { type: String },
        minCandidateCount: { type: Number },
        aiCompareTop: { type: Boolean },
        availableEmployeesOnly: { type: Boolean },
        arabicTranslation: { type: Boolean },
        receivedAt: { type: Date, required: true },
        payload: { type: Schema.Types.Mixed },
        createdByClerkUserId: { type: String },
    },
    { timestamps: true, collection: 'head_hunter_search_history' }
);

// The row identity within a tenant. Unique so a retry or a double-click updates
// rather than duplicating, and so the import of an old browser's history is
// naturally idempotent.
HeadHunterSearchHistorySchema.index({ organizationId: 1, entryId: 1 }, { unique: true });
// The live search stream upserts by searchId while results are still arriving.
HeadHunterSearchHistorySchema.index({ organizationId: 1, searchId: 1 });
// The list the page renders: newest first, within one tenant.
HeadHunterSearchHistorySchema.index({ organizationId: 1, receivedAt: -1 });

export default mongoose.model<IHeadHunterSearchHistory>(
    'HeadHunterSearchHistory',
    HeadHunterSearchHistorySchema
);
