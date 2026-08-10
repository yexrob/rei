# AC-F2-5 cancellation evidence

- Real persistent bingo child used.
- Turn `b31b2e15-e249-4a70-851f-7765d4728f01` started streaming, then received `turn.cancel`.
- Terminal event: `turn.cancelled`, seq 8, `reason=requested`, with the matching cancel command ID.
- No later record in the raw stream uses the cancelled turn ID after seq 8, proving no late delta overwrote the terminal state.
- A second turn was accepted by the same child immediately and reached `turn.completed` at seq 1550 with response `RECOVERED`.
- GUI reducer coverage independently asserts cancellation clears prompts, marks streaming content/tools interrupted, returns idle, and the turn guard rejects stale events.

Raw events: `ac-f2-5-cancel.ndjson`; diagnostics: `ac-f2-5-cancel.stderr`.

GUI screenshot automation for the physical Cancel click remains pending; the transport and reducer portions pass, but this document does not claim the QA 1-second UI measurement.

## Update (GUI evidence)
- `../screenshots/m1/ac-f2-5-cancel.png` re-captured after the CSS fix: the interrupted message now shows a distinct `INTERRUPTED` status badge on its own line (was `BINGOInterrupted` concatenation).
