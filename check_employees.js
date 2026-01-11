
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function checkEmployees() {
    console.log('🔍 Checking for Employees with Phone Numbers...\n');

    // 1. Check Roles
    console.log('--- Roles ---');
    const { data: roles, error: roleError } = await supabase
        .from('roles')
        .select('*');

    if (roleError) console.error('❌ Error fetching roles:', roleError.message);
    else console.table(roles.map(r => ({ id: r.id, name: r.name })));

    // 2. Check Profiles with 'Employee' role (or similar)
    console.log('\n--- Profiles with Phone Numbers ---');
    // Get role ID for 'Employee' (case insensitive check might be needed later, but strict for now)
    const employeeRole = roles?.find(r => r.name === 'Employee');
    const employeeRoleId = employeeRole?.id;

    if (!employeeRoleId) {
        console.error("❌ 'Employee' role not found in database! (Case sensitive check: 'Employee')");
    } else {
        const { data: profiles, error: profileError } = await supabase
            .from('profiles')
            .select('id, full_name, email, phone, role_id, organization_id')
            .eq('role_id', employeeRoleId);

        if (profileError) {
            console.error('❌ Error fetching profiles:', profileError.message);
        } else {
            if (profiles.length === 0) {
                console.log('⚠️ No profiles found with "Employee" role.');
            } else {
                console.log(`✅ Found ${profiles.length} employees:`);
                profiles.forEach(p => {
                    const hasPhone = p.phone ? '✅' : '❌';
                    console.log(`   - ${p.full_name} (${p.email}) | Phone: ${p.phone || 'N/A'} ${hasPhone} | Org: ${p.organization_id}`);
                });
            }
        }
    }
}

checkEmployees();
