import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { format } from "date-fns";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAdminData } from "@/hooks/useAdminData";
import { KYCSubmission } from "@/types/admin";

// Verification is automated (BVN + selfie via Dojah); admins see results only and never override them.
export const AdminKYC = () => {
  const { kycSubmissions, loading } = useAdminData();
  const [searchQuery, setSearchQuery] = useState("");

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return kycSubmissions;
    return kycSubmissions.filter((k) =>
      k.userName.toLowerCase().includes(q) || k.userEmail.toLowerCase().includes(q) || k.userId.includes(q),
    );
  }, [kycSubmissions, searchQuery]);

  const verified = filtered.filter((k) => k.status === "verified");
  const rejected = filtered.filter((k) => k.status === "rejected");

  const statusBadge = (status: KYCSubmission["status"]) => {
    switch (status) {
      case "verified": return <Badge className="bg-success/20 text-success border-0">Verified</Badge>;
      case "rejected": return <Badge variant="destructive">Rejected</Badge>;
      case "pending": return <Badge className="bg-primary/20 text-primary border-0">Pending</Badge>;
      default: return <Badge variant="outline" className="capitalize">{status}</Badge>;
    }
  };

  const ResultsTable = ({ rows }: { rows: KYCSubmission[] }) => (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="border-border hover:bg-transparent">
            <TableHead className="text-muted-foreground">User</TableHead>
            <TableHead className="text-muted-foreground">Level</TableHead>
            <TableHead className="text-muted-foreground">Status</TableHead>
            <TableHead className="text-muted-foreground">Reason</TableHead>
            <TableHead className="text-muted-foreground">Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
          ) : rows.length === 0 ? (
            <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No results</TableCell></TableRow>
          ) : (
            rows.map((k) => (
              <TableRow key={k.id} className="border-border">
                <TableCell>
                  <p className="font-medium text-foreground">{k.userName || "Unnamed user"}</p>
                  <p className="text-xs text-muted-foreground">{k.userEmail}</p>
                </TableCell>
                <TableCell>{k.level}</TableCell>
                <TableCell>{statusBadge(k.status)}</TableCell>
                <TableCell className="text-sm text-muted-foreground max-w-xs">{k.rejectionReason ?? "—"}</TableCell>
                <TableCell className="text-sm whitespace-nowrap">{format(k.verifiedAt ?? k.submittedAt, "MMM d, yyyy HH:mm")}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">KYC Results</h1>
        <p className="text-muted-foreground mt-1">
          Identity checks run automatically (BVN + selfie). This page shows the results; it can't change them.
        </p>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search by name or email..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      <Tabs defaultValue="all" className="space-y-6">
        <TabsList>
          <TabsTrigger value="all">All ({filtered.length})</TabsTrigger>
          <TabsTrigger value="verified">Verified ({verified.length})</TabsTrigger>
          <TabsTrigger value="rejected">Rejected ({rejected.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="all"><ResultsTable rows={filtered} /></TabsContent>
        <TabsContent value="verified"><ResultsTable rows={verified} /></TabsContent>
        <TabsContent value="rejected"><ResultsTable rows={rejected} /></TabsContent>
      </Tabs>
    </div>
  );
};
