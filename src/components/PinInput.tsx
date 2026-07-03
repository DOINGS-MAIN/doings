import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sanitizePinInput } from "@/lib/pin";

interface PinInputProps {
  id?: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export const PinInput = ({
  id = "transaction-pin",
  label = "Transaction PIN",
  value,
  onChange,
  className,
}: PinInputProps) => (
  <div className="space-y-2">
    <Label htmlFor={id}>{label}</Label>
    <Input
      id={id}
      type="password"
      inputMode="numeric"
      placeholder="••••"
      value={value}
      onChange={(e) => onChange(sanitizePinInput(e.target.value))}
      maxLength={4}
      autoComplete="off"
      className={`text-center text-2xl tracking-[1em] font-bold ${className ?? ""}`}
    />
  </div>
);
