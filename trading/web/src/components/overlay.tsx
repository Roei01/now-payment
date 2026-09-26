import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./icons";

export interface FieldSpec {
  name: string;
  label: string;
  type?: "text" | "textarea" | "number" | "otp" | "select" | "password";
  required?: boolean;
  defaultValue?: string;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
  ltr?: boolean;
}

export interface FormSpec {
  title: string;
  description?: ReactNode;
  fields?: FieldSpec[];
  submitLabel?: string;
  tone?: "primary" | "danger";
  /** Runs the action; throwing shows the error inside the dialog instead of closing it. */
  onSubmit?: (values: Record<string, string>) => Promise<void> | void;
}

type Toast = { id: number; text: string; tone: "good" | "bad" | "info" };

interface UiApi {
  toast: (text: string, tone?: Toast["tone"]) => void;
  form: (spec: FormSpec) => Promise<Record<string, string> | null>;
}

const Ctx = createContext<UiApi | null>(null);

export function useUI(): UiApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("UIProvider missing");
  return v;
}

function Sheet({ spec, onClose }: { spec: FormSpec; onClose: (v: Record<string, string> | null) => void }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries((spec.fields ?? []).map((f) => [f.name, f.defaultValue ?? (f.type === "select" ? f.options?.[0]?.value ?? "" : "")])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const first = bodyRef.current?.querySelector<HTMLElement>("input, textarea, select");
    // Avoid popping the keyboard on phones for confirm-only dialogs.
    if (first && window.matchMedia("(min-width: 640px)").matches) first.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose(null);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [busy, onClose]);

  const missing = (spec.fields ?? []).some((f) => f.required && !values[f.name]?.trim()) || (spec.fields ?? []).some((f) => f.type === "otp" && f.required && values[f.name]?.length !== 6);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (missing || busy) return;
    setBusy(true);
    setError(null);
    try {
      await spec.onSubmit?.(values);
      onClose(values);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose(null)} role="presentation">
      <form className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" onSubmit={submit}>
        <div className="sheet-head">
          <h2 id="sheet-title">{spec.title}</h2>
          <button type="button" className="btn ghost icon sm" aria-label="סגירה" onClick={() => !busy && onClose(null)}>
            <Icon name="x" />
          </button>
        </div>
        <div className="sheet-body stack" ref={bodyRef}>
          {spec.description && <div className="small muted">{spec.description}</div>}
          {(spec.fields ?? []).map((f) => (
            <div className="field" key={f.name}>
              <label htmlFor={`f-${f.name}`}>{f.label}</label>
              {f.type === "textarea" ? (
                <textarea id={`f-${f.name}`} className="textarea" value={values[f.name]} placeholder={f.placeholder} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} />
              ) : f.type === "select" ? (
                <select id={`f-${f.name}`} className="select" value={values[f.name]} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}>
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={`f-${f.name}`}
                  className={`input ${f.type === "otp" ? "otp" : ""} ${f.ltr ? "ltr" : ""}`}
                  type={f.type === "number" ? "number" : f.type === "password" ? "password" : "text"}
                  inputMode={f.type === "otp" ? "numeric" : f.type === "number" ? "decimal" : undefined}
                  autoComplete={f.type === "otp" ? "one-time-code" : "off"}
                  maxLength={f.type === "otp" ? 6 : undefined}
                  step={f.type === "number" ? "any" : undefined}
                  placeholder={f.placeholder ?? (f.type === "otp" ? "••••••" : undefined)}
                  value={values[f.name]}
                  onChange={(e) => setValues({ ...values, [f.name]: f.type === "otp" ? e.target.value.replace(/\D/g, "") : e.target.value })}
                />
              )}
              {f.help && <div className="help">{f.help}</div>}
            </div>
          ))}
          {error && (
            <div className="alert bad" role="alert">
              <Icon name="alert" />
              <div className="body">{error}</div>
            </div>
          )}
        </div>
        <div className="sheet-foot">
          <button type="submit" className={`btn ${spec.tone === "danger" ? "danger" : "primary"}`} disabled={missing || busy}>
            {busy && <span className="spinner" />}
            {spec.submitLabel ?? "אישור"}
          </button>
          <button type="button" className="btn" onClick={() => !busy && onClose(null)}>
            ביטול
          </button>
        </div>
      </form>
    </div>
  );
}

export function UIProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dialog, setDialog] = useState<{ spec: FormSpec; resolve: (v: Record<string, string> | null) => void } | null>(null);
  const seq = useRef(0);

  const toast = useCallback((text: string, tone: Toast["tone"] = "good") => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-2), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
  }, []);

  const form = useCallback((spec: FormSpec) => new Promise<Record<string, string> | null>((resolve) => setDialog({ spec, resolve })), []);

  return (
    <Ctx.Provider value={{ toast, form }}>
      {children}
      {dialog && (
        <Sheet
          spec={dialog.spec}
          onClose={(v) => {
            dialog.resolve(v);
            setDialog(null);
          }}
        />
      )}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`} role="status">
            <Icon name={t.tone === "bad" ? "alert" : t.tone === "info" ? "info" : "check"} />
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

/** Standard 2FA field for sensitive actions. */
export const OTP_FIELD: FieldSpec = { name: "totp", label: "קוד אימות דו־שלבי", type: "otp", required: true, help: "6 הספרות מאפליקציית האימות" };
export const REASON_FIELD: FieldSpec = { name: "reason", label: "סיבה", type: "textarea", required: true, placeholder: "נרשם ביומן הביקורת" };
