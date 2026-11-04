const fs = require('fs');
const results = JSON.parse(fs.readFileSync('scripts/audit_all_users_results.json', 'utf8'));

const errorCounts = {};
results.forEach(r => {
  r.errors.forEach(e => {
    let key = e;
    if (e.includes('pawn DELETE')) key = 'Pawn DELETE returned 404 instead of 403 (checked DB before role)';
    if (e.includes('stock RESTORE')) key = 'Stock RESTORE returned 404 instead of 403 (checked DB before role)';
    errorCounts[key] = (errorCounts[key] || 0) + 1;
  });
});

console.log('=== ERROR PATTERN BREAKDOWN ===');
console.log(JSON.stringify(errorCounts, null, 2));

console.log('\n=== USER ROLES & BRANCHES DISCOVERED ===');
const userMap = {};
results.forEach(r => {
  if (!userMap[r.email]) {
    userMap[r.email] = { name: r.name, role: r.role, branchId: r.branchId, checks: r.checks };
  }
});
console.table(Object.keys(userMap).map(email => ({
  Name: userMap[email].name,
  Email: email,
  Role: userMap[email].role,
  AssignedBranch: userMap[email].branchId,
  StockDelBlocked: userMap[email].checks.stockDeleteLocked ? 'YES (403)' : 'N/A',
  ClientDelBlocked: userMap[email].checks.clientDeleteLocked ? 'YES (403)' : 'N/A',
  InterestDelBlocked: userMap[email].checks.interestDeleteLocked ? 'YES (403)' : 'N/A',
  TicketSubmit: userMap[email].checks.ticketSubmission ? 'SUCCESS (201)' : 'FAIL',
  SelfApproveBlocked: userMap[email].checks.ticketApproveBlockedForTeller ? 'YES (403)' : 'N/A'
})));

