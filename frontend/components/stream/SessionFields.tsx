import { useState, type ReactNode } from "react";
import { Eye, EyeOff, LockKeyhole } from "lucide-react";
import { randomHex } from "@/lib/protocol";

export function Problem({ children }: { children: ReactNode }) {
  return children ? (
    <div className="problem" role="alert">
      {children}
    </div>
  ) : null;
}

export function PasswordField({
  value,
  onChange,
  disabled,
  create = false
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  create?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="field">
      <label htmlFor="stream-password">
        {create ? "Stream password" : "Password"}
      </label>
      <div className="password-input">
        <LockKeyhole size={17} aria-hidden="true" />
        <input
          id="stream-password"
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={create ? "new-password" : "current-password"}
          placeholder={
            create ? "Choose a password" : "Enter the password from your host"
          }
          required
          disabled={disabled}
          spellCheck={false}
        />
        <button
          className="icon-button"
          type="button"
          onClick={() => setVisible(!visible)}
          aria-label={visible ? "Hide password" : "Show password"}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      {create && (
        <button
          className="text-button"
          type="button"
          disabled={disabled}
          onClick={() => onChange(randomHex(10))}
        >
          Generate a strong password
        </button>
      )}
    </div>
  );
}
