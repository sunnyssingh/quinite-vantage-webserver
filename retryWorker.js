import { createClient } from '@supabase/supabase-js';
import plivo from 'plivo';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

const plivoClient = new plivo.Client(
    process.env.PLIVO_AUTH_ID,
    process.env.PLIVO_AUTH_TOKEN
);

/**
 * Retry Logic for Failed Call Attempts
 * Runs every 5 minutes to check for leads that need retry
 */
async function processRetries() {
    console.log('🔄 Checking for retry attempts...');

    const now = new Date().toISOString();

    // Get call attempts that need retry
    const { data: retries, error } = await supabase
        .from('call_attempts')
        .select(`
            *,
            lead:leads(id, name, phone, organization_id),
            campaign:campaigns(id, name, organization_id)
        `)
        .eq('will_retry', true)
        .lte('next_retry_at', now)
        .limit(20);

    if (error) {
        console.error('❌ Error fetching retries:', error);
        return;
    }

    if (!retries || retries.length === 0) {
        console.log('✅ No retries needed');
        return;
    }

    console.log(`📞 Processing ${retries.length} retry attempts...`);

    for (const attempt of retries) {
        try {
            const { lead, campaign } = attempt;

            // Determine retry strategy based on attempt number
            if (attempt.attempt_number < 3) {
                // Retry with voice call
                console.log(`📞 Retry #${attempt.attempt_number + 1} for ${lead.name}`);

                await supabase.from('call_queue').insert({
                    campaign_id: campaign.id,
                    lead_id: lead.id,
                    organization_id: lead.organization_id,
                    status: 'queued',
                    attempt_count: attempt.attempt_number + 1,
                    next_retry_at: now
                });

            } else if (attempt.attempt_number === 3) {
                // Switch to SMS fallback
                console.log(`📱 Sending SMS fallback to ${lead.name}`);

                const smsMessage = `नमस्ते ${lead.name}, हमने आपको 3 बार कॉल करने की कोशिश की। कृपया हमें वापस कॉल करें: ${process.env.PLIVO_PHONE_NUMBER}`;

                try {
                    await plivoClient.messages.create(
                        process.env.PLIVO_PHONE_NUMBER,
                        lead.phone,
                        smsMessage
                    );

                    // Log SMS attempt
                    await supabase.from('call_attempts').insert({
                        organization_id: lead.organization_id,
                        lead_id: lead.id,
                        campaign_id: campaign.id,
                        attempt_number: 4,
                        channel: 'sms',
                        outcome: 'sent',
                        attempted_at: now
                    });

                    console.log(`✅ SMS sent to ${lead.name}`);
                } catch (smsError) {
                    console.error(`❌ SMS failed for ${lead.name}:`, smsError.message);
                }
            }

            // Mark current attempt as processed
            await supabase
                .from('call_attempts')
                .update({ will_retry: false })
                .eq('id', attempt.id);

        } catch (err) {
            console.error(`❌ Error processing retry for attempt ${attempt.id}:`, err);
        }
    }

    console.log('✅ Retry processing complete');
}

/**
 * Update call attempts to set retry schedule
 * Called when a call fails (no answer, busy, etc.)
 */
async function scheduleRetry(callAttemptId, reason) {
    const { data: attempt } = await supabase
        .from('call_attempts')
        .select('attempt_number, lead_id')
        .eq('id', callAttemptId)
        .single();

    if (!attempt) return;

    // Retry schedule (IST timezone friendly)
    const retryDelays = {
        1: 2 * 60 * 60 * 1000,      // 2 hours
        2: 24 * 60 * 60 * 1000,     // 1 day (next day, same time)
        3: 48 * 60 * 60 * 1000      // 2 days (SMS fallback)
    };

    const delay = retryDelays[attempt.attempt_number] || 0;

    if (delay > 0) {
        const nextRetry = new Date(Date.now() + delay);

        await supabase
            .from('call_attempts')
            .update({
                will_retry: true,
                next_retry_at: nextRetry.toISOString(),
                retry_reason: reason
            })
            .eq('id', callAttemptId);

        console.log(`🔄 Retry scheduled for attempt ${callAttemptId} at ${nextRetry.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
    }
}

// Run retry processor every 5 minutes
setInterval(processRetries, 5 * 60 * 1000);

// Run immediately on start
processRetries();

console.log('✅ Retry worker started');

// Export for use in other modules
export { processRetries, scheduleRetry };
