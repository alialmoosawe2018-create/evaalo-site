// ============================================
// ملف: check-db-connection.ts
// الوظيفة: التحقق من حالة الاتصال بقاعدة البيانات
// ============================================

import { connectDatabase, checkDatabaseConnection, testDatabaseConnection } from '../config/database.js';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
    console.log('🔍 التحقق من حالة الاتصال بقاعدة البيانات...\n');
    
    // التحقق من الحالة الحالية
    const currentStatus = checkDatabaseConnection();
    console.log('📊 الحالة الحالية:');
    console.log(`   - متصل: ${currentStatus.isConnected ? '✅ نعم' : '❌ لا'}`);
    console.log(`   - الحالة: ${currentStatus.state}`);
    console.log(`   - ReadyState: ${currentStatus.readyState}`);
    if (currentStatus.databaseName) {
        console.log(`   - اسم قاعدة البيانات: ${currentStatus.databaseName}`);
    }
    console.log('');
    
    // محاولة الاتصال إذا لم يكن متصلاً
    if (!currentStatus.isConnected) {
        console.log('🔄 محاولة الاتصال بقاعدة البيانات...\n');
        try {
            await connectDatabase();
            const newStatus = checkDatabaseConnection();
            console.log('\n✅ تم الاتصال بنجاح!');
            console.log(`📊 الحالة الجديدة: ${newStatus.state}`);
            if (newStatus.databaseName) {
                console.log(`📊 قاعدة البيانات: ${newStatus.databaseName}`);
            }
        } catch (error: any) {
            console.error('\n❌ فشل الاتصال بقاعدة البيانات');
            console.error(`   الخطأ: ${error.message}`);
            process.exit(1);
        }
    } else {
        // اختبار الاتصال للتأكد من أنه يعمل
        console.log('🧪 اختبار الاتصال...');
        const isWorking = await testDatabaseConnection();
        if (isWorking) {
            console.log('✅ الاتصال يعمل بشكل صحيح!');
        } else {
            console.log('❌ الاتصال موجود لكن لا يعمل بشكل صحيح');
            process.exit(1);
        }
    }
    
    console.log('\n✨ اكتمل التحقق من الاتصال');
    process.exit(0);
}

main().catch((error) => {
    console.error('❌ خطأ غير متوقع:', error);
    process.exit(1);
});


