# PushBanner

A flag arriving on the nurse phone, in the app and as the model for the system push. Provide `ticket`, `time`, the handoff sentence as children, `onAcknowledge`, `onOpen`, and `acknowledged` with optional `by`.

- One banner per flag episode. After Acknowledge, the cool-down applies before the same ticket can notify again.
- The body is the templated handoff sentence: ticket number and measurements only.
- After the tap the button is replaced by the word Acknowledged. It does not disappear silently.
- This is a prompt to walk over, not an alarm: no red, no sound escalation, no full-screen takeover.
