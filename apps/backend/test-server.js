// Test script to check if backend can start
import('./src/server.js').catch((error) => {
    console.error('❌ Error starting server:', error);
    process.exit(1);
});


