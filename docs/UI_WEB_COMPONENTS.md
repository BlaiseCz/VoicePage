# VoicePage UI (Web Components)

## Goal
Provide a framework-agnostic default UI layer that works in:
- vanilla JS
- React
- Angular

The UI layer is optional but recommended. It is designed as Web Components so host apps can drop it into any page without adopting a UI framework.

---

## Package: `voicepage-ui`
`voicepage-ui` exposes custom elements that subscribe to the `voicepage-core` event stream and render:

- Listening indicator (ON/OFF)
- Prompt overlay (“Say the target now…”)
- Error/misconfiguration modal
- Highlight layer for target element before click
- Optional help panel

The UI package **never** performs:
- inference
- matching
- click routing decisions

---

## Components (v1)
### `<voicepage-overlay>`
Top-level controller element.
- Renders prompts, errors, help
- Manages focus trapping for modal states (when active)
- Provides a consistent “always-on-top” overlay

Inputs:
- `engine` (or `engine-id`) to connect to a `VoicePageEngine` instance
- optional configuration (strings, enableHelp, etc.)

### `<voicepage-listening-indicator>`
Small badge showing:
- mic permission status
- listening state
- last keyword detected (optional)

### `<voicepage-highlight-layer>`
Visual highlight effect applied immediately before execution:
- highlight target for `highlightMs` (e.g., 300ms)
- then allow `core` to execute click/focus

### `<voicepage-modal>`
Generic modal used for:
- misconfiguration (duplicate labels)
- no match / ambiguous match
- optional confirmation for `data-voice-risk="high"`

---

## UI behavior (strict)
### Misconfiguration modal (duplicate labels)
Displayed when `voicepage-core` emits `MisconfigurationError` (e.g., duplicate labels when `collisionPolicy = "error"`):
- shows the colliding normalized label (labels are normalized to lowercase in v1)
- shows list of elements (selector/path + developer label)
- shows fix suggestions:
  - add/adjust `data-voice-label`
  - scope/rename labels
  - mark one as `data-voice-deny`

User actions:
- “Close” -> dismiss modal and return to listening

No action is executed.

### Disambiguation modal (duplicate labels)
Displayed when `collisionPolicy = "disambiguate"` and multiple candidates match:
- shows the transcript and the normalized target label
- shows a ranked list of candidates with contextual hints
- selecting a candidate triggers a deterministic action proposal for that exact element

User actions:
- selecting a candidate -> proceed
- “Close” / ESC -> emits `cancel` and returns to listening

### No-match modal
Displayed when no target matches transcript:
- shows what was heard (transcript)
- optional guidance (“Say the words you see on the page”)

### Highlight-then-act
When `voicepage-core` proposes an action for a single unique match:
- UI highlights target for a short duration
- action proceeds automatically unless:
  - `data-voice-risk="high"` requires explicit confirmation

### Modal-first interaction scope
When the page has a blocking modal/popup, the UI should indicate that VoicePage is scoped to the topmost modal/popup. Background page elements should not be presented as candidates.

---

## Integration patterns

### Vanilla JS
1) Create and configure engine in JS
2) Add `<voicepage-overlay>` to DOM
3) Pass engine reference or register engine globally

Pseudo-flow:
- user toggles listening
- overlay subscribes to engine events
- overlay renders prompts/errors
- engine stays headless and deterministic

### React / Angular
Same pattern:
- engine is created once (singleton or service)
- overlay is used as a normal DOM element
- optionally wrap overlay in a framework component for ergonomics

Important:
- The core engine owns state; UI reflects it.
- Avoid duplicating state inside frameworks.

---

## Styling & customization
`voicepage-ui` should support:
- CSS variables for theme tokens (background, text, accent, z-index)
- minimal default styling
- no assumptions about app CSS resets

Customization via:
- CSS variables
- optional slots for modal content (later versions)

---

## Accessibility requirements
- Modal overlays must trap focus while open
- ESC should map to `cancel` semantics (UI-level convenience; still emits cancel to engine)
- Visible listening indicator is always present when listening is enabled
- Announce major state changes where possible (ARIA live region)

---

## Non-goals (v1)
- full design system
- complex animations
- i18n (strings can be overridden later, but not a goal)