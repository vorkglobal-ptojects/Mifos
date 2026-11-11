import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth-server';
import { executeChangeTicketAction } from '@/lib/change-requests';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: any) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const reviewNotes = (body.notes || body.reviewNotes || 'Approved by Manager').trim();
    const proposedData = body.proposed_data || body.proposedData;

    const result = await executeChangeTicketAction(session, id, 'APPROVE', {
      notes: reviewNotes,
      proposedData
    });

    return NextResponse.json(result.body, { status: result.status });
  } catch (err: any) {
    console.error('Error approving change request:', err);
    return NextResponse.json({ error: err.message || 'Failed to approve change request' }, { status: 500 });
  }
}
