---
name: compiler-lab-reference-artifacts
description: The committed processed.txt/afterPreProcess.txt in /workspace are GBK-encoded golden outputs of the original solution and pin down the exact lexer output format.
metadata: 
  node_type: memory
  type: project
  originSessionId: 7c5e1332-a1c9-4ea7-8fe6-71408a6f367c
---

In the /workspace compiler-lab repo (LexicalAnalyzer + Parser), `LexicalAnalyzer/afterPreProcess.txt`
and `LexicalAnalyzer/processed.txt` are **committed reference outputs of the original solution**,
encoded in **GBK** (decode with `iconv -f GBK -t UTF-8`). They are the only ground truth for the
expected output format, so keep them untouched in git and run the binary in a scratch dir.

What they pin down (verified reproduced byte-for-byte on 2026-08-12):
- preProcess: strip `//` (keep the newline) and `/* */` comments, then delete `\n`/`\t` and collapse
  runs of spaces → one single line, no trailing newline.
- Token table: `setw(8) << idx << setw(12) << type << setw(12) << value`; header uses the same widths.
  Illegal tokens are skipped in the table but still consume an index (17 and 25 are missing).
- Error block: `不合规单词：` / `  <word>: ` (trailing space) / `    第<idx>个单词;…` /
  `    位于第<row>行第<col>列…` where row is 1-based and col is the raw 0-based `string::find` result.
- Because the source is UTF-8 and the reference was compiled on Windows/GBK, `setw` padding of the
  Chinese header line cannot match the committed bytes on Linux — every ASCII row does match.
