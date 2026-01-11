import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function testStatus(status) {
    console.log(`\n🧪 Testing status: '${status}'`);
    try {
        const { data, error } = await supabase
            .from('call_logs')
            .insert({
                call_sid: `test-${Date.now()}`,
                call_status: status,
                call_timestamp: new Date().toISOString(),
                transferred: false
            })
            .select()
            .single();

        if (error) {
            console.log(`❌ Failed: ${error.message}`);
            return false;
        } else {
            console.log(`✅ Success! '${status}' is valid.`);
            await supabase.from('call_logs').delete().eq('id', data.id);
            return true;
        }
    } catch (err) {
        console.error("Unexpected error:", err);
        return false;
    }
}

async function checkPermissions() {
    console.log("\n🔐 Checking Permissions for 'Client Super Admin'...");

    // 1. Get Role ID
    const { data: role, error: roleError } = await supabase
        .from('roles')
        .select('id')
        .eq('name', 'Client Super Admin')
        .single();

    if (roleError || !role) {
        console.error("❌ Role 'Client Super Admin' not found!");
        return;
    }

    // 2. Get Permissions
    const { data: rolePerms } = await supabase
        .from('role_permissions')
        .select('permission:permissions(name)')
        .eq('role_id', role.id);

    const permissions = rolePerms.map(rp => rp.permission.name);
    console.log("Found Permissions:", permissions);

    // 3. Check for Read/Write
    const needed = ['leads.create', 'leads.read', 'leads.update', 'leads.delete', 'leads.import'];
    const missing = needed.filter(p => !permissions.includes(p));

    if (missing.length > 0) {
        console.error("❌ Missing:", missing);
    } else {
        console.log("✅ All Lead permissions verified.");
    }
}

async function run() {
    // Test statuses
    await testStatus('in_progress');  // What code uses
    await testStatus('in-progress');  // Plivo standard
    await testStatus('initiated');    // Common

    // Check permissions
    await checkPermissions();
}

run();
