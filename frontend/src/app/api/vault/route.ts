import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Authentication required.' }, { status: 401 });
    }
    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get('branchId') || (session?.role === 'TELLER' ? session.branchId : 'ALL');

    let query = adminSupabase.from('vault_transfer').select('*').order('date', { ascending: false });
    if (branchId !== 'ALL') {
      query = query.or(`from_vault.eq.${branchId},to_vault.eq.${branchId}`);
    }

    const { data: transfers, error } = await query;
    if (error) throw error;

    const totalTransferred = (transfers || [])
      .filter(t => t.status === 'Completed')
      .reduce((sum, t) => sum + Number(t.amount || 0), 0);

    const pendingCount = (transfers || [])
      .filter(t => t.status === 'Pending').length;

    return NextResponse.json({
      totalTransferred,
      pendingCount,
      transfers: transfers || []
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
