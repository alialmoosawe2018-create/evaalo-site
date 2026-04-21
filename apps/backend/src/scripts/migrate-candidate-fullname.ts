/**
 * ترحيل لمرة واحدة لمجموعة candidates:
 * - نقل الحقول من camelCase إلى snake_case (مع الإبقاء على القيم الحالية في snake_case إن وُجدت)
 * - دمج firstName + lastName → full_name عند الحاجة
 *
 * تشغيل: npx tsx src/scripts/migrate-candidate-fullname.ts
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const LEGACY_TO_SNAKE: [string, string][] = [
    ['fullName', 'full_name'],
    ['positionAppliedFor', 'position_applied_for'],
    ['companyAppliedTo', 'company_applied_to'],
    ['yearsOfExperience', 'years_of_experience'],
    ['currentCompany', 'current_company'],
    ['highestEducationLevel', 'highest_education_level'],
];

async function main() {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/your-db';
    await mongoose.connect(uri);
    const col = mongoose.connection.collection('candidates');

    let n = 0;
    const cursor = col.find({});

    for await (const doc of cursor) {
        const d = doc as Record<string, unknown>;
        const $set: Record<string, unknown> = {};
        const $unset: Record<string, ''> = {};

        for (const [legacy, modern] of LEGACY_TO_SNAKE) {
            const modernVal = d[modern];
            const hasModern =
                modernVal !== undefined &&
                modernVal !== null &&
                String(modernVal).trim() !== '';
            if (!hasModern && d[legacy] !== undefined && d[legacy] !== null) {
                const v = String(d[legacy]).trim();
                if (v) $set[modern] = d[legacy];
            }
            if (d[legacy] !== undefined) $unset[legacy] = '';
        }

        const fn = String(d.firstName ?? '').trim();
        const ln = String(d.lastName ?? '').trim();
        const fullExisting = String(d.full_name ?? d.fullName ?? '').trim();
        if (!fullExisting && (fn || ln)) {
            $set.full_name = [fn, ln].filter(Boolean).join(' ').trim() || 'Unknown';
        }
        if (d.firstName !== undefined) $unset.firstName = '';
        if (d.lastName !== undefined) $unset.lastName = '';

        const update: { $set?: Record<string, unknown>; $unset?: Record<string, ''> } = {};
        if (Object.keys($set).length) update.$set = $set;
        if (Object.keys($unset).length) update.$unset = $unset;

        if (Object.keys(update).length) {
            await col.updateOne({ _id: doc._id }, update);
            n++;
        }
    }

    console.log(`Updated ${n} candidate document(s) (snake_case + name merge).`);
    await mongoose.disconnect();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
