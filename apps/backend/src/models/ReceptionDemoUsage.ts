/**
 * عدّاد استخدام ديمو الرسبشن اليومي — لكل مفتاح (visitorId أو IP) بحسب اليوم (UTC).
 * قرار المالك: 3 جلسات يومياً لكل زائر بأي وقت يريدها (بدون فاصل زمني بين الجلسات).
 * TTL ثلاثة أيام — السجلات تحذف نفسها.
 */

import mongoose, { Schema, type Document } from 'mongoose';

export interface IReceptionDemoUsage extends Document {
    /** "v:<visitorId>" أو "ip:<address>" */
    key: string;
    /** يوم UTC بصيغة YYYY-MM-DD */
    day: string;
    count: number;
    createdAt: Date;
}

const ReceptionDemoUsageSchema = new Schema<IReceptionDemoUsage>(
    {
        key: { type: String, required: true },
        day: { type: String, required: true },
        count: { type: Number, default: 0 },
        createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 3 },
    },
    { collection: 'reception_demo_usage' }
);

ReceptionDemoUsageSchema.index({ key: 1, day: 1 }, { unique: true });

export default mongoose.model<IReceptionDemoUsage>(
    'ReceptionDemoUsage',
    ReceptionDemoUsageSchema
);
