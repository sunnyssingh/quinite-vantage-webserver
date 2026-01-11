
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function checkDatabase() {
    console.log('🔍 Checking Database Content...\n');

    // Check Call Logs
    console.log('📞 Latest Call Logs:');
    const { data: logs, error: logError } = await supabase
        .from('call_logs')
        .select('id, call_sid, call_status, transferred, created_at')
        .order('created_at', { ascending: false })
        .limit(5);

    if (logError) {
        console.error('❌ Error fetching call logs:', logError.message);
    } else {
        if (logs.length === 0) {
            console.log('   (No call logs found)');
        } else {
            logs.forEach(log => {
                console.log(`   - [${new Date(log.created_at).toLocaleString()}] Status: ${log.call_status}, Transferred: ${log.transferred}, ID: ${log.id}`);
            });
        }
    }

    console.log('\n👥 Updated Leads (Last 5):');
    const { data: leads, error: leadError } = await supabase
        .from('leads')
        .select('id, name, call_status, transferred_to_human, updated_at')
        .order('updated_at', { ascending: false })
        .limit(5);

    if (leadError) {
        console.error('❌ Error fetching leads:', leadError.message);
    } else {
        if (leads.length === 0) {
            console.log('   (No leads found)');
        } else {
            leads.forEach(lead => {
                console.log(`   - [${new Date(lead.updated_at).toLocaleString()}] ${lead.name} | Status: ${lead.call_status} | Transferred: ${lead.transferred_to_human}`);
            });
        }
    }
}

checkDatabase();
