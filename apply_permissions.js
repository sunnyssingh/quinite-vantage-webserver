
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function applyPermissions() {
    console.log('🛡️ Applying Client Super Admin Permissions...\n');

    // 1. Add Features
    const featuresToAdd = [
        { name: 'leads.create', description: 'Manually create new leads', category: 'leads' },
        { name: 'leads.delete', description: 'Delete existing leads', category: 'leads' }
    ];

    console.log('1️⃣ Upserting Features...');
    const { data: features, error: featError } = await supabase
        .from('features')
        .upsert(featuresToAdd, { onConflict: 'name' })
        .select();

    if (featError) {
        console.error('❌ Error adding features:', featError.message);
        return;
    }
    console.log('   ✅ Features added/verified:', features.map(f => f.name).join(', '));

    // 2. Get Roles
    console.log('\n2️⃣ Fetching Roles...');
    const { data: roles, error: roleError } = await supabase
        .from('roles')
        .select('id, name')
        .in('name', ['Client Super Admin', 'Manager']);

    if (roleError) {
        console.error('❌ Error fetching roles:', roleError.message);
        return;
    }

    // 3. Assign Permissions
    console.log('\n3️⃣ Assigning Permissions to Roles...');
    for (const role of roles) {
        const permissionsDeps = features.map(f => ({
            role_id: role.id,
            feature_id: f.id
        }));

        const { error: permError } = await supabase
            .from('role_permissions')
            .upsert(permissionsDeps, { onConflict: 'role_id,feature_id' });

        if (permError) {
            console.error(`❌ Error assigning to ${role.name}:`, permError.message);
        } else {
            console.log(`   ✅ Assigned ${features.length} features to role: ${role.name}`);
        }
    }

    console.log('\n✨ Permissions applied successfully!');
}

applyPermissions();
