import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env");
    process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

async function clearTable(tableName) {
    console.log(`🧹 Clearing table: ${tableName}...`);
    // Delete all rows by matching a column that always exists (like id) to not equal a dummy value
    // Or simpler: delete everything.
    const { error } = await supabase
        .from(tableName)
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000'); // UUID hack to select all

    if (error) {
        console.error(`❌ Error clearing ${tableName}:`, error.message);
    } else {
        console.log(`✅ ${tableName} cleared.`);
    }
}

async function deleteAllUsers() {
    console.log(`👥 Fetching all Auth Users...`);
    const { data: { users }, error } = await supabase.auth.admin.listUsers();
    
    if (error) {
        console.error("❌ Error listing users:", error.message);
        return;
    }

    console.log(`found ${users.length} users to delete.`);

    for (const user of users) {
        const { error: deleteError } = await supabase.auth.admin.deleteUser(user.id);
        if (deleteError) {
            console.error(`❌ Failed to delete user ${user.email}:`, deleteError.message);
        } else {
            console.log(`🗑️ Deleted user: ${user.email}`);
        }
    }
}

async function reset() {
    console.log("⚠️  WARNING: STARTING FULL DATABASE RESET ⚠️");
    console.log("-------------------------------------------");

    // Order matters because of Foreign Keys!
    // Delete children first, then parents.
    
    await clearTable('call_logs');
    await clearTable('leads');
    await clearTable('campaigns');
    await clearTable('projects');
    
    // Profiles often linked to Auth Users via trigger or FK
    // Organizations linked to Profiles?
    // Let's clear profiles, then organizations.
    await clearTable('profiles'); 
    await clearTable('organizations');

    // Audit logs if they exist
    // await clearTable('audit_logs'); 

    // Finally, wipe Auth Users (which enables fresh Sign Up)
    await deleteAllUsers();

    console.log("-------------------------------------------");
    console.log("✅ RESET COMPLETE. You can now Sign Up correctly.");
}

reset();
