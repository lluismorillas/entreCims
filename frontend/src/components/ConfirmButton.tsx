import { useRef } from "react";

type Props = {
  /** The destructive action, e.g. "Delete route". Also the text of the button that confirms it. */
  label: string;
  /** What will be lost, asked before doing it. */
  question: string;
  disabled?: boolean;
  className?: string;
  onConfirm: () => void;
};

/** A destructive action that asks again in a popup of the app, instead of in the browser's confirm box. */
export default function ConfirmButton({ label, question, disabled, className = "", onConfirm }: Props) {
  // A native modal <dialog>: it traps the focus, closes with Escape and dims the page behind.
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" disabled={disabled} onClick={() => dialog.current?.showModal()} className={`btn border-red-400/60 text-red-300 hover:bg-red-400/15 ${className}`}>
        {label}
      </button>
      <dialog
        ref={dialog}
        aria-label={label}
        // Closes on a click on the dimmed page, which lands on the dialog element itself.
        onClick={(e) => e.target === e.currentTarget && e.currentTarget.close()}
        className="m-auto w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-slate-700 bg-slate-900 p-0 text-sm text-slate-100 shadow-2xl backdrop:bg-black/60"
      >
        <div className="p-5">
          <h2 className="text-base font-bold">{label}</h2>
          <p className="mt-2 text-slate-300">{question}</p>
          <div className="mt-4 flex justify-end gap-2">
            {/* Focus lands on the safe choice. */}
            <button type="button" autoFocus onClick={() => dialog.current?.close()} className="btn">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                dialog.current?.close();
                onConfirm();
              }}
              className="btn border-red-400 text-red-300 hover:bg-red-400/15"
            >
              {label}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
