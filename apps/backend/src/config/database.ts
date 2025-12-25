import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

// Connection String من MongoDB Atlas
// Username: alialmoosawe2018
// Password: A07820782M
// Connection String: mongodb+srv://alialmoosawe2018:<db_password>@cluster0.35tnfqd.mongodb.net/?appName=Cluster0
const getMongoDBUri = (): string => {
    const uri = process.env.MONGODB_URI;
    if (uri) {
        return uri;
    }
    
    // معلومات الاتصال المؤكدة
    const username = 'alialmoosawe2018';
    const password = 'A07820782M';
    const cluster = 'cluster0.35tnfqd.mongodb.net';
    const database = 'sample_mflix'; // يمكن تغييرها حسب الحاجة
    
    // استخدام encodeURIComponent لكلمة المرور لتجنب مشاكل الترميز
    const encodedPassword = encodeURIComponent(password);
    
    // بناء Connection String - يمكن إزالة اسم قاعدة البيانات إذا لم تكن محددة
    return `mongodb+srv://${username}:${encodedPassword}@${cluster}/${database}?retryWrites=true&w=majority&appName=Cluster0`;
};

const MONGODB_URI = getMongoDBUri();

export const connectDatabase = async (): Promise<void> => {
    try {
        console.log('🔄 Attempting to connect to MongoDB...');
        console.log('📡 Connection String:', MONGODB_URI.replace(/:[^:@]+@/, ':****@')); // Hide password
        
        await mongoose.connect(MONGODB_URI, {
            serverSelectionTimeoutMS: 15000, // 15 seconds timeout
            socketTimeoutMS: 45000,
            connectTimeoutMS: 15000,
        });
        
        console.log('✅ Connected to MongoDB successfully');
        console.log(`📊 Database: ${mongoose.connection.db?.databaseName}`);
        console.log(`🔗 Connection State: ${mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected'}`);
    } catch (error: any) {
        console.error('❌ MongoDB connection error:', error);
        console.error('Error details:', {
            name: error.name,
            message: error.message,
            code: error.code
        });
        
        // Provide helpful error messages
        if (error.name === 'MongoServerSelectionError' || error.code === 'ENOTFOUND') {
            console.error('💡 Possible solutions:');
            console.error('   1. Check your internet connection');
            console.error('   2. Verify your IP address is whitelisted in MongoDB Atlas');
            console.error('   3. Check MongoDB Atlas cluster status');
            console.error('   4. Verify connection string is correct');
        } else if (error.message?.includes('authentication')) {
            console.error('💡 Authentication error:');
            console.error('   1. Check username and password in connection string');
            console.error('   2. Verify database user has correct permissions');
        }
        
        // Don't exit - let server start anyway for development
        console.log('⚠️ Continuing without database connection...');
        console.log('⚠️ Some features (like saving candidates) will not work until database is connected');
        throw error; // Re-throw to let server.ts handle it
    }
};

// معالجة انقطاع الاتصال
mongoose.connection.on('disconnected', () => {
    console.log('⚠️ MongoDB disconnected');
});

mongoose.connection.on('error', (error) => {
    console.error('❌ MongoDB error:', error);
});

// دالة للتحقق من حالة الاتصال
export const checkDatabaseConnection = (): {
    isConnected: boolean;
    state: string;
    readyState: number;
    databaseName?: string;
} => {
    const readyState = mongoose.connection.readyState;
    const states = {
        0: 'disconnected',
        1: 'connected',
        2: 'connecting',
        3: 'disconnecting'
    };
    
    return {
        isConnected: readyState === 1,
        state: states[readyState as keyof typeof states] || 'unknown',
        readyState,
        databaseName: mongoose.connection.db?.databaseName
    };
};

// دالة للتحقق من الاتصال بشكل متزامن
export const testDatabaseConnection = async (): Promise<boolean> => {
    try {
        if (mongoose.connection.readyState === 1) {
            // الاتصال موجود، تحقق من أنه يعمل
            await mongoose.connection.db?.admin().ping();
            return true;
        } else {
            // محاولة الاتصال
            await connectDatabase();
            return true;
        }
    } catch (error) {
        console.error('❌ Database connection test failed:', error);
        return false;
    }
};

















