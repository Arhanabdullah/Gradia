import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../context/AuthContext";
import { Button, Empty } from "../../components/ui";
import DashboardHeader from "../../components/dashboard/DashboardHeader";

const Notifications = () => {
  const { profile } = useAuth();
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await supabase
      .from("notifications")
      .select("id, title, body, is_read, created_at")
      .order("created_at", { ascending: false });
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

  const unread = items.filter((n) => !n.is_read).length;

  return (
    <>
      <DashboardHeader
        title="Notifications"
        subtitle={unread > 0 ? `${unread} unread` : "You're all caught up."}
      />
      {unread > 0 && (
        <div className="mt-5">
          <Button variant="subtle" onClick={markAllRead} disabled={busy}>
            {busy ? "Marking…" : "Mark all as read"}
          </Button>
        </div>
      )}
      <section className="mt-6 space-y-2">
        {items.length === 0 && <Empty>No notifications yet.</Empty>}
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
              <p className="mt-1 text-[10px] text-(--muted-foreground)">
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
    </>
  );
};

export default Notifications;
