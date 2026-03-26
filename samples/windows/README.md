# Windows Floating Voice Overlay (Python)

Minimal Windows-native style floating overlay for voice call controls.

## What it does

- Shows a small semi-transparent always-on-top window
- Lets you paste a call link and press `Join call`
- Switches to in-call controls (`Mute mic`, `Mute audio`, `Leave`, `Collapse`)
- Can collapse to a small draggable round bubble and expand back on click

## Run

```bash
python samples/windows/voice_chat_overlay.py
```

Requirements:
- Windows
- Python 3.10+ (standard library only, no extra packages)

## Notes

- This is a UI prototype for overlay behavior.
- `Join call` opens the provided link in your default browser.
- Audio toggles are local UI state only in this sample.
