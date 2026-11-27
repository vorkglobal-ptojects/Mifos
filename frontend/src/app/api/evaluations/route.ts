import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const status = searchParams.get('status');
    const billNo = searchParams.get('billNo');

    const isSingleBillQuery = Boolean(billNo && billNo.trim() !== '');
    // Egress optimization: Only include full base64 photos when specifically inspecting a single bill.
    const columns = isSingleBillQuery
      ? '*'
      : 'id, status, air_weight, water_weight, specific_gravity, estimated_karat, asking_amount, true_value, created_at';

    let query = adminSupabase
      .from('rejected_evaluations')
      .select(columns)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (isSingleBillQuery) {
      const cleanBill = billNo!.trim();
      query = query.or(`status.eq.BILL:${cleanBill},status.eq.${cleanBill},status.eq.BILL:${cleanBill}:DAMAGED`);
    } else if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ evaluations: data || [] });
  } catch (err: any) {
    console.error('Evaluations GET error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      billNo,
      airWeight,
      waterWeight,
      specificGravity,
      estimatedKarat,
      askingAmount,
      trueValue,
      status,
      airWeightPhoto,
      waterWeightPhoto,
    } = body;

    const finalStatus = billNo ? `BILL:${billNo}` : (status || 'ACCEPTED');

    const payload = {
      air_weight: parseFloat(airWeight) || 0,
      water_weight: parseFloat(waterWeight) || 0,
      specific_gravity: parseFloat(specificGravity) || 0,
      estimated_karat: estimatedKarat || 'Unknown',
      asking_amount: parseFloat(askingAmount) || 0,
      true_value: parseFloat(trueValue) || 0,
      status: finalStatus,
      air_weight_photo_url: airWeightPhoto || null,
      water_weight_photo_url: waterWeightPhoto || null,
    };

    const { data, error } = await adminSupabase
      .from('rejected_evaluations')
      .insert([payload])
      .select()
      .single();

    if (error) {
      console.error('Error inserting evaluation into database:', error);
      throw error;
    }

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    console.error('Evaluations POST error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
