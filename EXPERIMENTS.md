# Experiments Log: diff-speed-01-run-20261126

| # | Ide | Perubahan | Skor sebelum | Skor sesudah | Waktu eksekusi | Keputusan |
|---|-----|-----------|--------------|--------------|----------------|-----------|
| 1 | Baseline makefun-diff | Pure JS Myers line diff | N/A | 3,635,041 µs | ~3.64 s | Baseline |
| 2 | Myers in WebAssembly | Port forward greedy Myers search to WASM | 3,635,041 µs | 757,594 µs | ~0.76 s | Commit (4.8x speedup) |
| 3 | Fast tokenization + intern map | Single-pass indexOf/slice tokenization, Object.create(null) interning, charCodeAt newline check, enable TurboFan | 757,594 µs | 658,748 µs | ~0.66 s | Commit (+13.1% speedup, 5.52x over baseline) |
