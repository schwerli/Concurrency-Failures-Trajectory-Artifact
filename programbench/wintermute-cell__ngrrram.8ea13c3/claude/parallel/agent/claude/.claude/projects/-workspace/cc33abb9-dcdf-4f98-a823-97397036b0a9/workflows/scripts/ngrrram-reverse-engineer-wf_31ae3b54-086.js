export const meta = {
  name: 'ngrrram-reverse-engineer',
  description: 'Fan out parallel behavioral investigation of the ngrrram TUI binary',
  phases: [
    { title: 'Investigate' },
    { title: 'Verify' },
  ],
}

const HARNESS = `
You are reverse-engineering the behavior of a compiled TUI binary at /workspace/executable
(a Rust ratatui-style terminal app called "ngrrram", a typing trainer for n-grams).

STRICT RULES (violating these disqualifies the whole project):
- You MUST NOT decompile, disassemble, or inspect the binary's bytes (no objdump, nm, strings,
  gdb, ghidra, readelf, hexdump, xxd, strace, ltrace, ltrace, perf, or any binary analysis on
  /workspace/executable).
- You MUST NOT search the internet or any package registry for the project's source code.
- ONLY interact with it by RUNNING it with flags and keystrokes and observing terminal output.
- Do not modify anything in /workspace. Write scratch files under /tmp/<your-own-dir>/.

A python harness already exists (use it, do not rewrite it):
  /tmp/rec/drive.py  - run(args_list, keys_list, rows=30, cols=100, settle=0.6, out=None, delay=0.05) -> raw bytes
                       spawns the binary in a pty; keys_list entries are strings/bytes to send,
                       or a float meaning "sleep this many seconds".
  /tmp/rec/term.py   - render(raw, rows, cols) -> Term ; Term.text() gives the visible screen text,
                       Term.dump_styles() gives per-row style runs (fg,bg,attrs) as a real terminal
                       would show them.
  /tmp/rec/cap.py    - cap(args, keys=(1.0,), rows=30, cols=100, settle=0.6, show=True, styles=False)
                       -> (Term, raw) ; convenience: runs and prints the screen.
  /tmp/rec/inter.py  - class Session(args, rows=30, cols=100): interactive session.
                       s.send('x')  s.pump(0.3)  s.lines()  s.show()  s.term.dump_styles()  s.close()
                       s.raw holds all raw bytes so far. s.alive is False after the app exits.
Always run from /workspace (cwd) so './executable' resolves; the harness uses exe='./executable'.
Example:
  cd /workspace && python3 -c "
import sys; sys.path.insert(0,'/tmp/rec')
from cap import cap
t,raw=cap(['--nokb'])
"

KNOWN FACTS (do not re-derive, build on these):
- UI is a fixed 79-column x 19-row box anchored at the top-left of the terminal (13 rows with --nokb).
- Screen rows (0-based) in the default layout: 0 top border with "Quit <esc>" at cols 66..76;
  1 title "ngrrram!" (bold) + "   by winterveil"; 2 separator; 3 "    Lesson #N" and
  "✔: A, ✘: B    "; 4 separator; 5 blank; 6 the lesson text (centered); 7 the typed-input line
  (centered, same start column as the lesson text); 8..14 keyboard; 15 separator;
  16 "  need >= %3dWPM,   avg. %3dWPM,   last %3dWPM"; 17 "  need >= %3d% Acc, avg. %3d% Acc, last %3d% Acc";
  18 bottom border.
- A lesson is: pick 'combi' ngrams uniformly at random with replacement from the top-'top' list,
  then repeat that whole sequence 'rep' times, each ngram followed by a space (so the lesson
  string ends with a trailing space and you must type that final space to finish).
- Typing: correct chars make the target char lose bold; wrong chars appear on row 7 at the same
  column; a wrongly-typed target SPACE renders as '•' on row 6. Backspace (0x7f) removes one char.
  0x08 (ctrl+backspace) appears to delete back to a word boundary. ESC and ctrl+c quit.
  Ctrl+<letter> is treated as typing that letter. Tab and Enter do nothing.
- The app renders ~62 frames/second (approx 16ms loop) even when idle.
- Colors: every style with a foreground/background color is emitted in a broken way that a real
  terminal renders as a full SGR reset, so on screen only bold/italic survive in specific places.
  Term.dump_styles() already reflects what a real terminal shows - trust it.
`;

const REPORT_RULES = `
Report your findings as a dense, precise, implementation-ready spec in markdown. Include:
- exact strings, exact column/row positions, exact numeric formatting (field widths, padding)
- exact command lines you ran and the exact observed output for the important cases
- explicit statements of what you could NOT determine
Be exhaustive about details; another engineer will implement from your report alone with no access
to the binary. Do not speculate without labelling it as a guess. Your final message IS the report.
`;

const AREAS = [
  {
    key: 'cli-args',
    prompt: `Investigate the command-line interface exhaustively.
- The exact --help / -h output (byte-exact, including trailing spaces and the exact wording/column
  alignment). Check both -h and --help, and where it is printed (stdout vs stderr) and the exit code.
- What the program name shown in "Usage:" depends on (try copying the binary to /tmp/foo and running
  it as ./foo, and via a symlink) - report exactly.
- Every invalid input: --n 5, --n 0, --n abc, --n "" , --top 0, --top 201, --top -1, --top abc,
  --combi 0, --combi 201, --rep 0, --rep -1, --rep abc, --wpm 0, --wpm abc, --wpm huge,
  --acc 101, --acc -1, --acc abc, --emu-in foo, --emu-out foo, --emu-in qwerty (without --emu-out),
  --emu-out qwerty (without --emu-in), --emu-in qwerty --emu-out qwerty, unknown flag --xyz,
  bare positional argument, "-n" with no value, "--n=3" style, "-n3" style, repeated flags
  (--n 2 --n 3), "--" separator, empty args. For each: exact stderr/stdout text and exit code.
- Boundary values that ARE accepted (e.g. --top 1, --top 200, --rep 1, --wpm 0?, --acc 0, --acc 100,
  --rep very large like 1000, --combi 200) - say whether it runs and what the UI shows.
- Whether short flags exist for every option (-n -t -c -r -w -a) and whether --show-ortho/--nokb/--cat
  have short forms or take values.
- Does the app require a TTY? What happens when run with stdin/stdout not a tty (e.g.
  './executable </dev/null | cat' ) - exit code and output.
Note: to see the help exit code use: cd /workspace && ./executable --help; echo "exit=$?"`,
  },
  {
    key: 'stats-math',
    prompt: `Determine the WPM and accuracy computation and the whole stats/lesson-result state machine.
Use /tmp/rec/inter.py Session so you can control typing timing precisely (s.send(ch) then s.pump(t)).
- WPM: the docs say "Every 5 non-space characters are considered a word" and "the timer starts on the
  first typed letter of the lesson". Determine the exact formula and rounding. Design experiments:
  type a lesson of known length with a known total elapsed time (e.g. sleep a controlled amount
  between the first and last keystroke) and solve for the formula. Check whether the character count
  used is the lesson length, the number of correct chars, the number of keystrokes, or something else,
  and whether the trailing space and the inner spaces count. Check whether backspaces/extra keystrokes
  change it. Determine rounding (floor/round/ceil) by hitting several elapsed times.
- Accuracy: determine the exact formula (e.g. correct/total keystrokes) and rounding; how backspace
  affects it; whether typing a wrong char then correcting it counts once or twice; what happens with
  0 mistakes; what the accuracy is if you type only wrong characters.
- avg vs last: how "avg." is computed (mean over all lessons? over successful ones?), how it rounds,
  and how it updates. Do failed lessons count into the average?
- The ✔/✘ counters: which lessons count as success (need BOTH wpm>=threshold AND acc>=threshold?),
  how the counters update, and what the "Lesson #N" number does on success vs failure (does it always
  increment?).
- Number formatting: field widths for the need/avg/last numbers (they look right-aligned in a width),
  what happens with 3+ digit values, and what happens with very large WPM (type a lesson instantly).
- Does anything else change on success/failure (styles, colors, extra text)?
Report the exact formulas with evidence tables (elapsed time, chars, resulting displayed number).`,
  },
  {
    key: 'keyboard-display',
    prompt: `Fully specify the on-screen keyboard widget.
- Give the EXACT character grid for the default (staggered) keyboard and for --show-ortho, including
  the exact starting column of each row and the exact box-drawing characters. Do this both without
  --cat and with --cat (the keyboard shifts left with --cat: give exact columns for both).
- Do this for all 6 layouts (--emu-in qwerty --emu-out <layout>): qwerty, qwertz, azerty, dvorak,
  colemak, colemakdh, in both staggered and ortho mode. Report the exact key characters per row.
  Note that non-ASCII keys (ü, ä, ö, ù, ^, $, △) exist - report them exactly.
- Which keyboard is displayed when only --emu-in is given, or only --emu-out, or neither?
- Does any key get highlighted/emphasized while typing (e.g. the next key to press)? Test by starting
  a lesson and typing partially, then dumping styles (s.term.dump_styles()) for the keyboard rows.
  Check whether the highlight uses reverse video/bold or a changed character, and what happens when
  the next character to type is a space, or a character not present on the keyboard.
- Is there any indication of which finger/hand, or any color, on the keyboard?
- What does the keyboard look like for a lesson from a wordlist file with characters outside the
  layout (e.g. digits or uppercase)?
Report the keyboard as literal lines of text with their absolute screen columns.`,
  },
  {
    key: 'cat-sprite',
    prompt: `Fully specify the --cat feature.
- Give the EXACT cat sprite: every row, the exact characters, and the exact absolute screen
  row/column where each row starts, for --cat alone, --cat --nokb, and --cat --show-ortho.
  The cat overlaps and overwrites the box border and separator lines - describe exactly how.
- The tail animates. Already known: the tail cycles through 8 distinct sprites in the order
  A B C D D C A E F G H H G F E (15 slots, each slot lasting 10 render frames ~160ms) and then
  repeats. VERIFY that order and duration independently, and give the exact characters and
  absolute positions of each of the 8 tail sprites (the tail occupies screen rows 15,16,17 in
  default mode: row 15 has "||" embedded in the "/▔▔▔▔▔▔▔▔||▔▔\\" body line).
  Also determine what happens to the tail rows in --nokb mode (the box is shorter).
- Determine whether the animation is driven by wall-clock time or by a render-frame counter: type
  keys continuously (which produces extra renders) and see whether the tail speeds up.
- Does the cat's face/body change at all (e.g. while typing, on success, on failure, blinking)?
  Watch a long session (5-10s) including typing correct and wrong characters and completing lessons.
- Does the cat appear in any other flag combination or affect the lesson text position?
Report each sprite as literal lines with absolute (row, col) anchors.`,
  },
  {
    key: 'emulation',
    prompt: `Determine exactly what --emu-in/--emu-out do to the TYPING behavior (not just the display).
- With --emu-in qwerty --emu-out dvorak, start a lesson and figure out which physical keystroke is
  accepted as "correct" for each target character. Use /tmp/rec/inter.py Session: read the target
  text from row 6, then try sending various bytes and see which one advances without an error.
  Deduce the full mapping direction (does typing the qwerty key at the position where dvorak has
  the target letter count as correct, or the reverse?).
- Build the complete character mapping table for at least: qwerty->dvorak, qwerty->colemak,
  qwerty->qwertz, qwerty->azerty, qwerty->colemakdh, and one reversed case (dvorak->qwerty), by
  testing every lowercase letter a-z plus space and the punctuation on the keyboard (; ' , . / [ ]).
  For each target character, report which byte you must send.
- What happens for a character that has no mapping (e.g. a digit or uppercase from a wordlist file)?
- What is displayed on row 6/row 7 when you type a wrong key under emulation: the physical char or
  the mapped char? Determine exactly (dump the input row).
- Does emulation affect the lesson text itself (row 6 content) or only the input interpretation?
- What if --emu-in and --emu-out are the same layout? What if only one is given?
Report a full mapping table as (target_char -> byte_to_send) for each layout pair you tested.`,
  },
  {
    key: 'terminal-size',
    prompt: `Determine how the app behaves at different terminal sizes and on resize.
- The UI is normally a 79x19 box at the top-left. Find the exact rule: try cols =
  200,100,80,79,78,70,60,50,40,30,20,10 and rows = 40,20,19,18,15,13,12,10,5,3,1 (use
  cap(args, rows=R, cols=C) from /tmp/rec/cap.py). Report the exact rendered screen for each
  interesting case: does the box shrink, get clipped, wrap, or does the app crash/exit?
  Is the box centered or top-left anchored? Is there a minimum size with an error message?
- Determine whether the lesson text row and the keyboard get repositioned/hidden at small widths,
  and whether the lesson text is truncated or wrapped (a long lesson e.g. --combi 40 --rep 1 at
  various widths).
- Test SIGWINCH resize while running: use the harness Session, then
  import fcntl,termios,struct; fcntl.ioctl(s.fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0,0))
  and then s.pump(0.5). Does the app redraw immediately, only on next keypress, or garble?
  Does it clear the old content? Does it handle a resize to a tiny size and back?
- Report what happens with --cat at small widths.`,
  },
  {
    key: 'wordlist-file',
    prompt: `Determine the "-n <file>" wordlist mode completely.
- The -n/--n option accepts "2","3","4","w" or a FILE PATH containing a comma separated wordlist.
  Create test files under /tmp/wl/ and determine: the exact parsing rules (separator, whitespace
  handling around items, trailing separator, empty items, newlines instead of commas, CRLF,
  duplicate items, unicode items, very long items, items containing spaces, an item that is a
  single space, uppercase, digits, empty file, file with only commas, a file with one item, a
  directory path, a nonexistent path, a file with no read permission, a binary file, a very large
  file). For each, report exactly what happens (error message + exit code, or how the lesson looks).
- How does --top interact with a wordlist shorter than 'top'? (e.g. 3 items with --top 50, and
  --top 200). Does it error, clamp, or repeat? Is the file order the "usage order"?
- How does --combi interact (e.g. --combi 200 with a 2-item file)?
- Does the app strip/keep the case of items? Does it sort them? Does it filter anything out?
- Is the file read once at startup or per lesson? (modify the file while running and see)
- What happens if an item contains a comma-escaped or quoted value?
Report exact behavior and error strings with exit codes.`,
  },
  {
    key: 'typing-details',
    prompt: `Nail down the fine details of the typing/input handling and the row 6/row 7 rendering.
Use /tmp/rec/inter.py Session and s.term.dump_styles() to see exact styles.
- Confirm the exact style of every part of row 6 (already-typed prefix vs remaining) and row 7, and
  when the remaining text is BOLD vs not (there is a known quirk: the very first lesson's remaining
  text renders bold, later lessons render plain because of a color-reset artifact - characterize
  exactly which frames show bold and why, by dumping styles right after various events:
  app start, after 1 keystroke, after a wrong keystroke, after a lesson completes, after a resize).
- What is the exact cursor position (the app emits ESC[?25h then ESC[row;colH each frame) at:
  app start, after N correct chars, after wrong chars, at lesson end? Extract from s.raw the final
  "ESC[r;cH" of the last frame.
- Overtyping: what happens if you keep typing after the last character of the lesson (extra chars)?
  Does the lesson end exactly at the last char? Can the input exceed the lesson length?
- Backspace: exact semantics at position 0, at a word boundary, with 0x7f vs 0x08 vs ESC[3~ (delete)
  vs ctrl+w vs ctrl+u. Does backspace un-count a mistake for accuracy? Does it re-bold row 6?
- What happens when you type a space when the target is not a space, and a non-space when the target
  is a space (the '•' display) - exactly which cell shows '•' and does it persist after backspace?
- Are non-ASCII/unicode keystrokes handled (e.g. send 'ü' as utf-8 bytes)? Are function keys, arrows,
  page-up, mouse events ignored? Does the app enable mouse capture (does it emit ESC[?1000h)?
- What is emitted on exit (ESC[?1049l, cursor show, etc.)? Capture the exact bytes after sending ESC.
  Also check what happens on SIGTERM/SIGINT (does it restore the terminal?) and whether the terminal
  is left in raw mode.
Report precisely.`,
  },
  {
    key: 'lesson-generation',
    prompt: `Determine the lesson generation and layout rules precisely.
- Confirm the lesson string construction for many (combi, rep) combos: is it
  (ngram1 ngram2 ... ngramC) repeated 'rep' times with a trailing space after every ngram?
  Test --combi 1 --rep 1, --combi 1 --rep 5, --combi 3 --rep 2, --combi 5 --rep 3 and report the
  exact row-6 text each time (run each a few times).
- Where is the lesson text placed horizontally? Determine the exact centering formula for many
  lesson lengths (e.g. lengths 3,4,5,...,80) by using --combi/--rep to control the length and
  reporting the exact start column. Include whether the trailing space is included in the centering
  and what happens when the text is longer than the box interior (77 cols): truncated? wrapped?
  Does the input row 7 use the same start column? What happens when the lesson is much longer
  (--combi 40 --rep 3) - is there scrolling as you type? Type through 30+ characters of a long
  lesson and report whether the display shifts.
- Is the "Lesson #N" number 1-based? Does the very first frame show #0 (a one-frame artifact)?
- Are the same 'combi' ngrams re-picked for each repetition or picked once? (rep>1 shows the same
  sequence repeated - verify with --combi 3 --rep 3.)
- Does --rep 0 or --combi 0 do anything?
- Does the random selection ever produce duplicates within one lesson's 'combi' picks? (yes,
  confirm) and is the RNG seeded per run (different lessons each run)?
Report exact rules and the centering formula.`,
  },
];

phase('Investigate')

const results = await pipeline(
  AREAS,
  (a) => agent(HARNESS + '\n\nYOUR ASSIGNMENT:\n' + a.prompt + '\n' + REPORT_RULES,
               { label: 'investigate:' + a.key, phase: 'Investigate' }),
  (report, a) => agent(HARNESS + `

An investigator produced the following report about the area "${a.key}". Your job is to
ADVERSARIALLY VERIFY it. Re-run the most load-bearing experiments yourself (at least 6 distinct
checks, focusing on exact strings, exact columns, exact numbers and formulas). Find anything that is
wrong, imprecise, or missing. Also look for one or two important things the report did not cover in
this area and investigate them.

REPORT UNDER TEST:
"""
${(report || '(the investigator produced no report)').slice(0, 60000)}
"""

Output a corrected, merged, implementation-ready spec for this area: keep everything that verified,
fix what was wrong (say explicitly "CORRECTION: ..." inline), and add what was missing. Your final
message IS the merged spec.` + REPORT_RULES,
    { label: 'verify:' + a.key, phase: 'Verify' })
);

return AREAS.map((a, i) => ({ area: a.key, spec: results[i] }));
