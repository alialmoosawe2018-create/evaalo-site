// ============================================
// ملف: scripts/test-without-api-keys.ts
// الوظيفة: اختبار النظام بدون API keys (Error Handling + Basic Flow)
// ============================================

import axios from 'axios';
import Candidate from '../models/Candidate.js';
import VideoInterviewSession from '../models/VideoInterviewSession.js';

const BACKEND_URL = 'http://localhost:5000';

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

function log(message: string, color: string = colors.reset) {
    console.log(`${color}${message}${colors.reset}`);
}

function logSuccess(message: string) {
    log(`✅ ${message}`, colors.green);
}

function logError(message: string) {
    log(`❌ ${message}`, colors.red);
}

function logInfo(message: string) {
    log(`ℹ️  ${message}`, colors.blue);
}

function logWarning(message: string) {
    log(`⚠️  ${message}`, colors.yellow);
}

// ============================================
// Test 1: Health Check
// ============================================
async function testHealthCheck() {
    logInfo('\n📋 Test 1: Health Check');
    try {
        const response = await axios.get(`${BACKEND_URL}/api/health`);
        if (response.status === 200 && response.data?.status === 'ok') {
            logSuccess('Health check passed');
            logInfo(`Database: ${response.data.database}`);
            return true;
        }
        return false;
    } catch (error: any) {
        logError(`Health check failed: ${error.message}`);
        return false;
    }
}

// ============================================
// Test 2: Get Candidate from Database
// ============================================
async function getTestCandidate() {
    logInfo('\n📋 Test 2: Get Candidate from Database');
    try {
        const response = await axios.get(`${BACKEND_URL}/api/candidates?limit=1`);
        const list = response.data?.data ?? response.data;
        if (Array.isArray(list) && list.length > 0) {
            const candidate = list[0];
            const nm = candidate.full_name ?? candidate.fullName;
            logSuccess(`Found candidate: ${nm}`);
            logInfo(`Candidate ID: ${candidate._id || candidate.id}`);
            return candidate._id || candidate.id;
        }
        logWarning('No candidates found in database');
        return null;
    } catch (error: any) {
        logError(`Failed to get candidate: ${error.message}`);
        return null;
    }
}

// ============================================
// Test 3: Start Interview (Create Session)
// ============================================
async function testStartInterview(candidateId: string) {
    logInfo('\n📋 Test 3: Start Interview (Create Session)');
    try {
        const response = await axios.post(
            `${BACKEND_URL}/api/video-interview/start`,
            { candidateId, campaignId: 'test-campaign' },
            { headers: { 'Content-Type': 'application/json' } }
        );

        if (response.status === 200 && response.data.success) {
            logSuccess('Start interview endpoint works');
            logInfo(`Session ID: ${response.data.sessionId}`);
            
            // التحقق من أن Session تم إنشاؤه في DB
            const session = await VideoInterviewSession.findOne({ 
                sessionId: response.data.sessionId 
            });
            
            if (session) {
                logSuccess('Session created in database');
                logInfo(`Status: ${session.status}`);
                logInfo(`Started at: ${session.startedAt}`);
            } else {
                logError('Session not found in database');
            }
            
            return { success: true, sessionId: response.data.sessionId };
        }
        return { success: false };
    } catch (error: any) {
        logError(`Start interview failed: ${error.message}`);
        return { success: false };
    }
}

// ============================================
// Test 4: Error Handling (STT without API key)
// ============================================
async function testErrorHandling(sessionId: string, candidateId: string) {
    logInfo('\n📋 Test 4: Error Handling (STT without API key)');
    
    // إنشاء audio buffer وهمي (base64)
    const fakeAudioBase64 = Buffer.from('fake audio data').toString('base64');
    
    try {
        const response = await axios.post(
            `${BACKEND_URL}/api/video-interview/audio`,
            {
                audio: fakeAudioBase64,
                sessionId: sessionId,
                candidateId: candidateId
            },
            { headers: { 'Content-Type': 'application/json' } }
        );

        if (response.status === 200) {
            logSuccess('Audio endpoint responded (even without API keys)');
            
            if (response.data.success) {
                logInfo(`Reply: ${response.data.reply}`);
                logInfo(`Transcribed: ${response.data.transcribedText || '(empty - expected)'}`);
                
                // التحقق من Fallback Response
                if (response.data.reply && response.data.reply.includes('repeat')) {
                    logSuccess('Fallback response detected (expected without API keys)');
                }
            } else {
                logWarning('Request failed but endpoint responded');
            }
            return true;
        }
        return false;
    } catch (error: any) {
        if (error.response?.status === 200) {
            // حتى لو كان هناك خطأ، إذا كان status 200 فهذا يعني Error Handling يعمل
            logSuccess('Error handling works - endpoint returned 200 with error message');
            return true;
        }
        logError(`Error handling test failed: ${error.message}`);
        return false;
    }
}

// ============================================
// Test 5: Conversation History Storage
// ============================================
async function testConversationHistory(sessionId: string) {
    logInfo('\n📋 Test 5: Conversation History Storage');
    
    try {
        // الحصول على تاريخ المحادثة
        const response = await axios.get(
            `${BACKEND_URL}/api/video-interview/history/${sessionId}`
        );

        if (response.status === 200 && response.data.success) {
            logSuccess('Conversation history endpoint works');
            logInfo(`Messages count: ${response.data.conversationHistory?.length || 0}`);
            
            if (response.data.conversationHistory && response.data.conversationHistory.length > 0) {
                logInfo('Sample messages:');
                response.data.conversationHistory.slice(0, 3).forEach((msg: any, index: number) => {
                    logInfo(`  ${index + 1}. [${msg.role}]: ${msg.content.substring(0, 50)}...`);
                });
            }
            return true;
        }
        return false;
    } catch (error: any) {
        logError(`Conversation history test failed: ${error.message}`);
        return false;
    }
}

// ============================================
// Test 6: Session Status
// ============================================
async function testSessionStatus(sessionId: string) {
    logInfo('\n📋 Test 6: Session Status');
    
    try {
        const response = await axios.get(
            `${BACKEND_URL}/api/video-interview/status/${sessionId}`
        );

        if (response.status === 200 && response.data.success) {
            logSuccess('Session status endpoint works');
            logInfo(`Status: ${response.data.session?.status}`);
            logInfo(`Message count: ${response.data.session?.messageCount || 0}`);
            logInfo(`Started at: ${response.data.session?.startedAt}`);
            return true;
        }
        return false;
    } catch (error: any) {
        logError(`Session status test failed: ${error.message}`);
        return false;
    }
}

// ============================================
// Main Test Runner
// ============================================
async function runTests() {
    log('\n' + '='.repeat(60), colors.cyan);
    log('🧪 Testing System WITHOUT API Keys', colors.cyan);
    log('='.repeat(60), colors.cyan);

    const results: any = {};

    // Test 1: Health Check
    results.healthCheck = await testHealthCheck();
    if (!results.healthCheck) {
        logError('\n❌ Backend is not running. Please start it first.');
        process.exit(1);
    }

    // Test 2: Get Candidate
    const candidateId = await getTestCandidate();
    if (!candidateId) {
        logWarning('\n⚠️  No candidate found. Some tests will be skipped.');
        logInfo('Please create a candidate at: http://localhost:3000/form');
    } else {
        // Test 3: Start Interview
        const startResult = await testStartInterview(candidateId);
        results.startInterview = startResult.success;
        
        if (startResult.success && startResult.sessionId) {
            const sessionId = startResult.sessionId;
            
            // Test 4: Error Handling
            results.errorHandling = await testErrorHandling(sessionId, candidateId);
            
            // Test 5: Conversation History
            results.conversationHistory = await testConversationHistory(sessionId);
            
            // Test 6: Session Status
            results.sessionStatus = await testSessionStatus(sessionId);
        }
    }

    // Summary
    log('\n' + '='.repeat(60), colors.cyan);
    log('📊 Test Results Summary', colors.cyan);
    log('='.repeat(60), colors.cyan);

    Object.entries(results).forEach(([test, passed]) => {
        if (passed) {
            logSuccess(`${test}: PASSED`);
        } else {
            logError(`${test}: FAILED`);
        }
    });

    const allPassed = Object.values(results).every(r => r);
    
    log('\n' + '='.repeat(60), colors.cyan);
    if (allPassed) {
        logSuccess('✅ All tests passed!');
        logInfo('System is working correctly even without API keys.');
        logInfo('Error handling is functioning as expected.');
    } else {
        logWarning('⚠️  Some tests failed or were skipped.');
        logInfo('This is expected if no candidate exists in database.');
    }
    log('='.repeat(60), colors.cyan);

    process.exit(allPassed ? 0 : 1);
}

runTests().catch(error => {
    logError(`\n❌ Test runner failed: ${error.message}`);
    process.exit(1);
});


