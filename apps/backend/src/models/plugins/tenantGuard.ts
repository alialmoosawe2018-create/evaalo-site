/**
 * Tenant-isolation guard (Mongoose plugin).
 *
 * Converts multi-tenant isolation from "every caller must remember orgScopedQuery"
 * into a database-layer safety net. When a query against a tenant-scoped collection
 * runs WITHOUT an organizationId (and without a globally-unique safe key or an
 * explicit bypass), the guard reacts.
 *
 * Modes (env TENANT_GUARD):
 *   - unset / anything else → WARN once per Model.op signature (safe default).
 *   - 'strict'             → THROW (use in CI / tenant-isolation tests).
 *   - 'off'                → disabled entirely.
 *
 * A query is considered SAFE (guard skipped) when its filter references any of:
 *   - `_id` or `organizationId` (always safe),
 *   - one of the model's configured `safeKeys` (globally-unique alternates, e.g.
 *     `applicationId`, `sessionId`, `campaignId`),
 *   - or the call opts out with `.setOptions({ skipTenantGuard: true })`
 *     (system jobs / webhook reverse-lookups).
 *
 * Only genuine unscoped scans (list/update/delete without org and without a unique
 * key) trip the guard — exactly the cross-tenant-leak shape.
 */

import type { Schema } from 'mongoose';

export type TenantGuardOptions = {
    /** Globally-unique alternate keys whose presence makes a query intentionally single-tenant. */
    safeKeys?: string[];
};

const GUARD_OPS = [
    'count',
    'countDocuments',
    'find',
    'findOne',
    'findOneAndUpdate',
    'findOneAndDelete',
    'findOneAndReplace',
    'updateOne',
    'updateMany',
    'deleteOne',
    'deleteMany',
    'replaceOne',
] as const;

function mode(): 'off' | 'strict' | 'warn' {
    const v = String(process.env.TENANT_GUARD || '').toLowerCase();
    if (v === 'off') return 'off';
    if (v === 'strict') return 'strict';
    return 'warn';
}

// Warn once per unique Model.op signature to avoid log spam.
const warned = new Set<string>();

function filterHasKey(filter: unknown, keys: string[]): boolean {
    if (!filter || typeof filter !== 'object') return false;
    const obj = filter as Record<string, unknown>;
    for (const k of keys) {
        if (Object.prototype.hasOwnProperty.call(obj, k)) return true;
    }
    // Honor top-level $and/$or that scope inside a combinator.
    for (const c of ['$and', '$or'] as const) {
        const arr = obj[c];
        if (Array.isArray(arr) && arr.some((sub) => filterHasKey(sub, keys))) return true;
    }
    return false;
}

function report(signature: string, message: string): void {
    const m = mode();
    if (m === 'off') return;
    if (m === 'strict') {
        throw new Error(message);
    }
    if (!warned.has(signature)) {
        warned.add(signature);
        console.warn(message);
    }
}

export function tenantGuardPlugin(schema: Schema, options: TenantGuardOptions = {}): void {
    const safeKeys = ['_id', 'organizationId', ...(options.safeKeys || [])];

    function checkQuery(this: any): void {
        if (mode() === 'off') return;
        if (this.getOptions && this.getOptions().skipTenantGuard) return;
        const filter = this.getFilter ? this.getFilter() : this._conditions;
        if (filterHasKey(filter, safeKeys)) return;

        const model = (this.model && this.model.modelName) || 'UnknownModel';
        const op = this.op || 'query';
        const signature = `${model}.${op}`;
        report(
            signature,
            `[tenantGuard] ${signature} ran without organizationId or a safe unique key ` +
                `(${safeKeys.join(', ')}). Cross-tenant scan risk — scope the query or pass ` +
                `{ skipTenantGuard: true } if intentional.`,
        );
    }

    for (const op of GUARD_OPS) {
        // Array form has fragile typings across mongoose versions; register per-op.
        schema.pre(op as any, checkQuery);
    }

    schema.pre('aggregate', function (this: any): void {
        if (mode() === 'off') return;
        if (this.options && this.options.skipTenantGuard) return;
        const pipeline: unknown[] = (this.pipeline && this.pipeline()) || [];
        const firstMatch = pipeline.find(
            (s) => s && typeof s === 'object' && '$match' in (s as Record<string, unknown>),
        ) as { $match?: unknown } | undefined;
        if (filterHasKey(firstMatch?.$match, safeKeys)) return;

        const model = (this._model && this._model.modelName) || 'UnknownModel';
        const signature = `${model}.aggregate`;
        report(
            signature,
            `[tenantGuard] ${signature} ran without an organizationId $match ` +
                `(cross-tenant scan risk). Add a scoped $match or pass { skipTenantGuard: true }.`,
        );
    });
}
