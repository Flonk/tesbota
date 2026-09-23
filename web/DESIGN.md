# How this interface is put together

Read this before adding a control. Every rule here exists because it was broken
once and the result was a row of buttons that did not line up with the row above
it.

## Bars

A **bar** is one horizontal row of controls: the tab strip, the subtab strip, the
map's trail, the shaping toolbar, the composer. Every bar in this app is the same
height, has the same air at its sides, and carries the same rule underneath.

Never write a `padding`, a `height` or a `letter-spacing` into a bar or into
anything that sits in one. Four numbers, declared once in `:root`, govern all of
them:

    --bar-h     how tall every bar is
    --bar-x     the air at a bar's left and right
    --bar-y     the air above and below a control inside one
    --bar-gap   the space between two controls in the same bar
    --track     the letter-spacing of every label in a bar

A narrow screen tightens the bars by moving `--bar-x` and `--track` in one media
query. It does not tighten `.tab` and leave `.shapebar` alone — that is exactly
how two bars stop agreeing, and it is how this went wrong the first time.

## The pieces

| what | when |
| --- | --- |
| `<Tabs>` | a bar whose items **pick** which thing you are looking at |
| `<Row>` | a bar of anything else |
| `<Act>` | a button inside a bar that **does** something |
| `<Btn>` | a button outside a bar |
| `<Crumb>` | a trail of containing places, wherever they appear |
| `<Pill>` | a name you can press |
| `<Tag>` | a verdict |
| `<Mark>` | an icon with words beside it |

`Row` takes `pad`, `ruled` and `middled`, all on by default. Turn `pad` off when
the row's own children handle their edges — the map trail does this, because it
scrolls and a pinned button at its end must sit outside the scrolling part.
`Row` renders a `div` unless given `as` — the header is `as="header"`, the library
search is `as="form"` — and passes anything else it is given to that element.

`Tabs` takes `sub` for a strip under another bar: it gets the same side air and
the same rule as a `Row`.

If you find yourself writing `<div className="somethingbar">` with a padding in
the stylesheet, you want `<Row>`.

## Words

Controls say what they do, in as few words as possible: `name`, `cancel`,
`create`, `remove 5 places`, `loading…`, `no bodies`. No metaphor, no voice, no
sentences where a noun will do.

The narrative voice belongs to the world's own content — what the game master
writes, what a book says, what a place's description reads like — and to code
comments. It does not belong in a placeholder.

## Colour

Colour is never stored. A shape on the map is coloured by its `place.type`
through a class; change the type and it repaints. The palette lives in `:root`
and nothing outside it names a hex value.
