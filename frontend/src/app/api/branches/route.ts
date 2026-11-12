import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
    }

    const { data, error } = await adminSupabase
      .from('branches')
      .select('*')
      .order('name', { ascending: true });

    if (error) {
      console.error('Branches GET error:', error);
      return NextResponse.json({ error: 'Branches table error.', details: error.message }, { status: 500 });
    }

    return NextResponse.json(data || []);
  } catch (error: any) {
    console.error('Branches GET failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
    }
    if (session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden. Admin privileges required to create branches.' }, { status: 403 });
    }

    const { name, id } = await request.json();

    if (!name || !id) {
      return NextResponse.json({ error: 'Missing name or id' }, { status: 400 });
    }

    const { data, error } = await adminSupabase
      .from('branches')
      .insert([{
        id: id.toUpperCase(),
        name,
        created_at: new Date().toISOString(),
        is_active: true
      }])
      .select()
      .single();

    if (error) {
       console.error('POST /api/branches insert error:', error);
       throw error;
    }
    
    await adminSupabase.from('branch_status').upsert({
      branch_id: id.toUpperCase(),
      status: 'CLOSED',
      updated_at: new Date().toISOString()
    });

    return NextResponse.json(data, { status: 201 });
  } catch (error: any) {
    console.error('Branches POST failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

