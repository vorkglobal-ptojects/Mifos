# RUPASINGHA CAPITAL
## Forfeiture & Ownership Removed (F/S) SMS Templates
> **ලේඛන වර්ගය / ஆவண வகை:** උකස් භාණ්ඩ සින්න වීම සහ හිමිකාරිත්වය අහෝසි වීම පිළිබඳ කෙටි පණිවිඩ ආකෘති (SMS Templates)  
> **අරමුණ / நோக்கம்:** ණය සහන කාලය ඉක්මවූ පසු උකස් භාණ්ඩයේ හිමිකාරිත්වය අහෝසි කර වෙන්දේසියට / F/S තොගයට යොමු කිරීමේදී පාරිභෝගිකයා වෙත යවන නිල SMS දැනුම්දීම.

---

### Available Placeholders / පණිවිඩ විචල්‍යයන් / மாறி குறியீடுகள்

| Placeholder | Description | උදාහරණයක් (Example) |
|---|---|---|
| `{customer_name}` | පාරිභෝගිකයාගේ නම / வாடிக்கையாளர் பெயர் | K.D. Perera |
| `{bill_no}` | උකස් බිල්පත් අංකය / அடகு பற்றுச்சீட்டு எண் | 3R-2045 |
| `{amount}` | හිඟ මුදල හෝ මුළු වටිනාකම / நிலுவைத் தொகை | 45,500 |
| `{branch}` | ශාඛාව / கிளை பெயர் | Head Office / Horana |
| `{branch_phone}` | ශාඛා දුරකථන අංකය / கிளை தொலைபேசி | 0112345678 / 0771234567 |
| `{date}` | දිනය / திகதி | 06/11/2026 |

---

## 1. Sinhala Templates (සිංහල මාධ්‍යය)

### ආකෘතිය 1 (A): Compact / කෙටි පණිවිඩය (අවම SMS වියදම සඳහා නිර්දේශිතයි)
```text
RUPASINGHA CAPITAL
ගරු {customer_name},
අංක #{bill_no} දරන ඔබගේ උකස් භාණ්ඩය සඳහා නියමිත කාලය ඉක්මවා ඇති බැවින්, එහි හිමිකාරිත්වය අහෝසි වී වෙන්දේසියට යොමු කර ඇත.
ගෙවීම් කර එය බේරාගැනීමට වහාම අපගේ {branch} ශාඛාව අමතන්න: {branch_phone}
```

### ආකෘතිය 1 (B): Formal & Detailed / නිල හා පූර්ණ දැනුම්දීම
```text
RUPASINGHA CAPITAL
ගරු {customer_name},
දැනුම්දීමයි: අංක #{bill_no} දරන ඔබගේ රන් භාණ්ඩ උකස් ගිවිසුමේ නියමිත කාලය සහ සහන කාලය ඉක්මවා ගොස් ඇත.
උකස් නීතිරීති ප්‍රකාරව එකී භාණ්ඩයේ හිමිකාරිත්වය ආයතනය වෙත පවරාගෙන (සින්න වී) වෙන්දේසි කිරීමට පියවර ගෙන ඇති බව දන්වමු.
අවසන් පියවරට පෙර හිඟ මුදල (රු. {amount}) ගෙවා බේරාගැනීමට අවශ්‍ය නම් අදම ශාඛාව අමතන්න.
විමසීම්: {branch_phone} ({branch})
```

---

## 2. Tamil Templates (தமிழ் ஊடகம்)

### வடிவம் 2 (A): Compact / சுருக்கமான வடிவம் (பரிந்துரைக்கப்படுகிறது)
```text
RUPASINGHA CAPITAL
மதிப்பிற்குரிய {customer_name},
அடகு பற்றுச்சீட்டு #{bill_no} க்கான கால அவகாசம் முடிவடைந்ததால், உடன்படிக்கையின்படி தங்கத்தின் உரிமை ரத்து செய்யப்பட்டு ஏலத்திற்கு மாற்றப்பட்டுள்ளது.
மீட்க உடனடியாக கிளைக்கு வரவும் அல்லது தொடர்பு கொள்ளவும்: {branch_phone} ({branch})
```

### வடிவம் 2 (B): Formal & Detailed / முழுமையான உத்தியோகபூர்வ அறிவிப்பு
```text
RUPASINGHA CAPITAL
மதிப்பிற்குரிய {customer_name},
உத்தியோகபூர்வ அறிவித்தல்: தங்களின் அடகு இலக்கம் #{bill_no} க்கான கடன் மற்றும் கருணை காலம் முடிவடைந்துள்ளது.
அடகு சட்ட விதிகளின்படி, குறிப்பிட்ட பொருளின் மீதான தங்களுடைய உரிமை நீக்கப்பட்டு, நிறுவனம் பறிமுதல் செய்து (F/S) பொது ஏலத்திற்கு விட நடவடிக்கை எடுக்கப்பட்டுள்ளது.
ஏலத்திற்கு முன் நிலுவைத் தொகையை (ரூ. {amount}) செலுத்தி மீட்க இன்றே எமது கிளையைத் தொடர்பு கொள்ளவும்.
அழைக்க: {branch_phone} ({branch})
```

---

## 3. Bilingual Combined Template (සිංහල + தமிழ் එකට)
*තනි පණිවිඩයකින් සිංහල සහ දෙමළ භාෂා ද්විත්වයෙන්ම යැවීමට අවශ්‍ය අවස්ථාවන් සඳහා:*

```text
RUPASINGHA CAPITAL
Notice: Ticket #{bill_no} | Due: Rs. {amount}

[SINHALA]: ගරු {customer_name}, කාලය ඉක්මවීම හේතුවෙන් අංක #{bill_no} උකස් භාණ්ඩයේ හිමිකම අහෝසි වී වෙන්දේසියට යොමුකර ඇත. වහාම අමතන්න: {branch_phone}

[TAMIL]: மதிப்பிற்குரிய {customer_name}, காலாவதியானதால் அடகு #{bill_no} உரிமை ரத்து செய்யப்பட்டு ஏலத்திற்கு மாற்றப்பட்டுள்ளது. தொடர்புக்கு: {branch_phone}
```

---

## 4. Singlish / Tanglish / English GSM-7 Fallback Templates
*(UCS-2 Unicode සඳහා වැඩි පිරිවැයක් දැරීම වෙනුවට standard 160-character GSM SMS මගින් වියදම අඩු කර යැවීමට)*

### Option 4 (A): Standard English
```text
RUPASINGHA CAPITAL
Dear {customer_name},
Pawn Ticket #{bill_no} has expired and grace period ended. As per pawning regulations, collateral ownership is revoked & scheduled for public auction.
To settle Rs. {amount} and recover items prior to auction, please contact {branch} branch immediately at {branch_phone}.
```

### Option 4 (B): Singlish (Sinhala in English letters - 1 SMS Part)
```text
RUPASINGHA CAPITAL: Golu {customer_name}, obage ukas anka #{bill_no} sandaha kaalaya ikmawa athi bavini himikam ahosi vee vendesiyata yomu kara atha. Bera ganeemata wahama amathanna: {branch_phone} ({branch}).
```

---

## 5. Technical Delivery Notes (SMS Gateway Integration)

1. **UCS-2 Unicode Encoding (Sinhala & Tamil):**
   - සිංහල හෝ දෙමළ අක්ෂර අඩංගු වන විට පණිවිඩය UCS-2 ක්‍රමයට කේතනය වේ (1 SMS = උපරිම අක්ෂර 70, කොටස් 2 ක් = අක්ෂර 134).
   - TextBee Gateway සහ Android SIM Gateway මගින් Unicode (Sinhala/Tamil) සෘජුවම නිවැරදිව පාරිභෝගිකයාගේ ජංගම දුරකථනයට යවනු ලැබේ.

2. **ස්ථානගත කිරීම (Next.js / Supabase Integration):**
   - මෙම ආකෘතිය `frontend/src/lib/sms.ts` හි `buildOwnershipRemovedForfeitureSms` ලෙස එක් කළ හැකිය.
   - Forfeiture Page (`/operations/forfeiture`) හි "Mark Forfeited" ක්‍රියාව සිදුකරන විට හෝ තනිව/තොග වශයෙන් "Send F/S SMS" බොත්තම එබූ විට ස්වයංක්‍රීයව පාරිභෝගිකයාට යැවීමට සුදුසුය.

