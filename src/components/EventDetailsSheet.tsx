import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Calendar,
  Clock,
  MapPin,
  Users,
  Copy,
  Share2,
  Play,
  Square,
  Trash2,
  TrendingUp,
  ChevronRight,
  Tv,
  Settings,
  Loader2,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { EventData } from "@/hooks/useEvents";
import { toast } from "sonner";

interface EventDetailsSheetProps {
  event: EventData | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdateEvent: (eventId: string, body: Record<string, unknown>) => Promise<EventData | null>;
  onGoLive: (eventId: string) => void;
  onEndEvent: (eventId: string) => void;
  onDelete: (eventId: string) => void;
}

const statusConfig = {
  draft: { label: "Draft", color: "bg-gray-500", bgColor: "bg-gray-500/20", textColor: "text-gray-400" },
  scheduled: { label: "Scheduled", color: "bg-blue-500", bgColor: "bg-blue-500/20", textColor: "text-blue-400" },
  live: { label: "Live", color: "bg-green-500", bgColor: "bg-green-500/20", textColor: "text-green-400" },
  ended: { label: "Ended", color: "bg-muted", bgColor: "bg-muted/20", textColor: "text-muted-foreground" },
};

const eventTypeOptions: { id: EventData["type"]; label: string }[] = [
  { id: "wedding", label: "Wedding" },
  { id: "birthday", label: "Birthday" },
  { id: "party", label: "Party" },
  { id: "graduation", label: "Graduation" },
  { id: "funeral", label: "Funeral" },
  { id: "naming", label: "Naming" },
  { id: "other", label: "Other" },
];

export const EventDetailsSheet = ({
  event,
  isOpen,
  onClose,
  onUpdateEvent,
  onGoLive,
  onEndEvent,
  onDelete,
}: EventDetailsSheetProps) => {
  const navigate = useNavigate();
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<EventData["type"]>("party");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [maxGuests, setMaxGuests] = useState("");

  const syncFromEvent = useCallback((e: EventData) => {
    setTitle(e.title);
    setType(e.type);
    setDescription(e.description ?? "");
    setLocation(e.location ?? "");
    setDate(e.date ?? "");
    setTime(e.time?.slice(0, 5) ?? "");
    setIsPrivate(e.isPrivate);
    setMaxGuests(e.maxParticipants != null && e.maxParticipants > 0 ? String(e.maxParticipants) : "");
  }, []);

  useEffect(() => {
    if (!event) return;
    syncFromEvent(event);
    setIsEditing(false);
  }, [event?.id, isOpen, syncFromEvent, event]);

  if (!event) return null;

  const status = statusConfig[event.status];
  const canEdit = event.status !== "ended";
  const fullEdit = event.status === "draft" || event.status === "scheduled";
  const liveEditOnly = event.status === "live";

  const handleCopyCode = () => {
    navigator.clipboard.writeText(event.eventCode);
    toast.success("Event code copied!");
  };

  const handleShare = () => {
    const shareText = `Join my event "${event.title}" on Doings! 🎉\nEvent Code: ${event.eventCode}`;

    if (navigator.share) {
      navigator.share({
        title: event.title,
        text: shareText,
        url: window.location.href,
      });
    } else {
      navigator.clipboard.writeText(shareText);
      toast.success("Event details copied!");
    }
  };

  const handleDelete = () => {
    if (event.status === "live") {
      toast.error("Cannot delete a live event. End it first.");
      return;
    }
    onDelete(event.id);
    toast.success("Event deleted");
    onClose();
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "—";
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-NG", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  };

  const handleSave = async () => {
    if (!event) return;
    setSaving(true);
    try {
      if (fullEdit) {
        if (!title.trim()) {
          toast.error("Title is required");
          setSaving(false);
          return;
        }
        let scheduled_start: string | undefined;
        if (date && time) {
          scheduled_start = `${date}T${time.length === 5 ? `${time}:00` : time}`;
        }
        const maxRaw = maxGuests.trim();
        let max_participants: number | null = null;
        if (maxRaw) {
          const n = parseInt(maxRaw, 10);
          if (!Number.isFinite(n) || n < 1) {
            toast.error("Max guests must be a positive number or leave blank for unlimited");
            setSaving(false);
            return;
          }
          max_participants = n;
        }
        await onUpdateEvent(event.id, {
          title: title.trim(),
          type,
          description: description.trim() || null,
          location: location.trim() || null,
          is_private: isPrivate,
          max_participants,
          ...(scheduled_start ? { scheduled_start } : {}),
        });
      } else if (liveEditOnly) {
        const body: Record<string, unknown> = { is_private: isPrivate };
        const maxRaw = maxGuests.trim();
        if (maxRaw) {
          const n = parseInt(maxRaw, 10);
          if (!Number.isFinite(n) || n < 1) {
            toast.error("Max guests must be a positive number or leave blank to keep unlimited");
            setSaving(false);
            return;
          }
          if (n < event.participants) {
            toast.error(`Max guests cannot be below current guest count (${event.participants})`);
            setSaving(false);
            return;
          }
          body.max_participants = n;
        } else if (event.maxParticipants != null) {
          body.max_participants = null;
        }
        await onUpdateEvent(event.id, body);
      }
      toast.success("Event updated");
      setIsEditing(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save changes");
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    syncFromEvent(event);
    setIsEditing(false);
  };

  return (
    <Sheet
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side="bottom"
        className="flex h-[90dvh] max-h-[90dvh] flex-col overflow-hidden rounded-t-3xl bg-background fixed"
      >
        <SheetHeader className="shrink-0 pb-2">
          <SheetTitle className="sr-only">Event Details</SheetTitle>
          {canEdit && (
            <div className="flex justify-end px-1">
              {!isEditing ? (
                <motion.button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-foreground"
                  whileTap={{ scale: 0.97 }}
                >
                  <Settings className="h-4 w-4" />
                  Edit
                </motion.button>
              ) : (
                <div className="flex gap-2">
                  <motion.button
                    type="button"
                    onClick={handleCancelEdit}
                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-muted-foreground"
                    whileTap={{ scale: 0.97 }}
                    disabled={saving}
                  >
                    Cancel
                  </motion.button>
                  <motion.button
                    type="button"
                    onClick={() => void handleSave()}
                    disabled={saving}
                    className="flex items-center gap-2 rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                    whileTap={{ scale: 0.97 }}
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Save
                  </motion.button>
                </div>
              )}
            </div>
          )}
        </SheetHeader>

        <div className="isolate min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-1 pb-6 [-webkit-overflow-scrolling:touch]">
          <div className="flex items-start gap-4 mb-6">
            <div
              className={`flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${event.gradient} text-4xl`}
            >
              {event.emoji}
            </div>
            <div className="flex-1 min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span
                  className={`flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${status.bgColor} ${status.textColor}`}
                >
                  <span className={`h-2 w-2 rounded-full ${status.color} ${event.status === "live" ? "animate-pulse" : ""}`} />
                  {status.label}
                </span>
              </div>
              {!isEditing || !fullEdit ? (
                <h2 className="text-2xl font-bold text-foreground break-words">{event.title}</h2>
              ) : (
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="mt-1 bg-white/5 font-bold text-lg"
                  placeholder="Event title"
                />
              )}
              <p className="mt-1 text-sm text-muted-foreground">Hosted by {event.hostName}</p>
            </div>
          </div>

          {isEditing && fullEdit && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 space-y-4 rounded-2xl border border-white/10 bg-card/40 p-4"
            >
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Type</p>
                <div className="flex flex-wrap gap-2">
                  {eventTypeOptions.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setType(opt.id)}
                      className={`rounded-xl border px-3 py-1.5 text-sm font-medium transition-colors ${
                        type === opt.id
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-white/10 bg-white/5 text-foreground"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Date & time</p>
                <div className="grid grid-cols-2 gap-3">
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="bg-white/5" />
                  <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="bg-white/5" />
                </div>
              </div>
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Location</p>
                <Input value={location} onChange={(e) => setLocation(e.target.value)} className="bg-white/5" placeholder="Venue" />
              </div>
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Description</p>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="min-h-[88px] bg-white/5"
                  placeholder="Optional details"
                />
              </div>
              <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
                <div>
                  <p className="font-medium text-foreground">Private event</p>
                  <p className="text-xs text-muted-foreground">Only people with the code can find it in search</p>
                </div>
                <Switch checked={isPrivate} onCheckedChange={setIsPrivate} />
              </div>
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Max guests</p>
                <Input
                  inputMode="numeric"
                  value={maxGuests}
                  onChange={(e) => setMaxGuests(e.target.value.replace(/\D/g, ""))}
                  className="bg-white/5"
                  placeholder="Leave blank for unlimited"
                />
              </div>
            </motion.div>
          )}

          {isEditing && liveEditOnly && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 space-y-4 rounded-2xl border border-white/10 bg-card/40 p-4"
            >
              <p className="text-sm text-muted-foreground">
                While live you can only change the guest limit and whether the event is private.
              </p>
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Max guests</p>
                <Input
                  inputMode="numeric"
                  value={maxGuests}
                  onChange={(e) => setMaxGuests(e.target.value.replace(/\D/g, ""))}
                  className="bg-white/5"
                  placeholder="Unlimited if blank"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Current guests: {event.participants}
                  {event.maxParticipants != null ? ` • Current cap: ${event.maxParticipants}` : ""}
                </p>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
                <div>
                  <p className="font-medium text-foreground">Private event</p>
                  <p className="text-xs text-muted-foreground">Hide from public event list</p>
                </div>
                <Switch checked={isPrivate} onCheckedChange={setIsPrivate} />
              </div>
            </motion.div>
          )}

          <motion.div
            className="glass mb-6 rounded-2xl p-4"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Event Code</span>
              <div className="flex gap-2">
                <motion.button
                  type="button"
                  onClick={handleCopyCode}
                  className="rounded-lg bg-white/10 p-2 transition-colors hover:bg-white/20"
                  whileTap={{ scale: 0.95 }}
                >
                  <Copy className="h-4 w-4 text-foreground" />
                </motion.button>
                <motion.button
                  type="button"
                  onClick={handleShare}
                  className="rounded-lg bg-primary/20 p-2 transition-colors hover:bg-primary/30"
                  whileTap={{ scale: 0.95 }}
                >
                  <Share2 className="h-4 w-4 text-primary" />
                </motion.button>
              </div>
            </div>
            <div className="flex items-center justify-center gap-2 rounded-xl bg-white/5 py-4">
              <span className="font-mono text-4xl font-bold tracking-widest text-primary">{event.eventCode}</span>
            </div>
            <p className="mt-2 text-center text-xs text-muted-foreground">Share this code with your guests to join</p>
          </motion.div>

          {!isEditing || !fullEdit ? (
            <div className="mb-6 space-y-4">
              <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Details</h3>

              <div className="glass flex items-center gap-4 rounded-xl p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/20">
                  <Calendar className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Date</p>
                  <p className="font-medium text-foreground">{formatDate(event.date)}</p>
                </div>
              </div>

              <div className="glass flex items-center gap-4 rounded-xl p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/20">
                  <Clock className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Time</p>
                  <p className="font-medium text-foreground">{event.time || "—"}</p>
                </div>
              </div>

              <div className="glass flex items-center gap-4 rounded-xl p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/20">
                  <MapPin className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Location</p>
                  <p className="font-medium text-foreground">{event.location || "—"}</p>
                </div>
              </div>

              {event.description ? (
                <div className="glass rounded-xl p-4">
                  <p className="mb-2 text-sm text-muted-foreground">Description</p>
                  <p className="text-foreground">{event.description}</p>
                </div>
              ) : null}

              <div className="glass flex flex-wrap items-center justify-between gap-2 rounded-xl p-4 text-sm">
                <span className="text-muted-foreground">Privacy</span>
                <span className="font-medium text-foreground">{event.isPrivate ? "Private" : "Public"}</span>
                <span className="w-full text-muted-foreground sm:w-auto">Max guests</span>
                <span className="font-medium text-foreground">
                  {event.maxParticipants != null && event.maxParticipants > 0 ? event.maxParticipants : "Unlimited"}
                </span>
              </div>
            </div>
          ) : null}

          <div className="mb-6 space-y-4">
            <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Statistics</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="glass rounded-xl p-4 text-center">
                <Users className="mx-auto mb-2 h-6 w-6 text-primary" />
                <p className="text-2xl font-bold text-foreground">{event.participants}</p>
                <p className="text-sm text-muted-foreground">Participants</p>
              </div>
              <div className="glass rounded-xl p-4 text-center">
                <TrendingUp className="mx-auto mb-2 h-6 w-6 text-primary" />
                <p className="text-2xl font-bold text-primary">₦{event.totalSprayed.toLocaleString()}</p>
                <p className="text-sm text-muted-foreground">Total Sprayed</p>
              </div>
            </div>
          </div>

          {event.status === "live" && (
            <div className="mb-2">
              <button
                type="button"
                onClick={() => navigate(`/events/${event.id}/screen`)}
                className="glass flex w-full items-center justify-between rounded-2xl p-4 text-left transition-colors hover:bg-white/10 active:bg-white/15"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent">
                    <Tv className="h-6 w-6 text-primary-foreground" />
                  </div>
                  <div className="min-w-0 text-left">
                    <p className="font-bold text-foreground">Event Screen</p>
                    <p className="text-sm text-muted-foreground">Display on TV/Projector</p>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
              </button>
            </div>
          )}

          {event.status !== "live" && (
            <div className="space-y-4">
              <h3 className="text-sm font-medium uppercase tracking-wide text-red-400">Danger Zone</h3>
              <motion.button
                type="button"
                onClick={handleDelete}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-500/20 py-3 font-semibold text-red-400"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <Trash2 className="h-5 w-5" />
                Delete Event
              </motion.button>
            </div>
          )}
        </div>

        <div className="relative z-20 shrink-0 border-t border-white/10 bg-background p-6">
          {isEditing ? (
            <p className="text-center text-xs text-muted-foreground">Use Save above to apply changes</p>
          ) : event.status === "draft" || event.status === "scheduled" ? (
            <motion.button
              type="button"
              onClick={() => {
                onGoLive(event.id);
                onClose();
              }}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 py-4 text-lg font-bold text-white transition-opacity hover:opacity-95 active:opacity-90"
              whileTap={{ scale: 0.99 }}
            >
              <Play className="h-6 w-6" />
              Go Live Now
            </motion.button>
          ) : event.status === "live" ? (
            <motion.button
              type="button"
              onClick={() => {
                onEndEvent(event.id);
                onClose();
              }}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-500 py-4 text-lg font-bold text-white transition-opacity hover:opacity-95 active:opacity-90"
              whileTap={{ scale: 0.99 }}
            >
              <Square className="h-6 w-6" />
              End Event
            </motion.button>
          ) : (
            <motion.button
              type="button"
              onClick={handleShare}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-4 text-lg font-bold text-primary-foreground transition-opacity hover:opacity-95 active:opacity-90"
              whileTap={{ scale: 0.99 }}
            >
              <Share2 className="h-6 w-6" />
              Share Event Summary
            </motion.button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};
