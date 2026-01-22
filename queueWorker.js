import { createClient } from '@supabase/supabase-js';
import plivo from 'plivo';
import dotenv from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const PLIVO_AUTH_ID = process.env.PLIVO_AUTH_ID;
const PLIVO_AUTH_TOKEN = process.env.PLIVO_AUTH_TOKEN;
const PLIVO_PHONE_NUMBER = process.env.PLIVO_PHONE_NUMBER;
const WEBSOCKET_SERVER_URL = process.env.WEBSOCKET_SERVER_URL || 'https://vantage-websocket-server.up.railway.app'; // Adjust default
const NEXT_PUBLIC_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !PLIVO_AUTH_ID || !PLIVO_AUTH_TOKEN) {
    console.error("❌ Missing Configuration for Queue Worker");
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const plivoClient = new plivo.Client(PLIVO_AUTH_ID, PLIVO_AUTH_TOKEN);

// RATE LIMIT SETTINGS
const MAX_CONCURRENT_CALLS_PER_BATCH = 10; // Plivo might limit concurrent channels
const POLL_INTERVAL_MS = 5000;
const CALLS_PER_SECOND = 2; // Conservative rate limit

console.log("🚀 Starting Queue Worker...");
console.log(`   Poll Interval: ${POLL_INTERVAL_MS}ms`);
console.log(`   Rate Limit: ${CALLS_PER_SECOND} calls/sec`);

async function processQueue() {
    try {
        // 1. Fetch pending items suitable for retry
        const { data: queueItems, error } = await supabase
            .from('call_queue')
            .select('*')
            .in('status', ['queued', 'failed']) // processing? No, generic fetch queued
            .lte('next_retry_at', new Date().toISOString())
            .lt('attempt_count', 3) // Max retries check
            .limit(MAX_CONCURRENT_CALLS_PER_BATCH);

        if (error) throw error;

        if (!queueItems || queueItems.length === 0) {
            // console.log("💤 Queue empty...");
            return;
        }

        console.log(`📥 Processing ${queueItems.length} items from queue...`);

        for (const item of queueItems) {
            await executeCall(item);
            // Simple Rate Limiting: Sleep between calls
            await new Promise(r => setTimeout(r, 1000 / CALLS_PER_SECOND));
        }

    } catch (err) {
        console.error("❌ Queue Process Error:", err.message);
    }
}

async function executeCall(item) {
    const { id, lead_id, campaign_id, attempt_count } = item;

    try {
        // A. Mark as Processing
        await supabase.from('call_queue').update({ status: 'processing' }).eq('id', id);

        // B. Fetch Lead Data (Phone)
        const { data: lead } = await supabase.from('leads').select('phone, name').eq('id', lead_id).single();
        if (!lead || !lead.phone) {
            throw new Error("Invalid Lead or Missing Phone");
        }

        console.log(`📞 Dialing ${lead.name} (${lead.phone}) for Campaign ${campaign_id}...`);

        // C. Make Call via Plivo
        // Use websocket server's answer endpoint if available, else standard webhook
        // We MUST point to the endpoint that generates the WebSocket XML.
        // In this repo, that is usually specific.
        const answerUrl = `${WEBSOCKET_SERVER_URL}/answer?leadId=${lead_id}&campaignId=${campaign_id}`;

        const response = await plivoClient.calls.create(
            PLIVO_PHONE_NUMBER,
            lead.phone,
            answerUrl,
            {
                answer_method: 'POST',
                // Optional hooks
                time_limit: 1800
            }
        );

        console.log(`   ✅ Call Initiated: SID=${response.requestUuid}`);

        // D. Success - Update Queue & Lead
        await supabase.from('call_queue').update({
            status: 'completed',
            updated_at: new Date()
        }).eq('id', id);

        // Update Lead's own status
        await supabase.from('leads').update({
            call_status: 'calling',
            call_date: new Date().toISOString()
        }).eq('id', lead_id);

        // Update Campaign Stats (Approximate)
        // We do this individually to keep UI responsive. 
        // Note: For high volume, an RPC or periodic aggregate would be better.
        const { data: campaign } = await supabase.from('campaigns').select('total_calls').eq('id', campaign_id).single();
        if (campaign) {
            await supabase.from('campaigns').update({
                total_calls: (campaign.total_calls || 0) + 1
            }).eq('id', campaign_id);
        }

    } catch (err) {
        console.error(`   ❌ Call Failed (Attempt ${attempt_count + 1}):`, err.message);

        // E. Failure - Schedule Retry
        const nextRetry = new Date();
        nextRetry.setMinutes(nextRetry.getMinutes() + (5 * (attempt_count + 1))); // Linear backoff: 5m, 10m, 15m

        await supabase.from('call_queue').update({
            status: 'failed', // Temporarily failed
            attempt_count: attempt_count + 1,
            last_error: err.message,
            next_retry_at: nextRetry.toISOString(),
            updated_at: new Date()
        }).eq('id', id);
    }
}

// Start Polling Loop
setInterval(processQueue, POLL_INTERVAL_MS);

// Handle graceful shutdown
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
