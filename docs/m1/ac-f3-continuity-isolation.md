# AC-F3-1 / AC-F3-2 continuity and isolation

## Same conversation

Session `bingo-1786325961` received two turns:

1. `Remember this exact nonce for the next turn: ABC123. Reply only OK.` → `OK`
2. `What nonce did I ask you to remember? Reply only with the nonce.` → `ABC123`

The second prompt in `ac-f3-1-continuity.ndjson` does not contain `ABC123`; continuity therefore comes from the persistent bingo session, not GUI prompt injection.

## Fresh conversation

A separately launched conversation received session ID `bingo-1786326025`, then the question asking for the prior nonce. It answered `UNKNOWN` and stated no nonce was provided. Its raw stream is `ac-f3-2-isolation.ndjson`, which contains no previous messages or nonce value in the prompt.

Result: continuity within one persistent process and isolation across fresh processes both pass at the transport/session seam. GUI New conversation button wiring is not yet implemented, so AC-F3-2 is not fully claimed at the click/UI seam.
