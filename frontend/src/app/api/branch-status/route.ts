import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
    }

    const { data, error } = await adminSupabase
      .from('branch_status')
      .select('*');
    
    if (error) throw error;

    const statusMap = (data || []).reduce((acc: any, curr: any) => {
      acc[curr.branch_id] = curr.status;
      return acc;
    }, {});

    return NextResponse.json(statusMap);
  } catch (error: any) {
    console.error("Branch status GET failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
    }
    if (session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden. Admin privileges required to toggle branch status.' }, { status: 403 });
    }

    const { branchId, status } = await request.json();
    if (!branchId || !status) {
      return NextResponse.json({ error: "Missing branchId or status" }, { status: 400 });
    }

    const { data, error } = await adminSupabase
      .from('branch_status')
      .upsert({
        branch_id: branchId,
        status,
        updated_at: new Date().toISOString()
      }, { onConflict: 'branch_id' })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data);
  } catch (error: any) {
    console.error("Branch toggle API failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
