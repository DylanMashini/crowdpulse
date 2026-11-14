# RolePicker

The launch screen choice between the app's roles. Provide `value`, `onChange(id)` and optionally `roles` (`id`, `icon`, `label`, `hint`).

- Shown once at launch; the role can be changed later from settings.
- Each hint says what the phone will do in that role, in one sentence.
- Nothing is selected by default.
- Each role is a `surface-2` card with a `line` outline at `radius-xl`. The chosen one moves to `surface-3` with a `signal` icon and a `line-strong` outline.
