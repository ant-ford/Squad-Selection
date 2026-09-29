# People and Commitments: field decisions (GATE A)

Built 2026-09-29 from a read-only fetch of the live base. `filled` counts non-empty values across all records; `active` counts Active or Member records. Every value, including dropped ones, stays in the raw JSON archive until 20 Oct.

## What the decisions mean

- **keep**: a column on the person's (or commitment's) own row, as today.
- **derive**: not stored; worked out when read (a view, a calculated column, or a database trigger such as "last changed").
- **file**: the document goes to private R2 storage; the database holds a row describing it.
- **child**: moves to a separate table with one row per item, linked back to the person. The numbered groups (Child 1-4, Relative 1-3, Club 1-4, Trial 1-5) become as many rows as a person actually has, with no empty columns and no limit of four. Kit sizes, season plans and course sign-ups work the same way, so a new supplier, season or course is a new row, not new columns.
- **link**: a reference to a row in another table, which the database keeps valid.
- **drop**: not carried into Eddy; the value stays in the raw JSON archive until it is removed after 20 Oct.

## Other tables

| Table | Decision | Why |
|---|---|---|
| Sponsors, Section Chairs, Section Captains, Membership Officers, Hockey Convenor, Kit Convenor | Merge into one `offices` table (person, role, designation, Active/Retired) | Same shape six times; sign-in, pickers, the waiting-on shortcut and signatures each loop over all six |
| Shirt Numbers | Keep | Club-wide pool of numbers with the sizes ordered; spares go to later joiners |
| Teams, Matches, Match Cards, Availability Exceptions, Availability Rules, Ability Group Configuration | Keep, 1:1 | The squad app's tables |
| Ranking Events | Keep | The ranking history screen needs old and new rank as fields |
| Membership Events | Into the activity log | It is already an activity log |
| Message Templates, Message Log | Keep, for Eddy's mail merge | Owner uses them for personalised WhatsApp messages |
| HKHA Sync State | Keep | hkha-sync's state |
| Trials History | Archive only | No longer required (owner, 2026-09-29) |
| Registration Events | Archive only | No rows; the feature was removed |


## People (333 fields, 253 records)


### 1 Identity & membership

| Field | Type | Filled | Active | Decision | Note |
|---|---|---|---|---|---|
| Name | formula/singleLineText | 253 | 210 | derive | generated from given names, preferred name and surname |
| Photo | multipleAttachments | 253 | 210 | file |  |
| Full Name | formula/singleLineText | 253 | 210 | derive | generated from given names, preferred name and surname |
| Surname | singleLineText | 253 | 210 | keep |  |
| Given Name(s) | singleLineText | 253 | 210 | keep |  |
| Chinese Name | singleLineText | 83 | 70 | keep |  |
| First Name | formula/singleLineText | 253 | 210 | derive | generated from given names, preferred name and surname |
| Preferred Name | singleLineText | 253 | 210 | keep |  |
| Registered Name | singleLineText | 203 | 195 | keep |  |
| Status | singleSelect | 253 | 210 | keep |  |
| Applicant Stage | singleSelect | 94 | 54 | keep |  |
| Stage Updated At | lastModifiedTime/dateTime | 98 | 58 | derive | trigger stamps it when Applicant Stage changes |
| Application Date | createdTime/date | 253 | 210 | keep | imported from Airtable created time; created_at afterwards |
| Applicant Type | singleSelect | 96 | 56 | keep |  |
| Join Date | date | 134 | 130 | keep |  |
| Commitment End Date | date | 112 | 107 | keep |  |
| Next Period End | formula/number | 253 | 210 | derive | view |
| Membership No. | singleLineText | 188 | 178 | keep |  |
| Active | checkbox | 167 | 167 | keep |  |
| Member Type | singleSelect | 209 | 185 | keep |  |
| Category Type | singleSelect | 213 | 187 | keep |  |
| Sports Type | singleSelect | 253 | 210 | keep |  |
| Salutation | singleSelect | 47 | 43 | keep |  |
| Email | email | 253 | 210 | keep | unique on lower(email); the 2 shared addresses are the 3 rejected applicants being deleted |
| Gender | singleSelect | 253 | 210 | keep |  |
| Last Modified Time | lastModifiedTime/dateTime | 253 | 210 | derive | updated_at trigger |

### 2 Personal details (sensitive)

| Field | Type | Filled | Active | Decision | Note |
|---|---|---|---|---|---|
| Date of Birth | date | 235 | 192 | keep |  |
| Age | formula/number | 253 | 210 | derive | view (depends on today's date) |
| Age Band | formula/singleLineText | 235 | 192 | derive | view (depends on today's date) |
| U21 Eligible | formula/checkbox | 39 | 32 | derive | view (depends on today's date) |
| HKID No. | singleLineText | 219 | 183 | keep |  |
| HKID | multipleAttachments | 154 | 123 | file |  |
| Passport No. | singleLineText | 65 | 56 | keep |  |
| Nationality | singleSelect | 235 | 192 | keep |  |
| Place of Birth | singleLineText | 42 | 39 | keep |  |
| Marital Status | singleSelect | 52 | 49 | keep |  |
| Marriage Certificate | multipleAttachments | 5 | 5 | file |  |
| Date of arrival in Hong Kong | date | 42 | 39 | keep |  |
| Academic Qualifications | multipleSelects | 37 | 34 | keep |  |
| A&E Training | singleSelect | 10 | 7 | keep |  |
| Emergency Contact | singleLineText | 226 | 185 | keep |  |
| Emergency Contact No. | phoneNumber | 227 | 186 | keep |  |
| Medical Conditions (if applicable) | singleLineText | 27 | 22 | keep |  |

### 3 Contact, address & work

| Field | Type | Filled | Active | Decision | Note |
|---|---|---|---|---|---|
| Telephone No. | phoneNumber | 51 | 39 | keep |  |
| Mobile No. | phoneNumber | 249 | 206 | keep |  |
| Home Flat/Room/Apartment/Suite | singleSelect | 161 | 122 | keep | address parts, as today |
| Home Letter/Number/Reference | singleLineText | 157 | 119 | keep | address parts, as today |
| Home Floor | singleLineText | 151 | 115 | keep | address parts, as today |
| Home Block | singleLineText | 68 | 51 | keep | address parts, as today |
| Home Building | singleLineText | 133 | 103 | keep | address parts, as today |
| Home Street | singleLineText | 166 | 128 | keep | address parts, as today |
| Home District | singleSelect | 192 | 153 | keep | address parts, as today |
| Home Region | singleSelect | 192 | 151 | keep | address parts, as today |
| Name of Company | singleLineText | 121 | 102 | keep |  |
| Business Flat/Room/Apartment/Suite | singleSelect | 31 | 27 | keep | address parts, as today |
| Business Letter/Number/Reference | singleLineText | 27 | 25 | keep | address parts, as today |
| Business Floor | singleLineText | 50 | 44 | keep | address parts, as today |
| Business Block | singleLineText | 7 | 6 | keep | address parts, as today |
| Business Building | singleLineText | 46 | 41 | keep | address parts, as today |
| Business Street | singleLineText | 48 | 44 | keep | address parts, as today |
| Business District | singleSelect | 50 | 46 | keep | address parts, as today |
| Business Region | singleSelect | 60 | 53 | keep | address parts, as today |
| Position | singleLineText | 90 | 74 | keep |  |
| Nature of Business | singleLineText | 81 | 65 | keep |  |
| Office Telephone No. | phoneNumber | 8 | 6 | keep |  |
| Office Email Address | singleLineText | 22 | 19 | keep |  |

### 4 Guardian (under 18s)

| Field | Type | Filled | Active | Decision | Note |
|---|---|---|---|---|---|
| Guardian/Parent Surname | singleLineText | 15 | 14 | keep |  |
| Guardian/Parent Given Name(s) | singleLineText | 15 | 14 | keep |  |
| Guardian/Parent Bank Account Name | singleLineText | 7 | 6 | keep |  |
| Guardian/Parent Email | email | 15 | 14 | keep |  |
| Guardian/Parent Mobile No. | phoneNumber | 14 | 13 | keep |  |
| Guardian/Parent Account Signature | multipleAttachments | 6 | 5 | file | signature |
| Guardian/Parent Consent Signature | multipleAttachments | 14 | 13 | file | signature |

### 5 Billing (sensitive)

| Field | Type | Filled | Active | Decision | Note |
|---|---|---|---|---|---|
| Bill-Payer | singleSelect | 25 | 23 | keep |  |
| Bank Name | singleSelect | 32 | 30 | keep |  |
| Bank Code | formula/singleLineText | 253 | 210 | derive | lookup from Bank Name |
| Bank Branch No. | singleLineText | 32 | 30 | keep |  |
| Bank Account No. | singleLineText | 32 | 30 | keep |  |
| Bank Contact No. | phoneNumber | 36 | 33 | keep |  |
| Bank Payment Limit | singleSelect | 224 | 198 | keep |  |
| Bank Payment Limit Amount | number | 32 | 30 | keep |  |
| Billing Preferred Channel | multipleSelects | 42 | 39 | keep |  |
| Correspondence Preferred Channel | multipleSelects | 42 | 39 | keep |  |

### 6 Family (spouse, children)

| Field | Type | Filled | Active | Decision | Note |
|---|---|---|---|---|---|
| Spouse: Yes or No | checkbox | 11 | 10 | derive | counted from family rows |
| Spouse: Surname | singleLineText | 12 | 11 | child | family_members row (relation spouse / child) |
| Spouse: Given Name(s) | singleLineText | 12 | 11 | child | family_members row (relation spouse / child) |
| Spouse: Chinese Name | singleLineText | 4 | 4 | child | family_members row (relation spouse / child) |
| Spouse: Salutation | singleSelect | 12 | 11 | child | family_members row (relation spouse / child) |
| Spouse: Photo | multipleAttachments | 12 | 11 | child | file on the family member row |
| Spouse: Signature | multipleAttachments | 9 | 9 | child | file on the family member row |
| Spouse: HKID | multipleAttachments | 6 | 6 | child | file on the family member row |
| Spouse: Date of Birth | date | 12 | 11 | child | family_members row (relation spouse / child) |
| Spouse: Gender | singleSelect | 12 | 11 | child | family_members row (relation spouse / child) |
| Spouse: Wedding Anniversary | date | 7 | 6 | child | family_members row (relation spouse / child) |
| Spouse: HKID No. | singleLineText | 12 | 11 | child | family_members row (relation spouse / child) |
| Spouse: Passport No. | singleLineText | 0 | 0 | child | family_members row (relation spouse / child) |
| Spouse: Nationality | singleSelect | 12 | 11 | child | family_members row (relation spouse / child) |
| Spouse: Personal Email Address | email | 12 | 11 | child | family_members row (relation spouse / child) |
| Spouse: Mobile No. | phoneNumber | 12 | 11 | child | family_members row (relation spouse / child) |
| Spouse: Name of Company | singleLineText | 5 | 4 | child | family_members row (relation spouse / child) |
| Spouse: Business Flat/Room/Apartment/Suite | singleSelect | 0 | 0 | child | family_members row (relation spouse / child) |
| Spouse: Business Letter/Number/Reference | singleLineText | 0 | 0 | child | family_members row (relation spouse / child) |
| Spouse: Business Floor | singleLineText | 1 | 1 | child | family_members row (relation spouse / child) |
| Spouse: Business Block | singleLineText | 0 | 0 | child | family_members row (relation spouse / child) |
| Spouse: Business Building | singleLineText | 1 | 1 | child | family_members row (relation spouse / child) |
| Spouse: Business Street | singleLineText | 1 | 1 | child | family_members row (relation spouse / child) |
| Spouse: Business District | singleSelect | 1 | 1 | child | family_members row (relation spouse / child) |
| Spouse: Business Region | singleSelect | 2 | 1 | child | family_members row (relation spouse / child) |
| Spouse: Position | singleLineText | 4 | 3 | child | family_members row (relation spouse / child) |
| Spouse: Nature of Business | singleLineText | 4 | 3 | child | family_members row (relation spouse / child) |
| Spouse: Office Email Address | email | 1 | 1 | child | family_members row (relation spouse / child) |
| Spouse: Office Telephone No. | phoneNumber | 1 | 1 | child | family_members row (relation spouse / child) |
| Number of Children | singleSelect | 253 | 210 | derive | counted from family rows |
| Child 1: Surname | singleLineText | 6 | 6 | child | family_members row (relation spouse / child) |
| Child 1: Given Name(s) | singleLineText | 6 | 6 | child | family_members row (relation spouse / child) |
| Child 1: Photo | multipleAttachments | 6 | 6 | child | file on the family member row |
| Child 1: Signature | multipleAttachments | 3 | 3 | child | file on the family member row |
| Child 1: HKID | multipleAttachments | 0 | 0 | child | file on the family member row |
| Child 1: Birth Certificate | multipleAttachments | 4 | 4 | child | file on the family member row |
| Child 1: Date of Birth | date | 6 | 6 | child | family_members row (relation spouse / child) |
| Child 1: Gender | singleSelect | 6 | 6 | child | family_members row (relation spouse / child) |
| Child 1: HKID / Passport No. | singleLineText | 3 | 3 | child | family_members row (relation spouse / child) |
| Child 2: Surname | singleLineText | 4 | 4 | child | family_members row (relation spouse / child) |
| Child 2: Given Name(s) | singleLineText | 4 | 4 | child | family_members row (relation spouse / child) |
| Child 2: Photo | multipleAttachments | 4 | 4 | child | file on the family member row |
| Child 2: Signature | multipleAttachments | 2 | 2 | child | file on the family member row |
| Child 2: HKID | multipleAttachments | 0 | 0 | child | file on the family member row |
| Child 2: Birth Certificate | multipleAttachments | 3 | 3 | child | file on the family member row |
| Child 2: Date of Birth | date | 4 | 4 | child | family_members row (relation spouse / child) |
| Child 2: Gender | singleSelect | 4 | 4 | child | family_members row (relation spouse / child) |
| Child 2: HKID / Passport No. | singleLineText | 2 | 2 | child | family_members row (relation spouse / child) |
| Child 3: Surname | singleLineText | 0 | 0 | child | family_members row (relation spouse / child) |
| Child 3: Given Name(s) | singleLineText | 0 | 0 | child | family_members row (relation spouse / child) |
| Child 3: Photo | multipleAttachments | 0 | 0 | child | file on the family member row |
| Child 3: Signature | multipleAttachments | 0 | 0 | child | file on the family member row |
| Child 3: HKID | multipleAttachments | 0 | 0 | child | file on the family member row |
| Child 3: Birth Certificate | multipleAttachments | 0 | 0 | child | file on the family member row |
| Child 3: Date of Birth | date | 0 | 0 | child | family_members row (relation spouse / child) |
| Child 3: Gender | singleSelect | 0 | 0 | child | family_members row (relation spouse / child) |
| Child 3: HKID / Passport No. | singleLineText | 0 | 0 | child | family_members row (relation spouse / child) |
| Child 4: Surname | singleLineText | 0 | 0 | child | family_members row (relation spouse / child) |
| Child 4: Given Name(s) | singleLineText | 0 | 0 | child | family_members row (relation spouse / child) |
| Child 4: Photo | multipleAttachments | 0 | 0 | child | file on the family member row |
| Child 4: Signature | multipleAttachments | 0 | 0 | child | file on the family member row |
| Child 4: HKID | multipleAttachments | 0 | 0 | child | file on the family member row |
| Child 4: Birth Certificate | multipleAttachments | 0 | 0 | child | file on the family member row |
| Child 4: Date of Birth | date | 0 | 0 | child | family_members row (relation spouse / child) |
| Child 4: Gender | singleSelect | 0 | 0 | child | family_members row (relation spouse / child) |
| Child 4: HKID / Passport No. | singleLineText | 0 | 0 | child | family_members row (relation spouse / child) |

### 7 Relatives in the club

| Field | Type | Filled | Active | Decision | Note |
|---|---|---|---|---|---|
| Number of Relatives | singleSelect | 51 | 48 | derive | counted |
| Relative 1: Name | singleLineText | 12 | 11 | child | relatives row |
| Relative 1: Membership No. | singleLineText | 12 | 11 | child | relatives row |
| Relative 1: Relationship | singleSelect | 11 | 10 | child | relatives row |
| Relative 2: Name | singleLineText | 6 | 6 | child | relatives row |
| Relative 2: Membership No. | singleLineText | 6 | 6 | child | relatives row |
| Relative 2: Relationship | singleSelect | 6 | 6 | child | relatives row |
| Relative 3: Name | singleLineText | 4 | 4 | child | relatives row |
| Relative 3: Membership No. | singleLineText | 4 | 4 | child | relatives row |
| Relative 3: Relationship | singleSelect | 4 | 4 | child | relatives row |

### 8 Kit

| Field | Type | Filled | Active | Decision | Note |
|---|---|---|---|---|---|
| Shirt No. | multipleRecordLinks | 200 | 186 | link | FK to shirt_numbers; unique club-wide. Shirt Numbers keeps each ordered kit's sizes, so unallocated kit becomes spares for later joiners |
| Shirt No Value | formula/singleLineText | 200 | 186 | derive | join to shirt_numbers |
| Stock Size (from Shirt No.) | multipleLookupValues/singleSelect | 8 | 7 | derive | join to shirt_numbers |
| Socks Size | singleSelect | 200 | 173 | child | kit_sizes row (supplier: Kukri, or Tsunami where labelled; item; size), so a new supplier is rows, not columns |
| Socks Size (Tsunami) | singleSelect | 174 | 157 | child | kit_sizes row (supplier: Kukri, or Tsunami where labelled; item; size), so a new supplier is rows, not columns |
| Shirt Size | singleSelect | 200 | 173 | child | kit_sizes row (supplier: Kukri, or Tsunami where labelled; item; size), so a new supplier is rows, not columns |
| Shirt Size (Tsunami) | singleSelect | 174 | 157 | child | kit_sizes row (supplier: Kukri, or Tsunami where labelled; item; size), so a new supplier is rows, not columns |
| Shorts Size | singleSelect | 200 | 173 | child | kit_sizes row (supplier: Kukri, or Tsunami where labelled; item; size), so a new supplier is rows, not columns |
| Shorts Size (Tsunami) | singleSelect | 174 | 157 | child | kit_sizes row (supplier: Kukri, or Tsunami where labelled; item; size), so a new supplier is rows, not columns |
| Goalie Smock Style | singleSelect | 12 | 11 | child | kit_sizes row (supplier: Kukri, or Tsunami where labelled; item; size), so a new supplier is rows, not columns |
| Goalie Smock Size | singleSelect | 12 | 11 | child | kit_sizes row (supplier: Kukri, or Tsunami where labelled; item; size), so a new supplier is rows, not columns |

### 9 Squad & selection (app)

| Field | Type | Filled | Active | Decision | Note |
|---|---|---|---|---|---|
| Player/Coach | multipleSelects | 214 | 189 | keep |  |
| Registered Team | singleSelect | 203 | 190 | keep |  |
| Is Visiting Player | checkbox | 0 | 0 | keep | empty today; the eligibility engine reads it. The Hockey Convenor maintains it in Eddy |
| Section Rank | number | 204 | 177 | keep |  |
| Rank Updated At | dateTime | 204 | 177 | keep |  |
| Team Rank | number | 232 | 198 | drop | derived in the Worker (invariant 4); stored copies are stale |
| Positional Rank | number | 232 | 198 | drop | derived in the Worker (invariant 4); stored copies are stale |
| Playing Ability | singleSelect | 241 | 208 | keep |  |
| Selected Team SOS | singleSelect | 203 | 190 | keep |  |
| Selected Team EOS | singleSelect | 203 | 190 | keep |  |
| Previous EOS | singleSelect | 179 | 171 | keep |  |
| Playing Position | singleSelect | 239 | 196 | keep |  |
| Playing Level | multipleSelects | 226 | 184 | keep |  |
| Selection Comments/Coach Requests | multilineText | 42 | 31 | keep |  |
| Is Suspended | checkbox | 0 | 0 | keep | empty today; the eligibility engine reads it. The Hockey Convenor maintains it in Eddy |
| Matches To Serve | number | 0 | 0 | keep | empty today; the eligibility engine reads it. The Hockey Convenor maintains it in Eddy |
| Ever Registered To Premier | formula/checkbox | 20 | 19 | derive | Registered Team = HKFC A |
| Opt-In Only | checkbox | 41 | 41 | keep |  |

### 10 Season planning & availability

| Field | Type | Filled | Active | Decision | Note |
|---|---|---|---|---|---|
| Playing Preference | singleSelect | 200 | 173 | child | season_plans row per person per season: empty at the start of each season; the choices (dates, events) are set per season |
| Team Captain/Vice-Captain Interest | singleSelect | 236 | 193 | child | season_plans row per person per season: empty at the start of each season; the choices (dates, events) are set per season |
| Trials Availability | multipleSelects | 200 | 173 | child | season_plans row per person per season: empty at the start of each season; the choices (dates, events) are set per season |
| Previous Trials Availability | singleLineText | 170 | 158 | drop | last season's season_plans row holds it |
| Playing Availability | multipleSelects | 236 | 193 | child | season_plans row per person per season: empty at the start of each season; the choices (dates, events) are set per season |
| Tournament Interest | multipleSelects | 201 | 173 | child | season_plans row per person per season: empty at the start of each season; the choices (dates, events) are set per season |
| Tour Interest | multipleSelects | 232 | 189 | child | season_plans row per person per season: empty at the start of each season; the choices (dates, events) are set per season |

### 11 Volunteering, committees & umpiring

| Field | Type | Filled | Active | Decision | Note |
|---|---|---|---|---|---|
| Qualified Coach | singleSelect | 252 | 209 | keep |  |
| Qualified Umpire | singleSelect | 252 | 209 | keep |  |
| Umpire Course Sign-Up (2026.08.24) | singleSelect | 252 | 209 | child | course_signups row (course, signed up, attended): the next course is a row, not a column |
| Hockey Committee Roles | multipleSelects | 200 | 173 | keep |  |
| Men's Sub-Committee | multipleSelects | 200 | 173 | keep |  |
| Team Roles | multipleSelects | 200 | 173 | keep |  |
| Touring Committee | multipleSelects | 200 | 173 | keep |  |
| Junior Hockey Volunteers | multipleSelects | 200 | 173 | keep |  |
| Easter 5s Committee | multipleSelects | 200 | 173 | keep |  |
| General Volunteers | multipleSelects | 200 | 173 | keep |  |
| Improvement Ideas | multilineText | 4 | 4 | keep |  |
| Hockey Rules Quiz 1.0 | number | 253 | 210 | child | quiz_scores row (person, quiz, score, date) |
| Hockey Rules Quiz 2.0 | number | 253 | 210 | child | quiz_scores row (person, quiz, score, date) |
| Hockey Rules Quiz 3.0 | number | 253 | 210 | child | quiz_scores row (person, quiz, score, date) |
| Umpire Course Attendance | singleSelect | 36 | 33 | child | course_signups row (course, signed up, attended): the next course is a row, not a column |

### 12 Application & sponsor assessment

| Field | Type | Filled | Active | Decision | Note |
|---|---|---|---|---|---|
| Number of Clubs | singleSelect | 253 | 210 | derive | counted |
| Club 1 | singleSelect | 3 | 3 | child | previous_clubs row |
| Club 1 Year | number | 1 | 1 | child | previous_clubs row |
| Club 2 | singleSelect | 0 | 0 | child | previous_clubs row |
| Club 2 Year | number | 0 | 0 | child | previous_clubs row |
| Club 3 | singleSelect | 0 | 0 | child | previous_clubs row |
| Club 3 Year | number | 0 | 0 | child | previous_clubs row |
| Club 4 | singleSelect | 0 | 0 | child | previous_clubs row |
| Club 4 Year | number | 0 | 0 | child | previous_clubs row |
| Number of Trials | singleSelect | 253 | 210 | derive | counted |
| Trial 1: Date | date | 23 | 21 | child | applicant_trials row |
| Trial 1: Participation Type | multipleSelects | 24 | 22 | child | applicant_trials row |
| Trial 1: Highest Division | singleSelect | 23 | 21 | child | applicant_trials row |
| Trial 2: Date | date | 12 | 11 | child | applicant_trials row |
| Trial 2: Participation Type | multipleSelects | 12 | 11 | child | applicant_trials row |
| Trial 2: Highest Division | singleSelect | 13 | 11 | child | applicant_trials row |
| Trial 3: Date | date | 2 | 1 | child | applicant_trials row |
| Trial 3: Participation Type | multipleSelects | 2 | 1 | child | applicant_trials row |
| Trial 3: Highest Division | singleSelect | 2 | 1 | child | applicant_trials row |
| Trial 4: Date | date | 0 | 0 | child | applicant_trials row |
| Trial 4: Participation Type | multipleSelects | 0 | 0 | child | applicant_trials row |
| Trial 4: Highest Division | singleSelect | 0 | 0 | child | applicant_trials row |
| Trial 5: Date | date | 0 | 0 | child | applicant_trials row |
| Trial 5: Participation Type | multipleSelects | 0 | 0 | child | applicant_trials row |
| Trial 5: Highest Division | singleSelect | 0 | 0 | child | applicant_trials row |
| Participation Details | multilineText | 23 | 21 | keep |  |
| Training Comments | aiText | 253 | 210 | keep | AI draft for the sponsor; Eddy regenerates it when the applicant submits |
| Applicant's Training Comments (Formula) | formula/singleLineText | 20 | 18 | drop | formula over another field |
| Applicant's Training Comments (Sponsor) | singleLineText | 40 | 37 | keep |  |
| Applicant Level (Sponsor) | singleSelect | 48 | 42 | keep |  |
| Sports Background / Involvement | multilineText | 91 | 53 | keep |  |
| Sports Background / Achievement of the Applicant | aiText | 253 | 210 | keep | AI draft for the sponsor; Eddy regenerates it when the applicant submits |
| Sports Background (Formula) | formula/singleLineText | 90 | 53 | drop | formula over another field |
| Sports Background (Sponsor) | singleLineText | 58 | 41 | keep |  |
| Personal / Family Interest | multilineText | 72 | 40 | keep |  |
| Sponsored By Chair | multipleRecordLinks | 45 | 41 | link | FK to the office row |
| Preferred Name (from Section Chairs) | multipleLookupValues/singleLineText | 45 | 41 | derive | lookup: a join in the view |
| Chairman: Signature | multipleAttachments | 44 | 40 | drop | copy of the officer's own signature; Eddy looks it up at PDF time |
| Section Chair Full Name | multipleLookupValues/singleLineText | 45 | 41 | derive | lookup: a join in the view |
| Email (from Section Chairs) | multipleLookupValues/email | 45 | 41 | derive | lookup: a join in the view |
| Section Chair Full Name (Scalar) | formula/singleLineText | 45 | 41 | drop | formula over another field |
| Section Chair Membership No. | multipleLookupValues/singleLineText | 45 | 41 | derive | lookup: a join in the view |
| Section Chair Designation | multipleLookupValues/singleSelect | 45 | 41 | derive | lookup: a join in the view |
| Sponsored By Membership Officer | multipleRecordLinks | 47 | 43 | link | FK to the office row |
| Preferred Name (from Membership Officers) | multipleLookupValues/singleLineText | 47 | 43 | derive | lookup: a join in the view |
| Membership Officer: Signature | multipleAttachments | 45 | 41 | drop | copy of the officer's own signature; Eddy looks it up at PDF time |
| Membership Officer Full Name | multipleLookupValues/singleLineText | 47 | 43 | derive | lookup: a join in the view |
| Membership Officer Full Name (Scalar) | formula/singleLineText | 47 | 43 | drop | formula over another field |
| Email (from Membership Officers) | multipleLookupValues/email | 47 | 43 | derive | lookup: a join in the view |
| Membership Officer Membership No. | multipleLookupValues/singleLineText | 47 | 43 | derive | lookup: a join in the view |
| Membership Officer Designation | multipleLookupValues/singleSelect | 47 | 43 | derive | lookup: a join in the view |
| Sponsored By Sponsor | multipleRecordLinks | 45 | 41 | link | FK to the office row |
| Sponsor Preferred Name | multipleLookupValues/singleLineText | 45 | 41 | derive | lookup: a join in the view |
| Sponsor: Signature | multipleAttachments | 33 | 32 | drop | copy of the officer's own signature; Eddy looks it up at PDF time |
| Sponsor Full Name | multipleLookupValues/singleLineText | 45 | 41 | derive | lookup: a join in the view |
| Email (from Sponsors) | multipleLookupValues/email | 45 | 41 | derive | lookup: a join in the view |
| Membership No. (from Sponsors) | multipleLookupValues/singleLineText | 45 | 41 | derive | lookup: a join in the view |
| Designation (from Sponsors) | multipleLookupValues/singleSelect | 45 | 41 | derive | lookup: a join in the view |
| Sponsored By Hockey Convenor | multipleRecordLinks | 5 | 4 | link | FK to the office row |
| Preferred Name (from Hockey Convenor) | multipleLookupValues/singleLineText | 5 | 4 | derive | lookup: a join in the view |
| Email (from Hockey Convenor) | multipleLookupValues/email | 5 | 4 | derive | lookup: a join in the view |
| Sponsored By Kit Convenor | multipleRecordLinks | 4 | 3 | link | FK to the office row |
| Preferred Name (from Kit Convenor) | multipleLookupValues/singleLineText | 4 | 3 | derive | lookup: a join in the view |
| Email (from Kit Convenor) | multipleLookupValues/email | 4 | 3 | derive | lookup: a join in the view |

### 13 Waivers, declarations & documents

| Field | Type | Filled | Active | Decision | Note |
|---|---|---|---|---|---|
| Signature | multipleAttachments | 48 | 47 | file | the person's own signature (officers reuse it) |
| Last Submission: Profile Update | dateTime | 171 | 169 | keep |  |
| Last Submission: Waivers & Declarations | dateTime | 159 | 157 | keep |  |
| Sports Associate Application Form | multipleAttachments | 48 | 45 | file | signed PDF kept as history; new joiners get one consolidated application PDF instead |
| Sponsor Page 7 | multipleAttachments | 41 | 38 | file | imported only where the person has no Sports Associate Application Form (page 7 is part of it); from now on Eddy keeps only the consolidated file |
| Section Membership Application Form | multipleAttachments | 49 | 46 | file | signed PDF kept as history; new joiners get one consolidated application PDF instead |
| Commitment Pledge | multipleAttachments | 37 | 35 | file | signed PDF kept as history; new joiners get one consolidated application PDF instead |
| U18 Registration Form | multipleAttachments | 163 | 161 | file | needed each season for anyone under 18 on the last 1 September; the import skips files for people 18 or over on 1 Sep 2026 |

### 14 Airtable / Fillout / Make plumbing

| Field | Type | Filled | Active | Decision | Note |
|---|---|---|---|---|---|
| Fillout Submission ID | singleLineText | 96 | 56 | drop |  |
| Record ID (Commitments) | multipleLookupValues/singleLineText | 72 | 71 | drop |  |
| Fillout - Section Captain Dashboard (Update) | formula/singleLineText | 253 | 210 | drop |  |
| Fillout - Applicant (Trials Registration (Update)) | formula/singleLineText | 49 | 14 | drop |  |
| Fillout - Applicant (New Joiner Form) | formula/singleLineText | 49 | 14 | drop |  |
| Fillout - Sponsor (Page 7) | formula/singleLineText | 49 | 14 | drop |  |
| Fillout - Sponsor (Page 7 Signature) | formula/singleLineText | 49 | 14 | drop |  |
| Fillout - Chairman (Page 7 Signature) | formula/singleLineText | 49 | 14 | drop |  |
| Fillout - Membership Officer (Page 7 Signature) | formula/singleLineText | 49 | 14 | drop |  |
| Fillout - Member (Data Update Form) | formula/singleLineText | 196 | 196 | drop |  |
| Fillout - Member (Commitment Record Picker) | formula/singleLineText | 81 | 81 | drop |  |
| Fillout - Member Waivers & Declarations | formula/singleLineText | 253 | 210 | drop |  |
| Fillout - Umpire Course Sign-Up (2026.08.24) | formula/singleLineText | 253 | 210 | drop |  |
| Fillout - Hockey Rules Quiz 1.0 | formula/singleLineText | 253 | 210 | drop |  |
| Fillout - Hockey Rules Quiz 2.0 | formula/singleLineText | 253 | 210 | drop |  |
| Fillout - Hockey Rules Quiz 3.0 | formula/singleLineText | 253 | 210 | drop |  |
| HKHA Declaration Form | formula/singleLineText | 253 | 210 | drop |  |
| Send WhatsApp | button | 253 | 210 | drop |  |
| Selected Template | multipleRecordLinks | 214 | 178 | drop | per-person copy of the mail merge; Eddy fills the template at send time (Message Templates kept, Message Log imported) |
| Template Record ID | multipleLookupValues/singleLineText | 214 | 178 | drop | per-person copy of the mail merge; Eddy fills the template at send time (Message Templates kept, Message Log imported) |
| Template Message | multipleLookupValues/multilineText | 214 | 178 | drop | per-person copy of the mail merge; Eddy fills the template at send time (Message Templates kept, Message Log imported) |
| Personalized Message | formula/singleLineText | 214 | 178 | drop | per-person copy of the mail merge; Eddy fills the template at send time (Message Templates kept, Message Log imported) |
| Message Log | multipleRecordLinks | 91 | 59 | drop | per-person copy of the mail merge; Eddy fills the template at send time (Message Templates kept, Message Log imported) |
| Template Used (from Message Log) | multipleLookupValues/multipleRecordLinks | 91 | 59 | drop | per-person copy of the mail merge; Eddy fills the template at send time (Message Templates kept, Message Log imported) |
| Record ID | formula/singleLineText | 253 | 210 | drop |  |
| Squad Selections (Player) | singleLineText | 10 | 10 | drop | legacy text, superseded by Matches |
| Squad Selections (Selected By) | singleLineText | 1 | 1 | drop | legacy text, superseded by Matches |
| Manual sort | manualSort | 253 | 210 | drop |  |

### 15 Reverse links (held on the other table)

| Field | Type | Filled | Active | Decision | Note |
|---|---|---|---|---|---|
| Commitments | multipleRecordLinks | 82 | 81 | drop | reverse link; the FK lives on the other table |
| Match Cards | multipleRecordLinks | 199 | 191 | drop | reverse link; the FK lives on the other table |
| Trials History | multipleRecordLinks | 156 | 139 | drop | reverse link; the FK lives on the other table |
| Section Captains | multipleRecordLinks | 3 | 3 | drop | reverse link; the FK lives on the other table |
| Section Chairs | multipleRecordLinks | 1 | 1 | drop | reverse link; the FK lives on the other table |
| Membership Officers | multipleRecordLinks | 3 | 3 | drop | reverse link; the FK lives on the other table |
| Sponsors | multipleRecordLinks | 11 | 11 | drop | reverse link; the FK lives on the other table |
| Hockey Convenor | multipleRecordLinks | 2 | 2 | drop | reverse link; the FK lives on the other table |
| Kit Convenor | multipleRecordLinks | 1 | 1 | drop | reverse link; the FK lives on the other table |
| Availability Exceptions (Player) | multipleRecordLinks | 113 | 112 | drop | reverse link; the FK lives on the other table |
| Availability Exceptions (Updated By) | multipleRecordLinks | 97 | 96 | drop | reverse link; the FK lives on the other table |
| Teams (Team Captain) | multipleRecordLinks | 10 | 10 | drop | reverse link; the FK lives on the other table |
| Teams (Section Captain) | multipleRecordLinks | 3 | 3 | drop | reverse link; the FK lives on the other table |
| Teams | multipleRecordLinks | 12 | 12 | drop | reverse link; the FK lives on the other table |
| Matches (Home) | multipleRecordLinks | 120 | 118 | drop | reverse link; the FK lives on the other table |
| Matches (Away) | multipleRecordLinks | 104 | 104 | drop | reverse link; the FK lives on the other table |
| Ranking Events (Actor) | multipleRecordLinks | 5 | 5 | drop | reverse link; the FK lives on the other table |
| Ranking Events (Player) | multipleRecordLinks | 199 | 172 | drop | reverse link; the FK lives on the other table |
| Teams (Auto-Select) | multipleRecordLinks | 23 | 23 | drop | reverse link; the FK lives on the other table |
| Registration Events | multipleRecordLinks | 0 | 0 | drop | reverse link; the FK lives on the other table |
| Availability Rules | multipleRecordLinks | 4 | 4 | drop | reverse link; the FK lives on the other table |
| Membership Events (Person) | multipleRecordLinks | 0 | 0 | drop | reverse link; the FK lives on the other table |
| Membership Events (Actor) | multipleRecordLinks | 1 | 1 | drop | reverse link; the FK lives on the other table |

## Commitments (78 fields, 328 records)


### Commitments

| Field | Type | Filled | Active | Decision | Note |
|---|---|---|---|---|---|
| Key | formula/singleLineText | 328 | 328 | derive | generated / view |
| Review Progress | singleSelect | 328 | 328 | keep |  |
| Review Progress Updated At | lastModifiedTime/dateTime | 328 | 328 | derive | trigger |
| People | multipleRecordLinks | 328 | 328 | link | FK person_id |
| Membership No. | multipleLookupValues/singleLineText | 328 | 328 | derive | lookup: a join in the view |
| Join Date | multipleLookupValues/date | 328 | 328 | derive | lookup: a join in the view |
| Commitment End Date | multipleLookupValues/date | 328 | 328 | derive | lookup: a join in the view |
| Qualified Umpire | multipleLookupValues/singleSelect | 328 | 328 | derive | lookup: a join in the view |
| Playing Position | multipleLookupValues/singleSelect | 328 | 328 | derive | lookup: a join in the view |
| Year # | number | 328 | 328 | keep |  |
| Period | formula/singleLineText | 328 | 328 | derive | generated / view |
| Period Start | date | 328 | 328 | keep |  |
| Period End | date | 328 | 328 | keep |  |
| Qualified Umpire (from Full Name) | multipleLookupValues/singleSelect | 328 | 328 | derive | lookup: a join in the view |
| # Games Umpired | singleSelect | 328 | 328 | keep |  |
| Selected Team SOS | multipleLookupValues/singleSelect | 328 | 328 | derive | lookup: a join in the view |
| Selected Team EOS | multipleLookupValues/singleSelect | 328 | 328 | derive | lookup: a join in the view |
| Matches: Played | number | 155 | 155 | keep | snapshot kept as history; a view computes the open period live |
| Matches: Available (Did Not Play) | number | 33 | 33 | keep | snapshot kept as history; a view computes the open period live |
| Matches: Not Available | number | 22 | 22 | keep | snapshot kept as history; a view computes the open period live |
| Matches: Team Played | number | 155 | 155 | keep | snapshot kept as history; a view computes the open period live |
| Player: Teams Played | multipleSelects | 140 | 140 | keep | snapshot kept as history; a view computes the open period live |
| Practices | singleSelect | 32 | 32 | keep |  |
| Social Functions | multipleSelects | 32 | 32 | keep |  |
| Other Contributions | richText | 32 | 32 | keep |  |
| Potential for Section service and involvement (Member) | richText | 32 | 32 | keep | review answer |
| Potential for Section service and involvement (AI) | aiText | 328 | 328 | keep | AI draft; Eddy regenerates it when the previous person submits, so it is ready for the next |
| Potential for Section service and involvement (AI - Formula) | formula/singleLineText | 328 | 328 | drop | formula over the AI draft |
| Potential for Section service and involvement (Sponsor) | multilineText | 31 | 31 | keep | review answer |
| Potential for HKFC service and involvement (Member) | richText | 31 | 31 | keep | review answer |
| Potential for HKFC service and involvement (AI) | aiText | 328 | 328 | keep | AI draft; Eddy regenerates it when the previous person submits, so it is ready for the next |
| Potential for HKFC service and involvement (AI - Formula) | formula/singleLineText | 328 | 328 | drop | formula over the AI draft |
| Potential for HKFC service and involvement (Sponsor) | multilineText | 31 | 31 | keep | review answer |
| Recommendation (AI) | aiText | 328 | 328 | keep | AI draft; Eddy regenerates it when the previous person submits, so it is ready for the next |
| Recommendation (AI - Formula) | formula/singleLineText | 328 | 328 | drop | formula over the AI draft |
| Recommendation (Sponsor) | multilineText | 32 | 32 | keep | review answer |
| Players Available for this Team | number | 32 | 32 | keep |  |
| Optimium # Players for this team | number | 31 | 31 | keep |  |
| Is Player Needed (AI) | aiText | 328 | 328 | keep | AI draft; Eddy regenerates it when the previous person submits, so it is ready for the next |
| Is Player Needed (AI - Formula) | formula/singleLineText | 328 | 328 | drop | formula over the AI draft |
| Is Player Needed (Membership Officer) | singleLineText | 32 | 32 | keep | review answer |
| Other Comments (AI) | aiText | 328 | 328 | keep | AI draft; Eddy regenerates it when the previous person submits, so it is ready for the next |
| Other Comments (AI - Formula) | formula/singleLineText | 328 | 328 | drop | formula over the AI draft |
| Other Comments (Membership Officer) | multilineText | 31 | 31 | keep | review answer |
| Other relevant information about the candidate (AI) | aiText | 328 | 328 | keep | AI draft; Eddy regenerates it when the previous person submits, so it is ready for the next |
| Other relevant information about the candidate (AI - Formula) | formula/singleLineText | 318 | 318 | drop | formula over the AI draft |
| Other relevant information about the candidate (Membership Officer) | multilineText | 28 | 28 | keep | review answer |
| Combined Context | formula/singleLineText | 328 | 328 | derive | built when the drafts are generated |
| Sponsor | multipleRecordLinks | 33 | 33 | link | FK to the office row |
| Email (from Sponsor) | multipleLookupValues/email | 33 | 33 | derive | lookup: a join in the view |
| Sponsor Preferred Name | multipleLookupValues/singleLineText | 33 | 33 | derive | lookup: a join in the view |
| Sponsor Full Name | multipleLookupValues/singleLineText | 33 | 33 | derive | lookup: a join in the view |
| Designation (from Sponsor) | multipleLookupValues/singleSelect | 33 | 33 | derive | lookup: a join in the view |
| Sponsor Signature | multipleAttachments | 30 | 30 | file |  |
| Membership Officers | multipleRecordLinks | 33 | 33 | link | FK to the office row |
| Email (from Membership Officers) | multipleLookupValues/email | 33 | 33 | derive | lookup: a join in the view |
| Membership Officer Preferred Name | multipleLookupValues/singleLineText | 33 | 33 | derive | lookup: a join in the view |
| Membership Officer Full Name | multipleLookupValues/singleLineText | 33 | 33 | derive | lookup: a join in the view |
| Designation (from Membership Officers) | multipleLookupValues/singleSelect | 33 | 33 | derive | lookup: a join in the view |
| Membership Officer Signature | multipleLookupValues/multipleAttachments | 33 | 33 | drop | Fillout link / copy held elsewhere |
| Member Submission Date | dateTime | 29 | 29 | keep |  |
| Fillout - Sponsor (Commitment Review Form) | formula/singleLineText | 328 | 328 | drop | Fillout link / copy held elsewhere |
| Fillout - Membership Officer (Commitment Review Form) | formula/singleLineText | 328 | 328 | drop | Fillout link / copy held elsewhere |
| Player Statement | multipleAttachments | 31 | 31 | file |  |
| Commitment Pledge (from People) | multipleLookupValues/multipleAttachments | 52 | 52 | drop | Fillout link / copy held elsewhere |
| Notify Now | checkbox | 0 | 0 | drop | replaced by Eddy's Notify action |
| Record ID (People) | multipleLookupValues/singleLineText | 328 | 328 | drop | Fillout link / copy held elsewhere |
| Record ID | formula/singleLineText | 328 | 328 | derive | generated / view |
| Email (from People) | multipleLookupValues/email | 328 | 328 | derive | lookup: a join in the view |
| Full Name | multipleLookupValues/singleLineText | 328 | 328 | derive | lookup: a join in the view |
| Preferred Name | multipleLookupValues/singleLineText | 328 | 328 | derive | lookup: a join in the view |
| Sports Type | multipleLookupValues/singleSelect | 328 | 328 | derive | lookup: a join in the view |
| Player: Reason for low participation | multilineText | 13 | 13 | keep |  |
| Fillout - Member (Commitment Record Picker) | multipleLookupValues/singleLineText | 324 | 324 | drop | Fillout link / copy held elsewhere |
| Outcome Draft Email | aiText | 328 | 328 | keep | AI draft; Eddy regenerates it when the previous person submits, so it is ready for the next |
| Sponsor Submission Date | dateTime | 29 | 29 | keep |  |
| Membership Officer Submission Date | dateTime | 31 | 31 | keep |  |
| Recommended Commitment Reduction | singleSelect | 314 | 314 | keep |  |
