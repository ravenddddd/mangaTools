# Manga Tools

One Stash plugin for manga, in two halves: it **manages** a manga library — which
languages, which translation groups, what is censored, what is read raw — and it
**reads** one, two pages at a time in the lightbox. It **does not modify Stash
core code**: everything goes through the UI plugin API, so Stash upgrades never
produce merge conflicts.

The two halves were separate plugins until they were found to keep arriving at
the same questions — which image is this, what order are the pages in, what does
this gallery say about itself — and two answers to those is the bug that takes
longest to find. They are one bundle now, but they are still installed one at a
time and each inside its own guard, so a Stash that cannot start one still runs
the other. Reading is the half that has to survive: whatever else is wrong with
the page, a reader can still read.

## Features

| Feature | What it adds |
|---|---|
| **Language** | A language attribute on galleries, surfaced as a flag badge, an edit-page dropdown, a bulk-edit row and a localised detail row |
| **Censorship** | Whether a gallery is censored or not, surfaced as a mark on the gallery card and a row in the detail page's Manga info panel |
| **Translation group** | Who translated the comic, as free text — a box in the edit page's Manga info block, a row in the details one, and, in both directions, the language its galleries usually carry: a button on the language row, and the menu's order and flag hint |
| **Original text** | A mark for a gallery nothing was translated from, so "no group" and "not filled in yet" cannot be confused — a 生肉/熟肉 toggle on the group row, and a `（生肉）` after the language in the details panel |
| **Language filter** | A "language" section in the gallery list's sidebar that narrows the list to one language |
| **Settings** | One page, grouped: the two things the plugin takes over, the four fields and how they are shown, and the mark's own behaviour |
| **Reading** | A two-page (spread) view for the image lightbox, with the pages paired the way a manga is printed — see [Reading](#reading-two-pages-at-a-time) |

Each feature occupies its own section below, and each keeps to the same rule:
anything it does not own is handed straight back to Stash untouched.

### Language

Adds a "language" property to galleries.

| Where | Effect |
|---|---|
| Gallery list / card | A **regional flag** in the bottom-right of the cover (Japan, China, Taiwan…). Fades out on hover like the studio icon, clearing the cover |
| Gallery list / sidebar | A **language section** listing every language, to filter the list — see [Filtering](#filtering) |
| Gallery edit page | A "language" dropdown **between "studio" and "performers"**, listing "flag + localised name" — no typing codes by hand |
| Gallery detail page | An extra `<h6>` row **below "photographer", above "details"**, showing "flag + localised name" with the same label and font as the rows around it |
| Gallery bulk edit | A "language" row **between "studio" and "performers"**, prefilled with the selection's shared language like the studio field, and applied by the dialog's own **Apply** — Cancel discards it like every other field |

**Both of those positions rely on DOM plus a React portal, not a plain React
patch.** Stash leaves no insertion point at either one:

- **Detail page**: everything inside `.gallery-details` is a bare `<h6>`. The
  only component there is `PhotographerLink`, and neither it nor its parent
  `GalleryDetailPanel` is patchable. The plugin appends an empty container to the
  end of `.gallery-details`, which lands exactly after "photographer" and before
  "details".
- **Edit page**: `StudioSelect` *is* patchable, but it renders **inside a
  `<Col>`**, so anything injected there is nested in that column and the label
  column stops lining up with the fields above. Instead a sibling field row is
  inserted into the DOM, anchored on the `data-field="studio_id"` attribute that
  `renderField` leaves on every row (see `ui/v2.5/src/utils/form.tsx`) — far more
  stable than walking the element structure.

  **The column widths are copied off the native field's DOM rather than
  computed.** This came out of a real bug: `labelProps { sm:3, xl:2 }` /
  `fieldProps { sm:9, xl:7 }` were hard-coded from the develop branch's defaults,
  but the build actually running has **no `xl`** in its defaults, so on wide
  screens the label column came out narrower than the native ones and nothing
  lined up. Copying the classes that are already there is correct regardless of
  Stash version or breakpoint.

  The dropdown itself matches Stash's look too: `classNamePrefix: "react-select"`
  reuses its theme, and `components: { IndicatorSeparator: () => null }` removes
  the vertical rule react-select draws between the clear and expand icons —
  which is exactly what Stash's own `Select.tsx` does in its default props.

  Its options are **ordered by the name shown**, in the reader's own collation,
  so the list reads naturally in whatever language the Stash UI is set to. There
  is no hand-written priority order — see [Extending](#extending) for why that
  one was removed.

Both positions only insert an **empty div**; the content is rendered by a React
portal, so a UI language change or a value change updates automatically. No HTML
is written into the DOM by hand.

The "language" label comes straight from Stash's own locale files
(`config.ui.language.heading`) rather than a table maintained here — verified to
exist in every locale shipped with v0.31.1 (`语言` / `語言` / `Language` / `言語` /
`언어` / `Sprache`…), which gets all ~40 of Stash's UI languages for free.

Flags use `flag-icons`, which Stash already loads globally in `index.scss`, so the
plugin emits `<span class="fi fi-jp">` and ships **no extra assets**. They look
identical to the nationality flags on performer pages.

The data lives in one of the Gallery's **custom fields**: `plugin.mangaTools.language`. What
is stored is the canonical code, not the display name — the same approach Stash
takes for performer nationality (store `US`, display `United States`).

The semantic meaning is **the language of the comic itself**, not whether it is
raw or translated.

The name to display for that code is looked up through `Intl.DisplayNames` at
render time, so it follows Stash's UI language rather than being stored or
shipped — see [Extending](#extending) for why, and for what that costs.

#### Bulk edit

Setting one language across a whole selection is the reason this row exists, and
it is the only part of the plugin that reaches outside the patch API — so it is
worth knowing how it works.

`EditGalleriesDialog` is **not** a `PatchComponent`, and it keeps the values it is
about to apply in its own state:

```jsx
const [updateInput, setUpdateInput] = useState<BulkGalleryUpdateInput>(...)
function getGalleryInput() { return { ...updateInput, ... } }   // Apply sends this
```

No hook lets a plugin add a field to that state. So the row is rendered *outside*
it — DOM plus portal, anchored on the `data-field="studio"` row that
`BulkUpdateFormGroup` emits — and its value is merged into the outgoing mutation
instead:

- the plugin installs one `ApolloLink` in front of Stash's chain with
  `client.setLink(from([ours, previous]))` — Apollo's own API for changing the
  chain after the client exists. The existing chain is passed through untouched,
  so nothing else about the client changes.
- that link rewrites `input.custom_fields` on `bulkGalleryUpdate` **only**, as
  `{ partial: { "plugin.mangaTools.language": "ja" } }`. It is matched on the schema's root field
  name, not on an operation name, and scene/image bulk updates are deliberately
  left alone. A bulk edit that has nothing to do with language goes out byte for
  byte as Stash built it.
- it is installed **lazily**, the first time the row mounts, so a user who never
  opens the dialog never has their client touched at all.
- the value is cleared once the update **succeeds**, so a failed Apply can simply
  be retried with the row still filled in, and a cancelled dialog leaves nothing
  behind.
- a successful update also **refetches the gallery map**, so the flag badges on
  the cards update instead of waiting up to a minute for the next poll. That
  refetch waits for any fetch already in flight: one started before the write
  carries pre-write data and would otherwise land afterwards and undo it.

`partial` is what makes this safe rather than a blind overwrite: `CustomFieldsInput`
updates just the named keys, so nothing else in a gallery's custom fields is
disturbed.

The row behaves like Stash's own studio field, because it is the same shape of
data — one value per gallery:

- **the box is prefilled with the selection's shared language** when every
  selected gallery agrees, and shows the placeholder when they differ or none of
  them carries one. That mirrors `getAggregateStudioId` in Stash's
  `utils/bulkUpdate.ts`; the languages come from the plugin's own gallery store,
  since the dialog is the one thing that cannot be read.
- **clearing the box means "leave the language alone"**, exactly as clearing the
  studio field means "leave the studio alone" — neither sends a value. There is
  deliberately no way to blank the field across a selection, and so no extra
  button beside the dropdown.

The selection itself is read by *observing* `GalleryList` (`patch.before`, which
hands the props straight back). That is the only patchable component that receives
`selectedIds`, and it is the parent of all three display modes, so grid, list and
wall are all covered by one hook.

#### Filtering

The gallery list's sidebar gains a **language** section, built to work the way
Stash's own studio section does:

- a heading you can fold away, with whatever is selected **above** it, so the
  selection stays visible while the list of choices is folded
- a search box over the candidates, matching both the name and the code
- two modifier entries first — **(Any)**, galleries carrying a language at all,
  and **(None)**, galleries carrying none
- every language below, each with an **include** button and an **exclude** one
- excluded values collected in their own list, marked with a cross rather than a
  tick

There are three decisions behind that worth knowing, because each rules out an
approach that looks more obvious.

**There are two surfaces, and they commit at different times.** The sidebar
section applies on every click. The "edit filters" dialog also offers a
**Language** card, registered into the filter model's own
`options.criterionOptions` — the module-level array Stash builds its cards from,
which is reachable through the model even though `EditFilterDialog`,
`CriterionEditor` and `CustomFieldsFilter` are all plain `React.FC` and cannot be
patched. That card keeps its own selection and merges it into the URL when
**Apply** is pressed, exactly as the sidebar does; `src/filter-model.ts`
holds the operations the two share, so a click cannot come to mean different
things in the two places.

**The criterion is a custom field, and Stash is told it is a language.** It has to
be stored as one: Stash decodes the query string before a plugin's filter option
exists, so a stored type of `language` would not resolve on a reload. That leaves
Stash treating it as a custom field, which shows up in two places — its tag would
open the custom-fields card, and that tag would read `plugin.mangaTools.language
(custom field) is ja`. Both are repaired without changing what is stored: the criterion is handed
Stash's Language option, so its tag opens our card and its ✗ clears the filter,
and the tag's wording is replaced in the DOM with the same sentence the sidebar
would use. The repair is in the DOM because Stash draws its tag row *before* this
plugin is mounted, so nothing attached at render time can reach it (see
`relabelTags`). All three of this plugin's fields share that one criterion, so a
filter with two of them set is one criterion carrying a condition for each: what a
tag is worded from is the field's own conditions, never the criterion as a whole,
or a filter with two fields in it leaves both tags in Stash's raw wording (see
`fieldTagLabels`).

**The two tag rows say different things, so they are worded differently.** The row
above the list reports the filter the list is *applied* to. The row inside the
dialog reports the dialog's *working copy* — which is why Stash's own criteria
update it the moment they are edited, several clicks before Apply. A language
filter's working copy lives in this plugin's card rather than in Stash's copy, so
the dialog's row is worded from the card instead: one label per tag Stash drew,
a tag hidden only when the card has nothing to say in its place, and a tag of this
plugin's own drawn for a condition Stash has no tag for at all — the first
language picked into a dialog that had none when it opened (see
`manageDialogTags`). Clearing the card's selection and taking the tags away are
wired together, so the ✗ on Stash's tag means the same thing as the ✗ on this
plugin's.

**Applying waits for Apply to reach the list's filter.** Stash commits the dialog's
*copy*, and the model the plugin is handed is the list's, which only becomes that
copy a commit later, when Stash's own hook re-reads the query string Apply wrote.
So the merge waits for the model to change and merges into the new one. That is what
keeps the rest of the dialog: by then the filter holds everything the dialog did, so
a criterion removed there stays removed.

The wait has a deadline, because pressing Apply does not necessarily commit anything
at all — choosing a language and nothing else leaves Stash's own filter untouched,
so nothing arrives to wait for. See [Known limitations](#known-limitations).

**It works by rewriting the URL.** Stash keeps its filter in the `c` query
parameter, and its list hook re-reads that on every navigation. So a filter change
here is a URL change, and the filter tag, the result count, pagination,
bookmarks and the back button all follow without the plugin doing anything. The
alternative — holding the selection in plugin state and injecting it into the
`findGalleries` query, the way the bulk dialog injects its write — would leave
Stash's own state and the count disagreeing with what is on screen.

Nothing here reimplements Stash's encoding. The obvious route in would be to
build the query string by hand, but the format is private
(`translateJSON`, which swaps braces for parentheses). Instead the plugin clones
the live filter model and asks *it* for the query parameters, merging its
conditions into the existing custom-fields criterion. All of that is public API on
the model: `clone`, `options.criterionOptions`, `makeCriterion`,
`makeQueryParameters`.

**What the conditions mean**, measured against a real library rather than assumed:

| conditions | meaning |
|---|---|
| `EQUALS [a, b]` | matches `a` **or** `b` — several values are a union |
| `NOT_EQUALS [a, b]` | excludes both, **and also matches galleries with no language field** |
| `NOT_NULL` | galleries carrying a language |
| `IS_NULL` | galleries carrying none |
| `EQUALS [a]` + `NOT_EQUALS [b]` | include `a`, exclude `b` — the conditions are ANDed |

That last row is what makes include and exclude compose: `EQUALS [a]` with
`NOT_EQUALS [a]` returns nothing, which only AND semantics can produce. The
second row is why **exclude mirrors Stash's own modifier verbatim** rather than
being something cleverer — excluding one language on a mostly-untagged library
still returns nearly everything, and matching the studio filter while documenting
that is more honest than quietly meaning something else by the word.

The section honours the **enabled languages** setting, so the two never disagree
about which languages this library uses — with one exception: a value already
included or excluded stays visible even if it has since been disabled, since
otherwise the list would be filtered by something invisible.

**Two of the studio filter's entries are deliberately absent.** Stash also offers
`any of` and `only` among the modifier candidates, but those exist to choose
between its `INCLUDES` and `INCLUDES_ALL` modifiers — "any of these studios" as
opposed to "all of them". A custom-field `EQUALS` has no "all" form: its values
are always a union, so both entries would mean the same thing as selecting the
languages directly.

### Censorship

Whether a gallery is censored. A separate field from the language rather than a
flag on it, because the two are independent: an uncensored Japanese volume is a
perfectly ordinary thing.

Three states, and the third is the absence of the field rather than a value:

| State | Stored | Card | Toolbar |
|---|---|---|---|
| Not marked | no field | nothing | an empty chessboard, dimmed |
| Censored | `censored` | a knight | a knight |
| Uncensored | `uncensored` | a pawn | a pawn |

**Why a knight and a pawn.** 骑兵, "cavalry", is what a censored release is, and
步兵, "infantry", is what it is not — the mosaic a censor lays over the page has
had that name in Chinese for long enough that the joke needs no explaining to
the reader it is aimed at. The icons carry it and nothing on screen spells it
out: a tooltip about a word rather than about the gallery would be worse than no
tooltip. If the pun wears off, `censorshipIcon` in `src/mangaTools.tsx` is the
one place to change it.

**Why a board for the third state.** It is the third member of the same set, so
the button reads as one control with three states rather than as two chess pieces
beside a UI glyph — and the circled question mark it replaced is the universal
"help" mark, in a toolbar, which is a thing people click by mistake. A board with
nothing on it is also just true: nothing has been marked. It looks a little like
the mosaic the other two are named after, which the dimmed grey helps along. The
name needs no fallback, unlike `faXmark` in `dialog-filter.tsx`: `chess-board`
has been spelled that way in every FontAwesome since 5.

**Only "not marked" has a colour of its own** — it is dimmed, so the button reads
as an offer rather than as a setting with a value. The two marked states keep the
button's ordinary foreground colour and are told apart by the icon alone. Stash's
organized button next door does the opposite, dimming one state and colouring the
other brown; that brown is deliberately not copied, since it is Stash's accent for
"organized" and would say that being censored is a kind of done-ness.

| Where | Effect |
|---|---|
| Gallery list / card | The state's icon **at the end of the popover row** — the row that appears on hover with the image count, the tag count and the organized box. An unmarked gallery adds nothing there, since most galleries are unmarked |
| Gallery detail page | A **row in the Manga info panel**, with the state's icon and its name. Unset draws no row at all |
| Gallery edit page | A two-option selector in the Manga info block. Unset is the selector's own clear button, which is what makes "not marked" a state you can return to without a third option to name it |

**The block's rows run censorship, language, translation group** — in the edit
block and in the detail panel both, which is the one order the two surfaces share.
Censorship comes first because it is about the copy in hand, what was or was not
done to the scans; the other two are about where the text came from.

**The toolbar carries the manga switch, not this.** It used to cycle the three
censorship states; the mark and the switch are asked of the same plugin state, so
two controls in one toolbar meant two things to explain and no way to tell which
was authoritative. What the toolbar keeps is the one control there is no other
route to — marking a gallery as manga — and this plugin's fields are set on the
edit page, where every other gallery attribute is set.

**The card's mark is spliced into Stash's own row, and that row is a flex
container** — rendering a second `.card-popovers` beside it would put the mark on
a line of its own instead of at the end of this one. So the mark renders an
anchor carrying the gallery id, and portals its button into the last child of the
row it finds from that anchor. A card Stash draws no row for at all — no images,
tags, performers, scenes or organized mark — gets one made for it with the same
classes, so nothing about it looks unlike the real thing. See `ensurePopoverSlot`.

**The toolbar button is the same trick, for the same reason.** `Gallery` is not a
registered component, so there is no patch to hang a React child off; a span is
inserted after the one holding `.organized-button`, anchored on that button
rather than on a position, because the group's other span is the operation menu
and its contents vary. See `ensureToolbarHost`.

That anchor is not always there, and its absence is not the toolbar's: Stash
renders a spinner in the button's place for as long as its own save runs, which
is what a click on organized starts. So the lookup keeps the host it already has
rather than standing down — otherwise the switch disappeared the moment the
reader clicked organized, and stayed gone until the next refresh.

**Writing the mark is deliberately quieter than anything else this plugin
writes.** Stash's edit page is a tab on the same page as that toolbar, and its
form reinitialises itself whenever the gallery behind it changes
(`enableReinitialize` in `GalleryEditPanel`), which throws away whatever is typed
in it and not saved. `custom_fields` is one of that form's own fields, so the
obvious write does exactly that.

Both directions therefore go through this plugin's own mutation, whose selection
set asks for nothing back — Apollo writes only what a mutation asks for, so the
cached gallery keeps what it had — and both push the change into the form's copy
of the map at the same time, so that the map a Save sends back (the whole of it:
`custom_fields: { full: … }`) carries the change too. The store's own query is
`no-cache` for the same reason.

That the unmark is written quietly as well is the part worth spelling out, since
it is not obvious: what the panels draw is asked of this plugin's store rather
than of Stash's values (see `isMarkedNow`), so the cache can go on holding fields
that nothing on screen asks it for — and it must, because removing them there is
what resets the edit form. Marking quietly and unmarking loudly is exactly the
combination that lost a reader's typing on the way out.

**Both look their mount point up during render, which on a page's first pass is
too early** — React has not committed the page yet, so the lookup finds the
previous page's markup, which on a load is nothing. `useAfterMount` asks for one
more render once the component has mounted, and that render is the one that can
see it. One extra render, not a loop.

**The store, not the cache, is what says whether a gallery is manga** — which is
what makes the quiet write safe, and why the two have to be read together. It is
filled by a `no-cache` query for galleries carrying the mark, and it is what the
switch, the card's mark and the panels all ask (`isMarkedNow`); a gallery the
query did not return is one the server does not consider manga, and the mark
therefore says so the moment the write takes it out of the store. Until the first
answer the map is null rather than empty — "nothing is manga" is an answer, and a
different one from "no answer yet", which is the only reading that can flicker a
marked gallery's switch on the way in.

A write is followed by a refetch of that store, *deferred* past any fetch already
in flight: a fetch built before the write answers with the state before it, so
letting that response land afterwards puts back what the write just changed. The
reason is the same one the writes are quiet for, seen from the other side.

Clearing removes the key rather than writing an empty value, and removes it *by
the spelling the gallery actually carries* — so a key that drifted in case is
removed rather than left behind holding the old mark.

### Translation group

Who translated the comic: `plugin.mangaTools.translationGroup`, as free text.

| Where | Effect |
|---|---|
| Gallery detail page | A row in the Manga info panel: the label and the name, and nothing else. Unset draws no row. A raw gallery draws **no row here at all** — the mark rides on the language row instead, and on a raw gallery with no language it stands alone as *raw (no translation group)* |
| Gallery edit page | A box in the Manga info block, drawn as the same select the language and censorship fields are, with the groups already in use in its menu and a typed name offered as a new one. What it holds decides the language row's suggestion button — see below |

**Free text, and that is the whole of its design.** The other fields here pick
from a vocabulary this plugin owns — a language is a code, a censorship is one of
two words — so both can be validated, localised and drawn with an icon. A group's
name is whatever it calls itself, and the only honest treatment of that is to
keep what was typed. Nothing is normalised on the way in, and nothing is drawn
from it.

**It is a select wearing a costume, and the costume works because the text in the
box is the field's value.** Stash gives plugins `react-select`, whose select can
only be searched — the creatable variant is a separate entry point
(`react-select/creatable`) and is not injected. The usual way around that is to
keep the search text in state, offer it as one more option, and hope the reader
selects it; where typing and then clicking away throws the text away, which is
exactly the "creatable select loses what you typed" trap. Here there is nothing
to lose: every keystroke is written to Stash's values map as it is typed, exactly
as the plain text box did, and the menu is rebuilt from the map rather than from
any state of react-select's. The "create" entry is then a way of saying *this
text, yes* rather than the only way of keeping it.

Two of react-select's behaviours are worked with rather than around, and both are
worth knowing because getting either wrong is invisible in the tests:

- **Only a keystroke is a change.** `onInputChange` also fires when an option is
  selected, when the menu closes, and on blur — with the option's label or with
  nothing at all. Taking that text would put a search word back over the value
  just chosen, or clear the field as the menu shut. Only the `input-change` action
  is written.
- **`inputValue` is left to react-select**, which is the opposite of what it looks
  like it should be. In its source (`Select.js`, `renderPlaceholderOrValue`), the
  value area draws *nothing* while the input has text in it — on the assumption
  that the input is showing that text — and choosing an option hides the input
  (`opacity: 0`) for a single select. Controlling `inputValue` to the value
  therefore blanks the box: the input that would show it is hidden, and the label
  that would is suppressed. Left alone, react-select holds what is being typed,
  shows that while typing and the chosen name as plain text afterwards, and the
  field behaves exactly like the two above it.

There is no blur handler, and that is deliberate: the value is already saved by
the time the box is left, so a blur could only ever rewrite it — and the blur that
follows choosing an option arrives with the *previous* render's props, which is
how a tidy-up there would put the group just replaced back. What was typed is what
is stored, spaces and all; a box holding nothing but spaces counts as nothing and
removes the key, and the trimmed form is what everything reads (`NS.translationGroupOf`).

**The menu is the groups in use**, read out of this plugin's own store: every
marked gallery's whole custom_fields map is already in memory, so the list costs
no request and is the same set of galleries as everything else here. It is empty
until the first fetch settles, which is right — before that there is nothing to
offer, and a name can still be typed. A new name is offered only when it is not
already one of them in some other case, so the menu never spells one group twice.

**Once the language is known, the menu answers with it.** A group's galleries
agree about their language — that is the same fact the language row's button is
built on — so the names whose groups carry *this* gallery's language are listed
first, and each row shows, faintly and at its far end, the flag of that language.
Sorted rather than filtered: the rest are still what a reader picks when this
gallery is the exception, and hiding them would make the menu lie about what the
library holds. Both halves come from one walk of the store
(`NS.usualLanguagesOf`), because two dozen names asked one at a time would walk a
few thousand galleries two dozen times per keystroke.

The hint follows the "Show flags" setting, the way the badge and the detail row
do: with flags off it is the language's *name*, small and faint. The order does
not follow it — the order is what says which groups match, and it stays either
way. The name is much the wider of the two forms, so it is the hint that gives way
when a row runs out of room, clipped rather than wrapped: the group's own name is
what the row is for, and one long language must not make every row in the menu two
lines tall.

**Not every manga was translated, and that is its own field.**
`plugin.mangaTools.original` is a presence, like the mark that makes a gallery
manga: a key that is there says this gallery is the original text. The group row
carries a button that declares it — always drawn, because a control that vanished
while it was on could not be turned off — and the two answers to "who translated
this" clear each other: declaring the original empties the group field, and
writing a group clears the mark.

The button draws one of two steaks, and the state is the picture: 熟肉 — cooked —
while the gallery has a translation group, 生肉 — raw — once it is declared the
original. That is the Chinese fandom's own joke about untranslated manga, and it
is worth keeping for a second reason: neither file says a word of anybody's
language, so the state reads the same whatever Stash's UI is set to. The words go
in the button's name and its tooltip, which are localised and where a language
does apply. Both files are masked rather than inlined, like the manga mark: the
file supplies the shape, the stylesheet supplies the colour.

While a gallery is marked raw its group box is **disabled**, and says why: it
carries *raw (no translation group)*, the wording a raw gallery with no language
also uses in the details panel — the same sentence, worded that way so it cannot
be taken for a group with that name. Disabled rather
than left live, because an empty box means "nobody has said" and this is not that
— this is "not applicable" — and rather than replaced by a line of text, because
the row would then be a different shape from the two above it. The button beside
it is what turns the field back on.

That sentence is drawn at the form's ordinary foreground colour rather than the
muted grey the other two dropdowns' placeholders use, and one rule says both
things. It is not a hint about what to type — it is what the field is saying while
it is off — and a grey sentence in a grey box is exactly the look of an empty
field, which is the state it exists to be told apart from.

**What the mark takes away, it holds on to.** Pressing the steak clears the group
field, and pressing it again puts the name back: one click of a button that
destroys something is one click from a mistake, and the undo is what makes the
button safe to press. The name waits outside the gallery — never written to it —
because a raw gallery carrying a group would be answering "who translated this"
twice, and the answer travels: Stash's own custom-field filters would match it, and
so would the rule above about the language a group's galleries carry.

It is remembered once and for one gallery: un-marking gives the name back and drops
the memory either way, so a later mark starts from nothing rather than from a name
somebody has already given up on, and a name taken from one gallery is never handed
to the next one along. It does not survive a reload, which is the price of not
keeping a second copy of the name in the data — a *Cancel* answers the rest.

It is not a value of the group field, and the difference is not tidiness. A
group's name is whatever it calls itself, and this library has one called
`沒有漢化` — a statement to look at, and a name. A state kept among names like that
can be told from a name by nothing: not by the reader looking at the row, and not
by the rule above, which would go looking for the "usual language" of a group
called *raw*.

The language stays a separate fact. An original is usually Japanese, which the
data may show and nothing here assumes: the two are independent, and this field
says nothing about the language, or the language about it.

**The language row carries a button offering the language this group's galleries
carry.** Whoever translated a comic translated it into a language, so the two
fields are not independent: a group's galleries agree about theirs, and the store
already says so — the button is one count over the same map the group menu is
built from, with no request of its own. Clicking it writes the language through
the same call the language dropdown writes through, so it is set by Save and
discarded by Cancel like anything else typed on the page. It writes nothing on
its own.

It is Stash's own furniture — `btn btn-secondary`, the same button the date field
carries for its calendar — and its content is one glyph. No name, because the
field beside it already names what it writes; the language's name and the count
are in the tooltip, which is also the button's accessible name.

**Which glyph follows the "Show flags" setting.** That setting says the reader
does not want flags in their interface, and this button is part of the interface
rather than a value — so with flags off it draws a wand (`wand-magic-sparkles`, or
`magic` if that Stash bundles an older FontAwesome), which is what a suggestion
looks like. Not the language's name: it is long enough to squeeze the field it
shares its column with, and it would repeat what that field already shows. The
name is the last resort, for a Stash with neither wand — an undefined icon throws
*inside a render*, so the lookup is guarded the way the censorship icons and the
dialog's ✗ are, and a missing glyph may not leave an empty button.

It appears when there is something to say, and stays away when there is not
(`NS.usualLanguageFor`, in `src/fields.ts`):

| The field holds | The button |
|---|---|
| no language, and the group's galleries agree | shows that language; clicking fills it |
| that same language | nothing — writing what is already there is furniture |
| a different language | still shown: a correction, never applied by itself |
| a value the group's galleries disagree about | nothing — a tie is not a majority |
| a value this plugin does not recognise | nothing, and that value is never suggested onward |
| a group no marked gallery carries | nothing — there is nothing to have learned |
| a language the settings leave disabled | nothing — the dropdown could not show what it wrote |

The comparison is made between languages rather than between strings (the field
tolerates any case), and the gallery being edited is counted with the rest —
leaving it out would make a group's usual language depend on which of its
galleries happened to be open.

**Opening the menu refetches that store**, because the one thing a list of this
Stash's groups has to be is current, and it changes at the moment somebody saves a
gallery that used a new name. The store is otherwise on a minute's timer, so
without this the menu goes on offering to create the very name the gallery in
front of it carries — and offering a group that only that gallery ever used, now
that it no longer does. Nothing waits on the answer: the menu opens with what is
in hand and is redrawn when the fetch lands.


There is deliberately **no sidebar section and no bulk-edit row** for it. A
sidebar section would have to be a free-text search rather than the checkbox list
the other three are, and the bulk row would have to say what "set this group on
every selected gallery" means when the values differ. Both are additions with
their own design questions rather than a column in an existing table. It is
recognised as one of this plugin's fields all the same — see `NS.ownField` — so it
never shows up as a raw custom-field row in the edit form, and unmarking clears it
along with the rest.

### Settings

**Settings → Plugins → Manga Tools**, drawn by the plugin itself (see "A custom UI"
below). Everything the plugin remembers is here — including the reading half's own
settings, as the one JSON string the lightbox writes them as (see `reader/settings.ts`
for why they live with the library rather than with the browser).

The page is grouped by what each setting is about, and **a group's own rows appear only
while the switch they belong to is on**:

| Group | Holds |
|---|---|
| **Take over Stash's lightbox** | the switch, and — inside its description — a boxed note that the lightbox's own settings are changed on the lightbox |
| **Take over the Chapters tab** | the switch, and — inside its description — a boxed note on what it commits to: from then on, editing chapters does not touch Stash's own chapter rows |
| **Custom fields** | the master switch; then one switch per field, with the language's own settings under it; then a heading for the three rows that are not fields |
| **The manga mark** | three siblings under a heading: unmarking, what unmarking clears, and the mark's icon on covers |

Hiding is not writing. A switch turned off and on again comes back with exactly the
sub-settings it had, and the same goes for the field values on the galleries.

**A group can also be folded shut, and that is a view rather than a setting.** A row
that has rows under it carries a chevron, and so does a heading that is not a switch —
the mark's, and how the manga info is shown. Clicking the chevron, or the heading it
shares a row with, takes those rows off the page without touching a single value. The
chevron is drawn in the indent to the left of the heading: in front of the heading it
would push that heading a glyph to the right of the sibling rows without one, and the
right-hand column is the vertical line every switch on this page is aligned to, so the
left gutter is the only place with room. It is centred on the heading's *line* rather
than on the box around it — a row's box also holds its description, and a heading that
is not a switch sits in a box with padding above it, so a chevron measured from the box
comes out a few pixels high. A row with nothing under it has no chevron and never opens
nothing — the lightbox and the chapters rows have none, since their notes moved into
their descriptions. The state is a set of ids outside React, for the same reason the
settings are: this page is redrawn on every switch and the tests' React stub has no
working state setter.

**The rows under a heading that is not a switch sit one level in from it**, in a plain
wrapper — not in Stash's `.setting-group`, whose `> .setting:not(:first-child)` would
indent the second row on and leave the first one out. The wrapper indents by padding,
for the reason below, so those rows end at the same right edge as everything else.

**The switch column is one vertical line**, and the group indent has to respect it:
an indent is always padding and never a margin. A `margin-left` moves a group's box
right without narrowing it, so with Bootstrap's `box-sizing: border-box` the rows
inside end a few pixels further right than the rows outside — six pixels a level,
measured — and the switches step outwards as the page nests.

**And the lines between rows were tidied.** Stash draws one under every row that is
not its parent's last child, which across nested groups means a line between every
pair of rows *and* another at every group boundary — the page read as a table. This
plugin's rows carry none of their own; a line is drawn only under a row that is a
section of the page, under a group's last row, under a heading that is not a switch,
and under the page's last row. **A group's last row is a row in one shape and a
wrapper in the other**, and the wrapper is the shape the page has: the fields' group
ends with the rows under the heading for how the info is shown, and the page itself
ends with the mark's. So the wrapper's last row is what draws the line at both ends of
the page as it is drawn today — and without a rule of its own for that shape, neither
of the two lines the page is meant to end with was drawn at all, silently: a selector
that matches nothing is a selector nothing reports. The page-last one is a direct
child of Stash's collapse box rather than of `div.plugin-settings`: that div belongs
to Stash's own `PluginSettings`, and this plugin *replaces* that component rather than
adding to it.

**Two rows say a second thing, and it is the second half of their description.**
"Where the lightbox's own settings live" and "editing chapters does not touch Stash's
own rows" are each one of the two things the sentence under that switch is saying, so
each belongs in it rather than in a row of its own — and each is boxed and tinted,
because a line of grey prose under a longer line of grey prose is a line nobody reads.
The icon and the words are a flex row centred against each other rather than an icon
set on the text's baseline, which sits a little low at some sizes and is the kind of
misalignment that reads as "something is off" without being nameable. Neither goes
away with its switch: a description is always drawn, and this is part of what it says.

**The four fields.** Language, censorship, translation group and raw, each with its own
switch under the master. Turned off, a field leaves every surface it appears on — the
cover badge, the details row, the edit row, the bulk dialog, the sidebar section and
the filter dialog's card — and the values already on galleries are kept: hidden, not
cleared. What it does *not* change is which keys the plugin recognises. `NS.ownField`
goes on answering for a field nobody is showing, or a gallery's own JSON would come
back as somebody else's custom field in Stash's edit form.

**Raw is drawn differently depending on its neighbours.** It answers the same question
the translation group does, which is why — with the group also on — the mark is a chip
on the group's row rather than a row of its own. With the group turned off, raw is just
another boolean field and gets what the others have: a switch on a row of its own. The
details block does the same thing with what it has: the mark rides on the language row
when there is one, and stands alone when there is not.

**The language's own settings** sit under its switch, because they are about it and
nothing else:

| Setting | Type | Effect |
|---|---|---|
| **Enabled languages** | multiselect | Limits which languages the edit-page dropdown offers; empty = every language |
| **Show flags** | switch | Draw flags, or the language name on its own |
| **Show the language on gallery covers** | switch | The badge in the bottom-right of a gallery's cover |

An empty language list shows an "All languages" placeholder rather than every
tag; only a chosen subset renders tags.

**The two display switches are deliberately independent**, so all four combinations are
available:

| Show flags | Cover badge | Cover | Dropdowns / detail row |
|---|---|---|---|
| on | on | flag | flag + name |
| off | on | **name only**, in a chip | name only |
| on | off | no badge | flag + name |
| off | off | no badge | name only |

A badge without a flag is a real choice, not a leftover: the flag mapping is
lossy (see "Extending" — a language is not a country, so `zh-Hant` gets the
Taiwan flag and `en` gets the UK one), and a name can be preferable to a
misleading flag. The name chip is the same one an unrecognised value already
renders.

**The three rows that are not fields** — the two block defaults and the performers
field — are under a heading of their own inside the group, because they are about how
the manga info is shown rather than about any one field. The group only appears while
at least one field is on: a page the plugin draws no fields on is a page those three
are not about either, and the performers row is left alone with them.

**The mark's three are siblings, not sub-settings.** Asking before unmarking and
clearing the plugin's fields with the mark are two answers about one action rather
than a parent and its child, so they are not wrapped in the group Stash's stylesheet
uses to indent a setting's children. The mark is never one of the four fields and is
never gated on them: it is what makes a gallery this plugin's at all.

**Two settings carry a "?" and it opens a picture, not a paragraph.** "Cover badge"
and "the mark's icon" are both answered by *where* something is on a card, which is
a sentence nobody should have to assemble in their head — so the panel holds a
gallery card with the part in question ringed and everything else on the card
pushed back. The card is Stash's own markup and class names, drawn by Stash's own
stylesheet, with the cover as the one stand-in (no gallery is behind the settings
page): a square wearing `.gallery-card-image` at the `zoom-1` height, so the card
is not stretched by a portrait cover. The date line alone is what a card whose
gallery has no description draws, so nothing is being left out.

The spotlight is a `box-shadow` with a spread wide enough to cover the card, drawn
with the element — no overlay to keep in step. What clips it is the frame around the
example, one box further out than Stash's card: the card's own `overflow: hidden`
would do it, and did, until the ring around the mark turned out to be cut off by it —
the mark sits at the card's own bottom edge, and the frame's padding is what the ring
needs to live in. It is declared twice, and the second declaration is not a
duplicate: the badge's *text* chips carry a drop shadow of their own on two class
names, and a spotlight on one class lost to it — which is what "no dim once the flags
are switched off" was, with the badge drawn as a name instead of a flag. The ring is an `outline`, which goes outside the box without
touching it, and its rule sets no `position`: the badge it circles is absolutely
positioned in the cover's corner, and a `position` there would pull it back into the
flow. The mark's slot, which is a plain span, is the one element that needs both a
`position` and a `z-index` above the badge's own — below it, the mark's spotlight
would leave the badge standing out while everything else dimmed.

**The example puts the type back.** The panel hangs off the "?" inside the setting's
own `<h3>`, so a heading's font weight, line-height and size are inherited by the
card unless they are reset — and on a real cover the date and the language on the
badge are neither heavier nor tighter than the rest. That reset is what makes the
example read as the same card as the one in the list rather than as a card drawn
inside a heading.

Every word on the example — the caption, the title, the date — is in the message
catalogues, and the badge is the reader's own language: Stash's locale is a *region*
(`zh-CN`, `en-US`, `ja-JP`) and the language table holds *language* codes
(`zh-Hans`, `en`, `ja`), so the code is worked out from the locale — subtags dropped
until the table knows one, and for `zh`, which is in neither, the script taken from
the region. Asking the table about `zh-CN` on its own is what drew an English flag in
a Simplified Chinese UI. A locale the table has no language for gets English, since
an unknown value describes itself as the raw code. The wording that used to be shown
there is the button's own name, read out to whoever cannot see the picture.

Opening it is CSS and it is hover — nothing about it is stateful. A keyboard gets the
panel through `:focus-visible`, which is not what a click sets: clicking the "?" does
not leave the panel up, and the "?" itself is left as the muted glyph it was, with a
button's own box and chrome taken off it.

**Every switch defaults to what the plugin already did, and an absent value reads as
the default** — all of them on, except the details block, which starts folded. So an
install that predates them behaves exactly as it did until something is turned off.
Nothing is written to the config until then.

**Hiding the performers field only hides it.** The row is Stash's, its value lives
in Stash's form, and the plugin neither renders it nor touches it: one CSS rule
keyed on the mount point the language row already needs takes it off the page, so
a manga gallery that does have performers keeps them when it is saved. The bulk
edit dialog (where the selection may mix manga and ordinary galleries) and the
details tab are unaffected.

Every setting is saved as one map. `configurePlugin`'s input is the plugin's whole
settings object, and writing all of them at once is correct whether that object is
replaced or merged — which the plugin cannot confirm, since the resolver is not
part of the published API. The settings page is not the only writer: the lightbox
writes the reading half's JSON into its own key of the same map, and both go through
one function that builds the whole of it, so neither can take the other's with it.

It is a *custom* UI rather than Stash's stock per-setting inputs. Stash
can only render STRING/NUMBER/BOOLEAN settings one plain input each, so "which
languages are enabled" would otherwise be a comma-separated text box. The plugin
patches `PluginSettings` to render a react-select multiselect (flag + localised
name, the same renderer as the edit dropdown) plus the switches, which are laid
out exactly like Stash's own `BooleanSetting`.

**Only the edit dropdown is affected by the enabled languages.** Display is untouched:
a gallery whose language is disabled still shows its flag badge and detail row exactly
as before — the value is simply no longer offered as a new choice. This is
react-select's `value`/`options` split: the selected value is rendered from `value`,
which is never filtered, while only the option *list* is filtered.

## Reading: three ways

A reader for Stash's image lightbox, for reading manga the way it was printed — two
pages side by side, the earlier one on the right — or one page at a time, or the
whole gallery as a column scrolled downwards. **Off until you turn it on.** Open any
gallery, open an image, and the lightbox's own options menu — the one behind the gear
icon in its header — opens the reader's own panel: **Single page / Double page /
Scroll** as a row of buttons, then the switches, grouped.

**Everything below the mode chooser is kept per way of reading.** Single page, double page and
the column each have their own set of these settings — how the pages are paired, how a screen
arrives, what the progress bar does, what the wheel does — because the same switch does not mean
the same thing in all three. Switching the way you are reading switches which set the rows are
showing; the "?" beside the Reading group's heading is where the panel says so. The settings
themselves are kept with the library rather than in a browser — one JSON string in the plugin's
own configuration — so every browser and every machine reads the same sets.

**Everything is in that one panel, and it is grouped by what each setting is about:**

| Group | | |
|---|---|---|
| **Reading** | **Single page / Double page / Scroll** | Which of the three ways the pages are laid out — see below |
| | **Cover on a page of its own** | A cover is not the left half of anything. Double page only |
| | **Detect spreads automatically** | A page wider than it is tall is taken for one image spanning two pages. Double page only |
| | **Shift the pairing by one page** | For pages that are grouped wrongly, or `O`. Double page only |
| **Animation** | **None / Fade in** | Whether a screen arrives or appears. The two screen modes only; the length is the plugin's — 200 ms |
| **Progress** | **Progress bar** | This plugin's own bar — along the bottom in the two screen modes, down the side of the picture in the column. **On by default**; off, it is not drawn at all rather than hidden |
| | **Chapter marks** | A tick on the bar where each chapter begins. In every mode, and put away with the bar: a mark on a bar that is not drawn is a setting with nothing to say |
| | **Hide after** | How long the bar stays once it is out — a slider, in half-seconds up to 10, with the value beside it. Its two ends are not lengths of time: **0** is "only while the pointer is on it", and the top step is **never**, which is also the bar being there from the moment a lightbox opens. Both put away with the bar |
| **Wheel** | **Wheel / Shift + wheel / Ctrl + wheel** | What each of the wheel's three chords does: **off**, turn a page, zoom, or scroll. **Per way of reading** — the three rows change when the mode does — and any of them may be bound to the same thing, since nothing says a chord is used once. The Reading group's "?" is where that is said to the reader |

The last group is the one that **is in every mode**, because the bar is drawn in all
three — down the side rather than along the bottom in the column, which is a different
bar in the same place and not a different switch. Turning the bar off **gives the column
its width back**: the fit leaves the bar's corner free on both sides, that number is a
*measurement* of the bar, and a bar that is not there measures nothing — so the pages take
the whole width on the next pass, with no window resized and nothing zoomed.

**The clock is the reader's.** How long the bar lingers was two seconds and nothing else;
it is a slider now, and its two ends are two different pieces of behaviour. At the top step
it never goes away — the bar comes out on a turn or a hover and stays out until the lightbox
closes. At **0** the pointer *is* the bar's visibility: it is there while the pointer is on
it and gone when the pointer leaves, which makes a turn the one thing that does not bring it
out, since there would be nobody pointing at it to read it. Everything between the two is a
length of time. The default is still the two seconds, and a lightbox that has just opened
still says nothing — except with the slider at its top, where the bar is simply there from
the moment its pages are measured. That is the one setting under which the bar is not
something that *happens*: a reader who has asked for a bar that never goes away has asked for
a bar, and one that is never dismissed is not one to be dismissed before the picture can be
read either.

**And the wheel is yours to bind.** Three chords — the wheel, and the same wheel with Shift or
Ctrl held — each bound to one of three actions or off, **for each way of reading**: nine
answers, not three, because the same chord does not mean the same thing in front of a screen
and in a column. Switch the way you are reading and those three rows become that way of
reading's own — which is what the "?" beside the Reading group's heading says, and the one
thing about this panel a reader could not work out from the panel itself. (It says the other
half too: that these settings are kept with the library on the server rather than in this
browser, so every browser reads the same.)

The four bindings, and what each of them means where:

| | In a screen (single or double) | In the column |
|---|---|---|
| **Turn a page** | one screen per `WHEEL_TURN` of travel | scroll to the next page's row, as the arrow keys do |
| **Zoom** | the screen, about its middle | the column, keeping the reader on the line they were on |
| **Scroll** | up and down a zoomed page — nothing to scroll when it is not zoomed | the browser's own scrolling of the column, handed over rather than done |
| **Off** | nothing at all — but the chord is still taken, because Ctrl is where a browser puts its own page zoom | nothing at all, including the scrolling |

Untouched, every chord is on what this plugin has always done *there*: in front of a screen the
wheel turns a page, Shift goes up and down a tall one and Ctrl zooms; in the column the wheel
scrolls — scrolling is reading there — and the chord a reader holds down is the one that goes a
page at a time. There is no "automatic" for the panel to offer, because that would be a name for
"whatever this mode does" and every mode's answer is now kept as itself. **A chord's travel is read from whichever axis the
event carries it on**, since several browsers put a Shift+wheel's movement on `deltaX` —
scrolling sideways being their own meaning for that chord — and a binding the reader chose
should not care how the browser spells a scroll.

Turning off the chapter marks stops the **ticks** and nothing else. Whether this half knows
where the chapters are is a different question, and it goes on knowing: the header's
chapter menu still lists them, and the bubble a drag shows still names the chapter under
the pointer. In the column the bar is also the only scroll position there is — the
browser's own scrollbar is hidden there — which is why this is a switch a reader turns off
deliberately rather than a default.

The last two of the reading group are **stored settings that had no control until
now**: the pairing has read `coverAlone` and `detectSpreads` from the browser's
settings since the mode was written, and nothing could change them. Turning either
off re-lays the pages there and then — as the single/double pair does — because a
switch that writes a setting the screen does not obey is worse than no switch.

**The pairing's three go away unless the pages are actually paired.** "Cover on a
page of its own" and "detect spreads" describe how two pages are put together, and the
shift moves that pairing by a page: one page at a time, or a column, all three are put
away. A switch that changes nothing is worse than no switch. The fade goes with them
in the column, which has no screen to arrive.

**Three ways, and the third is a different renderer rather than a third setting.** A
screen at a time is *discrete*: a spread is one screen, a turn is arithmetic on the
place in the book, and the bar's width is measured from the pages on show. A column is
*not*: the pages are stacked, the browser scrolls them, and where the reader is
depends on where the column is. What the two share is the place itself — a page — and
that is what lets the header, the counter, the chapter menu and the bar go on meaning
the same thing in all three.

**The bar's width is a measurement, and it belongs to the lightbox that made it.**
Measured from the pages on show and kept between two screens of one lightbox — a page
still on its way does not shrink it, because the reader turned a page rather than
switched off — and forgotten when that lightbox closes. The next gallery has pages of
its own size and has said nothing yet, so a bar drawn at the last book's width, or one
that comes out before its own pages have arrived, is exactly the bar this one is
asleep for. The wake a turn owes when it arrives before there is anything to measure
goes with the lightbox too, for the same reason: what is owed is a screen of *that*
book, and a reader who opens a second gallery in that moment is the one who would have
seen it paid.

**It belongs to the layout that made it as well.** A *turn* keeps the width, because the
screen before is the same kind of thing as the screen now. A change of layout does not: the
pages are cut again, and what is still in the picture area for that moment is the previous
layout's — the old screen's images, or the column's rows, where a page is as wide as the
whole picture area. Measuring those is what made the bar come out at nearly its full length
for an instant on the way out of the column. So the pass that re-cuts the pages reports no
width and forgets the one it was holding, and the bar waits — out of the way, as it does for
a gallery's first screen — until the screen it is actually about has been measured. **What
it measures is the pages of a screen**, too, and not whatever the container happens to be
holding: for the few frames a new screen's images take to arrive, the picture area is still
full of the layout before it — the column's own rows — and a row measured as a page is the
same mistake from the other end.

**In the column:**

- **The plain wheel is the browser's**, left entirely alone: no page turns and no
  `preventDefault`, because scrolling *is* reading here. **`Ctrl`+wheel zooms the
  pages**, as it does in the other two modes — the same 10% a notch, the same range —
  and is taken for that reason rather than passed to the browser, whose own page zoom
  is the whole interface. `←`/`→` move one page, because a page is what the counter
  counts; a screenful would be a measurement, and a different answer on every window.
  A click on a page does nothing — there is no page on either side of it — while a
  click on the letterbox still closes the lightbox.
- **A page is fitted to the smaller of the picture area's width and its height**, less
  the corner the progress bar stands on. So a window taller than it is wide fills —
  the width is already the smaller one, which is what a portrait reader wants, and the
  page stops just short of the bar — and a window wider than it is tall is capped at
  its own height, which is the same rule the other two modes follow: a page is never
  drawn larger than a screenful of it. The bar's corner is **measured** rather than
  written down, so the stylesheet's own numbers stay in the stylesheet, and it comes off
  the width only: a page capped by its height is already clear of a bar down the side.
  The gap the bar leaves on the side it is pinned to is mirrored on its far side, so a
  reader sees the same air either side of the line rather than the page touching it on
  one — and that number is measured from the same rectangle too. The whole of it comes
  off **both** sides of the page: the pages are centred in the picture area, so a reserve
  taken off one side only would be a page of the right size in the wrong place, sitting
  half of itself back under the bar. Smaller, not moved.
  Nothing else is reserved — a zoom past the fit runs under the bar if the reader asks
  for it, which is what a zoom is for. Filling the width in landscape instead would draw a
  page three and a half screenfuls tall at a size that never shows a whole screenful of
  anything. It is a measurement and not a share of the box, which is why the rows carry
  a width in pixels; a window that changes size re-fits them (`measureAgain`), **and so
  does a bar that turns up after the fit was made** — the reserve is measured off the
  bar's own rectangle, and the bar is drawn by a different function in the same pass, so
  the first pass of a lightbox can fit the column before there is anything to measure.
  That comparison is made on every pass of the column, and it is one number against
  another: a fit that changes nothing writes nothing. A box that has not been measured —
  a DOM with no layout behind it — falls back to filling.
- **A zoomed column is wider than the picture area, and the drag is how a reader
  moves around in it.** A drag *scrolls* the box — the same movement the wheel makes,
  on the same box, so the two cannot disagree about where the reader is. The zoom
  cannot be a transform here, the way it is in the two screen modes: those zoom pages
  that are *fitted* to the screen, with slack in both directions, while the fit here is
  the page's own width. So the page itself grows — which is the browser's own model of
  page zoom — because a transform on a scroll box leaves its scroll range where it was
  and puts the edges of a zoomed page out of reach. **Which is also why the rows are
  centred *safely*.** They are centred on the column's cross axis, and centring an item
  that overflows puts half of that overflow outside the *start* edge — which a scroll box
  does not count as part of its scroll range: measured in Chrome, a 900px row in a 400px
  box gives a `scrollWidth` of 650, so the left 250px of a zoomed page is beyond the
  reach of the scroll and of the drag alike. `align-items: safe center` gives the
  centring up exactly when a row does not fit, with the plain `center` left above it for
  a browser that does not know the keyword. Whichever zoom is in hand, the
  header's reset button puts it back, and the reader stays exactly where they were
  reading — the position is scaled by the same factor the pages are, rather than
  snapped to the top of the page they happened to be in.
- **Every row's height is reserved before its picture arrives**, from the size the
  gallery answer carries: a column of images that are not there yet has no height at
  all, and each one landing would push the rest down — which for a reader halfway
  through is the page moving under their eyes.
- **The bar turns.** It is the same bar down the side of the picture instead of along
  the bottom: the same four pixels of paint, the same sixteen of aim, the same chapter
  ticks, the same bubble (beside the line rather than above it), the same drag. Its
  length is the picture area's, so nothing about it is measured — and the browser's own
  scrollbar is hidden, because this *is* the scrollbar here. Stash's next-page chevron
  steps inboard of it on that side: two controls in one place is a control the reader
  cannot use and a bar they cannot see, and the arrow still turns a page.
- **The pages are in reading order**, the same list the other two modes read — not
  path order.

**No row has a description under it.** Each is its words and its control. A quiet line
under a switch is Stash's own shape for one, and this panel has decided against it for
now — the words are meant to say enough on their own.

**The panel hangs from the gear's right edge**, and slides itself back inside the
window when the window is too narrow for it. Stash's own popover gets that from a
library that measures it and flips or shifts it until it fits; this header is DOM
work with no React of its own, so the placement is the stylesheet's and the shifting
is a measurement taken whenever a menu is open.

**No focus ring is left behind by a click.** Bootstrap draws one on `:focus`, and a
press gives the control the focus it keeps — so the chosen half of the pair came out
outlined rather than chosen. The ring is dropped for a pointer and kept for a Tab:
Stash's own `.no-focus` drops it in both cases, and the keyboard is the case worth
keeping it for.

While the pairing is on, and while you are reading a **gallery**:

| | |
|---|---|
| **Two pages at once** | Laid out to fit the screen, in reading order, the earlier page on the right |
| **Spreads** | A page wider than it is tall is taken for one image spanning two pages, and stands alone |
| **The cover** | Stands alone. A cover is not the left half of anything |
| **Arrows, chevrons and the wheel** | Left and right move a *screen*, not a page — so a pair advances together. The keyboard arrows, Stash's own chevrons and the mouse wheel all go through the same turn: the wheel is added up rather than counted by event, so a trackpad's flick is one screen rather than twenty |
| **Clicks** | Clicking a page turns it, right half forward and left half back, exactly as Stash's own image click does. Clicking the space around the pages still closes the lightbox |
| **Zoom** | `Ctrl` + the wheel by default, and **any chord can be bound to it** in the options panel — as can turning and scrolling. Away from you to zoom in, towards you to zoom out. **Not Stash's own arrangement** — its wheel zooms and its `Shift`+wheel scrolls, by its `scrollMode` default — but a browser puts its own page zoom on `Ctrl`+wheel, so that chord is taken rather than passed on. A whole screen zooms at once, so a pair zooms together, and the zoom is cut off at the edge of the picture area rather than scaled over the header — which is what Stash's own slides do, by containment rather than by a clip. The header offers a reset while there is a zoom to put back |
| **Pan** | Press and drag to move the pages — as far as you take them, past the edge of the screen and all, exactly as Stash's own image does; turning the page is what puts them back in the middle. A drag never turns the page, and a click never moves it. Nor does a press held longer than a click: Stash's own other half of the test, so a press you thought better of sends you nowhere |
| **Shift the pairing** | Its own switch in the options panel — in the reading group, and there while a pairing is — or `O`, for pages that are grouped wrongly. Remembered for the browser, like every other switch in that panel |
| **The chapter menu** | The header's chapter control opens a list of the chapters, each with the **range of pages it covers** — its own first and last page on screen, so a cover in no chapter is not claimed by the one after it. The chapter being read is marked down its side, and the list has a heading that stays put while the list scrolls under it |
| **The progress bar** | Its own line between the picture and the footer, as wide as the pages it is measuring — so a spread's bar is wider than a lone page's, and it never lies across the picture: how far through the book you are, with a tick where each chapter begins. A page still on its way does not shrink it — half a pair is not the width of a pair — so the bar holds the width it had until both of the pages are there. Drag it to cross four hundred pages in one gesture — the handle follows your hand exactly, while the pictures follow as fast as they can be fetched — and letting go lands you on the page you were nearest. Hover a tick to see which chapter it is, in the bar's own bubble — at once, rather than after the second a browser's tooltip takes — and click it to jump straight there. It is out of the way to begin with, fades again after a couple of seconds, and the pointer reaching the bar is what brings it back — and the whole of it, ticks included, can be switched off in the options panel |
| **The change of screen** | Fades in rather than snapping — briefly, and never at the cost of a wait. Two buttons in the options panel choose whether, and how long is the plugin's own answer (200 ms): the length was a slider, and what a reader did with it was look for the one that stopped being noticeable. Nothing is animated for a reader who has asked their system for less motion |
| **Fullscreen** | Stash's own button in Stash's own place. While the lightbox is filling the screen, a click on the space around the pages does nothing at all — the margin of a book is not a way out of it — so leaving fullscreen is the button, or Escape |
| **Back closes it** | Pressing Back closes the lightbox instead of leaving it over the page you land on. Stash's own does not: its lightbox is in its own state and not in the route, so Back moves the page out from under it |
| **Everything else** | Untouched: the nav strip, Escape, the slideshow, and the footer that names the image and links back to the gallery it came from — though the rating stars and the O counter at its left end are not drawn at all: a reader holding a book open is not rating anything. The footer's own name is kept on the page you are on, since Stash renders it from an index this half never moves, and clicking it is an ordinary page load rather than the router's own navigation — a plugin has no router to ask. The header is this half's own, because its counter has to count in the order you are reading |

All of it is remembered **with the library**, not with the browser, which is a departure
from Stash itself: the switches in the lightbox's own options menu (fit, zoom, scroll
mode) are per-browser interface settings, and these are not. This plugin's settings are
one set — the managing half's and the reading half's — and they live in the plugin's
configuration, where every browser reads the same thing. The cost is real and worth
naming: one menu holds two kinds of setting, and these follow you to another machine.

**Nothing is migrated, and nothing is read from the browser.** What a browser holds
under the old keys is left there: a library with no settings in it reads as the defaults,
and the first change writes the lot. Carrying each browser's old value up — once, on the
first visit — would be a branch and a write nobody asked for, to spare one click in each
browser that had chosen a mode.

**The fade's length is not a choice.** It was a slider, and the two answers a reader
actually had for it were "yes" and "no" — the ones in between were a reader looking
for a length that stopped being noticeable, which is what 200 ms is. So the panel
offers those two and the length belongs to the plugin.

Off a gallery page — an image list, a scene's stills — the mode draws nothing, even
switched on: pairing pages only means something inside a gallery.

### The three things worth knowing

**It is DOM surgery, not a React patch.** Stash's lightbox is `LightboxComponent`,
a plain `React.FC` with no `PatchComponent` wrapper, so `PluginApi.patch` cannot
reach it. What this half does instead is watch the document for a lightbox
appearing, put a container of its own **beside** Stash's carousel — never in place
of it, so React can re-render its own subtree without ours going with it — hide
that carousel with a class, and drive the lightbox through its own interface: it
reads where the lightbox is from its header, and moves it with its own arrow keys
rather than keeping a second idea of the current page that could drift from the
first.

The approach follows
[kokkengMangaViewer](https://github.com/kokkeng1/stash_plugin_custom/tree/main/plugins/kokkengMangaViewer),
which does the same thing in the wild for a scrolling view.

**The reader keeps its own place.** Stash's lightbox moves one page per press, and
*drops* a press that arrives while the page before it is still swapping
(`isSwitchingPageRef` in its source: "rapid inputs are dropped"). Driving it from here
would mean pressing once, waiting to be told it had landed, pressing again — an errand
with a timeout in it, for a move this half can make itself. So the place is a number
this plugin owns, a turn is arithmetic on it, and Stash's carousel is left where the
lightbox opened it: hidden, because it is not what is on screen, but still there,
because it is what Stash's own footer is rendered from.

**What it assumes about Stash is written down.** `src/reader/stash-lightbox.ts`
holds the class names and the image query; `chrome.ts` and `footer.ts` hold the
markup Stash's own header and footer are made of, which this half borrows rather than
imitates. If a Stash release renames any of it, the reader stops drawing and says so
in the console rather than drawing something wrong: a canvas that cannot tell where it
is must not paint. The same goes for a gallery Stash cannot answer for, or one whose
page count no longer matches what the lightbox is showing.

### Stash's own ways of turning a page go through this half's turn

There are three of them and none of them can be left alone once the pages are
paired:

- the **keyboard arrows**, taken in the capture phase on the window, in front of
  Stash's own handler;
- the **chevrons** either side of the image, which are Stash's buttons and move one
  page — in a two-page view the same screen, so a reader clicking one sees nothing
  happen. The click is stopped before Stash's React handler sees it and the same
  turn an arrow press starts is started instead;
- the **click on a page**, which Stash reads per image (the right half forward, the
  left half back) and this half reads the same way.

Every one of them ends in `turnBy`, so the three cannot disagree about what a turn
is. The exception is the click *around* the pages: Stash closes the lightbox when a
click reaches the slide its images sit in, and this half's container covers that
slide — so a click there is turned back into what Stash would have done with it, an
`Escape`, which is Stash's own closing path and not a second idea of closing.

### A screen goes up whole, and both of its images are asked for the way Stash asks

Those are two halves of one problem: two pages that arrive separately read as a
flicker rather than as a page, and the reason they arrived separately was mostly
self-inflicted.

Stash publishes each image's URL with a **version stamp** on it —
`/image/<id>/image?t=<mtime>` — and its own lightbox uses that URL. This half used
to build `/image/<id>/image` by hand, without the stamp, and the two are **different
browser cache entries**:

| URL | what the server answers with |
|---|---|
| `/image/<id>/image?t=<mtime>` | `private, max-age=31536000, immutable` |
| `/image/<id>/image` | `no-cache` |

So the hand-built URL did not merely miss a version: it threw away the caching
Stash's own lightbox had already paid for, and every page was fetched twice — once
by Stash's carousel, once by the reader — with nothing making the two halves of a
screen finish together. The fix is one field in the query (`paths { image }`), whose
query is lifted onto the reader's own relative path: same resource, same cache
entry, and now the pages Stash has already loaded are there the moment they are
asked for.

**And in the order the lightbox is showing them.** Which is not always path: the
lightbox opened from the gallery page's Chapters tab is Stash's own and path-sorted,
but the one opened from the **Images** tab holds *the list's* images, in the list's
own sort — and the list keeps that sort in the URL (`?sortby=title&perPage=500`).
Pairing path-ordered pages against a title-ordered carousel draws the wrong pages,
and puts every index the reader computes off by however much the two orders
disagree. So the sort and direction are read from the URL and asked for back, with
Stash's own rules for them — including that an absent direction means descending
for `date` and nothing else, and that a seeded `random_…` is a sort name to hand
back rather than a shuffle to roll again.

What remains is genuinely cold: the first screen, a jump, a slow disk. For those,
the screen is built **detached** and shown in one step — the reader keeps whatever
is already on screen until both images can be painted (the browser is asked with
`decode()`, not guessed at) — and a **budget of 300 ms** caps the wait, so a page
that never arrives cannot leave the reader looking at one they have already turned.
A turn that overtakes a screen still waiting takes its place: a counter decides
which draw owns the container, so the older one cannot land on top of it.

That one step is then **faded in**, over about 140 ms: a pair of pages filling the
display is a large area to change between two frames, and at a turn that reads as a
flash. The fade is against the lightbox's own background rather than over the page
before it — a cross-fade is smoother on a photograph and worse on everything else,
since two pages of text superimposed are illegible soup for as long as it lasts. It
starts only once the images are there, so it is never a wait in disguise, and it
does not happen at all for a reader whose system asks for less motion.

### Chapters, in the order you are reading

Stash keeps a chapter as a title and a **number** — the Nth image — and that N
counts in **path order**, because that is the order its own lightbox reads a
gallery in. Everything follows from that: sort the same gallery by title and the
number points somewhere else, add an image near the front and every chapter after
it is off by one. Stash knows this, which is why it hands the lightbox **no
chapters at all** unless the list behind it is in path order — the chapter menu
simply is not there in a gallery sorted any other way.

So this plugin keeps its own list, under `plugin.mangaTools.chapters`: a title and
the **ids of the images in it**. Identity does not move when the order does, so the
same list is right in every sort, and it survives images being added and removed
around it.

**Which images are in a chapter is a fact about the images, so it is stored; what
order they are in is a fact about the view, so it is not.** The ids are written in
path order only to keep the field stable and diffable — a chapter is placed at
whichever of its images comes *first* on screen, so the same list reads correctly
under a title sort, a path sort, or anything else. And an image in no chapter is
an ordinary thing to have: a cover, a divider, a page nobody has decided about
yet. The button says so rather than guessing, which is how a page that still needs
a chapter becomes visible.

**The menu is this plugin's own.** Stash renders its chapter menu from *its*
numbers — the Nth image, counted in path order — so a gallery sorted any other way
has no menu at all: those numbers would point at the wrong images. A menu this half
cannot make Stash show is a menu that is simply missing, so this half draws its own,
in Stash's markup and in Stash's place: the lightbox's own chapter control, offering
this plugin's chapters, and jumping to where each one begins **on screen**. The
header's chapter name is drawn from the same list, so it cannot disagree with it.

**Each row says which pages its chapter covers**, as a range of page numbers — the
chapter's own first and last page *on screen*. The last one is measured off the
chapter's own images rather than off where the next chapter begins: those two agree
for every list this plugin has written and every Stash list it has imported, because
both are runs of pages, and they part company the day a chapter in the middle is
deleted — a deletion leaves its pages in no chapter, and the run would go on claiming
them. A chapter with no name is named by its place in the interface's own words
("Chapter 6", "第 6 章"), which is also what the progress bar's bubble calls it: one
helper names it for both, so the two cannot disagree either.

**What is handed over is the images, not the chapters.** The lightbox is given the
list this half is drawing from, in the order it is drawing it — which is what makes
Stash's own footer name the right page and offer the right way back to the gallery.
The chapters are not handed over at all: the chapters tab and the lightbox's chapter
menu are both drawn by this plugin, from this plugin's list.

**Only on a list it has checked.** The handover is skipped when the list is not the
one the lightbox is showing — a filtered list behind it, say — because replacing a
lightbox's images with a different set is not a takeover but a swap, and every
number after the first difference would be wrong. A gallery whose pages could not
be matched to what is on screen is not drawn at all, and nothing is handed over.

**Nothing is written by reading.** A gallery with no list of its own — which is
every gallery to begin with, including the ones whose chapters you made by hand in
Stash — is read from Stash's own numbers instead: Stash gives each chapter a start
and nothing else, so its ranges (each chapter up to the next one's start) are
expanded into sets of images, against path order, on the spot. So opening a gallery
changes nothing, and the plugin's own list appears only for a gallery whose chapters
somebody has imported. See the next section for that.

### Importing Stash's chapters

A list of this plugin's own is written by **importing**: the same translation, kept
in `plugin.mangaTools.chapters` as image ids rather than as positions in path order.
That is the point of doing it — a Stash chapter is a position, so re-sorting a
gallery or renaming a file moves it, and a list of ids cannot move.

| Where | What it does |
|---|---|
| Chapters tab, **under the rows** | Imports the gallery whose tab it is. Offered only when Stash has chapters there that this gallery can use |

It asks before writing over a list this plugin already has, and that asking is not
optional politeness: this plugin hides its own fields from Stash's custom-field
editor, so the Chapters tab is the *only* place that list can be read — there is
nowhere else to go and look at what an import would replace. Confirming in the tab is
the way back if an import was a mistake.

*There used to be a second way in: a job on the settings page that would import every
marked gallery at once. It is gone, and the plan is for the tab to bring a gallery's
Stash chapters over quietly the first time it is opened — the import belongs where the
chapters are, not on a page about settings.*

A gallery whose Stash chapters all point past the end of its images is skipped, not
imported: translating those gives an empty list, and writing an empty list would be
*clearing* that gallery's chapters, which an import must never do.

**Nothing of Stash's is changed.** Its own chapter rows are read and left exactly as
they are, so the two lists can be compared as long as you like. The settings job can
be run again at any time: galleries it has already imported are left alone unless
you ask it to replace them, which also makes an interrupted run a matter of running
it again.

### Editing them

The Chapters tab's **Create** button and each row's **Edit** link both open **Stash's
own chapter form** — the same two fields, the same three buttons, the same markup down
to the ids and the class lists — and what it writes is this plugin's field. While the
form is open the Create button is out of sight, the way Stash's own panel takes its
button away with the rows; Stash's markup comes back on the next render, so it is
hidden rather than removed.

| Field | What it means |
|---|---|
| **Title** | The chapter's name, which may be empty |
| **Image #** | Which page the chapter begins at, counted from 1 **in the order the rows are in** — path order |

A **new** chapter takes the pages from that index to the next chapter's start, out of
whatever held them. Its index opens on the page you were last reading, when you were
reading this gallery — which is the one thing this form does that Stash's does not.

Changing an existing chapter's index **moves its start**, and the chapters are re-cut
as the runs between their starts: the pages it gives up go to the chapter before it,
because that is what a chapter's pages mean — the earlier chapter runs up to this
one's start. **Delete** is the other thing: the chapter goes and its pages are left
in *no* chapter, which no other edit can do.

Nothing here writes Stash's own chapter rows either. A gallery with no list of this
plugin's own gets one the first time it is edited — the same import the button above
does, done for you — and from then on the reader reads this plugin's field.

### What is not here yet

- **No pinch or touch panning.** The mouse is back — a drag that pans, a wheel that
  turns, `Ctrl`+wheel to zoom — but a touchscreen's gestures are not: no two-finger
  pinch, and no dragging the pages with one finger. Stash's own lightbox has both.
  The progress bar is dragged with a mouse for the same reason: a drag is the same
  gesture whatever it is dragging, and this plugin has built the one.
- **Stash's four image settings are not read.** Display mode, scale up to fit, reset
  zoom on navigation and scroll mode are Stash's own options, and their defaults are
  what this half does: fit to the screen, no scaling up, the position reset on every
  screen and the zoom kept, and the wheel turning a page rather than zooming or
  panning. Change one of
  them in Stash's settings and this half will not follow; the options menu here has
  its own three settings and no room for those.
- **The switches are worded in English the first time.** Their language comes from
  Stash's own configuration, which is read with the gallery — so the wording is
  right from the second time the menu is opened in a session.
- **Reading progress** is not tracked. That needs a viewer of our own rather than a
  takeover of Stash's.

## Files

```
mangaTools/
├── src/
│   ├── mangaTools.tsx        Entry: loads Stash's API, then starts each half inside its own guard
│   ├── plugin-api.ts         Stash's API as far as either half uses it, and the one gql lookup
│   ├── i18n.ts               Both halves' strings, resolved per key from the catalogs below
│   ├── languages.ts          Codes, flags, and the name lookup (pure, no DOM)
│   ├── messages/             One JSON catalog per locale: en / zh-Hans / zh-Hant
│   ├── tools/                The managing half
│   │   ├── index.tsx         Badge, panels, dropdown, bulk row, toolbar switch, settings, patches
│   │   ├── filter-model.ts   Criterion read/write for all three fields (pure, no DOM)
│   │   ├── filter-ui.tsx     The rows and tag DOM both filter surfaces share
│   │   ├── sidebar-filter.tsx  The three sidebar filter sections
│   │   ├── dialog-filter.tsx   The dialog's language card
│   │   ├── censorship.tsx    The censorship vocabulary and its icons
│   │   └── fields.ts         The custom fields this plugin owns, and how to
│   │                         read and write one (pure, no DOM)
│   └── reader/               The reading half
│       ├── takeover.ts       The reader itself: the observer, the drawing, the keys
│       ├── spreads.ts        The pairing rules (pure, no DOM)
│       ├── settings.ts       What is remembered, and how it is parsed
│       ├── stash-lightbox.ts   Everything that assumes something about Stash's markup
│       └── namespace.ts      The reader's own types, and window.MangaReader
├── tests/
│   ├── smoke.js              The managing half's runner
│   ├── helpers.js            Its stubs, its fixtures, and the loaded bundle
│   ├── renders.js            The two surfaces more than one section drives
│   ├── sections/             One file per area, in the order they run
│   ├── reader.js             The reading half's runner, against the same bundle
│   └── dom.js                A fake DOM: only the parts the reader touches
├── mangaTools.yml            Plugin config (the file name is the plugin ID)
├── mangaTools.css            The managing half's styles
├── mangaReader.css           The reading half's styles
├── build.mjs                 The bundler's entry point
├── tsconfig.json             Compiler options, inlined (nothing is shared)
├── biome.jsonc               Lint and format rules — Stash's own, in full
├── pnpm-workspace.yaml       pnpm settings, not a workspace
└── dist/                     Bundled output — generated, gitignored, and the
                              only thing that gets packaged
```

`ui.javascript` names **one** file. esbuild bundles `src/mangaTools.tsx` together
with everything it imports — both halves and the shared modules — into
`dist/mangaTools.js`, loaded by Stash through a plain `<script>` tag — hence
`format: "iife"` in `build.mjs`. The source files talk to each other by importing,
not through the window. `ui.css` names two, because the halves' stylesheets are
kept apart rather than concatenated.

**One bundle means one load, which is why the entry starts the halves one at a
time and each inside its own guard.** What that guard cannot catch is anything
evaluated in a module *body* — a class derived from `React.Component` at the top
of a file, a startup call made where it stands — so neither half resolves Stash's
API there. That is the whole reason `guardedBlock` in `tools/index.tsx` is a
factory rather than a class.

`languages.ts` and `fields.ts` still publish themselves at `window.MangaTools` as
well, because that is the handle `tests/helpers.js` uses to call the pure
functions directly; the plugin itself never reads it. They share one namespace
object, each adding its own members — which is why `fields.ts` holds the field
*names* while `languages.ts` holds the table of language codes they can point at.
The four filter modules do the same, each publishing the members it owns at the
end of its own file; that is what keeps the sidebar and dialog from having to
import each other. The reader half keeps to the same arrangement at
`window.MangaReader`, with its own types in `reader/namespace.ts`. The tools half
starts the reader half and reads nothing back out of it: what the two halves share is
the plugin's own fields, through the one module that names them.

The reader half's settings are in the plugin config too, as one JSON string under
`readerSettings` — written by the lightbox, where they are changed, rather than from
the settings page. They used to be this browser's, in `localStorage`, and they are not
read from there any more: a library nobody has written to has no settings, and the
reader starts from its defaults. See `reader/settings.ts`.

`tsc` plays no part in producing that file — it only type-checks, and esbuild
strips types without reading them, so a name that does not exist compiles fine
and only throws when a reader clicks something. That is why `pnpm test` runs
both, and why the publishing workflow runs it before it builds.

`biome.jsonc` is Stash's own config (`ui/v2.5/biome.jsonc`), version pinned to
the one Stash uses. The code was written under it before this repository existed,
so it is a gate rather than a rewrite: lint rules, then a format check that only
fails if something drifted. One rule is deliberately not Stash's — `noVar`,
because a hoisted `var` has already cost this codebase a confusing bug.

`tests/` is not packaged — the zip holds only what the entry point bundles plus
the `.yml`, `.css` and `.md` copied in beside it, so the spec never reaches a
user's plugins folder.

## Installation

Install through Stash's plugin manager; no copying files by hand.

**Settings → Plugins → Available Plugins → Add Source**

| Field | Value |
|---|---|
| Name | anything |
| Source URL | `https://ravenddddd.github.io/stash-plugin-repo/index.yml` |
| Local Path | anything, e.g. `stash-plugin-repo` |

Then tick Manga Tools → **Install** → **Reload Plugins**.

To update later: **Installed Plugins → Update**.

**Coming from the separate Manga Reader** (this plugin's reading half until
0.7.0): uninstall Manga Reader, then update Manga Tools. **It is no longer
published** — this plugin is where it lives now, and two plugins shipping the
same reader would both install it onto the lightbox. Stash does not remove a
plugin on its own, so an installed copy stays until it is uninstalled by hand.
The reading half's settings moved to the library, where every browser reads the same
ones; the keys the old plugin left in a browser (`mangaReader.settings`,
`mangaReader.offsets`) are **not** read, and its defaults are where a reader starts
from.

> To install manually instead: copy the whole `mangaTools/` directory into
> `<Stash config dir>/plugins/` and hit Reload Plugins. Note the js/css paths in
> the `.yml` are relative to the `.yml`, so the directory has to stay complete —
> copying the `.yml` alone is not enough.

## Verifying

From the repository root (no Stash required):

```bash
pnpm install        # once
pnpm lint           # biome lint
pnpm format         # biome format --write, when the check below complains
pnpm typecheck      # tsc over the sources
pnpm build          # bundle into dist/ (no type-check)
pnpm test           # lint, format check, type-check, build, then both suites
```

`pnpm test` runs the tests against the **bundled** plugin in `dist/`, which is
why it builds before them rather than relying on a build that happens to be
there: they then exercise exactly the file that gets published. A type error
would not reach them — esbuild types are stripped without being read — which is
the second reason `pnpm test` runs `tsc` first.

There are two suites, one per half, and they run as two processes: each builds its
own fake world and loads the bundle into it, and the two worlds disagree about
almost everything (one renders React components, the other drives a fake DOM and a
fake lightbox). Both load the *same* bundle, though, so each world has to satisfy
both halves — which is itself worth having, since it is the same thing a page does.

They cover value normalisation, the unknown-value fallback, route scoping,
write/clear semantics, badge rendering, the generic field read/write rules, the
censorship mark's placement in Stash's own popover row and the toolbar button's
cycle and mutation, settings parse/serialise and the settings UI's write path,
the filter's read/merge/replace/clear rules and the sidebar section it renders,
the shape of the bundle (one file, no module syntax, JSX really transformed), and
the string/CSS surface of every patched component.

They are split by area. `tests/smoke.js` is the managing half's runner — what
runs, in what order, and what failed — and `tests/sections/` holds one file per
area, in the order they run. What the sections share lives in `tests/helpers.js`
(the stubs, the fixtures, and the loaded bundle) and `tests/renders.js` (the two
surfaces more than one of them drives). `tests/reader.js` is the reading half's
runner, against `tests/dom.js` — a fake DOM holding only the parts that half
touches, and a fake lightbox built the way Stash's is.

Two things about that split are load-bearing. The sections that read the gallery
map the plugin fetches as it loads run in a timer, so the ones that do not care
whether it has settled go first. And what the tests *move* — the UI locale, the
tags the DOM stub answers with — sits in one `state` object in `helpers.js`: a
section file is its own module, so a test that set its own copy of a variable
would leave the stub reading the original and go on passing.

Against a real Stash:

1. **Enter a value**: open any gallery's edit page → a "language" dropdown should
   appear between studio and performers → pick "简体中文 (zh-Hans)" → save
2. **Check what was stored**: open `/graphql` and confirm a code, not a name:
   ```graphql
   { findGalleries(ids: ["<gallery id>"]) { galleries { id custom_fields } } }
   ```
   Expect `plugin.mangaTools.language === "zh-Hans"`
3. **Check the badge**: back on the gallery list, the card's cover should show the
   China flag in the bottom-right
4. **Check the tolerance**: hand-edit a gallery's value to `chs`; after a refresh
   the badge should show a grey "chs" chip rather than a flag, and `klingon`
   should render as `klingo` (truncated to 6 characters) rather than erroring
5. **Check isolation**: add a `test: 123` field to the same gallery — its input
   should still be the native text box
6. **Check the scope**: open any scene or performer edit page — there should be
   **no** language dropdown (the plugin only acts on gallery pages)
6b. **Check censorship**: on that gallery's **detail** page, the toolbar should
   have a dimmed chessboard button between the organized box and the `⋮`
   menu. Its tooltip should read "mark as censored".
   - Click it: the icon becomes a knight, the tooltip "mark as uncensored", and
     the mark should appear on the gallery's card in the list behind — at the
     **end of the row** that shows the image count and tags, not on a line of
     its own.
   - Click again: a pawn. Again: back to the question mark, and the mark is gone
     from the card.
   - **Check it really cleared**: `/graphql` again — the
     `plugin.mangaTools.censorship` key should be **absent**, not empty.
   - **Check the unmarked case is quiet**: most galleries carry no mark, and
     their cards should look exactly as they did before the plugin was enabled —
     no empty row, no gap.
7. **Check filtering**: gallery list → the sidebar should have a **语言** section
   with a search box, **(任意)** and **(无)** first, then every language.
   - **Include**: click a language → it moves above the fold-away list with a
     tick, the list narrows, a filter tag appears, and the URL changes. Click it
     again and the filter clears. Click a second one: both should be included,
     as "any of these".
   - **(无)** should list the galleries with no language set — the untagged ones.
   - **Exclude**: hover a candidate and press its **exclude** button → the
     language appears in a second list, marked with a cross. Note how many
     results that leaves: every untagged gallery still matches.
   - **Search**: type `日` and the candidates should narrow to the Japanese and
     Chinese entries.
   - **Check it composes**: include one language and exclude another; both
     conditions are sent, and including and excluding the *same* language should
     return nothing at all.
   - **Check the tag**: it should read `语言 是 日语`, not `plugin.mangaTools.
     language (用户字段) 是 ja` — the wording is the plugin's. Clicking it should
     open the **Language** card in the filter dialog, and its ✗ should clear the
     filter. With an
     exclusion there are two tags, one per condition, and the second should read
     `语言 不是 韩语`.
   - **Check the dialog's tag**: with the dialog open, change the language in the
     card — the tag's wording should follow it straight away, without Apply. With
     no language applied when the dialog was opened, picking one should make a tag
     appear where Stash has none. Pressing the tag's ✗ should empty the card, and
     emptying the card should take the tag away.
   - **Check that Apply keeps the rest of the dialog**: with the dialog open,
     remove one of Stash's own criteria (say **Organized**) *and* change the
     language, then press Apply — the removed criterion must stay removed, and one
     added there must stay added.
   - The same conditions are reachable by hand: filter panel → Custom Fields →
     field `plugin.mangaTools.language`. Both routes write the same thing, so a filter set through
     one should show up in the other.
8. **Check the settings**: Settings → Plugins → Manga Tools, tick only e.g.
   `日本語` and `English`, save, then open a gallery edit page — the dropdown
   should offer only those two, while a gallery already set to Vietnamese still
   shows its flag and detail row
9. **Check the display switches**: under Settings → Plugins → Manga Tools, open
   **Custom fields**, then **Language**, and turn **Show flags** off — the dropdowns
   and the detail row should show names only, and the cover badges should become name
   chips rather than disappearing. Turn it back on and turn **Show the language on
   gallery covers** off instead — now the covers are bare and everything else is
   unchanged.
   - **Check the switches above them**: turn **Language** itself off and its whole
     block goes — the dropdown, the badge, the detail row, the bulk row, the sidebar
     section. Turn **Custom fields** off and all four fields go together, including
     the manga info blocks on a gallery. Turn either back on and every setting under
     it is exactly as it was.
   - **Check the mark's three**: turn **Ask before unmarking** off — the toolbar
     switch now unmarks on the first click, with a line about it in the console
     instead of a dialog.
10. **Check the bulk edit**: select several galleries → **Edit** → a "language"
   row should appear between studio and performers.
   - Select galleries that already share a language: the box should be prefilled
     with it. Select a mixed set: it should show the placeholder instead.
   - Pick a language, press **Apply**, and all of them should show the new flag
     **without waiting for a refresh**.
   - Do it again and press **Cancel** instead — nothing should change.

## Troubleshooting: the badge does not show up

Open the browser console (F12) first. The plugin logs three kinds of line, and
**each one pinpoints a different broken link in the chain**:

| Log | Meaning |
|---|---|
| `[mangaTools] loaded N gallery(ies) marked as manga` | Fetching worked. **N is the number of galleries carrying the mark** — if N is lower than expected, the problem is the data, not the plugin |
| `[mangaTools] failed to fetch custom fields, marks will not show. Raw error: …` | The gallery query failed; read the error that follows. What the store already holds is kept, so the last answer keeps working |
| `[mangaTools] patch active: <component>` | That patch ran for the first time. Fires once per target |
| `[mangaTools] bulk update: sending the manga fields with the dialog's own update` | The Apollo link merged a bulk edit's manga fields into the outgoing mutation |

One more line reports a limitation rather than a fault — `Apply changed nothing in
Stash's filter, so the language picked in the card was not applied` — and is
explained under [Known limitations](#known-limitations).

Reading them together:

- **No logs at all** → the plugin did not load. Check that Manga Tools is
  enabled under Settings → Plugins, hit Reload Plugins, then **hard-refresh the
  browser (Ctrl+F5)**.
- **"loaded N" with N=0** → the query worked but no gallery carries the
  `plugin.mangaTools.manga` mark. Mark a few from a gallery's detail page.
- **"loaded N" with N>0, but no "patch active: GalleryCard.Overlays"** → this page
  is not in grid view. Only Grid mode uses `GalleryCard`.
- **A missing "patch active" line** → that component name does not exist in your
  Stash build. Patching a non-existent component raises no error and simply never
  runs.

### Why those logs exist

Development hit two completely silent failures, so every link in the chain now
leaves a trace:

1. GraphQL's `OR` is **singular** in the schema (`OR: GalleryFilterType`). It was
   written as an array, the whole query failed validation, the failure was
   swallowed by the `catch`, and the only symptom was that no badges appeared
   anywhere with no hint as to why.
2. `CustomField` looks like a patchable component but is a plain `React.FC` (only
   `CustomFields`, `CustomFieldInput` and `CustomFieldsInput` are wrapped in
   `PatchComponent`). Patching it does not error; it just never runs.

Both are fixed, and the smoke test guards against them (it checks the query shape
and the patch target list).

**`plugin.mangaTools.manga` is the one name the query spells, and the only one it
has to.** A gallery whose mark is keyed differently is not *found* by it, so the
plugin does not see that gallery at all — no badge, no card mark, no detail row.
The other three fields are never queried, only read and written, and for them a
drifted key is no obstacle: reads and writes are both tolerant of case —
`NS.pickField` matches any variant, and `NS.setField` replaces every variant with
the canonical spelling — so such a key is still read, and is corrected the first
time the plugin writes that gallery. The *query* is strict because matching the
variants there is impossible: GraphQL's `OR` is singular so it cannot be written
as an array, and multiple criteria inside a `custom_fields` array are ANDed.
Entering values
through the plugin's own controls never hits any of this, since they write the
canonical spelling.

## Known limitations

- **Marking a gallery from the toolbar leaves its edit form looking dirty.**
  Marking writes the mark into that form's own copy of the custom fields as well
  as to the server (see "Writing the mark" above), so formik sees a difference
  from the snapshot it mounted with and reports unsaved changes — until a Save,
  after which it is clean again. That is the price of not resetting the form: the
  alternative is the form being reinitialised on top of whatever was typed in it.
- **The bulk edit row hooks the Apollo link chain** (see "Bulk edit" above) — the
  only place the plugin goes beyond the patch API. It is the only way to put a
  field into that dialog, since the dialog is not patchable and keeps its pending
  values in private state. If a future Stash makes `EditGalleriesDialog` a
  `PatchComponent`, this should be replaced with a normal patch.
- **The dialog's language card is a replacement built around Stash, not inside it.**
  `CustomFieldCriterionEditor` is not a patchable component, so the card cannot be
  handed to Stash as an editor: the plugin draws its own list into the card and
  hides Stash's, by CSS, on the one card whose `data-type` is ours. The criterion
  it edits is still an ordinary custom field, so the two stay consistent — and if
  Stash ever renames that attribute, its editor simply shows up again beside the
  list rather than anything breaking.
- **The language dropdown only appears on gallery pages.** `CustomFieldsInput` is
  shared by every entity's edit panel, so the plugin scopes itself by URL path
  (`/galleries`). The bulk gallery edit dialog opens over the gallery list page,
  so that is covered too.
- **A new field still has to be typed once.** If you create a
  `plugin.mangaTools.language` field by hand instead of using the dropdown, you
  type the value yourself; with the dropdown there is no field to create — picking
  a value writes it. The censorship field has no such problem, since its button
  is always there and its first click creates the field.
- **Changes can take up to 60 seconds to appear.** After saving, badges refresh
  from a poll rather than instantly. Changing route (navigating) refreshes
  immediately, and a write from the censorship button updates the store directly.
- **Grid view only.** Of the gallery list's three display modes, only Grid goes
  through `GalleryCard`. List is a table, and Wall uses a different component, so
  neither shows a badge or a censorship mark.
- **A gallery with no censorship mark is invisible on the card, by design.** The
  row it would go in belongs to Stash and holds the image count, the tag count
  and the organized box; adding a fourth button that says "not set" would make
  every card noisier to say nothing about most of them. The state is still
  readable on the detail page, one click away.
- **Most of the plugin's surfaces are placed by hand in the DOM**, because Stash
  leaves no React insertion point at those positions (see above). How a surface
  is *reached* and where its content *lands* are separate questions: the
  censorship mark, for instance, is an ordinary `after` patch whose button is
  portalled into Stash's own popover row. Each mount point is an empty `<div>`
  that the plugin finds/creates and repositions while rendering; a React
  re-render that displaces it gets corrected automatically. The anchors are
  `.gallery-details` (detail page), `.form-group[data-field="studio_id"]` (edit
  page — confirmed to exist on v0.31.1) and `[data-field="studio"]` (bulk dialog).
  The filter dialog adds two more, anchored differently: the card's list goes
  inside Stash's own `.criterion-editor` box, which exists only while the card is
  open, and a tag drawn for the card joins Stash's tag row, or a row the plugin
  makes when Stash has none.

  **An anchor is only as unique as the attribute it names, and one of them is
  shared**: the scrape dialog's rows come from `ScrapeDialogRow`, and its studio
  row carries the same `data-field="studio"` the bulk dialog's row does. Since the
  bulk row is mounted by `RatingSystem` — which the gallery page renders behind the
  dialog, not the dialog itself — the mark checkbox turned up inside a gallery
  scrape, under the studio field.

  The bulk anchor is therefore looked for **inside the bulk dialog's own form**,
  and entered from the one row that dialog has and nothing else in Stash emits:
  `BulkUpdateFormGroup name="rating"` (the edit pages do not name a rating row that
  way, and a gallery scrape has no rating row at all). A dialog without one has no
  form to search, so its rows are never in scope — and when the question cannot be
  answered, nothing is drawn. That is the right way round for an insertion: a scope
  that fails closed, rather than a blacklist of the dialogs not to draw in, which
  fails open the day something else reuses the attribute.

  The censorship mark adds one more of each kind: a span next to the gallery
  card's `.card-popovers` row, named by the gallery id so the right card's row is
  the one found, and a span after the toolbar's `.organized-button` — see
  [Censorship](#censorship). Those two go further than the others: the mark is
  portalled *into Stash's own row* rather than beside it, because the row is a
  flex container and a sibling would be a line of its own.

  **The correction runs in a *layout* effect.** Most of them need a second pass,
  because the anchor's element does not exist while the tree is still being built.
  A plain effect is flushed after the browser has painted, so the row or section
  would be missing for a frame and everything below it would jump. Layout effects
  run after React writes the DOM but before paint, which is the only window where
  the correction is invisible.
- **The sidebar filter is mounted where Stash mounts its own.** It used to be
  portalled into a `<div>` found by the selector `.sidebar-saved-filters`, with a
  second render pass to get it placed. Stash registers
  `FilteredGalleryList.SidebarSections` — a patchable wrapper around its own
  sidebar filter sections — and the three sections are pushed in front of Stash's
  own there: no anchor, no DOM, no second pass. The filter model has to come from
  somewhere, because that wrapper is handed only `children`: it is published from
  `FilteredGalleryList`'s own output (an `after` patch runs once its body has
  produced the tree, and before React descends into it), which the sections read
  on the same pass. Publishing it from `GalleryList` instead does not work: that
  is the list of cards, rendered *after* the sidebar, so the sections would read
  nothing on the first pass. The patch container arrived in Stash v0.31 — the
  plugin logs an error at the first list render when it is missing, rather than
  leaving an empty sidebar behind.
- **The sidebar section appears a moment after the page** — the delay that used
  to be visible with no explanation. It was the mechanism above: the sections were
  rendered by the cards' patch and portalled into a node created after the sidebar
  had already been committed, so they could not be there for the first paint. They
  are now children of the sidebar's own tree and render with it.
- **Excluding a language also matches galleries with no language set**, because
  that is what Stash's `NOT_EQUALS` means. On a library where most galleries are
  untagged, "not Japanese" therefore returns nearly everything; `(None)` asks for
  the untagged ones directly.
- **A language cannot be both included and excluded** — the two lists are
  mutually exclusive, since `EQUALS` and `NOT_EQUALS` for the same value is a
  contradiction that matches nothing.
- **The filter's tag is Stash's tag, re-worded.** It is not a tag this plugin
  draws, so it behaves natively — it opens the Language card, and its ✗ clears the
  filter — but the wording is replaced after Stash has rendered it. On a page
  *load* with a language filter already in the URL, that replacement happens once
  the gallery list has rendered, so the tag shows Stash's own wording
  (`plugin.mangaTools.language (custom field) is ja`) for as long as the first
  query takes. See
  [Filtering](#filtering).
- **The dialog's tag mirrors the card, not Stash's copy.** The row inside the dialog
  is worded from the card, and the ✗ on it clears the card — so a click on either is
  applied on **Apply**, and Cancel discards both. That is deliberate: Stash's copy
  cannot be written to from a plugin, so the card is the one that has to be the
  truth.
- **A language chosen in the dialog is applied on an Apply that changed something
  of Stash's, and not otherwise.** The merge that carries the card's selection runs
  once the list's filter has become what Apply committed — and Apply commits the
  dialog's *copy*, which the card's selection is not part of. Change a criterion
  alongside it and the language comes with it; change nothing else and Apply
  commits nothing, the filter never moves, and there is nothing to merge on to.
  The console says which happened (`Apply changed nothing in Stash's filter…`).
  **Picking the language in the sidebar always works**, and that is the way round
  it. Fixing this properly is not a small change: it needs the filter to follow
  the URL every time Apply rewrites it, which is Stash's business, not a plugin's.
- **Fetch size scales with the number of tagged galleries**, not the library
  size. Verified working against a 1194-gallery library.

The reading half's own:

- **Zoomed all the way in, a column is eight screen-widths across.** The range is the
  same 0.1–8 the screen modes use, and at the far end the drag has a long way to go —
  which is the honest shape of zooming a page that is already as wide as the picture
  area. The reset button in the header is the way back, and `Ctrl`+wheel the way out.
- **The switches are worded in English the first time.** Their language comes from
  Stash's own configuration, read with the gallery — so the wording is right from
  the second time the menu is opened in a session.
- **Reading progress is not tracked.** That needs a viewer of our own rather than a
  takeover of Stash's.
- **Chapter editing is one gallery at a time.** The Chapters tab creates, renames,
  moves a start and deletes. Importing a whole library's chapters at once used to be
  a job on the settings page and is gone: the plan is for the tab to bring a gallery's
  Stash chapters over quietly, where the chapters are. What is missing is changing
  several galleries' chapters in one go, and a keyboard shortcut for the form —
  Stash's own is `n` while the tab is open, and this plugin has none.
- **A page in no chapter is not marked as such.** Stash's own header names the last
  chapter that began at or before where the reader is, which is what its numbers
  mean, so a cover before the first chapter shows no name and a divider between two
  shows the one before it. Saying "no chapter" would mean drawing a header of this
  plugin's own, and the native one is worth more than the distinction.

## Extending

**Adding a language**: add one line to `NS.LANGUAGES` in `src/languages.ts` — a
canonical code and a `flag` (a flag-icons alpha-2 **country** code). That is the
whole change. The name comes from `Intl.DisplayNames`, so there is nothing to
translate, and the dropdown's position comes from that name, so there is no order
to maintain either.

**Only canonical codes are recognised.** There is no alias mapping: values only
ever come from this plugin's own dropdown, so they are canonical by construction.
Reads tolerate surrounding whitespace and letter case (`ZH-HANS` resolves);
anything else becomes an unknown value and shows as a grey "unrecognised" chip
rather than being silently corrected. That is deliberate — bad data should be
visible.

**The language-to-flag mapping is lossy.** A language is not a country, and where
it is one-to-many only one can be picked:

- `zh-Hant` uses the Taiwan flag (`tw`) — Traditional Chinese is also used in Hong
  Kong and Macau; change it to `flag: "hk"` if you prefer
- `en` uses the UK flag (`gb`), changeable to `us`
- Easy mistakes: Vietnam is `vn`, not `vi` (that one is the US Virgin Islands)

**Chinese has only two entries, simplified and traditional.** A
"Chinese (unspecified)" entry existed briefly, but it shared the same flag as
simplified and was indistinguishable in both icon and name, adding ambiguity rather
than removing it, so it was dropped — and a bare `zh` is not mapped onto `zh-Hans`
either, for the same reason: the plugin does not guess which one a value meant.

**Flags are not emoji.** Windows' Segoe UI Emoji has no flag glyphs, so a flag
emoji degrades into a pair of boxed letters there. This is why the plugin uses
`flag-icons` CSS.

**Language names come from the platform, not from this plugin.** `NS.name` asks
`Intl.DisplayNames` for the name in the current UI locale, so all ~90 locales the
engine's CLDR knows are covered rather than the four that used to be listed here,
and adding a language needs no translation. Three consequences worth knowing:

- **The wording is CLDR's, not ours.** Where it differs from what the old
  hand-written table said, CLDR wins — `id` in Chinese is 印度尼西亚语 rather than
  our shorter 印尼语. It can also shift when a browser updates its CLDR data.
- **The locale is Stash's, never the browser's.** The plugin passes react-intl's
  locale, which Stash sets from `Configuration.interface.language`. It also passes
  English as a second entry in the locale list, because an engine that does not
  know a locale would otherwise resolve against the *runtime's* default — the
  browser's — silently. The smoke test pins that pair.
- **Recognition stays this plugin's job.** `Intl.DisplayNames` would happily name
  `chi`, `jpn` and `zh-TW`; those must keep reading as unrecognised data, so only
  codes in `NS.LANGUAGES` are ever looked up.
- **The dropdown's order is the reader's, not ours.** Options are sorted by the
  displayed name through `Intl.Collator`, so they come out in the reader's own
  alphabet. The order that used to be here ran `ja, zh-Hans, zh-Hant, en, ko, …`
  then European languages then `th, vi, id` — the author's languages first, then
  the West, then the rest. That is a judgement about which languages matter, and
  nothing needs one: the list is searchable and the setting above usually
  shortens it. Note the *stored* `enabledLanguages` string is still sorted by
  code, so it does not depend on who wrote it.

An engine without `DisplayNames` (older than Chrome 81 / Firefox 86 / Safari
14.1) is not a crash: names degrade to the raw code, which is what an unrecognised
value shows anyway.

A library was considered and rejected. `@cospired/i18n-iso-languages` is the
maintained option — MIT, zero dependencies — but it does not understand BCP 47
script subtags, so `zh-Hans` and `zh-Hant` return `undefined`, exactly the two
languages the script-subtag design exists for. It also ships no `zh-TW` locale,
and its ~4.8 KB per locale × 32 locales would be ~140 KB against a 31 KB bundle,
to cover fewer locales than the platform already provides for nothing.

**The plugin's own strings are translated too.** The headings, descriptions and
placeholders it writes itself — `Select language…`, the settings page's groups and
switches — live in `src/messages/*.json`, and `t(intl, id)` reads them from the
catalog for Stash's UI language. Everything else on screen comes from Stash's own
messages and follows the language for free.

A locale is chosen by its tag, dropping subtags one at a time, so `zh-Hant-HK` reads
the `zh-Hant` catalog; a bare `zh` reads the Simplified one, matching how a bare
value in the language field is read. A locale with no catalog of its own — or one
that has not translated a particular string — reads English, per key, so a
half-finished translation shows translated sentences rather than ids. See
[Translating](#translating).

Two things stay English, and neither is this plugin's to translate: the label
`exclude` on a sidebar row, which is a literal in Stash's own sidebar filter, and
the `displayName`/`description` in `mangaTools.yml`, which Stash's own settings UI
would render — the plugin replaces that UI with its own, so what is on screen comes
from the catalogs.

**Changing a field name**: edit it in `src/fields.ts`. Everything else reads it
from there, including the GraphQL query in `getQuery`.

**Adding another field** (scanlation group, …): the reading and writing are
already generic — `NS.pickField(map, name)` and `NS.setField(map, name, value)`,
used by both fields and by nothing else. What a third field would need is:

1. a name and its values in `src/fields.ts`, plus a `normalize…` if it is not
   free-form
2. whatever new surface it needs — see **Adding a surface** below
3. a message id per string and state in `src/messages/*.json`
4. a line in `refresh()`'s field list, so a gallery carrying only that field is
   still found by the query that feeds the store

Step 4 is the one that is easy to miss: the store is filled by one query per
field, and a field not in that list exists in the data and nowhere on screen.

**Adding a surface.** Where a new control goes decides how it is added, and there
is a clear order to try:

1. **`patch.after`** — the component is patchable and the control is *added to*
   what it already renders. The original is never called, so nothing about it can
   be disturbed, and its output passes through by identity when there is nothing
   to add. `GalleryCard.Overlays` (the flag badge), `GalleryCard.Popovers` (the
   censorship mark) and `RatingSystem` (the bulk row) are all this, and all three
   mean "the plugin adds a sibling and changes nothing else" is checkable rather
   than merely intended.
2. **`patch.instead`** — the component is patchable but its *props or output* have
   to change: `CustomFields` hands Stash a `values` map with this plugin's keys
   taken out, and `CustomFieldInput` returns null for its own row. This is also
   the only option when the control has to *precede* the original, as
   `GalleryList`'s two mounts do.
3. **A DOM mount point and a portal** — nothing on that part of the page is
   patchable at all. That is true of the three anchored rows, of the gallery
   detail toolbar and of the card's popover row, and it is why each of them
   carries a comment saying which component *would* have been the natural place
   and why it cannot be.

   Two of those go further than the others: the censorship mark is portalled
   **into Stash's own node** rather than beside it, because the row it belongs in
   is a flex container and a sibling would be a line of its own.

**Registering a patch goes through `registerPatch`**, which wraps the call in a
try/catch. That is not about a bad target name — Stash accepts any name and
simply never fires it, which is what the `patch active:` log is for. It is about
the API itself: the patches are registered top to bottom at load time, so a
`PluginApi.patch` that is missing a method would throw and silently kill every
patch *below* it. The smoke test loads the bundle once with a registration
deliberately faulted, to prove the rest still register.

### Translating

The plugin's own strings are the ids in `src/messages/en.json` — the edit-page
placeholder, the field headings, the settings blocks, the names a censorship state
has (current, and what a click would make it), and the reading half's own — the
lightbox's options panel, the chapter menu, and the two controls in it). Everything else
either half puts on screen comes from Stash's messages, which Stash already
translates.

The reading half's ids are prefixed `mangaReader.` where the managing half's are
`mangaTools.`, and nothing else about them differs: they are read from the same
catalogs by the same lookup. It takes a locale rather than an `intl` object
because that half draws outside React — see `stringFor` in `src/i18n.ts`.

**Adding a language** is two lines and a file:

1. copy `en.json` to a file named after the tag Stash uses — `de.json`,
   `pt-BR.json`, `zh-Hant.json`
2. import it in `src/i18n.ts` and add it to `CATALOGS` there

The list is written out by hand, deliberately: esbuild has no equivalent of Vite's
`import.meta.glob`, so a catalog has to be imported by name, and a file the build
cannot see would simply never load. The smoke test fails if the catalogs disagree
about which ids exist, which is the mistake that would otherwise only show up as a
sentence in the wrong language.

Keys are not translated, only their values. A locale that has not translated a
string reads the English one for that string, so a half-finished catalog shows
translated sentences rather than ids.

Locales are matched by tag, dropping subtags one at a time — `zh-Hant-HK` reads the
`zh-Hant` catalog — and a bare `zh` reads the Simplified one, matching how a bare
value in the language field is read. Anything with no catalog reads English.

Region tags for Chinese are mapped to a script before that walk, in `ALIASES`:
Stash reports a region, and what this plugin has is one catalog per script. That
list came in with the reading half, which had it right — reading Traditional text
in Simplified characters is unmissable — and it fixed the managing half, which had
been sending `zh-TW` down the subtag walk to `zh` and so to Simplified.

`mangaTools.yml` is not translated, and cannot be: its `displayName`/`description`
are what Stash's own settings UI would render. The plugin replaces that UI with its
own, and what it draws comes from the catalogs.

### Deliberately not done

- A dedicated "language" section on the detail page — the value is only shown,
  localised, within the custom fields area
- **A censorship filter, bulk-edit row or settings.** The mark exists to be read
  and set per gallery; a filter for it is the obvious next step, but the language
  filter is enough machinery to prove the approach first. There is no setting for
  it either — with two values and a per-gallery control, a switch would be a
  preference about someone else's library.
- **Explaining the chess icons anywhere on screen.** See [Censorship](#censorship):
  the pun is the point for the reader it is aimed at, and a tooltip about a word
  rather than about the gallery would be worse than none.
- Splitting `src/mangaTools.tsx` into several files — it is ~2000 lines, and imports
  would now make that possible, but splitting it would be a separate change from
  adding a feature, and keeping them apart makes a regression easy to attribute
