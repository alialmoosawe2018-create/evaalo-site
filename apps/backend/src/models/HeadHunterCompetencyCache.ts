// ============================================
// ملف: models/HeadHunterCompetencyCache.ts
// نموذج كفاءات الهيد هانتر — مخزَّن بدل ذاكرة العملية
// ============================================
//
// Why this collection exists (2026-09-16).
//
// The competency model was cached in a process-local Map. That made a search's
// ranking depend on whether an unrelated background LLM call had finished:
// the FIRST search of a role shipped no competencies (the curated pack does not
// match every role, and the LLM upgrade takes 76-110s and can never sit on the
// request path), while a repeat search minutes later shipped the full model and
// ranked far more strictly. Measured in production on 2026-09-16: execution
// 1868 at 17:52:48 went out with no model, the upgrade landed at 17:54:28, and
// execution 1869 at 17:59:34 — identical criteria — ranked against eight
// competencies and returned fewer, better candidates.
//
// A process-local Map also dies on every deploy, so each release silently reset
// every role to that cold first search. Persisting it means a role is generated
// once and stays generated, across restarts and across instances.
//
// Mongo is a cache here, never a source of truth: every read is wrapped and a
// failure falls back to the in-memory copy and then to the pack, exactly as
// before. Nothing in the search path may throw because of this collection.

import mongoose, { Schema, type Document } from 'mongoose';

export interface IHeadHunterCompetencyCache extends Document {
    cacheKey: string;
    /** The snapshot as it is sent to n8n. Shape owned by headHunterCompetencyModel.ts. */
    snapshot: Record<string, unknown>;
    competencyCount: number;
    expiresAt: Date;
    createdAt: Date;
    updatedAt: Date;
}

const HeadHunterCompetencyCacheSchema = new Schema<IHeadHunterCompetencyCache>(
    {
        // Role + the criteria that shape the role (not the filters that merely
        // narrow who matches) — see ROLE_SHAPING_KEYS in the service.
        cacheKey: { type: String, required: true, unique: true },
        snapshot: { type: Schema.Types.Mixed, required: true },
        // Denormalised so a zero-competency row can be spotted without parsing
        // the blob; an empty model must never be stored in the first place.
        competencyCount: { type: Number, required: true, default: 0 },
        expiresAt: { type: Date, required: true },
    },
    { timestamps: true, collection: 'head_hunter_competency_cache' }
);

// TTL — Mongo يحذف السجلات التي تجاوزت expiresAt تلقائياً.
HeadHunterCompetencyCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model<IHeadHunterCompetencyCache>(
    'HeadHunterCompetencyCache',
    HeadHunterCompetencyCacheSchema
);
