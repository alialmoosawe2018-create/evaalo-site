// اختبار API بسيط
const testData = {
    firstName: 'Test',
    lastName: 'User',
    email: `test${Date.now()}@example.com`,
    phone: '1234567890',
    positionAppliedFor: 'Developer',
    yearsOfExperience: '5',
    agreeToTerms: true
};

fetch('http://localhost:5000/api/candidates', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
    },
    body: JSON.stringify(testData)
})
.then(response => {
    console.log('Status:', response.status);
    return response.json();
})
.then(data => {
    console.log('Response:', JSON.stringify(data, null, 2));
    if (data.success) {
        console.log('✅ Test passed!');
    } else {
        console.log('❌ Test failed:', data.error || data.message);
    }
})
.catch(error => {
    console.error('❌ Error:', error.message);
});


