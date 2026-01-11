
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function checkLeadsAndCampaigns() {
    console.log('🔍 Checking Leads and Campaigns...\n');

    // 1. Get Campaigns to see what Project they are linked to
    const { data: campaigns, error: campError } = await supabase
        .from('campaigns')
        .select('id, name, project_id, organization_id, status');

    if (campError) {
        console.error('❌ Error fetching campaigns:', campError.message);
        return;
    }

    console.log(`Found ${campaigns.length} Campaigns:`);
    campaigns.forEach(c => {
        console.log(`- Campaign: "${c.name}" (ID: ${c.id})`);
        console.log(`  Project ID: ${c.project_id}`);
        console.log(`  Org ID: ${c.organization_id}`);
        console.log(`  Status: ${c.status}`);
    });

    console.log('\n---------------------------------\n');

    // 2. Get Leads and see if they match
    const { data: leads, error: leadError } = await supabase
        .from('leads')
        .select('id, name, project_id, organization_id, call_status');

    if (leadError) {
        console.error('❌ Error fetching leads:', leadError.message);
        return;
    }

    console.log(`Found ${leads.length} Leads:`);
    leads.forEach(l => {
        console.log(`- Lead: "${l.name}"`);
        console.log(`  Project ID: ${l.project_id}`);
        console.log(`  Org ID: ${l.organization_id}`);
        console.log(`  Call Status: ${l.call_status}`);

        // Check match
        const matchingCampaign = campaigns.find(c => c.project_id === l.project_id && c.organization_id === l.organization_id);
        if (matchingCampaign) {
            console.log(`  ✅ Matches Campaign: "${matchingCampaign.name}"`);

            // Logic check from route.js
            const validStatus = ['new', 'pending', 'failed', null].includes(l.call_status);
            if (validStatus) {
                console.log(`  ✅ Status is valid for calling`);
            } else {
                console.log(`  ❌ Status '${l.call_status}' excludes it from calling (must be new/pending/failed/null)`);
            }
        } else {
            console.log(`  ⚠️  NO Matching Campaign found (Project/Org mismatch)`);
        }
        console.log('');
    });
}

checkLeadsAndCampaigns();
