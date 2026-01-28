import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Building2, Plus, Trash2, Check, CreditCard, Star, Search } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBankAccounts, NIGERIAN_BANKS, BankAccount } from "@/hooks/useBankAccounts";
import { toast } from "sonner";

interface BankAccountsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const BankAccountsSheet = ({ open, onOpenChange }: BankAccountsSheetProps) => {
  const { accounts, addBankAccount, removeBankAccount, setDefaultAccount } = useBankAccounts();
  const [showAddForm, setShowAddForm] = useState(false);
  const [bankSearch, setBankSearch] = useState("");
  const [selectedBank, setSelectedBank] = useState<{ code: string; name: string } | null>(null);
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);

  const filteredBanks = NIGERIAN_BANKS.filter((bank) =>
    bank.name.toLowerCase().includes(bankSearch.toLowerCase())
  );

  const handleVerifyAccount = async () => {
    if (!selectedBank || accountNumber.length !== 10) return;

    setIsVerifying(true);
    // Simulate account verification
    await new Promise((resolve) => setTimeout(resolve, 1500));
    
    // Generate a realistic name
    const names = ["ADEBAYO JOHN OLUWASEUN", "CHIDINMA GRACE OKONKWO", "FATIMA MOHAMMED IBRAHIM", "EMMANUEL CHUKWUEMEKA OKAFOR"];
    setAccountName(names[Math.floor(Math.random() * names.length)]);
    setIsVerifying(false);
  };

  const handleAddAccount = () => {
    if (!selectedBank || !accountNumber || !accountName) {
      toast.error("Please complete all fields");
      return;
    }

    try {
      addBankAccount(selectedBank.code, accountNumber, accountName);
      toast.success("Bank account added successfully!");
      resetForm();
    } catch (error) {
      toast.error("Failed to add bank account");
    }
  };

  const resetForm = () => {
    setShowAddForm(false);
    setSelectedBank(null);
    setAccountNumber("");
    setAccountName("");
    setBankSearch("");
  };

  const handleDelete = (account: BankAccount) => {
    removeBankAccount(account.id);
    toast.success("Bank account removed");
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[90vh] rounded-t-3xl bg-background">
        <SheetHeader className="text-left pb-4">
          <SheetTitle className="text-2xl font-bold flex items-center gap-2">
            <Building2 className="w-6 h-6 text-primary" />
            Bank Accounts
          </SheetTitle>
          <SheetDescription>
            Manage your linked bank accounts for withdrawals
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 overflow-y-auto max-h-[70vh] pb-6">
          <AnimatePresence mode="wait">
            {!showAddForm ? (
              <motion.div
                key="accounts-list"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                {/* Add Account Button */}
                <Button
                  variant="outline"
                  className="w-full h-16 border-dashed border-2 mb-4"
                  onClick={() => setShowAddForm(true)}
                >
                  <Plus className="w-5 h-5 mr-2" />
                  Add Bank Account
                </Button>

                {/* Accounts List */}
                {accounts.length === 0 ? (
                  <div className="text-center py-12">
                    <CreditCard className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">No bank accounts linked yet</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Add a bank account to withdraw funds
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {accounts.map((account) => (
                      <motion.div
                        key={account.id}
                        layout
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="p-4 rounded-2xl bg-card border border-border"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                              <Building2 className="w-6 h-6 text-primary" />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="font-semibold">{account.bankName}</p>
                                {account.isDefault && (
                                  <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full flex items-center gap-1">
                                    <Star className="w-3 h-3" /> Default
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-muted-foreground">
                                {account.accountNumber.replace(/(\d{3})(\d{4})(\d{3})/, "$1****$3")}
                              </p>
                              <p className="text-xs text-muted-foreground">{account.accountName}</p>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            {!account.isDefault && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setDefaultAccount(account.id)}
                              >
                                <Star className="w-4 h-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive"
                              onClick={() => handleDelete(account)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="add-form"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <Button variant="ghost" onClick={resetForm} className="mb-2">
                  ← Back to accounts
                </Button>

                {/* Bank Selection */}
                {!selectedBank ? (
                  <div className="space-y-3">
                    <Label>Select Bank</Label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        placeholder="Search banks..."
                        value={bankSearch}
                        onChange={(e) => setBankSearch(e.target.value)}
                        className="pl-10"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2 max-h-[40vh] overflow-y-auto">
                      {filteredBanks.map((bank) => (
                        <Button
                          key={bank.code}
                          variant="outline"
                          className="h-auto py-3 justify-start"
                          onClick={() => setSelectedBank(bank)}
                        >
                          <Building2 className="w-4 h-4 mr-2 shrink-0" />
                          <span className="text-left text-sm truncate">{bank.name}</span>
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Selected Bank */}
                    <div className="p-3 rounded-xl bg-primary/10 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-5 h-5 text-primary" />
                        <span className="font-medium">{selectedBank.name}</span>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => setSelectedBank(null)}>
                        Change
                      </Button>
                    </div>

                    {/* Account Number */}
                    <div className="space-y-2">
                      <Label>Account Number</Label>
                      <Input
                        type="tel"
                        placeholder="Enter 10-digit account number"
                        value={accountNumber}
                        onChange={(e) => {
                          const value = e.target.value.replace(/\D/g, "").slice(0, 10);
                          setAccountNumber(value);
                          if (value.length === 10) {
                            setAccountName("");
                          }
                        }}
                        maxLength={10}
                      />
                      {accountNumber.length === 10 && !accountName && (
                        <Button
                          variant="secondary"
                          size="sm"
                          className="w-full mt-2"
                          onClick={handleVerifyAccount}
                          disabled={isVerifying}
                        >
                          {isVerifying ? "Verifying..." : "Verify Account"}
                        </Button>
                      )}
                    </div>

                    {/* Verified Account Name */}
                    {accountName && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="p-4 rounded-xl bg-green-500/10 border border-green-500/30"
                      >
                        <div className="flex items-center gap-2 text-green-500 mb-1">
                          <Check className="w-4 h-4" />
                          <span className="text-sm font-medium">Account Verified</span>
                        </div>
                        <p className="font-semibold">{accountName}</p>
                      </motion.div>
                    )}

                    {/* Add Button */}
                    <Button
                      className="w-full"
                      size="lg"
                      disabled={!accountName}
                      onClick={handleAddAccount}
                    >
                      Add Bank Account
                    </Button>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </SheetContent>
    </Sheet>
  );
};
