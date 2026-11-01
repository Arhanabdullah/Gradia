import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { Button, Card, Empty, Field, Select, inputClass } from "../../components/ui";
import DashboardHeader from "../../components/dashboard/DashboardHeader";

const ROLES = ["student", "teacher", "hod", "principal"];

const ManageUsers = () => {
  const [users, setUsers] = useState([]);
  const [classes, setClasses] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "",
    username: "",
    email: "",
    password: "",
    role: "student",
    department: "",
    class_id: "",
  });

  const load = async () => {
    const [{ data: users }, { data: classes }] = await Promise.all([
      supabase.from("profiles").select("*").order("created_at", { ascending: false }),
      supabase.from("classes").select("id, name"),
    ]);
    setUsers(users ?? []);
    setClasses(classes ?? []);
  };

  useEffect(() => {
    load();
  }, []);

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const createUser = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const payload = {
      email: form.email.trim(),
      password: form.password,
      name: form.name.trim(),
      username: form.username.trim() || form.email.split("@")[0],
      role: form.role,
      department: form.department.trim(),
      class_id: form.role === "student" ? form.class_id : "",
    };
    const { error: fnError } = await supabase.functions.invoke("create-user", { body: payload });
    setBusy(false);
    if (fnError) {
      setError(
        `Could not create the account. Make sure the "create-user" Edge Function is deployed.\n(${fnError.message})`,
      );
      return;
    }
    setForm({ name: "", username: "", email: "", password: "", role: "student", department: "", class_id: "" });
    load();
  };

  const toggleActive = async (user) => {
    await supabase
      .from("profiles")
      .update({ is_active: !user.is_active })
      .eq("id", user.id);
    load();
  };

  return (
    <>
      <DashboardHeader title="Users" subtitle="Create accounts and manage access." />

      <Card className="mt-6">
        <form onSubmit={createUser} className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name">
            <input className={inputClass} value={form.name} onChange={set("name")} required />
          </Field>
          <Field label="Username">
            <input className={inputClass} value={form.username} onChange={set("username")} placeholder="auto from email" />
          </Field>
          <Field label="Email">
            <input type="email" className={inputClass} value={form.email} onChange={set("email")} required />
          </Field>
          <Field label="Password">
            <input type="text" className={inputClass} value={form.password} onChange={set("password")} required minLength={6} />
          </Field>
          <Field label="Role">
            <Select value={form.role} onChange={set("role")}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r.toUpperCase()}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Department">
            <input className={inputClass} value={form.department} onChange={set("department")} />
          </Field>
          {form.role === "student" && (
            <Field label="Class">
              <Select value={form.class_id} onChange={set("class_id")}>
                <option value="">— none —</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <div className="sm:col-span-2">
            {error ? (
              <p className="mb-3 whitespace-pre-line text-xs text-red-500">{error}</p>
            ) : null}
            <Button type="submit" disabled={busy}>
              {busy ? "Creating…" : "Create account"}
            </Button>
          </div>
        </form>
      </Card>

      <section className="mt-8">
        <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-(--muted-foreground)">
          All accounts
        </p>
        <div className="mt-3 space-y-2">
          {users.length === 0 && <Empty>No accounts yet.</Empty>}
          {users.map((u) => (
            <div key={u.id} className="glass-inner flex items-center justify-between gap-3 rounded-lg px-4 py-2.5 text-sm">
              <div className="min-w-0">
                <p className="truncate text-(--foreground)">
                  {u.name} <span className="text-(--muted-foreground)">· {u.email}</span>
                </p>
                <p className="text-[10px] text-(--muted-foreground)">
                  {u.role.toUpperCase()}
                  {u.department ? ` · ${u.department}` : ""}
                  {!u.is_active ? " · INACTIVE" : ""}
                </p>
              </div>
              {u.role !== "admin" && (
                <Button variant={u.is_active ? "danger" : "success"} onClick={() => toggleActive(u)}>
                  {u.is_active ? "Deactivate" : "Activate"}
                </Button>
              )}
            </div>
          ))}
        </div>
      </section>
    </>
  );
};

export default ManageUsers;
