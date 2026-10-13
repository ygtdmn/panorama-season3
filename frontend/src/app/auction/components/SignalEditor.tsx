"use client";

import { useId, useMemo, useState } from "react";
import { measureSignal } from "@/lib/signal";

/**
 * The confirm step before any signal is sent. Signals are write-once, so the sanitized text is
 * shown back exactly as it will be stored, with confirm / edit. Inline, never a browser dialog.
 */
export function SignalConfirm({
	text,
	confirmLabel,
	disabled,
	onConfirm,
	onEdit,
}: {
	/** The sanitized text that will be sent. */
	text: string;
	confirmLabel: string;
	disabled: boolean;
	onConfirm: () => void;
	onEdit: () => void;
}) {
	return (
		<div className="game-slot flex flex-col gap-2.5 px-3 py-3" role="group" aria-label="Confirm signal">
			<p className="font-mono text-micro uppercase tracking-[0.12em] text-sky-pink">
				This is permanent. Send it as written?
			</p>
			<p
				dir="auto"
				className="font-sans text-[15px] text-foreground leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere] [unicode-bidi:plaintext]"
			>
				{text}
			</p>
			<div className="flex flex-wrap items-center gap-2">
				<button
					type="button"
					className="game-btn text-[12px] px-3 py-1.5 cursor-pointer"
					disabled={disabled}
					onClick={onConfirm}
				>
					{confirmLabel}
				</button>
				<button
					type="button"
					className="font-mono text-micro uppercase tracking-[0.14em] text-muted hover:text-foreground transition-colors cursor-pointer px-1"
					onClick={onEdit}
				>
					edit
				</button>
			</div>
		</div>
	);
}

/**
 * Inline editor that ADDS a signal to a bid or a day that has none. Signals are write-once, so
 * there is no replace or clear, and saving goes through SignalConfirm first. Same sanitiser and
 * byte counter as the bid form, so the count is exactly what gets stored.
 */
export function SignalEditor({
	maxBytes,
	saveLabel,
	disabled,
	onSave,
	onCancel,
}: {
	maxBytes: number;
	/** Button label while idle; the caller passes the pending-state label when a write runs. */
	saveLabel: string;
	disabled: boolean;
	onSave: (clean: string) => void;
	onCancel: () => void;
}) {
	const id = useId();
	const [draft, setDraft] = useState("");
	const [confirming, setConfirming] = useState(false);
	const m = useMemo(() => measureSignal(draft, maxBytes), [draft, maxBytes]);

	if (confirming)
		return (
			<SignalConfirm
				text={m.clean}
				confirmLabel={saveLabel === "save signal" ? "confirm" : saveLabel}
				disabled={disabled}
				onConfirm={() => onSave(m.clean)}
				onEdit={() => setConfirming(false)}
			/>
		);

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-baseline justify-between gap-3">
				<label htmlFor={id} className="font-mono text-micro uppercase tracking-[0.14em] text-muted">
					Add a signal
				</label>
				<span
					id={`${id}-count`}
					aria-live="polite"
					className={`font-mono text-micro tabular-nums ${m.over ? "text-signal" : "text-faint"}`}
				>
					{m.bytes} / {m.max} characters
				</span>
			</div>
			<textarea
				id={id}
				value={draft}
				onChange={(e) => setDraft(e.target.value)}
				rows={3}
				autoFocus
				placeholder="A word, a wish, a place, a memory."
				aria-describedby={`${id}-count ${id}-note`}
				aria-invalid={m.over}
				className="game-slot w-full resize-y outline-none font-sans text-[15px] leading-relaxed text-foreground placeholder:text-faint px-3 py-2.5 focus:border-sky-pink transition-colors"
			/>
			<p id={`${id}-note`} className="font-sans text-xs text-muted leading-relaxed">
				Once saved, it stays as written.
			</p>
			{m.over && (
				<p className="font-mono text-micro uppercase tracking-[0.12em] text-signal" role="alert">
					Over the limit by {m.bytes - m.max} characters. Shorten it to save.
				</p>
			)}
			<div className="flex flex-wrap items-center gap-2">
				<button
					type="button"
					className="game-btn text-[12px] px-3 py-1.5 cursor-pointer"
					disabled={disabled || m.over || m.clean === ""}
					onClick={() => setConfirming(true)}
				>
					{saveLabel}
				</button>
				<button
					type="button"
					className="font-mono text-micro uppercase tracking-[0.14em] text-muted hover:text-foreground transition-colors cursor-pointer px-1"
					onClick={onCancel}
				>
					cancel
				</button>
			</div>
		</div>
	);
}

/** A stored signal as text, or the empty state. React text only; keeps line breaks. */
export function SignalText({ signal }: { signal?: string }) {
	return signal ? (
		<p
			dir="auto"
			className="font-sans text-[15px] text-foreground/90 leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere] [unicode-bidi:plaintext]"
		>
			{signal}
		</p>
	) : (
		<p className="font-sans text-[14px] text-faint">No signal yet</p>
	);
}
