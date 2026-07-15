import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

/** MongoDB connection URI — must be set in `apps/backend/.env` as `MONGODB_URI` only. */
function getMongoDbUri(): string | undefined {
    const uri = process.env.MONGODB_URI?.trim();
    return uri && uri.length > 0 ? uri : undefined;
}

/** Walk nested Node / Mongo errors for TLS connect timeouts (VPN/firewall/IP block). */
function errorChainIncludesTlsConnectTimeout(err: unknown, depth = 0): boolean {
    if (!err || depth > 8) return false;
    const any = err as Record<string, unknown>;
    const msg = String(any.message ?? any.cause ?? '');
    const name = String(any.name ?? '');
    if (/secureConnect.*timed out/i.test(msg) || /MongoNetworkTimeoutError/i.test(name)) {
        return true;
    }
    if (any.cause) return errorChainIncludesTlsConnectTimeout(any.cause, depth + 1);
    return false;
}

export const connectDatabase = async (): Promise<void> => {
    const uri = getMongoDbUri();

    try {
        console.log('🔄 Attempting to connect to MongoDB...');

        if (!uri) {
            console.error(
                '❌ MONGODB_URI is not set. Create apps/backend/.env and add MONGODB_URI=... (see env.example).'
            );
            console.log('⚠️ Continuing without database connection...');
            console.log('⚠️ Some features (like saving candidates) will not work until database is connected');
            return;
        }

        console.log('📡 Connection String:', uri.replace(/:[^:@]+@/, ':****@'));

        const serverSelectionTimeoutMS = Math.min(
            120_000,
            Math.max(5_000, parseInt(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS || '30000', 10) || 30_000)
        );
        const connectTimeoutMS = Math.min(
            90_000,
            Math.max(5_000, parseInt(process.env.MONGODB_CONNECT_TIMEOUT_MS || '35000', 10) || 35_000)
        );

        await mongoose.connect(uri, {
            // Short timeouts fail on flaky networks; Atlas IP allowlist blocks often show as ReplicaSetNoPrimary + commonWireVersion 0.
            serverSelectionTimeoutMS,
            socketTimeoutMS: 45000,
            connectTimeoutMS,
            maxPoolSize: 10,
            minPoolSize: 1,
            heartbeatFrequencyMS: 10000,
            retryWrites: true,
            retryReads: true,
        });

        console.log('✅ MongoDB connected');
        console.log(`📊 Database: ${mongoose.connection.db?.databaseName}`);
        console.log(
            `🔗 Connection State: ${mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected'}`
        );
    } catch (error: any) {
        console.error('❌ MongoDB connection error:', error);
        console.error('Error details:', {
            name: error.name,
            message: error.message,
            code: error.code,
        });

        if (error.name === 'MongoServerSelectionError' || error.code === 'ENOTFOUND') {
            if (errorChainIncludesTlsConnectTimeout(error)) {
                console.error(
                    '💡 السبب الأقرب: انتهت مهلة TLS (secureConnect) — الاتصال بـ :27017 لم يكتمل. هذا **ليس** خطأ صيغة كلمة المرور عادةً.'
                );
                console.error('💡 جرّب: إيقاف VPN، السماح لـ outbound على 27017، إضافة IP الحالي في Atlas، أو شبكة أخرى (Hotspot).');
            } else {
                console.error('💡 If servers show commonWireVersion: 0 → TCP/TLS never completed (network or Atlas block).');
            }
            console.error('💡 Possible fixes:');
            console.error('   1. Atlas → Network Access → allow your current IP (or 0.0.0.0/0 for dev only)');
            console.error('   2. Cluster not Paused; user exists in Database Access with correct password');
            console.error('   3. VPN/firewall: allow outbound TCP 27017; try without VPN / mobile hotspot');
            console.error('   4. From PowerShell: Test-NetConnection <first-host-from-MONGODB_URI> -Port 27017');
            console.error('   5. Optional: MONGODB_CONNECT_TIMEOUT_MS / MONGODB_SERVER_SELECTION_TIMEOUT_MS if the path is slow');
        } else if (error.message?.includes('authentication')) {
            console.error('💡 Authentication error:');
            console.error('   1. Check username and password in MONGODB_URI');
            console.error('   2. Verify database user has correct permissions');
        }

        console.log('⚠️ Continuing without database connection...');
        console.log('⚠️ Some features (like saving candidates) will not work until database is connected');
    }
};

mongoose.connection.on('disconnected', () => {
    console.log('⚠️ MongoDB disconnected');
});

mongoose.connection.on('error', (error) => {
    console.error('❌ MongoDB error:', error);
});

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
        3: 'disconnecting',
    };

    return {
        isConnected: readyState === 1,
        state: states[readyState as keyof typeof states] || 'unknown',
        readyState,
        databaseName: mongoose.connection.db?.databaseName,
    };
};

export const testDatabaseConnection = async (): Promise<boolean> => {
    try {
        if (mongoose.connection.readyState !== mongoose.ConnectionStates.connected) {
            await connectDatabase();
        }
        await mongoose.connection.db?.admin().ping();
        return true;
    } catch (error) {
        console.error('❌ Database connection test failed:', error);
        return false;
    }
};
