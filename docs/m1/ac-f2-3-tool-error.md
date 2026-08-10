# AC-F2-3 failing tool finding

Prompting the real adapter to run `sh -c "exit 7"` produced correlated `tool.ready` and `tool.done` records with the same ID `call_00_M2EMrvdxkc5RbMEptn2v8301`. The output explicitly says `[Exited with code 7]`, but the adapter emitted `status="done"`, not `status="error"`.

This is an upstream protocol/adapter defect against AC-F2-3: GUI correctly renders the received status and must not infer failure by scraping output. The raw sequence is `ac-f2-3-tool-error.ndjson`. M1 failing-tool acceptance is blocked until bingo maps non-zero Bash exit to `tool.done.status="error"`.
