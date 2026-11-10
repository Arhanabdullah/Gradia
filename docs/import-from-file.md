# Import from file

Status: implemented against the linked project `fuaxyzxdhaqazcowcypi` without
changing the database. No migration was applied and no Edge Function was
deployed while producing this document. Browser sign-in was not available, so
the verification listed at the bottom is static plus scripted logic checks.

## What exists

| File | Role |
|---|---|
| `Client/src/import/parseFile.js` | Validates and parses `.xlsx`, `.xls`, `.csv`, `.json`. Extension, MIME, magic bytes, 10 MB size cap, 5,000 row cap, duplicate/blank headers, multi-sheet selection. |
| `Client/src/import/schemaUtils.js` | Normalisers, numeric and date parsing, email check, password generation, bounded concurrency, blob download, spreadsheet formula-injection guard. |
| `Client/src/import/templates.js` | Sample workbooks (data sheet plus instructions) and CSV/Excel import reports. Every report cell is passed through the formula guard. |
| `Client/src/import/modules.js` | One definition per importable table: fields, roles, context loading, row resolution, identity tokens, duplicate lookup and executor. |
| `Client/src/import/plan.js` | Decides create/update/skip/fail for every row before anything is written. |
| `Client/src/components/import/ImportWizard.jsx` | Six-step wizard: Upload, Match columns, Review, Confirm, Import, Report. |
| `Client/src/components/import/ImportButton.jsx` | Role-gated trigger used by the screens. |

The wizard never calls `result_sheets` or `result_items`. Those stay
RPC-controlled and immutable.

## Supported modules

All writes run as the signed-in user through PostgREST or the `create-user`
Edge Function, so RLS remains the real boundary. The role check in
`ImportButton` only hides controls the role cannot use.

| Module | Screen | Roles | Strategies | Notes |
|---|---|---|---|---|
| Departments | Academics, Departments tab | admin | new, skip, update | Matches on name and code. |
| Courses | Academics, Courses tab | admin | new, skip, update | Department resolved by name or code; matches `(department, name)`. |
| Classes | Academics, Classes tab | admin | new, skip, update | Department and course must exist; `department` text label kept in sync. |
| Subjects | Academics, Subjects tab | admin | new, skip, update | Catalogue only, `class_id` and `teacher_id` stay null. |
| Class subjects | Academics, Subjects tab | admin | new, skip, update | Inserts `class_subjects`; optional teacher goes to `teacher_assignments`. |
| Users | Users | admin | new, skip | Calls `create-user`. Updates are not supported for auth accounts. Blank passwords are generated and shown once in the report. |
| Exams | Exams | admin | new, skip, update | Matches `(class, name)`. |
| Marks | Marks Entry | admin, teacher | new, skip, update | Uses the class/exam/subject selected on the screen when the file omits them; RLS checks `is_subject_teacher` and `entered_by`. |

## Not supported yet

These need tables that do not exist on the linked project. No placeholder
tables were created.

| Area | Why it is blocked |
|---|---|
| Attendance | No attendance table. |
| Fees and payments | No fee table. |
| Timetable | No timetable table. |
| Assignments and submissions | No assignment table. |
| Library | No library table. |
| Parents and guardians | No parent table. |
| Academic sessions and terms | No session or term table; `classes` has no `academic_term_id` live. |
| Enrollments | No `student_enrollments` table. |
| Audit logs | No audit table and no safe client write path. |
| Result sheets and result items | Deliberately blocked: snapshots are RPC-controlled. |

PDF is not offered as an import format because none of the supported modules
has a document workflow where a parsed PDF could be verified safely.

## Validation before writing

Per row: required fields, email shape, integer and number ranges (semester
1 to 12, maximum marks 1 to 1000, marks between 0 and the subject maximum),
foreign keys resolved against freshly loaded reference data, ambiguous names
rejected, duplicate file rows reduced to one survivor, and existing records
listed as create, update, skip or fail. Rows with errors are never written;
they are reported with the reason.

Execution is bounded (`concurrency` per module, default 4), each row is
written separately, and every failure is captured in the report instead of
being ignored. Database error codes are translated (`23505` duplicate,
`23503` stale reference, `42501` permission, `23514` check violation).

## Security notes

- No service-role key in the browser. Users import through `create-user`; all
  other writes use the anon client and RLS.
- Reports and templates neutralise `=`, `+`, `-`, `@`, tab and CR at the start
  of a cell.
- File input is size and MIME checked, then magic-byte checked, and parsed
  without touching the DOM outside the wizard.
- The wizard traps focus, closes on Escape when no import is running, and
  restores focus and page scroll.

## Verification performed

- `npm run lint` and `npm run build` pass. The `xlsx` parser is emitted as a
  separate lazy chunk.
- 31 scripted logic checks passed with Node against the real modules:
  - 12 parser/template/report checks: CSV with BOM, duplicate and blank
    headers, quoted commas; header-only and empty files rejected; JSON array
    and `{ rows: [...] }`; two-sheet XLSX; wrong extension; fake `.xlsx`
    magic; binary CSV; template headers and module notes; CSV formula guard.
  - 10 module resolver checks: department, course, class, subject,
    class-subject, exam and mark resolution; range errors; student, teacher
    and subject-HOD payloads; generated password; duplicate index lookups.
  - 9 planner checks: new, skip and update strategies; repeated file rows;
    invalid rows; ambiguous existing matches; alternate identities; outcome
    summary.

Not verified here: an end-to-end run in a signed-in browser against the live
project. That still needs an admin session, a real file, and a check that each
row appears in its screen.

## Deployment prerequisite

`supabase/functions/create-user/index.js` no longer selects the absent
`classes.academic_term_id` during student validation, and treats
`student_enrollments` and `department_hod_assignments` as optional tables.
The deployed function is still version 1, so redeploy it with approval before
relying on user import for student accounts:

```bash
npx supabase functions deploy create-user --project-ref fuaxyzxdhaqazcowcypi
```
