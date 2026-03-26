#!/usr/bin/env python3
"""
Simple native-like floating voice chat overlay for Windows.

Features:
- Semi-transparent always-on-top panel
- Pre-join state: paste call link + Join
- In-call controls: mute mic, mute audio, leave, collapse
- Collapsible mini bubble (Discord-like)

This is a UI prototype only. It does not manage real audio devices by itself.
"""

from __future__ import annotations

import ctypes
import sys
import tkinter as tk
import webbrowser
from urllib.parse import urlparse


IS_WINDOWS = sys.platform.startswith("win")

PANEL_WIDTH = 340
PANEL_HEIGHT = 190
PANEL_CORNER_RADIUS = 26

BUBBLE_SIZE = 70

COLOR_BG = "#1E242D"
COLOR_PANEL = "#252C37"
COLOR_TEXT = "#F4F6FA"
COLOR_MUTED_TEXT = "#A9B4C6"
COLOR_ACCENT = "#3A86FF"
COLOR_ACCENT_ALT = "#2767C8"
COLOR_DANGER = "#CE2D4F"
COLOR_DANGER_ALT = "#A5233F"
COLOR_SURFACE = "#313B4B"


def _apply_round_region(window: tk.Tk | tk.Toplevel, width: int, height: int, radius: int) -> None:
    """Apply native rounded region on Windows."""
    if not IS_WINDOWS:
        return
    try:
        hwnd = window.winfo_id()
        region = ctypes.windll.gdi32.CreateRoundRectRgn(0, 0, width + 1, height + 1, radius, radius)
        ctypes.windll.user32.SetWindowRgn(hwnd, region, True)
    except Exception:
        # Keep working even if region shaping is unavailable.
        return


def _normalize_link(raw: str) -> str | None:
    candidate = raw.strip()
    if not candidate:
        return None
    if "://" not in candidate:
        candidate = f"https://{candidate}"
    parsed = urlparse(candidate)
    if not parsed.scheme or not parsed.netloc:
        return None
    return candidate


def _shorten_link(link: str, max_len: int = 42) -> str:
    if len(link) <= max_len:
        return link
    head = max_len - 3
    return f"{link[:head]}..."


class VoiceOverlayApp:
    def __init__(self) -> None:
        self.root = tk.Tk()
        self.root.title("Voice Overlay")
        self.root.configure(bg=COLOR_BG)
        self.root.overrideredirect(True)
        self.root.attributes("-topmost", True)
        self.root.attributes("-alpha", 0.92)

        self.bubble: tk.Toplevel | None = None
        self.drag_offset_x = 0
        self.drag_offset_y = 0
        self.bubble_drag_x = 0
        self.bubble_drag_y = 0
        self.bubble_mouse_down_x = 0
        self.bubble_mouse_down_y = 0
        self.bubble_has_moved = False

        self.in_call = False
        self.mic_muted = False
        self.audio_muted = False

        self.call_link = tk.StringVar()
        self.status_text = tk.StringVar(value="Paste a call link to join.")
        self.call_title = tk.StringVar(value="")

        self._build_panel()
        self._show_prejoin()
        self._place_initial_window()

        self.root.bind("<Escape>", lambda _: self._close_all())
        self.root.protocol("WM_DELETE_WINDOW", self._close_all)

    def _place_initial_window(self) -> None:
        self.root.update_idletasks()
        screen_w = self.root.winfo_screenwidth()
        screen_h = self.root.winfo_screenheight()
        x = screen_w - PANEL_WIDTH - 32
        y = screen_h - PANEL_HEIGHT - 100
        self.root.geometry(f"{PANEL_WIDTH}x{PANEL_HEIGHT}+{x}+{y}")
        self.root.after(10, self._apply_panel_shape)

    def _build_panel(self) -> None:
        self.panel = tk.Frame(self.root, bg=COLOR_PANEL, bd=0, highlightthickness=0)
        self.panel.pack(fill="both", expand=True)

        title_bar = tk.Frame(self.panel, bg=COLOR_PANEL)
        title_bar.pack(fill="x", padx=12, pady=(10, 6))
        title_bar.bind("<ButtonPress-1>", self._start_drag_panel)
        title_bar.bind("<B1-Motion>", self._drag_panel)

        self.title_label = tk.Label(
            title_bar,
            text="Voice Chat Overlay",
            fg=COLOR_TEXT,
            bg=COLOR_PANEL,
            font=("Segoe UI", 10, "bold"),
        )
        self.title_label.pack(side="left")
        self.title_label.bind("<ButtonPress-1>", self._start_drag_panel)
        self.title_label.bind("<B1-Motion>", self._drag_panel)

        close_btn = tk.Button(
            title_bar,
            text="x",
            command=self._close_all,
            bg=COLOR_PANEL,
            fg=COLOR_MUTED_TEXT,
            activebackground=COLOR_PANEL,
            activeforeground=COLOR_TEXT,
            relief="flat",
            bd=0,
            padx=6,
            pady=0,
            font=("Segoe UI", 10, "bold"),
            cursor="hand2",
        )
        close_btn.pack(side="right")

        self.content = tk.Frame(self.panel, bg=COLOR_PANEL)
        self.content.pack(fill="both", expand=True, padx=12, pady=(0, 10))

        self.prejoin = tk.Frame(self.content, bg=COLOR_PANEL)
        self.incall = tk.Frame(self.content, bg=COLOR_PANEL)

        self._build_prejoin_view()
        self._build_incall_view()

    def _build_prejoin_view(self) -> None:
        hint = tk.Label(
            self.prejoin,
            text="Call link",
            fg=COLOR_MUTED_TEXT,
            bg=COLOR_PANEL,
            anchor="w",
            font=("Segoe UI", 9),
        )
        hint.pack(fill="x")

        entry = tk.Entry(
            self.prejoin,
            textvariable=self.call_link,
            bg=COLOR_SURFACE,
            fg=COLOR_TEXT,
            insertbackground=COLOR_TEXT,
            relief="flat",
            font=("Segoe UI", 10),
        )
        entry.pack(fill="x", pady=(6, 10), ipady=7)
        entry.focus_set()
        entry.bind("<Return>", lambda _: self._join_call())

        join_btn = tk.Button(
            self.prejoin,
            text="Join call",
            command=self._join_call,
            bg=COLOR_ACCENT,
            fg=COLOR_TEXT,
            activebackground=COLOR_ACCENT_ALT,
            activeforeground=COLOR_TEXT,
            relief="flat",
            bd=0,
            font=("Segoe UI", 10, "bold"),
            pady=8,
            cursor="hand2",
        )
        join_btn.pack(fill="x")

        status = tk.Label(
            self.prejoin,
            textvariable=self.status_text,
            fg=COLOR_MUTED_TEXT,
            bg=COLOR_PANEL,
            anchor="w",
            justify="left",
            font=("Segoe UI", 9),
        )
        status.pack(fill="x", pady=(10, 0))

    def _build_incall_view(self) -> None:
        call_label = tk.Label(
            self.incall,
            text="In call",
            fg=COLOR_TEXT,
            bg=COLOR_PANEL,
            anchor="w",
            font=("Segoe UI", 10, "bold"),
        )
        call_label.pack(fill="x")

        call_link_label = tk.Label(
            self.incall,
            textvariable=self.call_title,
            fg=COLOR_MUTED_TEXT,
            bg=COLOR_PANEL,
            anchor="w",
            font=("Segoe UI", 9),
        )
        call_link_label.pack(fill="x", pady=(2, 10))

        controls_row_1 = tk.Frame(self.incall, bg=COLOR_PANEL)
        controls_row_1.pack(fill="x")

        self.mic_btn = tk.Button(
            controls_row_1,
            text="Mute mic",
            command=self._toggle_mic,
            bg=COLOR_SURFACE,
            fg=COLOR_TEXT,
            activebackground="#3A4658",
            activeforeground=COLOR_TEXT,
            relief="flat",
            bd=0,
            font=("Segoe UI", 9, "bold"),
            pady=7,
            cursor="hand2",
        )
        self.mic_btn.pack(side="left", fill="x", expand=True, padx=(0, 4))

        self.audio_btn = tk.Button(
            controls_row_1,
            text="Mute audio",
            command=self._toggle_audio,
            bg=COLOR_SURFACE,
            fg=COLOR_TEXT,
            activebackground="#3A4658",
            activeforeground=COLOR_TEXT,
            relief="flat",
            bd=0,
            font=("Segoe UI", 9, "bold"),
            pady=7,
            cursor="hand2",
        )
        self.audio_btn.pack(side="left", fill="x", expand=True, padx=(4, 0))

        controls_row_2 = tk.Frame(self.incall, bg=COLOR_PANEL)
        controls_row_2.pack(fill="x", pady=(8, 0))

        collapse_btn = tk.Button(
            controls_row_2,
            text="Collapse",
            command=self._collapse_to_bubble,
            bg=COLOR_ACCENT,
            fg=COLOR_TEXT,
            activebackground=COLOR_ACCENT_ALT,
            activeforeground=COLOR_TEXT,
            relief="flat",
            bd=0,
            font=("Segoe UI", 9, "bold"),
            pady=7,
            cursor="hand2",
        )
        collapse_btn.pack(side="left", fill="x", expand=True, padx=(0, 4))

        leave_btn = tk.Button(
            controls_row_2,
            text="Leave",
            command=self._leave_call,
            bg=COLOR_DANGER,
            fg=COLOR_TEXT,
            activebackground=COLOR_DANGER_ALT,
            activeforeground=COLOR_TEXT,
            relief="flat",
            bd=0,
            font=("Segoe UI", 9, "bold"),
            pady=7,
            cursor="hand2",
        )
        leave_btn.pack(side="left", fill="x", expand=True, padx=(4, 0))

        in_call_status = tk.Label(
            self.incall,
            textvariable=self.status_text,
            fg=COLOR_MUTED_TEXT,
            bg=COLOR_PANEL,
            anchor="w",
            font=("Segoe UI", 9),
        )
        in_call_status.pack(fill="x", pady=(10, 0))

    def _show_prejoin(self) -> None:
        self.incall.pack_forget()
        self.prejoin.pack(fill="both", expand=True)
        self.title_label.configure(text="Voice Chat Overlay")
        x, y = self.root.winfo_x(), self.root.winfo_y()
        self.root.geometry(f"{PANEL_WIDTH}x{PANEL_HEIGHT}+{x}+{y}")
        self.root.after(10, self._apply_panel_shape)

    def _show_incall(self) -> None:
        self.prejoin.pack_forget()
        self.incall.pack(fill="both", expand=True)
        self.title_label.configure(text="Voice Chat Controls")
        x, y = self.root.winfo_x(), self.root.winfo_y()
        self.root.geometry(f"{PANEL_WIDTH}x{PANEL_HEIGHT}+{x}+{y}")
        self.root.after(10, self._apply_panel_shape)

    def _apply_panel_shape(self) -> None:
        width = self.root.winfo_width()
        height = self.root.winfo_height()
        _apply_round_region(self.root, width, height, PANEL_CORNER_RADIUS)

    def _start_drag_panel(self, event: tk.Event) -> None:
        self.drag_offset_x = event.x
        self.drag_offset_y = event.y

    def _drag_panel(self, event: tk.Event) -> None:
        x = event.x_root - self.drag_offset_x
        y = event.y_root - self.drag_offset_y
        self.root.geometry(f"+{x}+{y}")

    def _join_call(self) -> None:
        normalized = _normalize_link(self.call_link.get())
        if not normalized:
            self.status_text.set("Invalid link. Use https://serenada.app/call/...")
            return

        self.call_link.set(normalized)
        self.call_title.set(_shorten_link(normalized))
        self.in_call = True
        self.status_text.set("Connected. Controls are ready.")
        self._show_incall()

        # Prototype behavior: open call URL in the default browser.
        try:
            webbrowser.open(normalized, new=2)
        except Exception:
            self.status_text.set("Connected. Failed to open browser automatically.")

    def _toggle_mic(self) -> None:
        self.mic_muted = not self.mic_muted
        self.mic_btn.configure(text="Unmute mic" if self.mic_muted else "Mute mic")
        self.status_text.set("Microphone muted." if self.mic_muted else "Microphone unmuted.")

    def _toggle_audio(self) -> None:
        self.audio_muted = not self.audio_muted
        self.audio_btn.configure(text="Unmute audio" if self.audio_muted else "Mute audio")
        self.status_text.set("Audio muted." if self.audio_muted else "Audio unmuted.")

    def _leave_call(self) -> None:
        self.in_call = False
        self.mic_muted = False
        self.audio_muted = False
        self.mic_btn.configure(text="Mute mic")
        self.audio_btn.configure(text="Mute audio")

        if self.bubble is not None and self.bubble.winfo_viewable():
            self._expand_from_bubble()

        self.status_text.set("Call ended.")
        self._show_prejoin()

    def _collapse_to_bubble(self) -> None:
        if not self.in_call:
            return

        root_x = self.root.winfo_x()
        root_y = self.root.winfo_y()
        self.root.withdraw()

        if self.bubble is None:
            self._create_bubble()

        bubble_x = root_x + PANEL_WIDTH - BUBBLE_SIZE
        bubble_y = root_y + PANEL_HEIGHT - BUBBLE_SIZE
        self.bubble.geometry(f"{BUBBLE_SIZE}x{BUBBLE_SIZE}+{bubble_x}+{bubble_y}")
        self.bubble.deiconify()
        self.bubble.lift()
        self.bubble.focus_force()
        self.bubble.after(10, self._apply_bubble_shape)

    def _create_bubble(self) -> None:
        self.bubble = tk.Toplevel(self.root)
        self.bubble.overrideredirect(True)
        self.bubble.attributes("-topmost", True)
        self.bubble.attributes("-alpha", 0.92)
        self.bubble.configure(bg=COLOR_BG)

        bubble_canvas = tk.Canvas(
            self.bubble,
            width=BUBBLE_SIZE,
            height=BUBBLE_SIZE,
            bg=COLOR_BG,
            highlightthickness=0,
            bd=0,
        )
        bubble_canvas.pack(fill="both", expand=True)

        inset = 2
        bubble_canvas.create_oval(
            inset,
            inset,
            BUBBLE_SIZE - inset,
            BUBBLE_SIZE - inset,
            fill=COLOR_ACCENT,
            outline=COLOR_ACCENT_ALT,
            width=2,
        )
        bubble_canvas.create_text(
            BUBBLE_SIZE // 2,
            BUBBLE_SIZE // 2 - 3,
            text="VC",
            fill="white",
            font=("Segoe UI", 11, "bold"),
        )
        bubble_canvas.create_text(
            BUBBLE_SIZE // 2,
            BUBBLE_SIZE // 2 + 14,
            text="call",
            fill="#DCE8FF",
            font=("Segoe UI", 8),
        )

        for target in (self.bubble, bubble_canvas):
            target.bind("<ButtonPress-1>", self._start_drag_bubble)
            target.bind("<B1-Motion>", self._drag_bubble)
            target.bind("<ButtonRelease-1>", self._release_bubble)

    def _apply_bubble_shape(self) -> None:
        if self.bubble is None:
            return
        _apply_round_region(self.bubble, BUBBLE_SIZE, BUBBLE_SIZE, BUBBLE_SIZE)

    def _start_drag_bubble(self, event: tk.Event) -> None:
        if self.bubble is None:
            return
        self.bubble_drag_x = event.x
        self.bubble_drag_y = event.y
        self.bubble_mouse_down_x = event.x_root
        self.bubble_mouse_down_y = event.y_root
        self.bubble_has_moved = False

    def _drag_bubble(self, event: tk.Event) -> None:
        if self.bubble is None:
            return
        x = event.x_root - self.bubble_drag_x
        y = event.y_root - self.bubble_drag_y
        self.bubble.geometry(f"+{x}+{y}")
        if abs(event.x_root - self.bubble_mouse_down_x) > 4 or abs(event.y_root - self.bubble_mouse_down_y) > 4:
            self.bubble_has_moved = True

    def _release_bubble(self, _event: tk.Event) -> None:
        if not self.bubble_has_moved:
            self._expand_from_bubble()

    def _expand_from_bubble(self) -> None:
        if self.bubble is None:
            return
        x = self.bubble.winfo_x()
        y = self.bubble.winfo_y()
        self.bubble.withdraw()
        self.root.deiconify()
        self.root.geometry(f"{PANEL_WIDTH}x{PANEL_HEIGHT}+{x}+{y}")
        self.root.lift()
        self.root.focus_force()
        self.root.after(10, self._apply_panel_shape)

    def _close_all(self) -> None:
        if self.bubble is not None:
            self.bubble.destroy()
            self.bubble = None
        self.root.destroy()

    def run(self) -> None:
        self.root.mainloop()


def main() -> None:
    app = VoiceOverlayApp()
    app.run()


if __name__ == "__main__":
    main()
