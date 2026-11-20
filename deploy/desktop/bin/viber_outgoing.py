# The owner's own Viber messages, typed from the phone, brought into Stream (deploy/DESKTOP.md, decision 2026-11-20).
# viber-read-out copies my outgoing (purple) bubbles from a chat; this decides WHICH chat to read and WHEN, and
# posts each message as mine (author `me` on the server). Opening a chat marks it read on the phone, so a chat is
# read only when the bridge opened it anyway — right after a reply it sent (note_sent) — or, if 15 minutes pass
# with none of those, one recently active chat (the idle sweep). A reply the bridge itself sent from the feed is
# already an event, so it is skipped here (note_sent remembers it). Used by viber-bridge; no state of its own.
import datetime, hashlib, json, subprocess, time

OUT_LIMIT = 5          # at most this many of my newest messages read from a chat at once
SWEEP_S = 900          # with no chat opened for a reply in this long, read one recently active chat
READ_AGAIN_S = 600     # the same chat is not re-read for the owner's messages more often than this
SENT_TTL_S = 86400     # a feed reply is remembered this long, so its bubble is not captured as a new message
RECENT_MAX = 200


def _sha12(text):
    return hashlib.sha1(text.encode('utf-8')).hexdigest()[:12]


def note_incoming(state, chat, phone):
    """Remember a chat that just wrote to me: a candidate for the idle sweep (my reply to it may be on the phone)."""
    recent = state.setdefault('out_recent', {})
    recent[chat] = {'phone': phone or (recent.get(chat) or {}).get('phone'), 'at': time.time()}
    if len(recent) > RECENT_MAX:
        for name in sorted(recent, key=lambda n: recent[n]['at'])[:len(recent) - RECENT_MAX]:
            del recent[name]


def note_sent(state, phone, text):
    """The bridge just sent this reply from the feed: queue the chat to read (to catch phone-typed messages too),
    and remember the reply so its own bubble is not captured again."""
    now = time.time()
    sent = [s for s in state.get('out_sent', []) if now - s['at'] < SENT_TTL_S]
    sent.append({'who': phone, 'text': text.strip(), 'at': now})
    state['out_sent'] = sent[-100:]
    touched = state.setdefault('out_touched', [])
    if phone not in touched:
        touched.append(phone)


def _recently_sent(state, who, text):
    body = text.strip()
    return any(s['who'] == who and s['text'] == body for s in state.get('out_sent', []))


def _received_at(when):
    """ISO time for a bubble: today at its HH:MM when the OCR read one, else now (the local desktop clock)."""
    now = datetime.datetime.now().astimezone()
    if when and ':' in when:
        try:
            hh, mm = (int(p) for p in when.split(':'))
            stamped = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
            if stamped <= now:
                return stamped.isoformat()
        except ValueError:
            pass
    return now.isoformat()


def _read_chat(api, state, who, phone, log):
    """Open the chat with viber-read-out, post each new outgoing message as mine. Returns the count posted."""
    state['out_sweep_at'] = time.time()
    state.setdefault('out_read', {})[who] = time.time()
    try:
        done = subprocess.run(['viber-read-out', who, str(OUT_LIMIT)], capture_output=True, text=True, timeout=150)
    except subprocess.TimeoutExpired:
        log('read-out timeout', who); return 0
    if done.returncode != 0:           # 2 no window · 3 wrong chat · 4 busy — try again later
        log('read-out', done.returncode, who, done.stderr.strip()[-120:]); return 0
    posted = 0
    for line in done.stdout.splitlines():
        try:
            message = json.loads(line)
        except ValueError:
            continue
        text = (message.get('text') or '').strip()
        chat = message.get('chat') or who
        ph = message.get('phone') or (phone or '')
        if not text or _recently_sent(state, ph or chat, text):
            continue
        body = {'key': f'out|{ph or chat}|{message.get("time", "")}|{_sha12(text)}', 'chat': chat,
                'text': text, 'mine': True, 'received_at': _received_at(message.get('time'))}
        if ph:
            body['phone'] = ph
        if api('messages', body)[0] == 201:
            posted += 1
    if posted:
        log('read-out', who, 'mine', posted)
    return posted


def step(api, state, log):
    """Once per bridge round (channel healthy): read one chat's outgoing — a chat just replied to, or, when it has
    been quiet for SWEEP_S, the most recently active chat not read in the last READ_AGAIN_S."""
    now = time.time()
    who = phone = None
    touched = state.get('out_touched', [])
    if touched:
        who = touched.pop(0)
        phone = who if str(who).startswith('+') else None
    elif now - state.get('out_sweep_at', 0) >= SWEEP_S:
        read = state.get('out_read', {})
        fresh = [(name, info) for name, info in state.get('out_recent', {}).items()
                 if now - read.get(name, 0) > READ_AGAIN_S]
        if fresh:
            name, info = max(fresh, key=lambda kv: kv[1]['at'])
            who, phone = (info.get('phone') or name), info.get('phone')
    if who:
        _read_chat(api, state, who, phone, log)
