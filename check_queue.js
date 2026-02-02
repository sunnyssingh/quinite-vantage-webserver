
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function checkQueue() {
    console.log('🔍 Checking Call Queue...\n');

    // Fetch queued items sorted by priority (retry logic matches queueWorker.js)
    const { data: queueItems, error } = await supabase
        .from('call_queue')
        .select(`
            id,
            status,
            attempt_count,
            created_at,
            next_retry_at,
            lead:leads (name, phone, organization_id),
            campaign:campaigns (name)
        `)
        .in('status', ['queued', 'failed'])
        .lte('next_retry_at', new Date().toISOString())
        .order('next_retry_at', { ascending: true }) // First due
        .limit(20);

    if (error) {
        console.error('❌ Error fetching queue:', error.message);
        return;
    }

    if (!queueItems || queueItems.length === 0) {
        console.log('✅ Queue is empty. No calls pending.');
    } else {
        console.log(`📋 Found ${queueItems.length} pending calls:\n`);
        queueItems.forEach((item, index) => {
            const leadName = item.lead?.name || 'Unknown Lead';
            const leadPhone = item.lead?.phone || 'No Phone';
            const campName = item.campaign?.name || 'Unknown Campaign';
            const due = new Date(item.next_retry_at).toLocaleString();

            console.log(`${index + 1}. [${item.status.toUpperCase()}] ${leadName} (${leadPhone})`);
            console.log(`   Campaign: ${campName}`);
            console.log(`   Attempts: ${item.attempt_count} | Due: ${due}`);
            console.log('   -------------------------------------------------');
        });
    }
}

checkQueue();
