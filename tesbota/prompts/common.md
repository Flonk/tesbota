The world is a SQLite database at canon.db, and querying it is the only way you can see it:

    sqlite3 -readonly canon.db "SELECT ..."

    entity(id, kind, name, introduced, extent, about)  kind: people | places | books | items
    book(id, author, author_id, written, rarity)       author_id when the author has a row
    person(id, lives, work, born, died)
    passage(book_id, ord, text)                        a book's text, one paragraph a row
    place(id, parent)                                  every place sits inside one
    way(src, dst, bearing, distance)                   what leads where
    item(id, type, damage, protection, heals, uses, worth, owed_by, rarity, slot)
                                                       slot: helmet | chest | legs | feet | mainhand | offhand | ring, or none
    holding(holder, item, qty, worn)                   what a place, a person or the explorer keeps

    writing(ref, entity, kind, section, body)          every passage, with its address
    search(ref, entity, section, body)                 fts5: WHERE search MATCH 'mill NEAR/5 boy'

Fact lives in books. `entity.about` is a thing describing itself and claims nothing.

Two authors are not fallible. `the godhead` states the laws of this world. `The Narrator` keeps one book — bota://books/$CHRONICLE_ID, $CHRONICLE_NAME — a passage set down after every turn of what has actually happened. Nothing may contradict either. Every other author may be wrong, and they disagree constantly.

`$BOTA` marks something deliberately left unwritten: it came up and is owed. That is not silence, which means the subject never came up. Never read around a $BOTA, guess at it, or quote it — say by name that the record leaves it unwritten.

Everything has an address, and prose is full of them, wrapped so the sentence still reads: [the mill](bota://places/alheim-mill), bota://books/petra-volls-route-notes#p2 for a passage.

Follow a name through the writing with `WHERE body LIKE '%/petra-voll%'`, and the fts5 table with `snippet()` when you are hunting rather than looking up.
