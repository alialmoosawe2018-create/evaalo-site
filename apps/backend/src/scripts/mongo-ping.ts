/**
 * اختبار اتصال MongoDB بنفس MONGODB_URI في apps/backend/.env
 * (مثل ping في Atlas؛ يكشف إن كان الرابط يحتوي <db_password> بالخطأ)
 */
import path from 'path';
import { fileURLToPath } from 'url';

import dotenv from 'dotenv';
import mongoose from 'mongoose';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function main(): Promise<void> {
    const uri = process.env.MONGODB_URI?.trim();
    if (!uri) {
        console.error('❌ MONGODB_URI غير مضبوط في apps/backend/.env');
        process.exit(1);
    }
    if (uri.includes('<') || uri.includes('>') || /db_password/i.test(uri)) {
        console.error(
            '❌ الرابط يحتوي عنصراً نائباً (مثل <db_password>). استبدل <db_password> بكلمة المرور فقط، بدون < أو > أو =.'
        );
        process.exit(1);
    }

    console.log('📡 URI:', uri.replace(/:([^:@]+)@/, ':****@'));
    await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 30_000,
        connectTimeoutMS: 25_000,
    });
    await mongoose.connection.db?.admin().command({ ping: 1 });
    console.log('✅ Pinged your deployment. You successfully connected to MongoDB!');
    await mongoose.disconnect();
}

main().catch((err) => {
    console.error('❌ فشل الاتصال:', err?.message || err);
    process.exit(1);
});
