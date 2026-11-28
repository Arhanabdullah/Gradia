import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../context/AuthContext";
import { Button } from "../ui";

const RECENT_LIMIT = 6;

const safeLink = (link) =>
  typeof link === "string" && link.startsWith("/") && !link.startsWith("//")
    ? link
    : "/app/notifications";

export default function NotificationCenter() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const rootRef = useRef(null);
  const triggerRef = useRef(null);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    const userId = profile.id;
    const recentQuery = supabase
      .from("notifications")
      .select("id, title, body, type, link, is_read, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(RECENT_LIMIT);
    const unreadQuery = supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("is_read", false);

    const [recentRes, unreadRes] = await Promise.all([recentQuery, unreadQuery]);
    if (recentRes.error || unreadRes.error) {
      setError(`Could not load notifications: ${recentRes.error?.message ?? unreadRes.error?.message}. Refresh the page and try again.`);
      setLoading(false);
      return;
    }
    setError("");
    setItems(recentRes.data ?? []);
    setUnreadCount(unreadRes.count ?? 0);
    setLoading(false);
  }, [profile?.id]);

  useEffect(() => {
    if (!profile?.id) return;
    load();
    const channel = supabase
      .channel(`notification-center-${profile.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${profile.id}` },
        () => load(),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${profile.id}` },
        () => load(),
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "notifications", filter: `user_id=eq.${profile.id}` },
        () => load(),
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [profile?.id, load]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onPointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  if (!profile) return null;

  const markRead = async (id) => {
    const item = items.find((n) => n.id === id);
    if (item?.is_read) return;
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    setUnreadCount((count) => Math.max(0, count - 1));
    const { error: updateError } = await supabase.from("notifications").update({ is_read: true }).eq("id", id);
    if (updateError) {
      setError(`Could not mark notification read: ${updateError.message}. Try again.`);
      await load();
    }
  };

  const markAllRead = async () => {
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnreadCount(0);
    const { error: updateError } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", profile.id)
      .eq("is_read", false);
    if (updateError) {
      setError(`Could not mark notifications read: ${updateError.message}. Try again.`);
      await load();
    }
  };

  const openItem = async (notification) => {
    if (!notification.is_read) await markRead(notification.id);
    setOpen(false);
    navigate(safeLink(notification.link));
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        aria-expanded={open}
        aria-controls="notification-center-panel"
        className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-(--border) bg-(--surface-secondary) text-(--muted) transition-colors hover:border-(--primary) hover:text-(--foreground) focus-visible:outline-2 focus-visible:outline-(--primary) focus-visible:outline-offset-2"
      >
        <Bell size={16} aria-hidden="true" />
        {unreadCount > 0 ? (
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-(--danger) px-1 text-[11px] font-medium leading-4 text-(--background) tabular-nums"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          id="notification-center-panel"
          role="region"
          aria-label="Notifications"
          className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] origin-top-right rounded-xl border border-(--border) bg-(--surface) p-2 shadow-lg"
        >
          <div className="flex items-center justify-between gap-2 px-2 py-1.5">
            <p className="text-xs font-medium text-(--foreground)">Notifications</p>
            {unreadCount > 0 ? (
              <Button type="button" variant="subtle" className="px-2 py-1 text-xs" onClick={markAllRead}>
                Mark all read
              </Button>
            ) : null}
          </div>

          {error ? (
            <p role="alert" className="mx-2 mb-2 rounded-lg border border-(--danger)/40 bg-(--danger-subtle) px-3 py-2 text-xs text-(--danger)">
              {error}
            </p>
          ) : null}

          {loading ? (
            <div className="space-y-2 p-2" aria-hidden="true">
              {["a", "b", "c"].map((key) => (
                <div key={key} className="glass-inner h-12 animate-pulse rounded-lg" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-(--muted-foreground)">
              No notifications yet. When results go live or the school sends you a message, it appears here.
            </p>
          ) : (
            <ul className="max-h-96 space-y-1 overflow-y-auto">
              {items.map((notification) => (
                <li key={notification.id}>
                  <button
                    type="button"
                    onClick={() => openItem(notification)}
                    className={`w-full rounded-lg px-3 py-2 text-left transition-colors hover:bg-(--surface-secondary) focus-visible:outline-2 focus-visible:outline-(--primary) focus-visible:outline-offset-2 ${
                      notification.is_read ? "opacity-70" : ""
                    }`}
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="text-xs font-medium text-(--foreground)">{notification.title}</span>
                      {!notification.is_read ? (
                        <span aria-hidden="true" className="mt-1 h-2 w-2 shrink-0 rounded-full bg-(--danger)" />
                      ) : null}
                    </span>
                    {notification.body ? (
                      <span className="mt-0.5 block text-xs text-(--muted)">{notification.body}</span>
                    ) : null}
                    <span className="mt-1 block text-xs text-(--muted-foreground)">
                      {new Date(notification.created_at).toLocaleString()}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-1 border-t border-(--border) p-1">
            <Button
              type="button"
              variant="subtle"
              className="w-full"
              onClick={() => {
                setOpen(false);
                navigate("/app/notifications");
              }}
            >
              View all notifications
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
