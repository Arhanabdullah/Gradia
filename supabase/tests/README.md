# GRADIA database tests

## Phase 3 security suite

`phase3_security_tests.sql` exercises row level security and the workflow
RPCs as all five roles (admin, teacher, hod, principal, student), plus an
inactive account and a metadata attacker.

> **Status: authored, not executed.** Phase 3 was completed without any
> database connection. No result in this file or in the Phase 3 report
> claims that these scenarios were run. They must be executed against a
> **staging** project before Phase 4 relies on them.

### Safety rules

- **Never run this against production or against your only Supabase
  project.** It inserts fixture rows.
- The script opens a transaction and ends with `rollback`, so a clean run
  leaves no rows behind. Do not remove the `begin` / `rollback` pair.
- It refuses to start unless you pass `-v allow_security_tests=yes`.
- Use `psql`, not the Supabase SQL editor. The script uses `\if`, `\set`
  and `SET LOCAL ROLE`, which the SQL editor does not support.

### Prerequisites

1. A staging Supabase project with the Phase 1, Phase 2 and Phase 3
   migrations applied in filename order (see `supabase/migrations/README.md`).
2. `psql` available locally.
3. The staging connection string in an environment variable. Do not paste
   the string into a file in the repository and do not commit it.

### Running

PowerShell:

```powershell
$env:STAGING_DATABASE_URL = "postgresql://postgres:<password>@<host>:5432/postgres"
psql $env:STAGING_DATABASE_URL -v allow_security_tests=yes -f supabase/tests/phase3_security_tests.sql
```

bash:

```bash
psql "$STAGING_DATABASE_URL" -v allow_security_tests=yes \
     -f supabase/tests/phase3_security_tests.sql
```

`ON_ERROR_STOP` is on. A failing assertion aborts immediately, psql exits
non-zero and the transaction is rolled back when the connection closes.
Every successful assertion raises a `NOTICE: PASS: ...` line; the final
line is:

```
=== All Phase 3 security scenarios passed (rolling back) ===
```

### Fixture assumptions

- The script inserts rows into `auth.users` directly, which fires the
  Supabase `on_auth_user_created` trigger and creates a plain active
  student profile for each user. Roles and academic scope are then applied
  with SQL `UPDATE`s.
- Direct `auth.users` inserts are acceptable on staging only. On a
  production project use the admin API instead.
- The fixtures create two departments, two courses, two classes, four
  subjects, five exams, four result sheets and one mark per exam as
  described in the header comment of the SQL file.
- Published fixtures are created as `draft` first and published at the
  end of the fixture block. This is required because the Phase 2
  immutability guards block adding items to an already-published version.
- Audit-log assertions use `at_least`, because the number of audit rows
  depends on triggers that also fire during fixture setup.

### What is covered

1. `user_metadata` cannot mint an admin or choose a class.
2. Profile visibility per role (self, class, department, institution).
3. Class and subject visibility per role, including an inactive teacher.
4. Mark read/write scope, `entered_by` forgery, cross-class students and
   post-publication edits (teacher and admin).
5. Result sheet, item and version visibility; published immutability.
6. Workflow RPCs: wrong-role calls, double compile/review/sign/publish,
   HOD cross-scope review.
7. Published rows cannot be changed or deleted even by the migration role
   (guard triggers, not just RLS).
8. Student visibility immediately after publication.
9. Notification isolation and forged inserts.
10. Audit-log read scope and rejected direct writes.
11. Inactive accounts (reads return nothing, RPCs refuse).
12. Admin role change and reactivation of a deactivated teacher.

### What is not covered here

The Edge Functions (`create-user`, `set-user-active`) cannot be exercised
from `psql`. Verify them manually on staging:

- call `create-user` with a teacher user's token, expect `403`;
- call it with an active admin token, confirm the created profile role and
  scope, and confirm `user_metadata.role` is ignored;
- call `set-user-active` on yourself, expect `400`;
- deactivate the second admin while only one active admin remains, expect
  `400`;
- deactivate a normal account, confirm login is refused and existing
  sessions read nothing.
