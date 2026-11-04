import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';
import { invalidateBranchInventoryCache } from '@/lib/redis';
import { getSriLankaDate } from '@/lib/date-utils';
import { recordAuditLog } from '@/lib/audit-logger';
export const dynamic = 'force-dynamic';

// GET: Fetch interest records for a specific bill, branch, item, or all bills
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const billNo = searchParams.get('bill_no');
    const branch = searchParams.get('branch');
    const itemId = searchParams.get('item_id');

    let records: any[] = [];
    let supabaseFailed = false;

    if (adminSupabase) {
      try {
        let query = adminSupabase
          .from('stock_interests')
          .select('*')
          .order('created_at', { ascending: false });

        if (billNo) {
          query = query.eq('bill_no', billNo);
        }
        if (branch && branch.toUpperCase() !== 'ALL') {
          query = query.eq('branch', branch.toUpperCase());
        }

        const { data, error } = await query;

        if (!error && data && data.length > 0) {
          records = data;
        } else {
          supabaseFailed = true;
        }
      } catch (e) {
        supabaseFailed = true;
      }

      // Cloud Fallback: If stock_interests table is missing or empty, fetch from audit_logs
      if (supabaseFailed || records.length === 0) {
        try {
          let auditQuery = adminSupabase
            .from('audit_logs')
            .select('details')
            .eq('action', 'RECORD_STOCK_INTEREST')
            .order('created_at', { ascending: false });

          if (branch && branch.toUpperCase() !== 'ALL') {
            auditQuery = auditQuery.ilike('branch_id', branch.toUpperCase());
          }

          const { data: auditData } = await auditQuery;
          if (auditData && Array.isArray(auditData) && auditData.length > 0) {
            let extracted = auditData.map((a: any) => a.details).filter(Boolean);
            if (billNo) {
              extracted = extracted.filter((r: any) => (r.bill_no || '').trim().toUpperCase() === billNo.trim().toUpperCase());
            }
            if (itemId) {
              extracted = extracted.filter((r: any) => !r.item_id || r.item_id === itemId);
            }
            // Deduplicate by ID
            const seen = new Set();
            const deduplicated = extracted.filter((r: any) => {
              if (r && r.id && !seen.has(r.id)) {
                seen.add(r.id);
                return true;
              }
              return false;
            });
            if (deduplicated.length > 0) {
              records = deduplicated;
              supabaseFailed = false;
            }
          }
        } catch (auditErr) {
          console.warn('[Audit logs fallback read error]:', auditErr);
        }
      }
    } else {
      supabaseFailed = true;
    }

    return NextResponse.json({ data: records || [] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}

// POST: Add a new interest record
export async function POST(req: Request) {
  try {
    const session = await getAuthenticatedUser(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
    }
    const body = await req.json();
    const { bill_no, item_id, date, interest_value, branch, notes } = body;

    if (!bill_no || !date || interest_value === undefined || interest_value === null || !branch) {
      return NextResponse.json({ error: 'Missing required fields: bill_no, date, interest_value, branch' }, { status: 400 });
    }

    const numericValue = parseFloat(interest_value);
    if (isNaN(numericValue)) {
      return NextResponse.json({ error: 'Invalid interest_value' }, { status: 400 });
    }

    const cleanBranch = branch.trim().toUpperCase();
    const id = 'si_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const payload: any = {
      id: id,
      bill_no: bill_no.trim(),
      date: date,
      interest_value: numericValue,
      branch: cleanBranch,
      notes: notes || '',
      created_at: new Date().toISOString()
    };
    if (item_id) {
      payload.item_id = item_id;
    }

    let insertedData: any = payload;
    let savedToSupabase = false;
    const supabaseError: string | null = null;

    if (adminSupabase) {
      try {
        // Prevent duplicate interest entries during offline tablet auto-sync
        const { data: existingRecords } = await adminSupabase
          .from('stock_interests')
          .select('*')
          .eq('bill_no', bill_no.trim())
          .eq('date', date)
          .eq('branch', cleanBranch);

        const dup = (existingRecords || []).find((r: any) => 
          parseFloat(r.interest_value) === numericValue
        );

        if (dup) {
          return NextResponse.json({ 
            success: true, 
            data: dup, 
            savedToSupabase: true,
            isDuplicate: true 
          });
        }

        const { data, error } = await adminSupabase
          .from('stock_interests')
          .insert([payload])
          .select()
          .single();

        if (error) {
          console.error('[Supabase stock_interests insert error]:', error.message);
          return NextResponse.json({ 
            error: `Failed to record stock interest in database: ${error.message}` 
          }, { status: 500 });
        }

        if (data) {
          insertedData = data;
          savedToSupabase = true;
        }

        // Record into audit_logs for permanent activity tracking
        await recordAuditLog(session, {
          action: 'RECORD_STOCK_INTEREST',
          resource: `Stock Item Interest: Bill #${payload.bill_no}`,
          branchId: cleanBranch,
          details: insertedData
        });

        // Record Transaction and General Ledger Double-Entry
        try {
          let clientId: string | null = null;
          if (item_id) {
            const { data: pawnMatch } = await adminSupabase.from('pawns').select('client_id').eq('id', item_id).maybeSingle();
            if (pawnMatch?.client_id) clientId = pawnMatch.client_id;
          }
          if (!clientId && payload.bill_no) {
            const { data: pawnMatch } = await adminSupabase.from('pawns').select('client_id').ilike('bill_no', `%${payload.bill_no}%`).limit(1).maybeSingle();
            if (pawnMatch?.client_id) clientId = pawnMatch.client_id;
          }

          // 1. Transaction log
          await adminSupabase.from('transaction').insert([{
            id: crypto.randomUUID(),
            client_id: clientId,
            type: 'INTEREST_PAYMENT',
            amount: numericValue,
            description: `Pawn Interest Payment: Bill #${payload.bill_no} (${cleanBranch})`,
            branch_id: cleanBranch,
            timestamp: new Date().toISOString()
          }]);

          // 2. Balanced Double-Entry Journal Entry
          const jeId = `JE-AUTO-INT-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
          const dateStr = date || getSriLankaDate();
          const { error: jeErr } = await adminSupabase.from('journal_entry').insert([{
            id: jeId,
            date: dateStr,
            description: `Pawn Interest Collection - Bill #${payload.bill_no} (${cleanBranch})`,
            reference: `INT-PAY-${payload.bill_no}`,
            total_debit: numericValue,
            total_credit: numericValue,
            created_by: (session as any)?.profile?.name || session?.user?.email || 'Cashier'
          }]);

          if (!jeErr) {
            await adminSupabase.from('journal_entry_line').insert([
              {
                journal_entry_id: jeId,
                account_name: 'Vault Cash (Asset)',
                debit: numericValue,
                credit: 0
              },
              {
                journal_entry_id: jeId,
                account_name: 'Interest & Fee Income (Revenue)',
                debit: 0,
                credit: numericValue
              }
            ]);
          }
        } catch (glErr) {
          console.warn('[Non-fatal GL/Transaction warning during interest payment]:', glErr);
        }
      } catch (e: any) {
        console.error('[Exception during stock_interests insert]:', e);
        return NextResponse.json({ 
          error: `Database exception: ${e?.message || 'Failed to save interest'}` 
        }, { status: 500 });
      }
    }

    // Invalidate Redis inventory cache
    try {
      await invalidateBranchInventoryCache(cleanBranch, date);
    } catch (cErr) {
      console.warn('[Cache Invalidation Warning]:', cErr);
    }

    return NextResponse.json({ 
      success: true, 
      data: insertedData, 
      savedToSupabase,
      warning: supabaseError ? `Supabase: ${supabaseError}` : undefined 
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}

// DELETE: Remove an interest record by ID
export async function DELETE(req: Request) {
  try {
    const session = await getAuthenticatedUser(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
    }
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Missing required param: id' }, { status: 400 });
    }

    if (session && session.role === 'TELLER') {
      return NextResponse.json({ 
        error: 'Direct deletion of interest payment records is prohibited for Tellers. Please request Manager/Admin authorization.' 
      }, { status: 403 });
    }

    if (adminSupabase) {
      try {
        await adminSupabase
          .from('stock_interests')
          .delete()
          .eq('id', id);
      } catch (e) {}

      // Delete from audit_logs fallback as well
      try {
        await adminSupabase
          .from('audit_logs')
          .delete()
          .eq('action', 'RECORD_STOCK_INTEREST')
          .contains('details', { id });
      } catch (e) {}
    }

    // Invalidate Redis inventory cache
    try {
      await invalidateBranchInventoryCache('ALL');
    } catch (cErr) {
      console.warn('[Cache Invalidation Warning]:', cErr);
    }

    return NextResponse.json({ success: true, message: 'Interest record deleted' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
