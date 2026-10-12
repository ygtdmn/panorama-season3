"use client";

// Season 3 has one look, dark. The layout fixes the .dark class on <html>; this provider stays
// so the tree keeps its shape, and holds no state.
export function ThemeProvider({ children }: { children: React.ReactNode }) {
	return <>{children}</>;
}
