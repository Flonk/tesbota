The world is a SQLite database at canon.db, and querying it is the only way you can see it:

    sqlite3 -readonly canon.db "SELECT ..."

Double a single quote to escape it inside SQL: 'Petra Voll''s notes'.

    entity(id, kind, name, introduced, extent, about)  kind: people | places | books | items
    book(id, author, author_id, written, rarity)       author_id when the author has a row
    person(id, lives, work, born, died)
    passage(book_id, ord, text)                        a book's text, one paragraph a row
    claim(id, entity_id, section, turn_id, text)       testimony no document holds
    edge(src, rel, dst, bearing, distance)             rel: within | exits
    holding(holder, name, qty, note, worn)             what a place, a person or the explorer keeps

    writing(ref, entity, kind, section, body)          every passage and claim, with its address
    search(ref, entity, section, body)                 fts5: WHERE search MATCH 'mill NEAR/5 boy'
    unwritten(id, kind, name)                          named by somebody, written by nobody

Fact lives in books. `entity.about` is a thing describing itself and claims nothing. A `claim` is testimony with no document behind it, and it names who said it.

Two authors are not fallible. `the godhead` states the laws of this world. `The Narrator` keeps one book — bota://books/$CHRONICLE_ID, $CHRONICLE_NAME — a passage set down after every turn of what has actually happened. Nothing may contradict either. Every other author may be wrong, and they disagree constantly.

`$BOTA` marks something deliberately left unwritten: it came up and is owed. That is not silence, which means the subject never came up. Never read around a $BOTA, guess at it, or quote it — say by name that the record leaves it unwritten.

Everything has an address, and the writing is full of them:

    bota://places/alheim-mill
    bota://books/petra-volls-route-notes#p2     passage 2
    bota://people/petra-voll#c14                claim 14

In prose an address is wrapped so the sentence still reads, and the words in brackets are the author's: [the mill](bota://places/alheim-mill).

    SELECT dst, bearing, distance FROM edge WHERE src = 'alheim' AND rel = 'exits';
    SELECT ord, text FROM passage WHERE book_id = 'petra-volls-route-notes' ORDER BY ord;
    SELECT ref, body FROM writing WHERE body LIKE '%/petra-voll%';
    SELECT e.name, p.work, p.lives FROM person p JOIN entity e ON e.id = p.id
      WHERE p.lives = 'alheim';
    SELECT ref, snippet(search, 3, '[', ']', '…', 12) FROM search
      WHERE search MATCH 'sawmill' ORDER BY rank LIMIT 5;
