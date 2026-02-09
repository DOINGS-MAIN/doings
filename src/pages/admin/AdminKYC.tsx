import { useState } from "react";
import { 
  CheckCircle, 
  XCircle, 
  Clock,
  Eye,
  User,
  FileText,
  Camera
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAdminData } from "@/hooks/useAdminData";
import { KYCSubmission } from "@/types/admin";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

export const AdminKYC = () => {
  const { kycSubmissions, approveKYC, rejectKYC } = useAdminData();
  const [selectedKYC, setSelectedKYC] = useState<KYCSubmission | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectDialog, setShowRejectDialog] = useState(false);

  const pendingSubmissions = kycSubmissions.filter(k => k.status === "pending");
  const reviewedSubmissions = kycSubmissions.filter(k => k.status !== "pending");

  const handleApprove = (kyc: KYCSubmission) => {
    approveKYC(kyc.id);
    toast.success(`KYC approved for ${kyc.userName}`);
    setSelectedKYC(null);
  };

  const handleReject = () => {
    if (!selectedKYC) return;
    rejectKYC(selectedKYC.id, rejectReason);
    toast.success(`KYC rejected for ${selectedKYC.userName}`);
    setSelectedKYC(null);
    setShowRejectDialog(false);
    setRejectReason("");
  };

  const getStatusBadge = (status: KYCSubmission["status"]) => {
    switch (status) {
      case "pending":
        return <Badge className="bg-primary/20 text-primary border-0">Pending</Badge>;
      case "approved":
        return <Badge className="bg-success/20 text-success border-0">Approved</Badge>;
      case "rejected":
        return <Badge variant="destructive">Rejected</Badge>;
    }
  };

  const getIdTypeLabel = (type: KYCSubmission["idType"]) => {
    const labels: Record<string, string> = {
      national_id: "National ID",
      drivers_license: "Driver's License",
      passport: "International Passport",
      voters_card: "Voter's Card",
    };
    return labels[type] || type;
  };

  const KYCCard = ({ kyc, showActions = true }: { kyc: KYCSubmission; showActions?: boolean }) => (
    <Card className="bg-card border-border">
      <CardContent className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center text-xl font-bold text-primary">
              {kyc.userName.charAt(0)}
            </div>
            <div>
              <p className="font-semibold text-foreground">{kyc.userName}</p>
              <p className="text-sm text-muted-foreground">{kyc.userPhone}</p>
            </div>
          </div>
          {getStatusBadge(kyc.status)}
        </div>

        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">BVN</span>
            <span className="font-mono">{kyc.bvn}</span>
          </div>
          {kyc.nin && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">NIN</span>
              <span className="font-mono">{kyc.nin}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">ID Type</span>
            <span>{getIdTypeLabel(kyc.idType)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">ID Number</span>
            <span className="font-mono">{kyc.idNumber}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Submitted</span>
            <span>{formatDistanceToNow(kyc.submittedAt, { addSuffix: true })}</span>
          </div>
        </div>

        {showActions && kyc.status === "pending" && (
          <div className="flex gap-3 mt-6">
            <Button 
              variant="outline" 
              className="flex-1"
              onClick={() => setSelectedKYC(kyc)}
            >
              <Eye className="w-4 h-4 mr-2" />
              Review
            </Button>
            <Button 
              className="flex-1 bg-success hover:bg-success/90"
              onClick={() => handleApprove(kyc)}
            >
              <CheckCircle className="w-4 h-4 mr-2" />
              Approve
            </Button>
          </div>
        )}

        {kyc.status === "rejected" && kyc.rejectionReason && (
          <div className="mt-4 p-3 bg-destructive/10 rounded-lg">
            <p className="text-sm text-destructive font-medium">Rejection Reason:</p>
            <p className="text-sm text-muted-foreground mt-1">{kyc.rejectionReason}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">KYC Review</h1>
          <p className="text-muted-foreground mt-1">Verify user identity documents</p>
        </div>
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-primary" />
          <span className="font-semibold text-lg">{pendingSubmissions.length}</span>
          <span className="text-muted-foreground">pending</span>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="pending" className="space-y-6">
        <TabsList>
          <TabsTrigger value="pending" className="gap-2">
            Pending
            {pendingSubmissions.length > 0 && (
              <Badge variant="destructive" className="h-5 min-w-[20px] px-1.5">
                {pendingSubmissions.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="reviewed">Reviewed</TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
          {pendingSubmissions.length === 0 ? (
            <Card className="bg-card border-border">
              <CardContent className="p-12 text-center">
                <CheckCircle className="w-12 h-12 text-success mx-auto mb-4" />
                <p className="text-lg font-medium">All caught up!</p>
                <p className="text-muted-foreground">No pending KYC submissions to review.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {pendingSubmissions.map((kyc) => (
                <KYCCard key={kyc.id} kyc={kyc} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="reviewed">
          {reviewedSubmissions.length === 0 ? (
            <Card className="bg-card border-border">
              <CardContent className="p-12 text-center">
                <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-lg font-medium">No reviewed submissions</p>
                <p className="text-muted-foreground">Reviewed KYC submissions will appear here.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {reviewedSubmissions.map((kyc) => (
                <KYCCard key={kyc.id} kyc={kyc} showActions={false} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Review Dialog */}
      <Dialog 
        open={!!selectedKYC && !showRejectDialog} 
        onOpenChange={() => setSelectedKYC(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Review KYC Submission</DialogTitle>
            <DialogDescription>
              Verify the user's identity documents before approval
            </DialogDescription>
          </DialogHeader>
          
          {selectedKYC && (
            <div className="space-y-6 py-4">
              {/* User Info */}
              <div className="flex items-center gap-4 p-4 bg-muted rounded-lg">
                <div className="w-14 h-14 rounded-full bg-primary/20 flex items-center justify-center text-2xl font-bold text-primary">
                  {selectedKYC.userName.charAt(0)}
                </div>
                <div>
                  <p className="text-lg font-semibold">{selectedKYC.userName}</p>
                  <p className="text-muted-foreground">{selectedKYC.userPhone}</p>
                </div>
              </div>

              {/* Document Info */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">BVN</p>
                  <p className="font-mono font-medium">{selectedKYC.bvn}</p>
                </div>
                {selectedKYC.nin && (
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">NIN</p>
                    <p className="font-mono font-medium">{selectedKYC.nin}</p>
                  </div>
                )}
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">ID Type</p>
                  <p className="font-medium">{getIdTypeLabel(selectedKYC.idType)}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">ID Number</p>
                  <p className="font-mono font-medium">{selectedKYC.idNumber}</p>
                </div>
              </div>

              {/* Document Images */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <p className="text-sm font-medium flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    ID Document
                  </p>
                  <div className="aspect-[4/3] bg-muted rounded-lg flex items-center justify-center border-2 border-dashed border-border">
                    <div className="text-center">
                      <FileText className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">ID Image Preview</p>
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium flex items-center gap-2">
                    <Camera className="w-4 h-4" />
                    Selfie
                  </p>
                  <div className="aspect-[4/3] bg-muted rounded-lg flex items-center justify-center border-2 border-dashed border-border">
                    <div className="text-center">
                      <User className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">Selfie Preview</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button 
              variant="outline" 
              onClick={() => setSelectedKYC(null)}
            >
              Cancel
            </Button>
            <Button 
              variant="destructive"
              onClick={() => setShowRejectDialog(true)}
            >
              <XCircle className="w-4 h-4 mr-2" />
              Reject
            </Button>
            <Button 
              className="bg-success hover:bg-success/90"
              onClick={() => selectedKYC && handleApprove(selectedKYC)}
            >
              <CheckCircle className="w-4 h-4 mr-2" />
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog 
        open={showRejectDialog} 
        onOpenChange={() => {
          setShowRejectDialog(false);
          setRejectReason("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject KYC Submission</DialogTitle>
            <DialogDescription>
              Provide a reason for rejecting this submission. The user will be notified.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="bg-muted p-4 rounded-lg">
              <p className="font-medium">{selectedKYC?.userName}</p>
              <p className="text-sm text-muted-foreground">{selectedKYC?.userPhone}</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Rejection Reason</label>
              <Textarea
                placeholder="Enter reason for rejection..."
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => {
                setShowRejectDialog(false);
                setRejectReason("");
              }}
            >
              Cancel
            </Button>
            <Button 
              variant="destructive"
              onClick={handleReject}
              disabled={!rejectReason.trim()}
            >
              Reject Submission
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
