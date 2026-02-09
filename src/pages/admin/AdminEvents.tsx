import { useState } from "react";
import { 
  Search, 
  MoreHorizontal,
  Flag,
  FlagOff,
  StopCircle,
  Eye,
  Users,
  Gift,
  Coins,
  AlertTriangle
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAdminData } from "@/hooks/useAdminData";
import { AdminEvent } from "@/types/admin";
import { format, formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

export const AdminEvents = () => {
  const { events, flagEvent, unflagEvent, endEvent } = useAdminData();
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [selectedEvent, setSelectedEvent] = useState<AdminEvent | null>(null);
  const [actionType, setActionType] = useState<"flag" | "end" | "view" | null>(null);
  const [flagReason, setFlagReason] = useState("");

  const liveEvents = events.filter(e => e.status === "live");
  const upcomingEvents = events.filter(e => e.status === "upcoming");
  const endedEvents = events.filter(e => e.status === "ended");
  const flaggedEvents = events.filter(e => e.flagged);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const filteredEvents = (eventList: AdminEvent[]) => {
    return eventList.filter((event) => {
      const matchesSearch = 
        event.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        event.hostName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        event.code.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesType = typeFilter === "all" || event.type === typeFilter;
      
      return matchesSearch && matchesType;
    });
  };

  const getTypeBadge = (type: AdminEvent["type"]) => {
    const colors: Record<string, string> = {
      wedding: "bg-pink-500/20 text-pink-400",
      birthday: "bg-purple-500/20 text-purple-400",
      party: "bg-primary/20 text-primary",
      corporate: "bg-secondary/20 text-secondary",
      other: "bg-muted text-muted-foreground",
    };
    return (
      <Badge className={`${colors[type]} border-0 capitalize`}>
        {type}
      </Badge>
    );
  };

  const getStatusBadge = (status: AdminEvent["status"]) => {
    switch (status) {
      case "live":
        return (
          <Badge className="bg-success/20 text-success border-0 gap-1">
            <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
            Live
          </Badge>
        );
      case "upcoming":
        return <Badge className="bg-primary/20 text-primary border-0">Upcoming</Badge>;
      case "ended":
        return <Badge variant="outline" className="text-muted-foreground">Ended</Badge>;
    }
  };

  const handleFlag = () => {
    if (!selectedEvent) return;
    flagEvent(selectedEvent.id, flagReason);
    toast.success("Event flagged for review");
    setSelectedEvent(null);
    setActionType(null);
    setFlagReason("");
  };

  const handleUnflag = (event: AdminEvent) => {
    unflagEvent(event.id);
    toast.success("Event unflagged");
  };

  const handleEndEvent = () => {
    if (!selectedEvent) return;
    endEvent(selectedEvent.id);
    toast.success("Event ended successfully");
    setSelectedEvent(null);
    setActionType(null);
  };

  const EventTable = ({ eventList }: { eventList: AdminEvent[] }) => (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="border-border hover:bg-transparent">
            <TableHead className="text-muted-foreground">Event</TableHead>
            <TableHead className="text-muted-foreground">Host</TableHead>
            <TableHead className="text-muted-foreground">Type</TableHead>
            <TableHead className="text-muted-foreground">Status</TableHead>
            <TableHead className="text-muted-foreground">Participants</TableHead>
            <TableHead className="text-muted-foreground">Sprayed</TableHead>
            <TableHead className="text-muted-foreground w-[50px]"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {eventList.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                No events found
              </TableCell>
            </TableRow>
          ) : (
            eventList.map((event) => (
              <TableRow 
                key={event.id} 
                className={`border-border ${event.flagged ? "bg-destructive/5" : ""}`}
              >
                <TableCell>
                  <div className="flex items-center gap-2">
                    {event.flagged && <Flag className="w-4 h-4 text-destructive" />}
                    <div>
                      <p className="font-medium text-foreground">{event.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">{event.code}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-foreground">{event.hostName}</TableCell>
                <TableCell>{getTypeBadge(event.type)}</TableCell>
                <TableCell>{getStatusBadge(event.status)}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Users className="w-4 h-4 text-muted-foreground" />
                    <span>{event.participantCount}</span>
                  </div>
                </TableCell>
                <TableCell className="font-medium">
                  {formatCurrency(event.totalSprayed)}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem 
                        onClick={() => {
                          setSelectedEvent(event);
                          setActionType("view");
                        }}
                      >
                        <Eye className="w-4 h-4 mr-2" />
                        View Details
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {event.flagged ? (
                        <DropdownMenuItem onClick={() => handleUnflag(event)}>
                          <FlagOff className="w-4 h-4 mr-2" />
                          Remove Flag
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem 
                          onClick={() => {
                            setSelectedEvent(event);
                            setActionType("flag");
                          }}
                          className="text-destructive"
                        >
                          <Flag className="w-4 h-4 mr-2" />
                          Flag Event
                        </DropdownMenuItem>
                      )}
                      {event.status === "live" && (
                        <DropdownMenuItem 
                          onClick={() => {
                            setSelectedEvent(event);
                            setActionType("end");
                          }}
                          className="text-accent"
                        >
                          <StopCircle className="w-4 h-4 mr-2" />
                          End Event
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Event Moderation</h1>
          <p className="text-muted-foreground mt-1">Monitor and manage platform events</p>
        </div>
        {flaggedEvents.length > 0 && (
          <Badge variant="destructive" className="gap-1 h-8 px-3">
            <AlertTriangle className="w-4 h-4" />
            {flaggedEvents.length} flagged
          </Badge>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by event name, host, or code..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="wedding">Wedding</SelectItem>
            <SelectItem value="birthday">Birthday</SelectItem>
            <SelectItem value="party">Party</SelectItem>
            <SelectItem value="corporate">Corporate</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="live" className="space-y-6">
        <TabsList>
          <TabsTrigger value="live" className="gap-2">
            Live
            {liveEvents.length > 0 && (
              <Badge className="bg-success/20 text-success border-0 h-5 min-w-[20px] px-1.5">
                {liveEvents.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="upcoming">Upcoming ({upcomingEvents.length})</TabsTrigger>
          <TabsTrigger value="ended">Ended ({endedEvents.length})</TabsTrigger>
          {flaggedEvents.length > 0 && (
            <TabsTrigger value="flagged" className="gap-2 text-destructive">
              Flagged
              <Badge variant="destructive" className="h-5 min-w-[20px] px-1.5">
                {flaggedEvents.length}
              </Badge>
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="live">
          <EventTable eventList={filteredEvents(liveEvents)} />
        </TabsContent>
        <TabsContent value="upcoming">
          <EventTable eventList={filteredEvents(upcomingEvents)} />
        </TabsContent>
        <TabsContent value="ended">
          <EventTable eventList={filteredEvents(endedEvents)} />
        </TabsContent>
        <TabsContent value="flagged">
          <EventTable eventList={filteredEvents(flaggedEvents)} />
        </TabsContent>
      </Tabs>

      {/* Flag Dialog */}
      <Dialog 
        open={!!selectedEvent && actionType === "flag"} 
        onOpenChange={() => {
          setSelectedEvent(null);
          setActionType(null);
          setFlagReason("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Flag Event</DialogTitle>
            <DialogDescription>
              Flag this event for review. It will be marked for investigation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="bg-muted p-4 rounded-lg space-y-2">
              <p className="font-medium">{selectedEvent?.name}</p>
              <p className="text-sm text-muted-foreground">Host: {selectedEvent?.hostName}</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Reason for flagging</label>
              <Textarea
                placeholder="Enter reason..."
                value={flagReason}
                onChange={(e) => setFlagReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => {
                setSelectedEvent(null);
                setActionType(null);
                setFlagReason("");
              }}
            >
              Cancel
            </Button>
            <Button 
              variant="destructive"
              onClick={handleFlag}
              disabled={!flagReason.trim()}
            >
              Flag Event
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* End Event Dialog */}
      <Dialog 
        open={!!selectedEvent && actionType === "end"} 
        onOpenChange={() => {
          setSelectedEvent(null);
          setActionType(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>End Event</DialogTitle>
            <DialogDescription>
              This will immediately end the event. Participants will no longer be able to spray or participate.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="bg-muted p-4 rounded-lg space-y-2">
              <p className="font-medium">{selectedEvent?.name}</p>
              <p className="text-sm text-muted-foreground">
                {selectedEvent?.participantCount} participants • {formatCurrency(selectedEvent?.totalSprayed || 0)} sprayed
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => {
                setSelectedEvent(null);
                setActionType(null);
              }}
            >
              Cancel
            </Button>
            <Button 
              variant="destructive"
              onClick={handleEndEvent}
            >
              End Event
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Event Dialog */}
      <Dialog 
        open={!!selectedEvent && actionType === "view"} 
        onOpenChange={() => {
          setSelectedEvent(null);
          setActionType(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Event Details</DialogTitle>
          </DialogHeader>
          {selectedEvent && (
            <div className="space-y-6 py-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-xl font-bold">{selectedEvent.name}</h3>
                  <p className="text-muted-foreground">Code: {selectedEvent.code}</p>
                </div>
                {getStatusBadge(selectedEvent.status)}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="bg-muted p-4 rounded-lg">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <Users className="w-4 h-4" />
                    <span className="text-sm">Participants</span>
                  </div>
                  <p className="text-2xl font-bold">{selectedEvent.participantCount}</p>
                </div>
                <div className="bg-muted p-4 rounded-lg">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <Coins className="w-4 h-4" />
                    <span className="text-sm">Total Sprayed</span>
                  </div>
                  <p className="text-2xl font-bold">{formatCurrency(selectedEvent.totalSprayed)}</p>
                </div>
                <div className="bg-muted p-4 rounded-lg">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <Gift className="w-4 h-4" />
                    <span className="text-sm">Giveaways</span>
                  </div>
                  <p className="text-2xl font-bold">{selectedEvent.giveawayCount}</p>
                </div>
                <div className="bg-muted p-4 rounded-lg">
                  <p className="text-sm text-muted-foreground mb-1">Event Type</p>
                  {getTypeBadge(selectedEvent.type)}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Host</span>
                  <span className="font-medium">{selectedEvent.hostName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Created</span>
                  <span>{format(selectedEvent.createdAt, "MMM d, yyyy")}</span>
                </div>
                {selectedEvent.scheduledAt && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Scheduled</span>
                    <span>{format(selectedEvent.scheduledAt, "MMM d, yyyy HH:mm")}</span>
                  </div>
                )}
              </div>

              {selectedEvent.flagged && selectedEvent.flagReason && (
                <div className="bg-destructive/10 p-4 rounded-lg">
                  <p className="text-sm font-medium text-destructive flex items-center gap-2">
                    <Flag className="w-4 h-4" />
                    Flagged
                  </p>
                  <p className="text-sm mt-1">{selectedEvent.flagReason}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
