# VHS tape that records REAL `ripple demo` output.
#
# This replaces the previous hand-drawn GIF renderer. Every frame produced here
# is genuine terminal output from the built CLI running the real engine against
# a real temporary git repository — including the pre-commit hook rejecting the
# rogue commit. Nothing in the recording is scripted or re-enacted.
#
# Build with: npm run demo:gif   (see scripts/build-vhs-gate-demo.js)

Output resources/ripple-gate-demo.gif

Set Shell bash
Set FontSize 15
Set Width 1200
Set Height 820
Set Padding 24
Set Framerate 12
Set Theme "Catppuccin Mocha"

# The demo paces itself (it detects a TTY, which VHS provides), so the tape does
# not need Sleep directives between scenes — only a settle at each end.
Hide
Type "clear"
Enter
Show

Sleep 800ms
Type "ripple demo"
Sleep 600ms
Enter

# The demo's own pacing runs ~30s; wait past it, then hold on the final frame.
Sleep 40s
