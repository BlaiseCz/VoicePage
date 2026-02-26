# VoicePage Labeling Spec (v1)

## Purpose
This document defines the strict, deterministic rules VoicePage uses to:
- decide which elements are voice-addressable
- compute a label for each addressable element
- normalize labels and transcripts for matching
- restrict targeting when a blocking modal/popup is open (modal-first scope)

VoicePage is designed for high precision. When uncertain, it prefers disambiguation or refusal over guessing.

---

## Definitions
- **Scope root**: the DOM subtree VoicePage is allowed to target for a given request.
- **Addressable element**: a DOM element that is eligible to be targeted by voice.
- **Raw label**: the unnormalized string produced by a label source.
- **Normalized label**: the canonical string used for indexing and matching.

---

## 1. Interaction scope (modal-first)
VoicePage resolves targets within a single scope root.

### 1.1 Scope root selection
1) If a blocking modal/popup is present, the scope root is the **topmost modal root**.
2) Otherwise, the scope root is `document`.

### 1.2 Modal root detection (deterministic)
An element qualifies as a modal root if it is visible and matches one of:
- `dialog[open]`
- `[role="dialog"][aria-modal="true"]`
- `[aria-modal="true"]`
- `[data-voice-modal="true"]` (explicit override)

### 1.3 Topmost modal selection
If multiple modal roots qualify, VoicePage selects the topmost modal root by:
1) highest computed `z-index` (parseable integer; non-integers treated as `0`)
2) if tied, the modal root appearing later in DOM order wins

---

## 2. Addressable elements
An element is addressable if it is within the scope root and passes:
- eligibility rules
- visibility rules
- allow/deny rules

### 2.1 Eligibility (v1)
An element is eligible if any of the following is true:
- it has an explicit canonical label: `data-voice-label`
- it is one of:
  - `button`
  - `a[href]`
  - `input` (except `type="hidden"`)
  - `select`
  - `textarea`
  - `summary`
- it has an ARIA role in:
  - `button`, `link`, `tab`, `menuitem`, `option`

Note: v1 intentionally keeps eligibility conservative. Additional roles/elements can be added later.

### 2.2 Visibility (v1)
An element is considered visible if all are true:
- it does not have `hidden`
- it is not `aria-hidden="true"`
- computed style `display != "none"` and `visibility != "hidden"`
- it has a non-empty client rect (`getClientRects().length > 0`)

If a menu/section item is not currently visible, it is not addressable until visible.

### 2.3 Allow/deny attributes
- `data-voice-deny="true"` => never addressable
- `data-voice-allow="true"` => addressable even if it matches a global deny list (if configured)

---

## 3. Label sources (precedence)
VoicePage computes a label for each addressable element using the first non-empty source below.

### 3.1 Canonical label override
1) `data-voice-label`

### 3.2 Accessible/visible fallback labels
2) `aria-label`
3) `aria-labelledby` (concatenate referenced elements’ visible text with single spaces)
4) Associated `<label>` text for form controls:
   - `<label for="id">…</label>`
   - or a `<label>` ancestor wrapping the control
5) Visible element text:
   - `innerText` (trimmed)
6) Input placeholder (for `input`/`textarea`):
   - `placeholder`
7) `title` attribute

If no label can be derived, the element is not indexed.

---

## 4. Text extraction rules
When a rule requires “visible text”, VoicePage uses:
- `innerText` trimmed
- if `innerText` is empty/unavailable, fallback to `textContent` trimmed

For `aria-labelledby`, referenced nodes are read using the same visible-text rule.

---

## 5. Normalization (v1)
VoicePage normalizes both derived labels and user transcripts using the same function.

### 5.1 Required normalization
- convert to lowercase
- trim leading/trailing whitespace
- collapse consecutive whitespace to a single space

### 5.2 Notes
- v1 does not require punctuation-stripping. If punctuation causes frequent mismatches, add a new normalization step deliberately (and update benchmarks).

---

## 6. Synonyms (optional, v1)
Developers can provide synonyms for matching via:
- `data-voice-synonyms="billing, billing settings, invoices"`

Rules:
- split on commas
- normalize each synonym using the same normalization rules
- synonyms participate in matching, but do not change the canonical displayed label in UI

---

## 7. Collisions and ambiguity
The target index maps **normalized labels** to one or more addressable elements.

Collision handling is controlled by `collisionPolicy`:
- `disambiguate` (default): duplicates are allowed, but VoicePage must not auto-act. UI selection is required.
- `error`: duplicates are treated as misconfiguration; VoicePage refuses to proceed and emits details.

---

## 8. Examples

### Example 1: developer override
```html
<button data-voice-label="Contact">Get in touch</button>
```
- raw label: `Contact`
- normalized: `contact`

### Example 2: visible button text
```html
<button>Pricing</button>
```
- raw label: `Pricing`
- normalized: `pricing`

### Example 3: input with associated label
```html
<label for="email">Email address</label>
<input id="email" type="email" />
```
- raw label: `Email address`
- normalized: `email address`

### Example 4: modal-first scope
If a modal dialog is open, only elements inside the selected modal root are indexed and targetable. Background page elements are treated as non-addressable until the modal is dismissed.
