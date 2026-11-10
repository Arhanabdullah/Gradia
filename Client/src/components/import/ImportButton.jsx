// Reusable "Import from file" trigger.
//
// The button is the only thing a screen has to add: it resolves the module by
// id, hides itself when the signed-in role may not import that module, and
// mounts the shared wizard in a modal. Row-level security still runs on every
// write, so this role check is a convenience, not the boundary.

import { useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "../ui";
import { useAuth } from "../../context/AuthContext";
import { getImportModule } from "../../import/modules";
import ImportWizard from "./ImportWizard";

function describeSummary(summary) {
  if (!summary) return "";
  const parts = [];
  if (summary.created) parts.push(`${summary.created} imported`);
  if (summary.updated) parts.push(`${summary.updated} updated`);
  if (summary.skipped) parts.push(`${summary.skipped} skipped`);
  if (summary.failed) parts.push(`${summary.failed} failed`);
  if (summary.invalid) parts.push(`${summary.invalid} invalid`);
  if (!parts.length) return "No records were written.";
  return `Last import: ${parts.join(", ")}.`;
}

export default function ImportButton({
  moduleId,
  label,
  variant = "subtle",
  className = "",
  defaults = {},
  disabled = false,
  onComplete,
}) {
  const { profile } = useAuth();
  const module = getImportModule(moduleId);
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState(null);

  if (!module) return null;
  const role = profile?.role;
  if (!role || !module.roles.includes(role)) return null;

  const handleComplete = (result) => {
    setSummary(result?.summary ?? null);
    onComplete?.(result);
  };

  return (
    <div className={`inline-flex flex-col items-start gap-1 ${className}`}>
      <Button
        type="button"
        variant={variant}
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-haspopup="dialog"
      >
        <Upload size={15} aria-hidden="true" />
        {label ?? `Import ${module.title.toLowerCase()}`}
      </Button>
      {summary ? (
        <p role="status" className="text-[11px] text-(--muted-foreground)">
          {describeSummary(summary)}
        </p>
      ) : null}
      {open ? (
        <ImportWizard
          module={module}
          defaults={defaults}
          onClose={() => setOpen(false)}
          onComplete={handleComplete}
        />
      ) : null}
    </div>
  );
}
