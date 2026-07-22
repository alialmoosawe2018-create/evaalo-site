/**
 * Persistent org chart per organization (source of truth for the Chart page).
 *
 * One document per org. `departments` holds the same nested shape the frontend
 * uses: [{ id, name, positions: [{ id, name, position, subordinates: [...], layout }] }].
 * Stored as Mixed because the position tree is recursive and UI-owned; the API
 * validates only the top-level shape (departments must be an array).
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface IOrgChart extends Document {
    organizationId: string;
    departments: unknown[];
    updatedByClerkUserId?: string;
    createdAt: Date;
    updatedAt: Date;
}

const OrgChartSchema = new Schema<IOrgChart>(
    {
        organizationId: {
            type: String,
            required: true,
            unique: true,
            index: true,
            trim: true,
        },
        departments: {
            type: [Schema.Types.Mixed],
            default: [],
        },
        updatedByClerkUserId: { type: String, trim: true },
    },
    { timestamps: true, collection: 'org_charts', minimize: false },
);

export default mongoose.model<IOrgChart>('OrgChart', OrgChartSchema);
