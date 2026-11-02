import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../context/AuthContext";
import { Button, Empty } from "../../components/ui";
import DashboardHeader from "../../components/dashboard/DashboardHeader";

const Notifications = () => {
  const { profile } = useAuth();
  const [items, setItems] = useState(null); // null = still loading
  const [loadError, setLoadError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data, error } = await supabase
      .from("notifications")
      .select("id, title, body, is_read, created_at")
      .order("created_at", { ascending: false });
    if (error) {
      setLoadError(`Could not load notifications: ${error.message}. Refresh the page and try again.`);
      setItems([]);
      return;
    }
    setLoadError(null);
    setItems(data ?? []);
  };

  useEffect(() => {
    if (!profile) return;
    load();

    // live updates: new rows appear without a page refresh
    const channel = supabase
      .channel(`notifications-${profile.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${profile.id}` },
        (payload) => setItems((prev) => [payload.new, ...prev]),
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [profile]);

  const markRead = async (id) => {
    await supabase.from("notifications").update({ is_read: true }).eq("id", id);
    load();
  };

  const markAllRead = async () => {
    setBusy(true);
    await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("is_read", false);
    setBusy(false);
    load();
  };

  const unread = (items ?? []).filter((n) => !n.is_read).length;

  return (
    <>
      <DashboardHeader
        title="Notifications"
        subtitle={unread > 0 ? `${unread} unread` : "You’re all caught up."}
      />
      {unread > 0 && (
        <div className="mt-5">
          <Button variant="subtle" onClick={markAllRead} disabled={busy}>
            {busy ? "Marking…" : "Mark all as read"}
          </Button>
        </div>
      )}
      {loadError ? (
        <p className="mt-6 rounded-lg border border-(--danger)/40 bg-(--danger-subtle) px-4 py-3 text-xs text-(--danger)">
          {loadError}
        </p>
      ) : items === null ? (
        <div className="mt-6 space-y-2" aria-hidden="true">
          {["a", "b", "c"].map((k) => (
            <div key={k} className="glass-inner h-16 animate-pulse rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="mt-6">
          <Empty>No notifications yet. When results go live or the school sends you a message, it appears here.</Empty>
        </div>
      ) : (
        <section className="mt-6 space-y-2">
          {items.map((n) => (
            <div
              key={n.id}
              className={`glass-inner flex items-start justify-between gap-3 rounded-lg px-4 py-3 text-sm ${
                n.is_read ? "opacity-60" : ""
              }`}
            >
              <div>
                <p className="font-medium text-(--foreground)">{n.title}</p>
                <p className="mt-0.5 text-xs text-(--muted)">{n.body}</p>
                <p className="mt-1 text-xs text-(--muted-foreground)">
                  {new Date(n.created_at).toLocaleString()}
                </p>
              </div>
              {!n.is_read && (
                <Button variant="subtle" onClick={() => markRead(n.id)}>
                  Mark read
                </Button>
              )}
            </div>
          ))}
        </section>
      )}
    </>
  );
};

export default Notifications;
