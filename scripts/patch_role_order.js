const fs = require('fs');
const path = require('path');

// 1. Patch pawns/[id]/route.ts
const pawnsFile = path.join(__dirname, '..', 'frontend', 'src', 'app', 'api', 'pawns', '[id]', 'route.ts');
let pContent = fs.readFileSync(pawnsFile, 'utf8');
const pCRLF = pContent.includes('\r\n');
let pNorm = pContent.replace(/\r\n/g, '\n');

const pTarget = `    // Fetch pawn details first to verify branch authorization and description / bill_no
    const { data: pawn, error: fetchErr } = await adminSupabase.from('pawns').select('*').eq('id', id).single();
    if (fetchErr || !pawn) {
      return NextResponse.json({ error: 'Pawn ticket not found' }, { status: 404 });
    }

    if (session && session.role === 'TELLER') {
      return NextResponse.json({ 
        error: 'Direct pawn deletion is strictly prohibited for Tellers. Please submit a Change Request Ticket for Manager/Admin review.' 
      }, { status: 403 });
    }`;

const pReplace = `    if (session && session.role === 'TELLER') {
      return NextResponse.json({ 
        error: 'Direct pawn deletion is strictly prohibited for Tellers. Please submit a Change Request Ticket for Manager/Admin review.' 
      }, { status: 403 });
    }

    // Fetch pawn details first to verify branch authorization and description / bill_no
    const { data: pawn, error: fetchErr } = await adminSupabase.from('pawns').select('*').eq('id', id).single();
    if (fetchErr || !pawn) {
      return NextResponse.json({ error: 'Pawn ticket not found' }, { status: 404 });
    }`;

if (pNorm.includes(pTarget)) {
  pNorm = pNorm.replace(pTarget, pReplace);
  fs.writeFileSync(pawnsFile, pCRLF ? pNorm.replace(/\n/g, '\r\n') : pNorm, 'utf8');
  console.log('✓ Successfully moved Teller lock first in pawns/[id]/route.ts');
} else {
  console.warn('Warning: pTarget not found');
}

// 2. Patch stock/restore/route.ts
const restoreFile = path.join(__dirname, '..', 'frontend', 'src', 'app', 'api', 'stock', 'restore', 'route.ts');
let rContent = fs.readFileSync(restoreFile, 'utf8');
const rCRLF = rContent.includes('\r\n');
let rNorm = rContent.replace(/\r\n/g, '\n');

const rTarget = `    // 1. Fetch item from stock_items
    const { data: item, error: fetchErr } = await adminSupabase
      .from('stock_items')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !item) {
      return NextResponse.json({ error: 'Stock item not found' }, { status: 404 });
    }

    // Direct restore prohibited for TELLER
    if (session && session.role === 'TELLER') {
      return NextResponse.json({ 
        error: 'Direct stock restore to safe is prohibited for Tellers. Please submit a Change Request Ticket for Manager approval.' 
      }, { status: 403 });
    }`;

const rReplace = `    // Direct restore prohibited for TELLER
    if (session && session.role === 'TELLER') {
      return NextResponse.json({ 
        error: 'Direct stock restore to safe is prohibited for Tellers. Please submit a Change Request Ticket for Manager approval.' 
      }, { status: 403 });
    }

    // 1. Fetch item from stock_items
    const { data: item, error: fetchErr } = await adminSupabase
      .from('stock_items')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !item) {
      return NextResponse.json({ error: 'Stock item not found' }, { status: 404 });
    }`;

if (rNorm.includes(rTarget)) {
  rNorm = rNorm.replace(rTarget, rReplace);
  fs.writeFileSync(restoreFile, rCRLF ? rNorm.replace(/\n/g, '\r\n') : rNorm, 'utf8');
  console.log('✓ Successfully moved Teller lock first in stock/restore/route.ts');
} else {
  console.warn('Warning: rTarget not found');
}

