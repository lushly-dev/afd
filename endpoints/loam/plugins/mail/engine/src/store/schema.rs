//! The store's schema and its migrations (the specification's section 4.3).
//!
//! A migration runs forward only, inside a transaction, when the store is
//! opened. The schema's version is SQLite's `user_version`: the number of
//! migrations applied.

use rusqlite::Connection;

use super::StoreError;

/// The migrations, oldest first. One is never edited once it has merged: a
/// change to the schema is a new entry.
pub(super) const MIGRATIONS: &[&str] = &[
    // 1: what is not derived from the log. An account and its mailboxes, a
    // message's identity and which of its bytes are held, and the record of
    // what the provider showed.
    "
    CREATE TABLE account (
        id INTEGER PRIMARY KEY,
        provider TEXT NOT NULL,
        address TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE (provider, address)
    ) STRICT;

    CREATE TABLE mailbox (
        id INTEGER PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES account (id),
        -- The provider's own name for the mailbox: an IMAP mailbox name, a Gmail label id.
        provider_key TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL
            CHECK (role IN ('inbox', 'sent', 'trash', 'junk', 'archive', 'all', 'none')),
        -- Bodies are fetched only when someone opens a message (section 5.3).
        header_only INTEGER NOT NULL CHECK (header_only IN (0, 1)),
        -- The generation the provider's ids belong to: IMAP's UIDVALIDITY, or '' without one.
        validity TEXT NOT NULL DEFAULT '',
        -- Where sync resumes. Opaque to the store.
        cursor TEXT,
        last_pass_at INTEGER,
        -- The engine's own words; never text from a message.
        last_error TEXT,
        UNIQUE (account_id, provider_key)
    ) STRICT;

    -- A message is the hash of its header block and the size the provider reports (4.2).
    CREATE TABLE message (
        id INTEGER PRIMARY KEY,
        header_hash BLOB NOT NULL CHECK (length(header_hash) = 32),
        reported_size INTEGER NOT NULL CHECK (reported_size >= 0),
        first_seen_at INTEGER NOT NULL,
        UNIQUE (header_hash, reported_size)
    ) STRICT;

    -- Which of a message's bytes the log holds.
    CREATE TABLE held (
        message_id INTEGER NOT NULL REFERENCES message (id),
        -- 'header', 'whole', or a part's place in the message ('1.2').
        part TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('header', 'whole', 'text', 'attachment')),
        blob BLOB NOT NULL CHECK (length(blob) = 32),
        size INTEGER NOT NULL CHECK (size >= 0),
        PRIMARY KEY (message_id, part)
    ) STRICT, WITHOUT ROWID;

    -- A message seen in a mailbox. A row is never deleted: when the provider shows something
    -- else, the row is ended and a new one is written.
    CREATE TABLE observation (
        id INTEGER PRIMARY KEY,
        message_id INTEGER NOT NULL REFERENCES message (id),
        mailbox_id INTEGER NOT NULL REFERENCES mailbox (id),
        validity TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        provider_thread TEXT,
        -- A JSON array of the flags or labels seen, sorted.
        flags TEXT NOT NULL,
        internal_date INTEGER,
        seen_at INTEGER NOT NULL,
        ended_at INTEGER,
        ended_by TEXT CHECK (ended_by IN ('superseded', 'removed', 'closed')),
        CHECK ((ended_at IS NULL) = (ended_by IS NULL))
    ) STRICT;
    CREATE UNIQUE INDEX observation_current
        ON observation (mailbox_id, validity, provider_id) WHERE ended_at IS NULL;
    CREATE INDEX observation_message ON observation (message_id);

    -- A listed message that did not arrive (section 5.4).
    CREATE TABLE unreturned (
        mailbox_id INTEGER NOT NULL REFERENCES mailbox (id),
        validity TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        tries INTEGER NOT NULL CHECK (tries > 0),
        first_tried_at INTEGER NOT NULL,
        last_tried_at INTEGER NOT NULL,
        PRIMARY KEY (mailbox_id, validity, provider_id)
    ) STRICT, WITHOUT ROWID;

    -- One row per change to anything a view shows, in order.
    CREATE TABLE change (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        kind TEXT NOT NULL,
        subject INTEGER NOT NULL
    ) STRICT;
    ",
    // 2: what is derived from the log, and can be rebuilt from it (4.3): what a message's
    // headers and body say, its parts, its thread, and where each thread shows. Beside them,
    // what the derivation itself has to remember: which messages the search index still lacks,
    // and how far a rebuild has come.
    "
    -- When the provider received the message, as first reported. Not derived: it is what the
    -- provider showed, and a message's date falls back to it.
    ALTER TABLE message ADD COLUMN received_at INTEGER;

    CREATE TABLE envelope (
        message_id INTEGER PRIMARY KEY REFERENCES message (id),
        -- The version of the derivation that wrote the row (4.3).
        parser INTEGER NOT NULL,
        thread_id INTEGER NOT NULL,
        -- The date the message is listed under, in milliseconds: its Date header when that is
        -- not in the future, else when the provider received it, else when it was first seen.
        date INTEGER NOT NULL,
        sent_at INTEGER,
        sender_address TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        subject TEXT NOT NULL,
        -- From the body, once it is held whole; '' and 0 until then.
        snippet TEXT NOT NULL DEFAULT '',
        attachments INTEGER NOT NULL DEFAULT 0,
        -- Why the headers, or the body, could not be read; the engine's own words.
        unparsed TEXT
    ) STRICT;
    CREATE INDEX envelope_thread ON envelope (thread_id, date, message_id);

    CREATE TABLE part (
        message_id INTEGER NOT NULL REFERENCES message (id),
        -- The part's place in the message, as IMAP numbers it ('1.2').
        place TEXT NOT NULL,
        content_type TEXT NOT NULL,
        name TEXT NOT NULL,
        size INTEGER NOT NULL CHECK (size >= 0),
        attachment INTEGER NOT NULL CHECK (attachment IN (0, 1)),
        PRIMARY KEY (message_id, place)
    ) STRICT, WITHOUT ROWID;

    -- A Message-ID a message has, or names in References or In-Reply-To, and the thread it
    -- belongs to (5.6). The key is the first 16 bytes of the id's SHA-256.
    CREATE TABLE thread_key (
        key BLOB PRIMARY KEY CHECK (length(key) = 16),
        thread_id INTEGER NOT NULL
    ) STRICT, WITHOUT ROWID;
    CREATE INDEX thread_key_thread ON thread_key (thread_id);

    -- A thread, with what a list shows. Its id is the lowest id of its messages.
    CREATE TABLE thread (
        id INTEGER PRIMARY KEY,
        last_date INTEGER NOT NULL,
        messages INTEGER NOT NULL,
        attachments INTEGER NOT NULL,
        last_message INTEGER NOT NULL,
        subject TEXT NOT NULL,
        snippet TEXT NOT NULL,
        last_sender TEXT NOT NULL
    ) STRICT;

    -- A thread in a mailbox: the messages of the thread the mailbox currently shows. This is
    -- what a list of a mailbox reads, newest first.
    CREATE TABLE thread_place (
        mailbox_id INTEGER NOT NULL REFERENCES mailbox (id),
        thread_id INTEGER NOT NULL,
        last_date INTEGER NOT NULL,
        messages INTEGER NOT NULL,
        PRIMARY KEY (mailbox_id, thread_id)
    ) STRICT, WITHOUT ROWID;
    CREATE INDEX thread_place_by_date ON thread_place (mailbox_id, last_date DESC, thread_id DESC);
    CREATE INDEX thread_place_thread ON thread_place (thread_id);

    -- Which mailboxes currently show a message.
    CREATE INDEX observation_shown ON observation (message_id, mailbox_id) WHERE ended_at IS NULL;

    -- A message whose document the search index does not yet hold on the disk. The index
    -- records the highest seq it has committed; rows up to it are removed.
    CREATE TABLE index_pending (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER NOT NULL
    ) STRICT;

    -- What the engine remembers about its own work: how far a rebuild has come, and the
    -- highest index_pending.seq the index has committed.
    CREATE TABLE engine_state (
        key TEXT PRIMARY KEY,
        value INTEGER NOT NULL
    ) STRICT, WITHOUT ROWID;

    -- Messages recorded before these tables existed have no rows in them. A rebuild is due,
    -- and until `mail-rebuild` has run, new mail waits for it too.
    INSERT INTO engine_state (key, value) SELECT 'rebuild', 0 WHERE EXISTS (SELECT 1 FROM message);
    ",
    // 3: what sync needs (5.2 to 5.7). How many messages a mailbox's last listing named, and
    // whether the provider still lists the mailbox; the files a read found damaged, for sync to
    // fetch again; bodies the provider did not return; and how many of a thread's messages in a
    // mailbox are unread.
    "
    -- How many ids the mailbox's last listing named; NULL until it is first listed.
    ALTER TABLE mailbox ADD COLUMN listed INTEGER CHECK (listed >= 0);
    -- When the provider stopped listing the mailbox. Its observations are closed then.
    ALTER TABLE mailbox ADD COLUMN gone_at INTEGER;

    -- A file a read found damaged or missing: sync fetches its bytes again, and storing them
    -- repairs the file (4.1). The part is 'header' or 'whole'. After three fetches that return
    -- other bytes, it is left for a person to look at.
    CREATE TABLE refetch (
        message_id INTEGER NOT NULL REFERENCES message (id),
        part TEXT NOT NULL CHECK (part IN ('header', 'whole')),
        tries INTEGER NOT NULL DEFAULT 0 CHECK (tries >= 0),
        noted_at INTEGER NOT NULL,
        PRIMARY KEY (message_id, part)
    ) STRICT, WITHOUT ROWID;

    -- A message whose body the provider did not return when asked: tried again an hour later,
    -- given up after three tries until a week has passed (5.4, for bodies).
    CREATE TABLE body_missing (
        message_id INTEGER PRIMARY KEY REFERENCES message (id),
        tries INTEGER NOT NULL CHECK (tries > 0),
        last_tried_at INTEGER NOT NULL
    ) STRICT;

    -- Derived like the rest of the row: the messages the mailbox shows that no current
    -- observation in it marks \\Seen.
    ALTER TABLE thread_place ADD COLUMN unread INTEGER NOT NULL DEFAULT 0 CHECK (unread >= 0);
    UPDATE thread_place SET unread = (
        SELECT count(*) FROM envelope
        WHERE envelope.thread_id = thread_place.thread_id
          AND EXISTS (SELECT 1 FROM observation
                      WHERE observation.message_id = envelope.message_id
                        AND observation.mailbox_id = thread_place.mailbox_id
                        AND observation.ended_at IS NULL)
          AND NOT EXISTS (SELECT 1 FROM observation
                          WHERE observation.message_id = envelope.message_id
                            AND observation.mailbox_id = thread_place.mailbox_id
                            AND observation.ended_at IS NULL
                            AND instr(observation.flags, '\"\\\\Seen\"') > 0));
    ",
    // 4: the evidence of section 6.1, derived from the log like the rest of `envelope` and
    // `part`. Rows written by the derivation before it are stale (their `parser` is 1) and are
    // derived again (4.3).
    "
    -- What the headers say about where the message came from and how it may be answered.
    ALTER TABLE envelope ADD COLUMN list_id TEXT NOT NULL DEFAULT '';
    -- 0 no unsubscribe header, 1 List-Unsubscribe, 2 that and one-click.
    ALTER TABLE envelope ADD COLUMN unsubscribe INTEGER NOT NULL DEFAULT 0
        CHECK (unsubscribe IN (0, 1, 2));
    ALTER TABLE envelope ADD COLUMN precedence TEXT NOT NULL DEFAULT '';
    ALTER TABLE envelope ADD COLUMN auto_submitted TEXT NOT NULL DEFAULT '';
    ALTER TABLE envelope ADD COLUMN reply_to TEXT NOT NULL DEFAULT '';
    ALTER TABLE envelope ADD COLUMN reply_to_differs INTEGER NOT NULL DEFAULT 0
        CHECK (reply_to_differs IN (0, 1));
    -- The topmost Authentication-Results header: the server that wrote it and its results.
    -- Whether that server is the account's provider is decided by who reads it.
    ALTER TABLE envelope ADD COLUMN auth_server TEXT NOT NULL DEFAULT '';
    ALTER TABLE envelope ADD COLUMN auth_spf TEXT NOT NULL DEFAULT '';
    ALTER TABLE envelope ADD COLUMN auth_dkim TEXT NOT NULL DEFAULT '';
    ALTER TABLE envelope ADD COLUMN auth_dmarc TEXT NOT NULL DEFAULT '';
    -- From the body, once it is held whole (6.1, 6.3).
    ALTER TABLE envelope ADD COLUMN hidden_chars INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE envelope ADD COLUMN links INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE envelope ADD COLUMN mismatched_links INTEGER NOT NULL DEFAULT 0;
    -- The template key's first half, from the headers; the key itself once the body is held.
    ALTER TABLE envelope ADD COLUMN template_head BLOB CHECK (length(template_head) = 16);
    ALTER TABLE envelope ADD COLUMN template_key BLOB CHECK (length(template_key) = 16);
    ALTER TABLE envelope ADD COLUMN body_shape BLOB CHECK (length(body_shape) = 16);
    CREATE INDEX envelope_template ON envelope (template_key) WHERE template_key IS NOT NULL;
    CREATE INDEX envelope_stale ON envelope (parser, message_id);

    -- A part's bytes, read for what they are.
    ALTER TABLE part ADD COLUMN detected TEXT NOT NULL DEFAULT '';
    ALTER TABLE part ADD COLUMN type_differs INTEGER NOT NULL DEFAULT 0
        CHECK (type_differs IN (0, 1));
    ALTER TABLE part ADD COLUMN hash BLOB CHECK (length(hash) = 32);

    -- A link in a message, with the host the text shown for it names (6.1).
    CREATE TABLE link (
        message_id INTEGER NOT NULL REFERENCES message (id),
        ordinal INTEGER NOT NULL,
        target TEXT NOT NULL,
        target_host TEXT NOT NULL,
        text_host TEXT NOT NULL,
        mismatched INTEGER NOT NULL CHECK (mismatched IN (0, 1)),
        PRIMARY KEY (message_id, ordinal)
    ) STRICT, WITHOUT ROWID;
    ",
    // 5: a message held in parts (M20). Its structure is what the provider said, not derived
    // from the log; its parts are rows of `held`. A damaged file of a part is fetched again
    // like the others, so `refetch` takes a part's place too.
    "
    CREATE TABLE structure (
        message_id INTEGER PRIMARY KEY REFERENCES message (id),
        -- The structure as the engine reads the provider's description of it, as JSON.
        body TEXT NOT NULL,
        fetched_at INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE refetch_parts (
        message_id INTEGER NOT NULL REFERENCES message (id),
        part TEXT NOT NULL CHECK (part IN ('header', 'whole')
            OR (part GLOB '[0-9]*' AND part NOT GLOB '*[^0-9.]*')),
        tries INTEGER NOT NULL DEFAULT 0 CHECK (tries >= 0),
        noted_at INTEGER NOT NULL,
        PRIMARY KEY (message_id, part)
    ) STRICT, WITHOUT ROWID;
    INSERT INTO refetch_parts (message_id, part, tries, noted_at)
        SELECT message_id, part, tries, noted_at FROM refetch;
    DROP TABLE refetch;
    ALTER TABLE refetch_parts RENAME TO refetch;
    ",
    // 6: the tokens agents present to a running server (3.3, 3.4). Not derived. Only the
    // token's SHA-256 is kept; the token itself is shown once, when it is made.
    "
    CREATE TABLE token (
        -- Stable, made with the token: the actor's id, so a later token of the same name is
        -- another caller.
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        hash BLOB NOT NULL UNIQUE CHECK (length(hash) = 32),
        created_at INTEGER NOT NULL
    ) STRICT;
    ",
    // 7: senders and their history with the person (section 7.1). Derived from the log like
    // the rest of `envelope`: rows the derivation wrote before it are stale (their `parser` is
    // 2) and are derived again, which fills the new columns and `recipient`, and makes each
    // sender's row.
    "
    -- The key of the message's own Message-ID and of the one it answers (as thread_key's).
    ALTER TABLE envelope ADD COLUMN message_key BLOB CHECK (length(message_key) = 16);
    ALTER TABLE envelope ADD COLUMN answers_key BLOB CHECK (length(answers_key) = 16);
    -- When the provider received the message, else when it was first seen. A sender's first
    -- and last messages are read from it, not from the Date header, which the sender writes.
    ALTER TABLE envelope ADD COLUMN received INTEGER NOT NULL DEFAULT 0;
    UPDATE envelope SET received = (SELECT coalesce(received_at, first_seen_at) FROM message
                                    WHERE message.id = envelope.message_id);
    -- Who redirected the message (its topmost Resent-From), when someone did.
    ALTER TABLE envelope ADD COLUMN resent_from TEXT NOT NULL DEFAULT '';
    CREATE INDEX envelope_message_key ON envelope (message_key) WHERE message_key IS NOT NULL;
    CREATE INDEX envelope_sender ON envelope (sender_address, received);
    -- A message with a list or bulk header (7.2's rule 3), by sender.
    CREATE INDEX envelope_sender_bulk ON envelope (sender_address)
        WHERE list_id <> '' OR unsubscribe > 0 OR precedence IN ('bulk', 'list', 'junk')
            OR auto_submitted <> '';
    -- The lists a sender's messages came through.
    CREATE INDEX envelope_sender_list ON envelope (sender_address, list_id) WHERE list_id <> '';

    -- Every observation, current or ended, by mailbox: the messages a sent mailbox has shown.
    CREATE INDEX observation_mailbox ON observation (mailbox_id, message_id);

    -- An address a message was sent to: To, Cc and Bcc.
    CREATE TABLE recipient (
        message_id INTEGER NOT NULL REFERENCES message (id),
        address TEXT NOT NULL,
        PRIMARY KEY (message_id, address)
    ) STRICT, WITHOUT ROWID;

    -- A sender other than the person, and its history with them. Computed again from the
    -- messages, never adjusted, like a thread. Its id is made from its address, so a rebuild
    -- gives it the same one.
    CREATE TABLE sender (
        address TEXT PRIMARY KEY,
        id INTEGER NOT NULL UNIQUE,
        -- The registrable domain of the address, for grouping on display.
        domain TEXT NOT NULL,
        -- The name on its newest message.
        name TEXT NOT NULL,
        -- Its messages, and how many of them carry a list or bulk header.
        messages INTEGER NOT NULL CHECK (messages >= 0),
        bulk INTEGER NOT NULL CHECK (bulk >= 0),
        first_received INTEGER,
        last_received INTEGER,
        -- The person's messages to it: those a sent mailbox has shown.
        written INTEGER NOT NULL CHECK (written >= 0),
        last_written INTEGER,
        -- Its messages that a message of the person's answers.
        answered INTEGER NOT NULL CHECK (answered >= 0),
        -- The later of its last message and the person's last to it.
        recent INTEGER NOT NULL
    ) STRICT, WITHOUT ROWID;
    CREATE INDEX sender_recent ON sender (recent DESC, id DESC);
    CREATE INDEX sender_domain ON sender (domain, recent DESC, id DESC);
    ",
    // 8: screening (sections 7.2 and 7.3). How often each template was seen and each inbound
    // message's class are derived, computed again for each batch that touches them; the
    // person's decisions on senders and agents' suggestions are not. A store that held mail
    // before has its templates and classes filled once when it is next opened.
    "
    -- A template key and how many messages the store holds with it, wherever they are.
    CREATE TABLE template (
        key BLOB PRIMARY KEY CHECK (length(key) = 16),
        messages INTEGER NOT NULL CHECK (messages > 0)
    ) STRICT, WITHOUT ROWID;

    -- An inbound message's screening class: a message not from one of the person's own
    -- addresses. Its date and sender are the envelope's, kept here for the lists by class, and
    -- `listed` is whether a mailbox other than junk and trash shows it now, which is what those
    -- lists show.
    CREATE TABLE screening (
        message_id INTEGER PRIMARY KEY REFERENCES message (id),
        class TEXT NOT NULL CHECK (class IN ('blocked', 'known', 'bulk', 'unknown')),
        date INTEGER NOT NULL,
        sender_address TEXT NOT NULL,
        listed INTEGER NOT NULL CHECK (listed IN (0, 1))
    ) STRICT;
    CREATE INDEX screening_listed ON screening (class, date DESC, message_id DESC)
        WHERE listed = 1;
    CREATE INDEX screening_sender ON screening (sender_address, class, listed);

    -- The person's decision on an address: in, out, or theirs. Never derived, so it survives a
    -- rebuild. `suggestion` is the agent's suggestion the person accepted, when it came from one.
    CREATE TABLE sender_decision (
        address TEXT PRIMARY KEY,
        -- The address's sender id, so a decision is found by it when the address has no row.
        id INTEGER NOT NULL,
        decision TEXT NOT NULL CHECK (decision IN ('in', 'out', 'mine')),
        decided_at INTEGER NOT NULL,
        suggestion INTEGER REFERENCES sender_suggestion (id)
    ) STRICT, WITHOUT ROWID;
    CREATE INDEX sender_decision_id ON sender_decision (id);
    CREATE INDEX sender_decision_at ON sender_decision (decision, decided_at);

    -- An agent's suggestion of a decision. It changes no class until the person accepts it.
    CREATE TABLE sender_suggestion (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        address TEXT NOT NULL,
        decision TEXT NOT NULL CHECK (decision IN ('in', 'out')),
        -- Who proposed it: the kind of caller, and the agent's token id when it had one.
        proposer_kind TEXT NOT NULL,
        proposer_id TEXT,
        created_at INTEGER NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('open', 'accepted', 'dismissed', 'superseded')),
        closed_at INTEGER,
        CHECK ((state = 'open') = (closed_at IS NULL))
    ) STRICT;
    CREATE INDEX sender_suggestion_open ON sender_suggestion (address) WHERE state = 'open';
    CREATE INDEX sender_suggestion_proposer ON sender_suggestion (proposer_kind, proposer_id)
        WHERE state = 'open';

    -- Classes for the mail already held are filled when the store is next opened.
    INSERT INTO engine_state (key, value) SELECT 'screening-fill', 1
        WHERE EXISTS (SELECT 1 FROM message);
    ",
    // 9: stream stories (section 8). Every row but a stream's id is derived from the screening
    // classes and the envelopes, computed again for each batch that touches it. A store that held
    // mail before has its stories filled once when it is next opened.
    "
    -- A stream: a list's id or a sender's address (`list <id>` or `sender <address>`), and the
    -- id its story has. Not derived: an id once given is kept, so a rebuild gives a story the
    -- same one and no two streams share one. A rebuild that finishes drops the streams of mail
    -- no longer held.
    CREATE TABLE stream (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL UNIQUE
    ) STRICT;

    -- A bulk message a mailbox other than junk and trash shows, and the stream it belongs to:
    -- its list, or else its sender. Its date, template key and body shape are the envelope's,
    -- kept here so that a story's counts read an index alone. `exception` is whether its body
    -- shape is not one of its story's usual ones. A stream is a story from its fifth message,
    -- so a row's story may have no `story` row yet.
    CREATE TABLE story_member (
        message_id INTEGER PRIMARY KEY REFERENCES message (id),
        story_id INTEGER NOT NULL,
        date INTEGER NOT NULL,
        template_key BLOB CHECK (template_key IS NULL OR length(template_key) = 16),
        body_shape BLOB CHECK (body_shape IS NULL OR length(body_shape) = 16),
        exception INTEGER NOT NULL CHECK (exception IN (0, 1))
    ) STRICT;
    -- A story's members by date, with each one's kind and shape: a body that arrives rewrites
    -- its entry in place, near its story's newest, so an import writes no page an index keyed by
    -- a hash would scatter it across. A kind's or a shape's members are read from the story's
    -- range.
    CREATE INDEX story_member_date
        ON story_member (story_id, date DESC, message_id DESC, template_key, body_shape);
    CREATE INDEX story_member_exception ON story_member (story_id, date DESC, message_id DESC)
        WHERE exception = 1;

    -- How many of a stream's members have each body shape, and each template key, kept by what
    -- each batch changes. A count that reaches nothing is removed in the statement after; one
    -- below nothing is a story counted wrong, which is counted again whole.
    CREATE TABLE story_shape (
        story_id INTEGER NOT NULL,
        shape BLOB NOT NULL CHECK (length(shape) = 16),
        messages INTEGER NOT NULL,
        PRIMARY KEY (story_id, shape)
    ) STRICT, WITHOUT ROWID;
    CREATE TABLE story_kind (
        story_id INTEGER NOT NULL,
        template_key BLOB NOT NULL CHECK (length(template_key) = 16),
        messages INTEGER NOT NULL,
        PRIMARY KEY (story_id, template_key)
    ) STRICT, WITHOUT ROWID;

    -- A stream with members, and a story from its fifth. Its counts are kept by what each batch
    -- changes, since a story of a large folder is too large to count again for each. Its id is
    -- its stream's. `list_id` is '' for a story by sender; `sender_address` is its sender, or
    -- for a list the sender of its newest message; `title` is the list's id, or the name on the
    -- newest message, or else the address. `kinds` counts its template keys, `exceptions` its
    -- exceptions and `usual` its usual shapes. A burst (section 7.4) is step C3's.
    CREATE TABLE story (
        id INTEGER PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('stream', 'burst')),
        list_id TEXT NOT NULL,
        sender_address TEXT NOT NULL,
        title TEXT NOT NULL,
        messages INTEGER NOT NULL CHECK (messages > 0),
        exceptions INTEGER NOT NULL CHECK (exceptions >= 0),
        kinds INTEGER NOT NULL CHECK (kinds >= 0),
        usual INTEGER NOT NULL CHECK (usual >= 0),
        first_date INTEGER NOT NULL,
        last_date INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX story_recent ON story (last_date DESC, id DESC) WHERE messages >= 5;

    -- What changed since a cursor is read by kind.
    CREATE INDEX change_kind ON change (kind, seq);

    -- Stories for the mail already held are filled when the store is next opened.
    INSERT INTO engine_state (key, value) SELECT 'story-fill', 1
        WHERE EXISTS (SELECT 1 FROM message);
    -- The stories' epoch, which a cursor of what changed carries; each rebuild moves it on.
    INSERT INTO engine_state (key, value) VALUES ('story-epoch', abs(random() % 2147483647) + 1);
    ",
    // 10: bursts (section 7.4). Derived from the senders and the envelopes, computed again for
    // the senders each batch touches. A store that held mail before has its bursts found once
    // when it is next opened.
    "
    -- When the person first wrote to a sender: a sender they wrote to after its mail came was
    -- new to them when it came (section 7.4). Filled with the bursts when the store is opened.
    ALTER TABLE sender ADD COLUMN first_written INTEGER;

    -- When a mailbox was first listed whole: an account's bursts are read once every mailbox of
    -- it has been. Not reset by a new generation of its ids, nor by its going.
    ALTER TABLE mailbox ADD COLUMN first_listed_at INTEGER;
    UPDATE mailbox SET first_listed_at = coalesce(last_pass_at, 0)
        WHERE cursor IS NOT NULL OR last_pass_at IS NOT NULL;

    -- When every mailbox of an account had first been listed: from then its bursts are read,
    -- and a mailbox that appears later does not hold them back.
    ALTER TABLE account ADD COLUMN listed_at INTEGER;
    UPDATE account SET listed_at = coalesce(
            (SELECT max(first_listed_at) FROM mailbox WHERE mailbox.account_id = account.id), 0)
        WHERE NOT EXISTS (SELECT 1 FROM mailbox
                          WHERE mailbox.account_id = account.id AND mailbox.gone_at IS NULL
                            AND mailbox.first_listed_at IS NULL);

    -- When the person first screened a sender in: kept when they block it and undo that, so
    -- its mail before then stays a known sender's (section 7.4).
    ALTER TABLE sender_decision ADD COLUMN first_in_at INTEGER;
    UPDATE sender_decision SET first_in_at = decided_at WHERE decision = 'in';

    -- A first contact: a message from a sender whose first message the provider received at
    -- most 24 hours before it, in each account whose mailboxes have shown it, junk and trash and
    -- what was deleted since included.
    CREATE TABLE first_contact (
        account_id INTEGER NOT NULL,
        message_id INTEGER NOT NULL REFERENCES message (id),
        sender_address TEXT NOT NULL,
        received INTEGER NOT NULL,
        -- Whether a mailbox of the account other than junk and trash has shown it.
        kept INTEGER NOT NULL CHECK (kept IN (0, 1)),
        PRIMARY KEY (account_id, message_id)
    ) STRICT, WITHOUT ROWID;
    CREATE INDEX first_contact_received ON first_contact (account_id, received);
    CREATE INDEX first_contact_sender ON first_contact (sender_address);
    CREATE INDEX first_contact_message ON first_contact (message_id);

    -- How many first contacts each account had on each day (a day in UTC, numbered from 1970),
    -- and how many of them were kept.
    CREATE TABLE contact_day (
        account_id INTEGER NOT NULL,
        day INTEGER NOT NULL,
        messages INTEGER NOT NULL CHECK (messages > 0),
        kept INTEGER NOT NULL CHECK (kept >= 0 AND kept <= messages),
        PRIMARY KEY (account_id, day)
    ) STRICT, WITHOUT ROWID;

    -- A burst: its id is its story's, from `stream`. `first` and `last` are when the provider
    -- received its first and last first contact; `messages` counts them, whatever their class.
    CREATE TABLE burst (
        id INTEGER PRIMARY KEY,
        account_id INTEGER NOT NULL,
        first INTEGER NOT NULL,
        last INTEGER NOT NULL,
        messages INTEGER NOT NULL CHECK (messages > 0)
    ) STRICT;
    CREATE INDEX burst_account ON burst (account_id, last);
    CREATE INDEX burst_latest ON burst (last DESC, id DESC);

    -- Each first contact a burst holds. A message two accounts hold can be in a burst of each;
    -- its story is the earliest of them.
    CREATE TABLE burst_message (
        burst_id INTEGER NOT NULL,
        message_id INTEGER NOT NULL REFERENCES message (id),
        PRIMARY KEY (burst_id, message_id)
    ) STRICT, WITHOUT ROWID;
    CREATE INDEX burst_message_message ON burst_message (message_id);

    -- A burst is a story whatever its size; a stream from its fifth message.
    DROP INDEX story_recent;
    CREATE INDEX story_recent ON story (last_date DESC, id DESC)
        WHERE (messages >= 5 OR kind = 'burst');

    -- Bursts for the mail already held are found when the store is next opened.
    INSERT INTO engine_state (key, value) SELECT 'burst-fill', 1
        WHERE EXISTS (SELECT 1 FROM message);
    ",
    // 11: the bursts' third rule (section 7.4). Where a junk or trash mailbox's history starts
    // counts when the engine first listed it. Builds of the second rule refuse the store; its
    // bursts are found again when it is next opened.
    "
    -- An account none of whose mailboxes was listed is not listed whole: migration 10 marked
    -- one with no mailboxes listed at 0.
    UPDATE account SET listed_at = NULL
        WHERE NOT EXISTS (SELECT 1 FROM mailbox
                          WHERE mailbox.account_id = account.id
                            AND mailbox.first_listed_at IS NOT NULL);

    -- Migration 10 could take a mailbox's first listing only from its last pass before it. A
    -- mailbox its account had when first listed whole has been watched since the engine first
    -- saw that account's mail, about its first sync; one that appeared since held nothing before.
    -- In a store made with bursts, this moves a mailbox first listed late in the first sync back
    -- to that sync's start: what came there and went before its first pass, hours at most, is
    -- not seen.
    WITH earliest AS (
        SELECT other.account_id AS account_id, min(observation.seen_at) AS seen_at
        FROM observation JOIN mailbox AS other ON other.id = observation.mailbox_id
        GROUP BY other.account_id)
    UPDATE mailbox
        SET first_listed_at = (SELECT seen_at FROM earliest
                               WHERE earliest.account_id = mailbox.account_id)
        WHERE first_listed_at <= (SELECT listed_at FROM account
                                  WHERE account.id = mailbox.account_id)
          AND (first_listed_at = 0
               OR first_listed_at > (SELECT seen_at FROM earliest
                                     WHERE earliest.account_id = mailbox.account_id))
          AND (SELECT seen_at FROM earliest WHERE earliest.account_id = mailbox.account_id)
              <= (SELECT listed_at FROM account WHERE account.id = mailbox.account_id)
          AND EXISTS (SELECT 1 FROM earliest WHERE earliest.account_id = mailbox.account_id);

    -- Makes sure the bursts are found again when the store is opened, as the rule's number
    -- would anyway.
    DELETE FROM engine_state WHERE key = 'burst-rule';
    ",
    // 12: selections and the person's policy (sections 9.1 and 9.4). Neither is derived: both
    // survive a rebuild. (A test that winds a store back past a migration drops what the later
    // ones made: `bursts_tests`.)
    "
    -- A query resolved once and frozen. `query` is the caller's, as JSON; its search text is the
    -- caller's words, which mail may have steered. Its counts are those of the frozen set. It
    -- can be acted on until `expires_at`.
    CREATE TABLE selection (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        query TEXT NOT NULL,
        -- Who made it: the kind of caller, and the agent's token id when it had one.
        creator_kind TEXT NOT NULL,
        creator_id TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        messages INTEGER NOT NULL CHECK (messages >= 0),
        threads INTEGER NOT NULL CHECK (threads >= 0),
        unreturned INTEGER NOT NULL CHECK (unreturned >= 0)
    ) STRICT;
    CREATE INDEX selection_expires ON selection (expires_at);
    CREATE INDEX selection_creator ON selection (creator_kind, creator_id, expires_at);

    -- What a selection froze, each as the provider names it: a message in a mailbox, by the id
    -- the mailbox gives it in its generation, so that two copies of one message in a mailbox
    -- are two items. `message_id` is null for a message the mailbox lists and the provider
    -- never returned (section 5.4), held by a selection of that whole mailbox and changed by
    -- its provider id like any other.
    CREATE TABLE selection_item (
        selection_id INTEGER NOT NULL REFERENCES selection (id) ON DELETE CASCADE,
        mailbox_id INTEGER NOT NULL REFERENCES mailbox (id),
        validity TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        message_id INTEGER REFERENCES message (id),
        PRIMARY KEY (selection_id, mailbox_id, validity, provider_id)
    ) STRICT, WITHOUT ROWID;

    -- What an agent or a script may change with nobody present. One row, changed only by the
    -- person; `set_at` is null until they first change it.
    CREATE TABLE policy (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        change_per_call INTEGER NOT NULL CHECK (change_per_call >= 0),
        trash_per_call INTEGER NOT NULL CHECK (trash_per_call >= 0),
        trash_per_day INTEGER NOT NULL CHECK (trash_per_day >= trash_per_call),
        ask_above INTEGER NOT NULL CHECK (ask_above >= 0),
        set_at INTEGER
    ) STRICT;
    INSERT INTO policy (id, change_per_call, trash_per_call, trash_per_day, ask_above)
        VALUES (1, 500, 50, 200, 200);
    ",
    // 13: operations (sections 9.1 to 9.3): each change to mail at a provider, the messages it
    // acts on, and what it did to each, so that a stop is resumed and a change undone. Not
    // derived: a rebuild keeps them.
    "
    -- One change. `command` is the command that made it; `action` what it does to each message:
    -- move or copy it to another mailbox, remove a copy an undo takes back, or set flags.
    -- `kind` is the policy's limit it counts against. `query` is the selection's, as its
    -- caller wrote it, when it came from one. `messages` is the count it was made with.
    CREATE TABLE operation (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        command TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('move', 'copy', 'remove', 'flags')),
        kind TEXT NOT NULL CHECK (kind IN ('change', 'trash')),
        -- What the caller asked, as JSON: ids and booleans only.
        asked TEXT NOT NULL,
        undo_of INTEGER REFERENCES operation (id),
        selection_id INTEGER,
        query TEXT,
        creator_kind TEXT NOT NULL,
        creator_id TEXT,
        state TEXT NOT NULL CHECK (state IN ('running', 'stopped', 'done')),
        -- Someone asked it to stop after the batch in hand.
        stop_asked INTEGER NOT NULL DEFAULT 0 CHECK (stop_asked IN (0, 1)),
        created_at INTEGER NOT NULL,
        ended_at INTEGER,
        messages INTEGER NOT NULL CHECK (messages >= 0),
        -- Why it stopped, in the engine's words.
        error TEXT
    ) STRICT;
    CREATE INDEX operation_creator ON operation (creator_kind, creator_id, created_at);
    CREATE INDEX operation_undo ON operation (undo_of) WHERE undo_of IS NOT NULL;

    -- What an operation acts on: a message in a mailbox, as the provider named it there when the
    -- operation was made, and each step it reached. `to_*` is where it went, or for a copy an
    -- undo removes, the message the copy was made from, which must still be there.
    -- `to_mark` is the destination's next id before a copy, so that a copy whose answer was
    -- lost is found rather than made twice. `flags_before` is what the provider showed when the
    -- step ran; `flags_wanted` what a change of flags sets, as JSON.
    CREATE TABLE operation_item (
        operation_id INTEGER NOT NULL REFERENCES operation (id) ON DELETE CASCADE,
        mailbox_id INTEGER NOT NULL REFERENCES mailbox (id),
        validity TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        message_id INTEGER REFERENCES message (id),
        to_mailbox_id INTEGER REFERENCES mailbox (id),
        to_validity TEXT,
        to_provider_id TEXT,
        to_mark TEXT,
        flags_before TEXT,
        flags_wanted TEXT,
        step TEXT NOT NULL CHECK (step IN ('waiting', 'copying', 'copied', 'flagged', 'done',
                                           'unchanged', 'missing', 'ignored')),
        PRIMARY KEY (operation_id, mailbox_id, validity, provider_id)
    ) STRICT, WITHOUT ROWID;
    -- The items still to do, which each batch reads.
    CREATE INDEX operation_item_open ON operation_item (operation_id, mailbox_id, to_mailbox_id)
        WHERE step IN ('waiting', 'copying', 'copied', 'flagged');
    ",
    // 14: proposals (section 9.4, M28): a change an agent or a script may not make alone waits as
    // an operation in the state `proposed` until the person approves or dismisses it. SQLite
    // cannot widen a CHECK, so `operation` is made again with its rows, ids and next id kept, and
    // `operation_item`, which refers to it, is set aside and put back around it.
    "
    CREATE TABLE operation_item_kept AS SELECT * FROM operation_item;
    DROP TABLE operation_item;

    -- `started_at` is when it first ran: null for a proposal not yet approved, which changed
    -- nothing. `charged` is whether it counts against its creator's day of trash: a proposal does
    -- not, approved or not. `proposer_*`, `proposed_at` and `expires_at` name the proposal open
    -- now, or the last one: a change proposed, or a stopped operation proposed to be carried on.
    -- `approved_at` is when the person last approved one.
    CREATE TABLE operation_next (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        command TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('move', 'copy', 'remove', 'flags')),
        kind TEXT NOT NULL CHECK (kind IN ('change', 'trash')),
        asked TEXT NOT NULL,
        undo_of INTEGER REFERENCES operation_next (id),
        selection_id INTEGER,
        query TEXT,
        creator_kind TEXT NOT NULL,
        creator_id TEXT,
        state TEXT NOT NULL CHECK (state IN ('proposed', 'running', 'stopped', 'done',
                                             'dismissed', 'expired')),
        stop_asked INTEGER NOT NULL DEFAULT 0 CHECK (stop_asked IN (0, 1)),
        created_at INTEGER NOT NULL,
        ended_at INTEGER,
        messages INTEGER NOT NULL CHECK (messages >= 0),
        error TEXT,
        started_at INTEGER,
        charged INTEGER NOT NULL DEFAULT 1 CHECK (charged IN (0, 1)),
        proposer_kind TEXT,
        proposer_id TEXT,
        proposed_at INTEGER,
        expires_at INTEGER,
        approved_at INTEGER,
        CHECK (state <> 'proposed' OR (proposer_kind IS NOT NULL AND expires_at IS NOT NULL))
    ) STRICT;
    INSERT INTO operation_next (id, command, action, kind, asked, undo_of, selection_id, query,
                                creator_kind, creator_id, state, stop_asked, created_at, ended_at,
                                messages, error, started_at)
        SELECT id, command, action, kind, asked, undo_of, selection_id, query, creator_kind,
               creator_id, state, stop_asked, created_at, ended_at, messages, error, created_at
        FROM operation ORDER BY id;
    -- The next id carries on from the old table's, so an id is never given twice.
    INSERT INTO sqlite_sequence (name, seq)
        SELECT 'operation_next', seq FROM sqlite_sequence WHERE name = 'operation'
          AND NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'operation_next');
    UPDATE sqlite_sequence
        SET seq = (SELECT max(seq) FROM sqlite_sequence
                   WHERE name IN ('operation', 'operation_next'))
        WHERE name = 'operation_next';
    DROP TABLE operation;
    ALTER TABLE operation_next RENAME TO operation;
    CREATE INDEX operation_creator ON operation (creator_kind, creator_id, created_at);
    CREATE INDEX operation_undo ON operation (undo_of) WHERE undo_of IS NOT NULL;
    -- The proposals waiting, which each caller may have five of.
    CREATE INDEX operation_proposed ON operation (proposer_kind, proposer_id)
        WHERE state = 'proposed';

    CREATE TABLE operation_item (
        operation_id INTEGER NOT NULL REFERENCES operation (id) ON DELETE CASCADE,
        mailbox_id INTEGER NOT NULL REFERENCES mailbox (id),
        validity TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        message_id INTEGER REFERENCES message (id),
        to_mailbox_id INTEGER REFERENCES mailbox (id),
        to_validity TEXT,
        to_provider_id TEXT,
        to_mark TEXT,
        flags_before TEXT,
        flags_wanted TEXT,
        step TEXT NOT NULL CHECK (step IN ('waiting', 'copying', 'copied', 'flagged', 'done',
                                           'unchanged', 'missing', 'ignored')),
        PRIMARY KEY (operation_id, mailbox_id, validity, provider_id)
    ) STRICT, WITHOUT ROWID;
    INSERT INTO operation_item (operation_id, mailbox_id, validity, provider_id, message_id,
                                to_mailbox_id, to_validity, to_provider_id, to_mark, flags_before,
                                flags_wanted, step)
        SELECT operation_id, mailbox_id, validity, provider_id, message_id, to_mailbox_id,
               to_validity, to_provider_id, to_mark, flags_before, flags_wanted, step
        FROM operation_item_kept;
    DROP TABLE operation_item_kept;
    CREATE INDEX operation_item_open ON operation_item (operation_id, mailbox_id, to_mailbox_id)
        WHERE step IN ('waiting', 'copying', 'copied', 'flagged');
    ",
    // 15: drafts and snoozed threads (step D3, the specification's 9.5). Neither is derived:
    // both survive a rebuild.
    "
    -- A draft is the engine's own record, not synced to the provider's drafts mailbox. Its
    -- revision rises with every change, so a send names the draft as it was previewed.
    CREATE TABLE draft (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL REFERENCES account (id),
        -- The message it answers, if it answers one.
        answers_message_id INTEGER REFERENCES message (id),
        -- JSON arrays of addresses.
        to_addresses TEXT NOT NULL,
        cc_addresses TEXT NOT NULL,
        bcc_addresses TEXT NOT NULL,
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        -- Who wrote each part: JSON {recipients, subject, body}, each {kind, id}.
        authors TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK (revision > 0),
        creator_kind TEXT NOT NULL,
        creator_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        -- A discarded draft is held for 30 days, then goes (M29).
        discarded_at INTEGER
    ) STRICT;
    CREATE INDEX draft_updated ON draft (discarded_at IS NOT NULL, updated_at DESC, id DESC);

    -- A thread snoozed until a time, by its lowest message, which a rebuild keeps as its id.
    -- A message that arrives in the thread after it was snoozed, one whose id is above `mark`,
    -- the highest message id when it was set, ends the snooze; a pass of sync removes it then.
    CREATE TABLE snooze (
        message_id INTEGER PRIMARY KEY REFERENCES message (id),
        until INTEGER NOT NULL,
        set_at INTEGER NOT NULL,
        mark INTEGER NOT NULL,
        creator_kind TEXT NOT NULL,
        creator_id TEXT
    ) STRICT;
    ",
    // 16: sending drafts and `outbound` (step D3, second part; the specification's 9.5).
    // Not derived: survives a rebuild.
    "
    -- Whether a draft is being sent, was sent, or had a send whose outcome is unknown (and is
    -- therefore never retried).
    ALTER TABLE draft ADD COLUMN send_state TEXT NOT NULL DEFAULT 'none'
        CHECK (send_state IN ('none', 'sending', 'sent', 'unknown'));

    -- Every outbound send attempt, recorded before handover and updated after. A send whose
    -- connection drops after handover stays `unknown` and is never retried; `mail-status`
    -- shows it to the person.
    CREATE TABLE outbound (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL REFERENCES account (id),
        draft_id INTEGER REFERENCES draft (id) ON DELETE SET NULL,
        draft_revision INTEGER,
        kind TEXT NOT NULL CHECK (kind IN ('draft', 'replyset', 'unsubscribe')),
        message_id TEXT NOT NULL,
        recipients INTEGER NOT NULL CHECK (recipients >= 0),
        state TEXT NOT NULL CHECK (state IN ('sending', 'sent', 'failed', 'unknown')),
        sent_copy INTEGER NOT NULL DEFAULT 0 CHECK (sent_copy IN (0, 1)),
        sender_kind TEXT NOT NULL,
        sender_id TEXT,
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        -- The engine's own words only; never text from a provider or from mail.
        error TEXT
    ) STRICT;
    CREATE INDEX outbound_state ON outbound (state, started_at DESC, id DESC);
    CREATE INDEX outbound_account ON outbound (account_id);
    ",
    // 17: proposed records attached to messages (step E1; the specification's 10.1).
    // Not derived: survives a rebuild.
    "
    -- Structured records proposed by callers and grounded in verbatim visible passages of a
    -- message. Records are never edited: a newer proposal from the same proposer for the same
    -- message and type atomically supersedes the prior active row.
    CREATE TABLE record (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER NOT NULL REFERENCES message (id),
        record_type TEXT NOT NULL CHECK (record_type IN (
            'request', 'commitment', 'deadline', 'order', 'booking',
            'bill', 'code', 'category', 'priority'
        )),
        fields TEXT NOT NULL,
        passages TEXT NOT NULL,
        content_hash BLOB NOT NULL CHECK (length(content_hash) = 32),
        proposer_kind TEXT NOT NULL,
        proposer_id TEXT CHECK (proposer_id IS NULL OR proposer_id <> ''),
        state TEXT NOT NULL CHECK (state IN ('active', 'superseded', 'withdrawn')),
        superseded_by INTEGER REFERENCES record (id) CHECK (superseded_by <> id),
        proposed_at INTEGER NOT NULL,
        ended_at INTEGER,
        CHECK ((state = 'active') = (ended_at IS NULL)),
        CHECK ((state = 'superseded') = (superseded_by IS NOT NULL))
    ) STRICT;
    CREATE UNIQUE INDEX record_active_slot
        ON record (message_id, record_type, proposer_kind, coalesce(proposer_id, ''))
        WHERE state = 'active';
    CREATE INDEX record_message ON record (message_id, state, proposed_at DESC, id DESC);
    CREATE INDEX record_type_active ON record (record_type, proposed_at DESC, id DESC)
        WHERE state = 'active';
    CREATE INDEX record_proposer_active ON record (proposer_kind, proposer_id, id)
        WHERE state = 'active';
    CREATE INDEX record_proposer_id ON record (proposer_id, proposed_at DESC, id DESC)
        WHERE proposer_id IS NOT NULL;
    CREATE INDEX record_active_order ON record (proposed_at DESC, id DESC)
        WHERE state = 'active';
    CREATE INDEX record_order ON record (proposed_at DESC, id DESC);
    ",
    // 18: approver tokens (step F1, plugin.spec.md section 4). Every existing
    // token keeps the role `agent`; only a token explicitly created at the
    // terminal as `approver` gets that role.
    "
    ALTER TABLE token ADD COLUMN role TEXT NOT NULL DEFAULT 'agent'
        CHECK (role IN ('agent', 'approver'));
    ",
    // 19: reply sets (step E3; the specification's 10.3 and plugin.spec.md sections 7 and 9).
    // Not derived: survives a rebuild.
    "
    -- A batch of replies answering a cohort of messages, reviewed together and sent under
    -- one approval. `revision` rises on every change so a preview and send stay bound.
    CREATE TABLE replyset (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL REFERENCES account (id),
        story_id INTEGER,
        shared_text TEXT NOT NULL DEFAULT '',
        revision INTEGER NOT NULL CHECK (revision > 0),
        state TEXT NOT NULL DEFAULT 'open'
            CHECK (state IN ('open', 'sending', 'partial', 'sent', 'unknown')),
        creator_kind TEXT NOT NULL,
        creator_id TEXT CHECK (creator_id IS NULL OR creator_id <> ''),
        creator_name TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX replyset_account ON replyset (account_id, updated_at DESC, id DESC);
    CREATE INDEX replyset_state ON replyset (state, updated_at DESC, id DESC);

    -- One reply in a reply set. `recipient_address` and `recipient_name` are derived by the
    -- engine from the source message at creation and cannot be set by any caller (10.3,
    -- plugin.spec.md 9.4). `generation` rises whenever the reply's text or linked answers
    -- change, invalidating any open unit `rsu_<set>_<reply>_<generation>`.
    CREATE TABLE replyset_reply (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        replyset_id INTEGER NOT NULL REFERENCES replyset (id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
        message_id INTEGER REFERENCES message (id),
        recipient_address TEXT NOT NULL,
        recipient_name TEXT NOT NULL DEFAULT '',
        reply_to_differs INTEGER NOT NULL DEFAULT 0 CHECK (reply_to_differs IN (0, 1)),
        subject TEXT NOT NULL,
        text TEXT,
        source TEXT CHECK (source IS NULL OR source IN ('submitted', 'edited')),
        generation INTEGER NOT NULL DEFAULT 1 CHECK (generation > 0),
        author_kind TEXT,
        author_id TEXT CHECK (author_id IS NULL OR author_id <> ''),
        author_name TEXT,
        source_unit TEXT,
        source_text_digest TEXT,
        answers_snapshot TEXT,
        handed_unit TEXT,
        handed_source_text_digest TEXT,
        handed_answers_snapshot TEXT,
        text_digest TEXT,
        updated_at INTEGER NOT NULL,
        send_state TEXT NOT NULL DEFAULT 'none'
            CHECK (send_state IN ('none', 'sending', 'sent', 'failed', 'unknown')),
        outbound_id INTEGER REFERENCES outbound (id) ON DELETE SET NULL,
        UNIQUE (replyset_id, ordinal),
        UNIQUE (replyset_id, message_id)
    ) STRICT;
    CREATE INDEX replyset_reply_set ON replyset_reply (replyset_id, ordinal);
    CREATE INDEX replyset_reply_message ON replyset_reply (message_id) WHERE message_id IS NOT NULL;

    -- Distinct questions asked by the cohort, each answered once.
    CREATE TABLE replyset_question (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        replyset_id INTEGER NOT NULL REFERENCES replyset (id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
        question TEXT NOT NULL,
        answer TEXT,
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
        answered_by_kind TEXT,
        answered_by_id TEXT CHECK (answered_by_id IS NULL OR answered_by_id <> ''),
        answered_by_name TEXT,
        updated_at INTEGER NOT NULL,
        UNIQUE (replyset_id, ordinal)
    ) STRICT;
    CREATE INDEX replyset_question_set ON replyset_question (replyset_id, ordinal);

    -- Which replies ask each question (drives per-reply unit isolation and the `individual`
    -- flag when only one reply asks a question).
    CREATE TABLE replyset_question_reply (
        question_id INTEGER NOT NULL REFERENCES replyset_question (id) ON DELETE CASCADE,
        reply_id INTEGER NOT NULL REFERENCES replyset_reply (id) ON DELETE CASCADE,
        PRIMARY KEY (question_id, reply_id)
    ) STRICT, WITHOUT ROWID;
    CREATE INDEX replyset_question_reply_reply ON replyset_question_reply (reply_id);

    -- Audit trail of every submission and edit per reply (plugin.spec.md 9.4).
    CREATE TABLE replyset_event (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reply_id INTEGER NOT NULL REFERENCES replyset_reply (id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('submitted', 'edited')),
        unit_id TEXT,
        source_message_id INTEGER,
        source_text_digest TEXT,
        answers_snapshot TEXT,
        actor_kind TEXT NOT NULL,
        actor_id TEXT CHECK (actor_id IS NULL OR actor_id <> ''),
        actor_name TEXT,
        text_digest TEXT NOT NULL,
        at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX replyset_event_reply ON replyset_event (reply_id, id);
    ",
    // 20: proposal generation (step F2a; plugin.spec.md section 7). Raised each
    // time an operation enters `proposed`, so a resume dismissed and proposed
    // again under the same id gets a new generation and cannot be released by an
    // earlier approval's digest. Every existing proposal starts at 1.
    "
    ALTER TABLE operation
        ADD COLUMN proposal_generation INTEGER NOT NULL DEFAULT 0
            CHECK (proposal_generation >= 0);

    UPDATE operation SET proposal_generation = 1 WHERE proposer_kind IS NOT NULL;
    ",
    // 21: per-account policy overrides (step F4; plugin.spec.md section 10, M36).
    // Not derived: survives a rebuild. Each nullable limit falls back to the
    // default `policy` row when NULL.
    "
    CREATE TABLE account_policy (
        account_id INTEGER PRIMARY KEY REFERENCES account (id) ON DELETE CASCADE,
        change_per_call INTEGER CHECK (change_per_call IS NULL OR (change_per_call >= 0 AND change_per_call <= 1000)),
        trash_per_call INTEGER CHECK (trash_per_call IS NULL OR (trash_per_call >= 0 AND trash_per_call <= 1000)),
        trash_per_day INTEGER CHECK (trash_per_day IS NULL OR (trash_per_day >= 0 AND trash_per_day <= 10000)),
        ask_above INTEGER CHECK (ask_above IS NULL OR (ask_above >= 0 AND ask_above <= 1000000)),
        set_at INTEGER NOT NULL
    ) STRICT;
    ",
    // 22: proposed stories (step E2; engine.spec.md section 10.2).
    // Not derived: survives a rebuild. Ids are allocated from `stream` so they
    // never collide with stream or burst story ids.
    "
    CREATE TABLE proposed_story (
        id INTEGER PRIMARY KEY REFERENCES stream (id),
        kind TEXT NOT NULL CHECK (kind IN ('situation', 'cohort')),
        title TEXT NOT NULL,
        proposer_kind TEXT NOT NULL,
        proposer_id TEXT CHECK (proposer_id IS NULL OR proposer_id <> ''),
        state TEXT NOT NULL CHECK (state IN ('proposed', 'dismissed')),
        messages INTEGER NOT NULL CHECK (messages >= 0),
        first_date INTEGER NOT NULL,
        last_date INTEGER NOT NULL,
        proposed_at INTEGER NOT NULL,
        ended_at INTEGER,
        CHECK ((state = 'proposed') = (ended_at IS NULL))
    ) STRICT;
    CREATE INDEX proposed_story_recent ON proposed_story (last_date DESC, id DESC)
        WHERE state = 'proposed';
    CREATE INDEX proposed_story_proposer_active ON proposed_story (proposer_kind, proposer_id, id)
        WHERE state = 'proposed';

    CREATE TABLE proposed_story_member (
        story_id INTEGER NOT NULL REFERENCES proposed_story (id) ON DELETE CASCADE,
        message_id INTEGER NOT NULL REFERENCES message (id),
        passage TEXT NOT NULL,
        date INTEGER NOT NULL,
        PRIMARY KEY (story_id, message_id)
    ) STRICT, WITHOUT ROWID;
    CREATE INDEX proposed_story_member_date
        ON proposed_story_member (story_id, date DESC, message_id DESC);
    CREATE INDEX proposed_story_member_message
        ON proposed_story_member (message_id);
    ",
    // 23: fixed recipient bases on drafts (step F2b; plugin.spec.md sections 7 and 8.2).
    // Computed and stored when a draft is created or new recipients are added so `mail-draft-show`
    // stays stable for an unchanged revision even if sync later moves messages or adds sent mail.
    // Pre-existing rows are backfilled on store open by `drafts::backfill_recipient_bases`.
    "
    ALTER TABLE draft ADD COLUMN recipient_bases TEXT;
    ",
    // 24: reply-set unit claim key and instructions version (step F3; plugin.spec.md
    // sections 9.1 and 9.4). Neither is derived from mail: both survive restarts and rebuilds.
    // The claim key is initialized once from the operating system's random source on store open.
    "
    CREATE TABLE replyset_claim_key (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        secret BLOB NOT NULL CHECK (length(secret) = 32),
        created_at INTEGER NOT NULL
    ) STRICT;

    ALTER TABLE replyset_reply ADD COLUMN instructions_version TEXT;
    ALTER TABLE replyset_reply ADD COLUMN known_source_digest TEXT;
    ALTER TABLE replyset_event ADD COLUMN instructions_version TEXT;
    ",
    // 25: persistent instance identity proof key for pre-bearer `/health` proof
    // (phase 5 no-terminal amendment, sections 5.1 and 5.2). Not derived from mail:
    // survives restarts, rebuilds, and token unpair. Initialized once from the
    // operating system's random source on store open.
    "
    CREATE TABLE instance_proof_key (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        secret BLOB NOT NULL CHECK (length(secret) = 32),
        created_at INTEGER NOT NULL
    ) STRICT;
    ",
];

/// Brings `connection` to the newest schema, one migration and one
/// transaction at a time.
///
/// # Errors
/// [`StoreError::Newer`] when the store was written by a newer program. A
/// migration that fails leaves the store at the version before it.
pub(super) fn migrate(connection: &mut Connection, migrations: &[&str]) -> Result<(), StoreError> {
    let found: u32 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    let supported = u32::try_from(migrations.len()).unwrap_or(u32::MAX);
    if found > supported {
        return Err(StoreError::Newer { found, supported });
    }
    for (index, migration) in migrations.iter().enumerate().skip(found as usize) {
        let transaction = connection.transaction()?;
        transaction.execute_batch(migration)?;
        // A pragma takes no bound parameter; the value is this loop's own number.
        transaction.execute_batch(&format!("PRAGMA user_version = {}", index + 1))?;
        transaction.commit()?;
    }
    Ok(())
}
