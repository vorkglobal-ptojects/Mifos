const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'frontend', 'src', 'app', 'loans', 'page.tsx');
let c = fs.readFileSync(file, 'utf8');

const isCRLF = c.includes('\r\n');
let norm = c.replace(/\r\n/g, '\n');

// 1. Remove ChangeRequestModal from PawnDetailsModal
norm = norm.replace(/\n\s*\{\/\* Maker-Checker Change Request Modal \*\/\}[\s\S]*?\/>\s*\n/, '\n');

// 2. Add inside PawnesPage right before </div>\n  );\n}\n\nconst BRANCH_ADDRESSES
const modalCode = `
    {/* Maker-Checker Change Request Modal */}
    <ChangeRequestModal
      isOpen={changeRequestTarget.isOpen}
      onClose={() => setChangeRequestTarget(prev => ({ ...prev, isOpen: false }))}
      entityType="PAWN"
      actionType={changeRequestTarget.actionType}
      entityId={changeRequestTarget.pawn?.id || ''}
      referenceNo={changeRequestTarget.pawn?.bill_no || changeRequestTarget.pawn?.pawn_ticket_no || changeRequestTarget.pawn?.id?.substring(0, 8) || 'PAWN'}
      branchId={changeRequestTarget.pawn?.branch_id || branchId || 'HQ'}
      currentData={changeRequestTarget.pawn || {}}
      initialProposedData={changeRequestTarget.proposedData}
      onSubmitted={() => {
        loadPawns();
      }}
    />`;

const target = `      </Dialog>\n    </div>\n  );\n}\n\nconst BRANCH_ADDRESSES`;
const replacement = `      </Dialog>${modalCode}\n    </div>\n  );\n}\n\nconst BRANCH_ADDRESSES`;

if (norm.includes(target)) {
  norm = norm.replace(target, replacement);
  fs.writeFileSync(file, isCRLF ? norm.replace(/\n/g, '\r\n') : norm, 'utf8');
  console.log('Successfully relocated ChangeRequestModal in loans/page.tsx');
} else {
  console.error('Target not found in loans/page.tsx');
}

