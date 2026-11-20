import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { Button, Card, Field, Select, StatusChip, inputClass } from "../components/ui";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import ImportButton from "../components/import/ImportButton";
import { useAuth } from "../context/AuthContext";
import { callRpc } from "../lib/db";
import { CLASSWORK_KIND_LABEL as KIND_LABEL } from "../lib/exams";

const MISSING_TABLE = new Set(["42P01", "PGRST205"]);

function isMissingTable(error) {
  return Boolean(error) && (MISSING_TABLE.has(error.code) || /does not exist|schema cache|could not find the table/i.test(error.message ?? ""));
}

const EMPTY_BRIEF = {
  kind: "assignment",
  classId: "",
  subjectId: "",
  title: "",
  description: "",
  instructions: "",
  deadline: "",
};

function deadlineText(value) {
  if (!value) return "No deadline";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function deadlineState(value) {
  if (!value) return "none";
  const date = new Date(value).getTime();
  if (Number.isNaN(date)) return "none";
  if (date < Date.now()) return "past";
  if (date - Date.now() < 48 * 60 * 60 * 1000) return "soon";
  return "open";
}

export default function Classwork() {
  const { profile } = useAuth();
  const role = profile?.role;
  const isStudent = role === "student";
  const canManage = ["teacher", "admin", "exam_cell"].includes(role);

  const [items, setItems] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [classes, setClasses] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [classSubjects, setClassSubjects] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [brief, setBrief] = useState(EMPTY_BRIEF);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [answers, setAnswers] = useState({});
  const [busyItem, setBusyItem] = useState("");

  const load = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const itemQuery = supabase
        .from("classwork_items")
        .select(
          `id, kind, class_id, subject_id, teacher_id, title, description, instructions,
           deadline, published, published_at, created_at,
           classes ( id, name, academic_year, semester, section ),
           subjects ( id, name, code )`,
        )
        .order("created_at", { ascending: false });
      if (isStudent) {
        itemQuery.eq("published", true);
        if (profile?.class_id) itemQuery.eq("class_id", profile.class_id);
      }

      const [itemsRes, submissionsRes, classesRes, subjectsRes, classSubjectsRes, assignmentsRes] =
        await Promise.all([
          itemQuery,
          supabase
            .from("classwork_submissions")
            .select("id, item_id, student_id, status, answer, file_url, submitted_at, feedback, reviewed_at, profiles ( name, username )"),
          supabase.from("classes").select("id, name, academic_year, semester, section").order("name"),
          supabase.from("subjects").select("id, name, code").order("code"),
          supabase.from("class_subjects").select("id, class_id, subject_id"),
          role === "teacher"
            ? supabase.from("teacher_assignments").select("id, class_id, subject_id, teacher_id").eq("teacher_id", profile?.id ?? "")
            : supabase.from("teacher_assignments").select("id, class_id, subject_id, teacher_id"),
        ]);

      if (isMissingTable(itemsRes.error)) {
        setLoadError("Classwork is not set up on this database yet. Ask an administrator to apply the classwork migration.");
        setItems([]);
        setSubmissions([]);
        setLoading(false);
        return;
      }
      if (itemsRes.error) throw new Error(itemsRes.error.message);

      setItems(itemsRes.data ?? []);
      setSubmissions(submissionsRes.error ? [] : (submissionsRes.data ?? []));
      setClasses(classesRes.data ?? []);
      setSubjects(subjectsRes.data ?? []);
      setClassSubjects(classSubjectsRes.data ?? []);
      setAssignments(assignmentsRes.data ?? []);
    } catch (err) {
      setLoadError(err?.message ?? "Could not load classwork.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, profile?.role]);

  const classById = useMemo(() => new Map(classes.map((klass) => [klass.id, klass])), [classes]);
  const subjectById = useMemo(() => new Map(subjects.map((subject) => [subject.id, subject])), [subjects]);

  const manageableClasses = useMemo(() => {
    if (role === "teacher") {
      const ids = new Set(assignments.map((row) => row.class_id));
      return classes.filter((klass) => ids.has(klass.id));
    }
    return classes;
  }, [role, assignments, classes]);

  const briefSubjects = useMemo(() => {
    if (!brief.classId) return [];
    const offered = new Set(
      classSubjects.filter((row) => row.class_id === brief.classId).map((row) => row.subject_id),
    );
    const mine = new Set(
      assignments
        .filter((row) => row.class_id === brief.classId)
        .filter((row) => role !== "teacher" || row.teacher_id === profile?.id)
        .map((row) => row.subject_id),
    );
    return subjects
      .filter((subject) => offered.has(subject.id))
      .filter((subject) => (role === "teacher" ? mine.has(subject.id) : true))
      .sort((a, b) => String(a.code ?? "").localeCompare(String(b.code ?? "")));
  }, [brief.classId, classSubjects, subjects, assignments, role, profile]);

  const mySubmissions = useMemo(() => {
    if (!isStudent) return new Map();
    const map = new Map();
    submissions.forEach((row) => map.set(row.item_id, row));
    return map;
  }, [isStudent, submissions]);

  const submissionsByItem = useMemo(() => {
    const map = new Map();
    submissions.forEach((row) => {
      if (!map.has(row.item_id)) map.set(row.item_id, []);
      map.get(row.item_id).push(row);
    });
    return map;
  }, [submissions]);

  const createBrief = async () => {
    setSaving(true);
    setNotice("");
    try {
      if (!brief.classId || !brief.subjectId || !brief.title.trim()) {
        throw new Error("Choose a class and subject, then give the classwork a title.");
      }
      const teacherId =
        assignments.find((row) => row.class_id === brief.classId && row.subject_id === brief.subjectId)?.teacher_id ??
        profile?.id ??
        null;

      const { data, error } = await supabase
        .from("classwork_items")
        .insert({
          kind: brief.kind,
          class_id: brief.classId,
          subject_id: brief.subjectId,
          teacher_id: role === "teacher" ? profile?.id ?? teacherId : teacherId,
          title: brief.title.trim(),
          description: brief.description.trim(),
          instructions: brief.instructions.trim(),
          deadline: brief.deadline ? new Date(brief.deadline).toISOString() : null,
          created_by: profile?.id ?? null,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);

      await callRpc("publish_classwork_item", { p_item_id: data.id });
      setNotice(`${KIND_LABEL[brief.kind]} published to the class. Students have been notified.`);
      setBrief(EMPTY_BRIEF);
      setShowForm(false);
      await load();
    } catch (err) {
      setLoadError(err?.message ?? "Could not publish this classwork.");
    } finally {
      setSaving(false);
    }
  };

  const submitWork = async (item, draft) => {
    setBusyItem(item.id);
    setNotice("");
    try {
      await callRpc("submit_classwork", {
        p_item_id: item.id,
        p_answer: answers[item.id] ?? "",
        p_file_url: null,
        p_draft: Boolean(draft),
      });
      setNotice(draft ? "Draft saved." : "Submitted. Your teacher can now review it.");
      setAnswers((current) => ({ ...current, [item.id]: "" }));
      await load();
    } catch (err) {
      setLoadError(err?.message ?? "Could not submit this classwork.");
    } finally {
      setBusyItem("");
    }
  };

  const review = async (submission, status) => {
    setBusyItem(submission.id);
    setNotice("");
    try {
      await callRpc("review_classwork_submission", {
        p_submission_id: submission.id,
        p_status: status,
        p_feedback: status === "returned" ? "Please revise and resubmit." : "Reviewed.",
      });
      setNotice(status === "returned" ? "Submission returned to the student." : "Submission marked reviewed.");
      await load();
    } catch (err) {
      setLoadError(err?.message ?? "Could not review this submission.");
    } finally {
      setBusyItem("");
    }
  };

  const title = isStudent ? "Classwork" : "Assignments, quizzes and projects";
  const subtitle = isStudent
    ? "Assignments, quizzes, projects and deadlines set by your teachers."
    : "Publish assignments, quizzes and projects, set deadlines and track submissions.";

  return (
    <>
      <DashboardHeader title={title} subtitle={subtitle} />

      {canManage && !isStudent ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => setShowForm((value) => !value)}>
              {showForm ? "Hide form" : "New assignment, quiz or project"}
            </Button>
            <ImportButton moduleId="classwork" label="Import classwork" onComplete={load} />
          </div>
          <p className="text-xs text-(--muted-foreground)">
            {items.length} published item{items.length === 1 ? "" : "s"}
          </p>
        </div>
      ) : null}

      {showForm ? (
        <Card className="mt-4">
          <p className="text-sm font-medium text-(--foreground)">New classwork</p>
          <p className="mt-1 text-xs text-(--muted-foreground)">
            Set the deadline, instructions and submission details. Publishing notifies every student in the class.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Kind">
              <Select
                value={brief.kind}
                onChange={(event) => setBrief({ ...brief, kind: event.target.value })}
              >
                <option value="assignment">Assignment</option>
                <option value="quiz">Quiz</option>
                <option value="project">Project</option>
              </Select>
            </Field>
            <Field label="Class">
              <Select
                value={brief.classId}
                onChange={(event) => setBrief({ ...brief, classId: event.target.value, subjectId: "" })}
              >
                <option value="">Choose a class</option>
                {manageableClasses.map((klass) => (
                  <option key={klass.id} value={klass.id}>{klass.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Subject">
              <Select
                value={brief.subjectId}
                onChange={(event) => setBrief({ ...brief, subjectId: event.target.value })}
                disabled={!brief.classId}
              >
                <option value="">{brief.classId ? "Choose a subject" : "Choose a class first"}</option>
                {briefSubjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.code ? `${subject.code} ${subject.name}` : subject.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Title">
                <input
                  type="text"
                  className={inputClass}
                  value={brief.title}
                  onChange={(event) => setBrief({ ...brief, title: event.target.value })}
                  placeholder="Data structures lab report"
                />
              </Field>
            </div>
            <Field label="Deadline">
              <input
                type="datetime-local"
                className={inputClass}
                value={brief.deadline}
                onChange={(event) => setBrief({ ...brief, deadline: event.target.value })}
              />
            </Field>
            <div className="sm:col-span-2 lg:col-span-3">
              <Field label="Description">
                <textarea
                  rows={3}
                  className={inputClass}
                  value={brief.description}
                  onChange={(event) => setBrief({ ...brief, description: event.target.value })}
                  placeholder="What the student must produce"
                />
              </Field>
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <Field label="Submission instructions">
                <textarea
                  rows={2}
                  className={inputClass}
                  value={brief.instructions}
                  onChange={(event) => setBrief({ ...brief, instructions: event.target.value })}
                  placeholder="File format, naming, what to include"
                />
              </Field>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button type="button" variant="subtle" onClick={() => setShowForm(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="button" onClick={createBrief} disabled={saving}>
              {saving ? "Publishing..." : "Publish to class"}
            </Button>
          </div>
        </Card>
      ) : null}

      {notice ? <p role="status" className="mt-4 text-xs text-(--success)">{notice}</p> : null}
      {loadError ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-(--danger)/40 px-4 py-3">
          <p className="text-xs text-(--danger)">{loadError}</p>
          <Button type="button" variant="subtle" onClick={load}>Try again</Button>
        </div>
      ) : null}

      {loading ? <div className="glass-inner mt-4 h-32 motion-safe:animate-pulse rounded-xl" /> : null}

      {!loading && !loadError && items.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-(--border) px-4 py-8 text-center">
          <p className="text-sm font-medium text-(--foreground)">No classwork yet.</p>
          <p className="mt-1 text-xs text-(--muted-foreground)">
            {isStudent
              ? "Your teachers have not published an assignment, quiz or project for your class."
              : "Publish the first assignment, quiz or project to get started."}
          </p>
        </div>
      ) : null}

      <section className="mt-4 space-y-3">
        {items.map((item) => {
          const klass = classById.get(item.class_id);
          const subject = subjectById.get(item.subject_id) ?? item.subjects;
          const itemSubmissions = submissionsByItem.get(item.id) ?? [];
          const mine = mySubmissions.get(item.id) ?? null;
          const state = deadlineState(item.deadline);
          const open = expanded === item.id;
          return (
            <Card key={item.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-(--muted-foreground)">
                    {KIND_LABEL[item.kind] ?? "Classwork"}
                    {klass ? `, ${klass.name}` : ""}
                    {subject ? `, ${subject.code ? `${subject.code} ` : ""}${subject.name}` : ""}
                  </p>
                  <h3 className="mt-1 text-base font-semibold tracking-tight text-(--foreground)">{item.title}</h3>
                  <p className="mt-1 text-xs text-(--muted-foreground)">
                    Due {deadlineText(item.deadline)}
                    {state === "past" ? ", deadline passed" : state === "soon" ? ", due soon" : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {isStudent ? (
                    <StatusChip status={mine?.status === "graded" ? "published" : mine?.status ?? "draft"} />
                  ) : (
                    <span className="rounded-full border border-(--border) px-2.5 py-1 text-[11px] text-(--muted-foreground)">
                      {itemSubmissions.length} submission{itemSubmissions.length === 1 ? "" : "s"}
                    </span>
                  )}
                  {!isStudent ? (
                    <Button type="button" variant="subtle" onClick={() => setExpanded(open ? null : item.id)}>
                      {open ? "Hide submissions" : "View submissions"}
                    </Button>
                  ) : null}
                </div>
              </div>

              {item.description ? (
                <p className="mt-3 whitespace-pre-line text-sm text-(--foreground)">{item.description}</p>
              ) : null}
              {item.instructions ? (
                <p className="mt-2 rounded-lg border border-(--border-subtle) bg-(--surface-secondary)/40 px-3 py-2 text-xs text-(--muted-foreground)">
                  {item.instructions}
                </p>
              ) : null}

              {isStudent ? (
                <div className="mt-4">
                  {mine ? (
                    <div className="rounded-lg border border-(--border) px-3 py-2 text-xs text-(--muted-foreground)">
                      <p>
                        You submitted on {deadlineText(mine.submitted_at)}. Status: {mine.status}.
                      </p>
                      {mine.feedback ? <p className="mt-1">Feedback: {mine.feedback}</p> : null}
                    </div>
                  ) : null}
                  <div className="mt-2">
                    <Field label={mine ? "Update your answer" : "Your answer"}>
                      <textarea
                        rows={3}
                        className={inputClass}
                        value={answers[item.id] ?? ""}
                        onChange={(event) => setAnswers({ ...answers, [item.id]: event.target.value })}
                        placeholder="Type your submission, or paste a link to your file"
                      />
                    </Field>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        onClick={() => submitWork(item, false)}
                        disabled={busyItem === item.id || (state === "past" && mine?.status !== "returned")}
                      >
                        {busyItem === item.id ? "Saving..." : mine ? "Resubmit" : "Submit classwork"}
                      </Button>
                      <Button
                        type="button"
                        variant="subtle"
                        onClick={() => submitWork(item, true)}
                        disabled={busyItem === item.id || (state === "past" && mine?.status !== "returned")}
                      >
                        Save draft
                      </Button>
                    </div>
                    {state === "past" && mine?.status === "returned" ? (
                      <p className="mt-2 text-xs text-(--warning)">
                        The deadline has passed, but your teacher returned this work, so you can still resubmit it.
                      </p>
                    ) : null}
                    {state === "past" && !mine ? (
                      <p className="mt-2 text-xs text-(--danger)">
                        The deadline has passed. Contact your teacher if you still need to submit.
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {!isStudent && open ? (
                <div className="mt-4 rounded-xl border border-(--border)">
                  <p className="border-b border-(--border) px-3 py-2 text-xs font-medium text-(--foreground)">
                    Submissions
                  </p>
                  {itemSubmissions.length === 0 ? (
                    <p className="px-3 py-4 text-xs text-(--muted-foreground)">
                      No student has submitted yet. Students are notified when this is published and again before the
                      deadline.
                    </p>
                  ) : (
                    <ul className="divide-y divide-(--border)">
                      {itemSubmissions.map((submission) => (
                        <li key={submission.id} className="px-3 py-2.5">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="text-xs font-medium text-(--foreground)">
                                {submission.profiles?.name ?? "Student"}
                                {submission.profiles?.username ? ` (${submission.profiles.username})` : ""}
                              </p>
                              <p className="mt-0.5 text-[11px] text-(--muted-foreground)">
                                {submission.status}
                                {submission.submitted_at ? `, ${deadlineText(submission.submitted_at)}` : ""}
                              </p>
                              {submission.answer ? (
                                <p className="mt-1 whitespace-pre-line text-xs text-(--foreground)">{submission.answer}</p>
                              ) : null}
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              <Button
                                type="button"
                                variant="subtle"
                                onClick={() => review(submission, "graded")}
                                disabled={busyItem === submission.id}
                              >
                                Mark reviewed
                              </Button>
                              <Button
                                type="button"
                                variant="subtle"
                                onClick={() => review(submission, "returned")}
                                disabled={busyItem === submission.id}
                              >
                                Return
                              </Button>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </Card>
          );
        })}
      </section>
    </>
  );
}
