export const meta = {
  name: 'halite-env-recon',
  description: 'Black-box reverse-engineer the Halite game environment binary across many behavioral dimensions',
  phases: [
    { title: 'Recon' },
    { title: 'Verify' },
  ],
}

const SHARED = `
CONTEXT: /workspace/executable is a compiled "Halite Game Environment" version 1.2 (a competition/game
platform). We must reimplement it from scratch in C++ from BLACK-BOX OBSERVATION ONLY.

HARD RULES (violating = disqualification):
- DO NOT search the web, github, package registries for source code or implementation details.
- DO NOT decompile/disassemble (no objdump, gdb, ghidra, nm, strings on ./executable, no strace/ltrace).
- ONLY run ./executable with inputs/flags and observe stdout/stderr/files it writes.
- You may write and analyze your OWN programs freely.

WHAT IS ALREADY KNOWN (verified):
- CLI: ./executable [-i <replaydir>] [-s <seed>] [-d "W H"] [-n <1..6>] [-r] [-t] [-o] [-q] [--] [--version] [-h] <bot cmd>...
- --version prints "./executable  version: 1.2"  (note the argv[0] then two spaces)
- Protocol per bot (over stdin/stdout pipes):
    line 1: player id (1-based)
    line 2: "W H " (trailing space)
    line 3: production map: W*H ints space separated, trailing space
    <bot replies with its name on one line>
    then per turn: game map line = RLE owner pairs "count owner count owner ..." until W*H cells,
      followed by W*H strength values, all space-separated with trailing space
    <bot replies with moves line: "x y dir x y dir ...">
- Replay is JSON (not gzipped) named "<unixtimestamp>-<seed>.hlt" in cwd or -i dir.
  Keys: frames, height, moves, num_frames, num_players, player_names, productions, version(=11), width
  frames[f][r][c] = [owner, strength]; moves[t][r][c] = direction int; productions[r][c] = int
- Non-quiet stdout: bot commands echoed TWICE each, then "W H", then "Init Message sent to player N."
  lines, "Init Message received from player N, NAME." lines, then "Turn 1".."Turn T",
  then "Map seed was S", "Opening a file at ./<file>.hlt", then per player
  "Player #I, NAME, came in rank #R and was last alive on frame #F!"
- Quiet (-q) stdout: bot commands echoed ONCE each, then "W H", then per player "id rank lastframe",
  then a line of timed-out player ids (items joined by " " plus a trailing " "; empty list prints just " "),
  then a line of log filenames (same joining, NO trailing newline at end of output).
- Timed-out/errored bots get a log file "<playerid>-<unixtimestamp>.log" written in cwd.
- Max turns = floor(sqrt(W*H) * 10) for the adjusted W,H.

USEFUL HELPERS already written at /workspace/probe/ (read them):
- nullbot.py: reads 3 init lines, prints a name, then echoes empty move lines forever.
- scriptbot.py: env SCRIPT=<json file of [[moves for turn 0],[turn 1],...]> BOTNAME=<name>; sends those moves.
- runsim.py: python module with run(seed,w,h,botmoves,names=,extra=,nplayers=) -> (stdout,stderr,replay_dict,logs)
  and show(rep, frames=[..]) to pretty-print frames. Use: sys.path.insert(0,'/workspace/probe').
- extract.py: get_map(seed,w,h,n,nbots) -> dict(w,h,prod,owner,strength) grids.
Run things from a scratch dir you create under /tmp so you do not pollute /workspace.

YOUR OUTPUT: write a thorough markdown report to /workspace/probe/findings/<NAME>.md documenting
every rule you established, with the concrete experiments/evidence, and explicitly flag anything
you could NOT determine. Be exhaustive and precise -- another engineer will implement C++ from your
report alone. Your final message should be a concise summary of the key rules you nailed down.
`;

const TOPICS = [
  {
    key: 'movement-production',
    title: 'Movement, production, strength caps',
    prompt: `Determine EXACTLY the per-turn game update rules for owned pieces, ignoring combat for now
(use maps/positions where players never touch, e.g. large maps, or single-player -n mode with 1 bot).
Establish:
1. Direction encoding: which integer means STILL/NORTH/EAST/SOUTH/WEST in the move protocol AND in the
   replay 'moves' array. Test each of 0,1,2,3,4 and observe which way a piece moves in row/col terms.
   Confirm wrap-around (torus) behavior at edges.
2. Production: when a piece stays STILL, how much strength does it gain? Exactly production of its site?
   Is there a cap (test up to 255 and beyond)? Does a piece that MOVES gain production? Does the
   strength cap apply before/after combat?
3. Merging: two friendly pieces moving onto the same site -- how do strengths combine? Is there a cap
   (e.g. capped at 255)? Test 3+ pieces merging.
4. Moving onto an unowned (owner 0) site: how is the neutral strength handled? What if the moving
   piece strength is less than / equal to / greater than the neutral strength? Does the neutral site's
   strength subtract? Does the piece capture the site?
5. Moving onto own site that also has a piece staying still.
6. What happens if a bot issues a move for a site it does not own, or coordinates out of range,
   or duplicate moves for the same site, or malformed tokens? Does the env ignore them, error the bot?
7. Verify the x/y convention in the move string: is it "x y dir" with x=column and y=row, or reversed?
Also determine whether strength 0 pieces still exist/persist.
Use the replay JSON to read exact resulting strengths.`,
  },
  {
    key: 'combat',
    title: 'Combat resolution',
    prompt: `Determine EXACTLY the combat rules. Use small maps and scripted bots so pieces meet.
Establish:
1. When two pieces of different owners move onto the SAME site, what is the outcome (who owns it,
   what strength)? Test equal strengths and unequal.
2. Do adjacent enemy pieces damage each other WITHOUT moving into each other? (Strong evidence yes:
   on a 4x4 map with two adjacent starting pieces of strength 88 each, both died on turn 1.)
   Determine the exact damage formula: does piece A deal damage equal to A's strength to every
   adjacent enemy piece AND to the site it moved to? Is damage simultaneous (both computed from
   pre-combat strengths)?
3. Does a piece damage adjacent NEUTRAL (owner 0) sites with strength > 0? Test carefully: a lone
   piece next to neutral squares -- do the neutral strengths decrease?
4. What is the damage radius: only the 4 orthogonal neighbors, or also the piece's own site?
5. With 3+ players meeting at once, how is it resolved?
6. When a piece is destroyed does the site become owner 0 strength 0?
7. Determine the exact ORDER of operations in a turn: (a) apply moves, (b) resolve collisions/merges,
   (c) apply combat damage, (d) add production. Prove the order with experiments (e.g. does a piece
   that just captured a site gain production the same turn?).
8. Establish whether a piece moving into a neutral site with LESS strength than the neutral reduces
   the neutral strength and dies, and whether the neutral strength is reduced by exactly the piece str.
Be extremely precise with numbers; dump replay frames before/after.`,
  },
  {
    key: 'protocol-timeouts',
    title: 'Bot protocol, timeouts, error handling, log files',
    prompt: `Determine EXACTLY the bot I/O protocol edge cases and timeout/error handling.
1. Timeout durations: how long does the env wait for the init (name) response vs per-turn moves?
   Test bots that sleep for varying durations (e.g. 0.5s, 0.9s, 1.1s, 1.5s, 2s, 5s, 10s, 20s).
   Report the init timeout and the per-turn timeout in milliseconds as precisely as you can bracket
   them. Check whether -t (--timeout flag) really gives infinite time.
2. What exactly is written to the "<pid>-<timestamp>.log" file? Reproduce its full format byte-exactly:
   header lines, the " --- Init ---" section, " --- Bot used N milliseconds ---" lines, the dashed
   separator line (count the dashes), " --- Frame #N ---" sections, and the final error text for
   each failure mode (timeout / no response / EOF / bad moves / crash). Show raw bytes.
   Does the log contain the bot's stderr? Its stdout? Both? Test a bot that writes to stderr.
3. What happens when a bot dies/exits mid-game? When a bot writes garbage? When it sends too many
   tokens? When it never sends a name? When the name is empty? When name has spaces (is only the
   first token used? the whole line?)? Very long names?
4. Is the bot process launched via a shell (so "cmd arg1 arg2" and shell metacharacters work)?
   Test quoting/redirection. Are bot stderr/stdout separated?
5. What happens with a bot command that does not exist?
6. Does the env kill bots at the end? Does it send anything special at game end?
7. Determine the -o/--override flag behaviour: with -o, are player names taken from the command-line
   argument instead of the bot's response? Exactly what string is used?
8. When a bot times out, is it removed from the game (its pieces removed?) and how does that show in
   the replay/frames? Verify what happens to its territory.
9. Test what happens when a bot sends a name but then EOFs immediately.
Give exact byte-level formats.`,
  },
  {
    key: 'cli-tclap',
    title: 'CLI parsing, help text, error messages',
    prompt: `Determine EXACTLY the command-line interface behavior byte-for-byte. It appears to use the
TCLAP C++ library. Capture EXACT stdout/stderr and exit codes for:
1. --help / -h (full exact text including whitespace/indentation - dump with od -c or python repr).
2. --version.
3. No arguments at all.
4. One bot only (is that allowed? what message?). Zero bots.
5. Invalid -n values (0, 7, -1, "x"), invalid -d values ("5", "5 5 5", "a b", "0 0", "-5 5", "5.5 5"),
   invalid -s values (0, -1, "abc", huge numbers like 4294967296, 99999999999999999999).
6. Unknown flags (--foo), missing required arg values (-s with nothing after), "--" handling,
   combined short flags (-rq, -qr), flags after bot commands, repeated flags (-s 1 -s 2).
7. -i with a nonexistent directory, with a file, with a trailing slash or not. Where exactly does the
   replay file go and what is the "Opening a file at ..." path string in each case?
8. Exit codes for all of the above.
9. What is the exact default behaviour when -d is omitted (random dimensions? what range?) and when
   -s is omitted (random seed - print "Map seed was N")? Run many times to characterize the ranges of
   randomly chosen dimensions (min/max/distribution) and seed.
10. Does -n work with more than one bot? What error/behavior?
11. Order of the echoed bot command lines and the "W H" line.
Record everything as exact byte strings (python repr) so it can be replicated char-for-char.`,
  },
  {
    key: 'ranking-endgame',
    title: 'Ranking, game end conditions, replay details',
    prompt: `Determine EXACTLY how games end and how players are ranked.
1. Max turn count formula: verify floor(sqrt(W*H)*10) across many dimensions including rectangles
   (use -t and fast null bots; read num_frames from the replay). Report exact formula.
2. Early termination: does the game end as soon as only one player remains alive? Verify with a bot
   that suicides. Does it end when zero players remain? What if all die simultaneously?
3. Ranking rules: with equal territory/strength who wins (observed: player 2 beat player 1 when both
   idle and symmetric)? Determine the sort key: is it (last frame alive desc, then territory, then
   strength, then player id)? Design experiments with 3-4 players where one has more territory but
   less strength etc. Report the exact comparator and tie-break.
4. "last alive on frame #F" semantics: which frame number is reported for a player that survives to
   the end vs one that dies at turn k?
5. Replay JSON exactness: key order in the file, number formatting, whether it is minified,
   num_frames vs len(frames), moves length vs frames length, what the moves array contains for
   sites not owned / not moved, what it contains for a dead player's sites, and whether moves for
   the final frame are recorded. Whether player_names are the raw bot-provided names.
6. Does the replay include any info about timeouts?
7. What is the exact "Opening a file at ..." string, and the exact filename format (timestamp source)?
8. Confirm frames[0] is the initial map and frames[i] the state after turn i.
9. Check the version field and whether it varies.
Give exact evidence.`,
  },
  {
    key: 'mapgen-structure',
    title: 'Map generator: symmetry/tiling structure and dimension adjustment',
    prompt: `Reverse-engineer the STRUCTURE (not yet the RNG) of the map generator.
Known: with -n P (single bot) or P bots, requested -d "W H" gets ADJUSTED. Measured for square requests:
  n=1: unchanged. n=2: both rounded down to even. n=3: both to multiples of 3.
  n=4: W to multiple of 2, H to multiple of 8. n=5: both to multiples of 5.
  n=6: W to multiple of 3, H to multiple of 12.
Tasks:
1. Build a full 2D table of (requested W, requested H, n) -> adjusted (W,H) for n=1..6 over a wide
   range (say 1..60 for both, sampled) and DERIVE the exact adjustment algorithm. Consider that the
   generator may pick a tiling factorization (a columns x b rows of identical regions with a*b = n or
   with reflections) and require W % a == 0 and H % b == 0 plus extra constraints. Note n=4 H needing
   multiple of 8 and n=6 H needing multiple of 12 - figure out why (maybe reflection doubling).
   Also determine what happens for degenerate requests (0, 1, huge).
2. Determine the SYMMETRY structure of generated maps for each n: given the adjusted map, find all
   translations/reflections T such that prod[T(r,c)] == prod[r,c] and strength likewise. Report for
   n=2..6 across several seeds and dimensions. Known examples: seed 1/12345 10x10 n=2 has
   (r,c)->(H-1-r,c) reflection; seed 7 24x24 n=2 has (r,c)->(r+12, W-1-c); seed 7 24x24 n=3 has
   horizontal period 8; n=4 24x24 has both reflections; n=5 20x20 has translation (r,c)->(r+4,c+8);
   n=6 24x24 has horizontal period 8 plus vertical reflection.
   IMPORTANT: determine whether the transformation used for each copy is RANDOM per seed (it appears
   to vary) and enumerate the possible transformation sets.
3. Determine the fundamental-domain size (area/n) and its shape for each n.
4. Determine where player starting pieces are placed relative to the fundamental domain, and their
   initial strength (looks like 255? no - observed 41, 88...). Actually determine the rule for the
   initial strength of a player's starting piece and its production site value.
   Check: is the start piece placed at the location of some extremum (e.g. lowest production)?
5. Determine whether productions and strengths are the SAME grid across different n for the same seed
   (i.e. is the base noise seed-only-dependent?), and whether changing only W or only H changes
   everything or scales.
Write the report with concrete grids as evidence. Save raw grids you gather to
/workspace/probe/data/ as JSON so others can reuse them (name them clearly).`,
  },
  {
    key: 'mapgen-values',
    title: 'Map generator: value distributions and prod/strength relationship',
    prompt: `Investigate the numeric properties of generated maps to constrain the generation algorithm.
Use extract.py get_map(seed,w,h,n,nbots) (see /workspace/probe/extract.py). Use n=1 with 1 bot to get
UNSYMMETRIZED base maps (fastest, ~1.5s each).
1. Collect many n=1 maps at various sizes (e.g. 1x1, 2x2, 3x3, 1x8, 8x1, 5x5, 10x10, 16x16, 32x32)
   and seeds, and save the raw grids as JSON to /workspace/probe/data/.
2. Characterize the production value distribution: min, max, histogram, as a function of map size.
   Is max production bounded? Does the histogram look like a rounded/floored continuous field?
   Is the mean roughly constant?
3. Characterize strength: min, max, mean. Is strength correlated with production per-cell? Compute
   correlation. Is strength = f(production) + noise, or an independent field? Is strength ever 0? >255?
4. For a 1x1 map (n=1), what are the production and strength? Run 200 different seeds and report the
   exact multiset of (prod, strength) pairs - this is the tightest possible probe of the RNG.
   Similarly for 1x2, 2x1, 2x2.
5. Does seed S and seed S+1 give completely different maps (suggesting a well-mixed PRNG seeding)?
   Do two different sizes with the same seed share any values (suggesting the same RNG stream)?
   E.g. does the 2x2 map appear as a sub-block of the 4x4 map for the same seed?
6. Try to detect the smoothing/blur structure: compute the 2D autocorrelation / spatial spectrum of
   production and strength for a large map (e.g. 48x48). Report whether it looks like a Gaussian blur
   of white noise, a fractal/diamond-square, or Perlin-like, and estimate the correlation length.
7. Check whether production/strength grids for a WxH map relate to those for (W)x(H') maps.
Write up numbers concretely. This report will be used to design and validate a candidate generator.`,
  },
];

phase('Recon')

const results = await parallel(TOPICS.map(t => () =>
  agent(SHARED + "\n\nYOUR ASSIGNMENT: " + t.title + "\n" + t.prompt +
        `\n\nWrite your report to /workspace/probe/findings/${t.key}.md`,
        { label: `recon:${t.key}`, phase: 'Recon' })
));

return { done: TOPICS.map((t,i) => ({ topic: t.key, summary: results[i] })) };
