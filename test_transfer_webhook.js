
// Native fetch is available in Node.js 18+
// remove require


async function testTransferWebhook() {
    const BASE_URL = 'http://localhost:3000'; // Assuming local Next.js is running here
    const TEST_TO = '+919999999999';
    // Use dummy UUIDs for leads/campaigns to test robustness (or valid ones if you have them)
    const TEST_URL = `${BASE_URL}/api/webhooks/plivo/transfer?to=${encodeURIComponent(TEST_TO)}&leadId=test-lead-uuid&campaignId=test-campaign-uuid`;

    console.log('🧪 Testing Transfer Webhook...');
    console.log(`🔗 URL: ${TEST_URL}`);

    try {
        const response = await fetch(TEST_URL, {
            method: 'POST',
        });

        console.log(`\n📊 Status: ${response.status} ${response.statusText}`);

        const text = await response.text();
        console.log('📄 Response Body:');
        console.log('---------------------------------------------------');
        console.log(text);
        console.log('---------------------------------------------------');

        if (response.status === 200 && text.includes('<Dial')) {
            console.log('✅ SUCCESS: Webhook returned valid XML with Dial.');
        } else if (response.status === 404) {
            console.log('❌ FAIL: Endpoint not found (Check file path/formatting).');
        } else {
            console.log('❌ FAIL: Invalid response or status.');
        }

    } catch (error) {
        console.error('❌ ERROR: Could not connect to Next.js server.', error.message);
        console.log('   (Ensure "npm run dev" is running on port 3000)');
    }
}

testTransferWebhook();
