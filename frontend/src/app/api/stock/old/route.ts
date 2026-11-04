import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth-server';
import { oldSupabase } from '@/lib/old-supabase-server';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const session = await getAuthenticatedUser(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type') || 'items';
    const page = parseInt(searchParams.get('page') || '0', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '1000', 10);

    if (type === 'customers') {
      const { data, error } = await oldSupabase
        .from('stock_customers')
        .select('*')
        .order('name', { ascending: true });
      if (error) throw error;
      return NextResponse.json({ customers: data || [] });
    }

    const { data, error } = await oldSupabase
      .from('stock_items')
      .select('*')
      .eq('status', 'Active')
      .order('date', { ascending: false })
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) throw error;
    return NextResponse.json({ items: data || [] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
