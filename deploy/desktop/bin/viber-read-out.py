#!/usr/bin/env python3
# Read the owner's own (outgoing) messages from the Viber chat already open on screen (viber-read-out opened it).
# My bubbles are purple and hug the right edge; each is copied by right-click → «Скопировать сообщение», its text
# read from the clipboard and its time read by OCR. Prints one JSON object per message, newest first:
#   {"text": "...", "time": "HH:MM", "chat": "<title>", "phone": "<+... or empty>"}
# A fresh screenshot is taken before every copy, so a message that arrives mid-read cannot send the mouse to the
# wrong bubble; already-copied texts are skipped, and a bubble with no «Скопировать сообщение» (a photo) is passed
# over. The lock and the parked return to «Мои заметки» are the caller's. deploy/DESKTOP.md.
import json, os, re, subprocess, sys, time
import numpy as np
from PIL import Image

CHAT = os.environ.get('MINE_CHAT', '')
PHONE = os.environ.get('MINE_PHONE', '')
LIMIT = int(sys.argv[1]) if len(sys.argv) > 1 else 8   # at most this many of my newest messages per call

# The outgoing bubble fill, measured 2026-11-20: srgb(115,96,242) ≈ #7360F2 (the Viber brand purple).
PURPLE = np.array([115, 96, 242])
TOL = np.array([48, 48, 48])
AREA = (118, 712)      # y range between the chat header and the input line
RIGHT_X = 760          # my bubbles are looked for right of here (they hug the right edge)
MIN_RUN = 50           # a bubble row has at least this many purple pixels (a reaction chip is far narrower)
GAP = 4                # purple rows closer than this belong to one bubble (my bubbles sit ~5 px apart)
MIN_BAND = 22          # a band shorter than this is not a bubble (a reaction chip, a lone emoji)
SHOT = '/tmp/read-out.png'    # the clean chat screenshot of the current pass
MENU = '/tmp/read-menu.png'   # a separate screenshot taken while a context menu is open


def shot():
    subprocess.run(['import', '-window', 'root', SHOT], check=True)
    return np.asarray(Image.open(SHOT).convert('RGB'))


def purple_mask(img):
    return (np.abs(img[:, RIGHT_X:].astype(int) - PURPLE) <= TOL).all(axis=2)


def bands(img):
    """(top, bottom) of each purple bubble in the message area, top to bottom."""
    rows = np.zeros(img.shape[0], bool)
    mask = purple_mask(img)
    rows[AREA[0]:AREA[1]] = mask[AREA[0]:AREA[1]].sum(axis=1) >= MIN_RUN
    ys = np.where(rows)[0]
    if len(ys) == 0:
        return []
    groups, start, prev = [], ys[0], ys[0]
    for y in ys[1:]:
        if y - prev > GAP:
            groups.append((start, prev)); start = y
        prev = y
    groups.append((start, prev))
    return [(int(a), int(b)) for a, b in groups if b - a >= MIN_BAND]


def click_point(img, top, bottom):
    """A right-click point on the bubble's fill — near the top-right, where there is padding and no white text
    and no time stamp (that sits bottom-right). Returns an interior pixel whose 9x7 neighbourhood is all purple."""
    mask = purple_mask(img)
    wide = mask.shape[1]
    for y in range(top + 6, min(bottom - 16, top + 130)):
        xs = np.where(mask[y])[0]
        if len(xs) < 20:
            continue
        for xoff in range(int(xs[-1]) - 12, int(xs[0]), -4):
            if 4 <= xoff < wide - 4 and mask[y - 3:y + 4, xoff - 4:xoff + 5].all():
                return RIGHT_X + xoff, y
    mid = (top + bottom) // 2
    xs = np.where(mask[mid])[0]
    return RIGHT_X + (int(xs[-1]) - 14 if len(xs) else 0), mid


def is_purple_at(x, y):
    out = subprocess.run(['convert', SHOT, '-crop', f'1x1+{x}+{y}', '-format', '%[pixel:p{0,0}]', 'info:'],
                         capture_output=True, text=True).stdout
    nums = re.findall(r'\d+', out)
    if len(nums) < 3:
        return False
    return bool((np.abs(np.array([int(n) for n in nums[:3]]) - PURPLE) <= TOL).all())


def run(*args):
    subprocess.run(list(args), capture_output=True, close_fds=True)


def clip_get():
    return subprocess.run(['xclip', '-o', '-selection', 'clipboard'], capture_output=True, close_fds=True).stdout.decode('utf-8', 'replace')


def clip_set(text):
    subprocess.run(['xclip', '-selection', 'clipboard'], input=text.encode('utf-8'), close_fds=True)


def ocr_time(bottom):
    """HH:MM OCR'd from the bubble's bottom-right corner (read before the menu can cover it), or ''."""
    subprocess.run(['convert', SHOT, '-crop', f'170x34+1100+{max(0, bottom - 30)}', '+repage',
                    '-resize', '300%', '-colorspace', 'Gray', '/tmp/read-time.png'], capture_output=True)
    text = subprocess.run(['tesseract', '/tmp/read-time.png', '-', '--psm', '7'], capture_output=True, text=True).stdout
    m = re.search(r'(\d{1,2}):(\d{2})', text)
    return f'{int(m.group(1)):02d}:{m.group(2)}' if m else ''


def locate_copy(cx, cy):
    """Screen coords of «Скопировать сообщение» in the context menu now open near (cx, cy), or None."""
    x0, y0 = max(0, cx - 300), max(0, cy - 350)   # the menu opens left or right of the click; cover both
    x1, y1 = min(1280, cx + 300), min(800, cy + 350)
    w, h, s = x1 - x0, y1 - y0, 3
    subprocess.run(['import', '-window', 'root', MENU], check=True)
    subprocess.run(['convert', MENU, '-crop', f'{w}x{h}+{x0}+{y0}', '+repage', '-resize', f'{s}00%',
                    '-colorspace', 'Gray', '/tmp/read-menu-ocr.png'], capture_output=True)
    tsv = subprocess.run(['tesseract', '/tmp/read-menu-ocr.png', '-', '-l', 'rus', '--psm', '6', 'tsv'],
                         capture_output=True, text=True).stdout
    lines = {}
    for row in tsv.splitlines()[1:]:
        c = row.split('\t')
        if len(c) >= 12 and c[11].strip():
            lines.setdefault((c[2], c[3], c[4]), []).append(c)
    for words in lines.values():
        joined = ' '.join(w[11] for w in words).lower()
        if 'копиров' in joined and 'сообщ' in joined:   # not «Скопировать изображение» (a photo)
            w0 = words[0]
            left, top, wd, ht = (int(w0[i]) for i in (6, 7, 8, 9))
            return x0 + int((left + wd / 2) / s), y0 + int((top + ht / 2) / s)
    return None


def copy_bubble(img, top, bottom):
    """Right-click the bubble, copy it, return (text, time); text '' when it is not a copyable text message,
    or None when the view shifted since the screenshot (the target is no longer purple)."""
    x, y = click_point(img, top, bottom)
    if not is_purple_at(x, y):
        return None
    tm = ocr_time(bottom)
    clip_set('\x00')
    run('xdotool', 'mousemove', str(x), str(y), 'click', '3')
    time.sleep(0.7)
    spot = locate_copy(x, y)
    if not spot:
        run('xdotool', 'key', 'Escape')
        return '', ''
    run('xdotool', 'mousemove', str(spot[0]), str(spot[1]), 'click', '1')
    time.sleep(0.4)
    text = clip_get()
    return ('' if text == '\x00' else text.strip()), tm


def main():
    seen, out = set(), []
    for _ in range(LIMIT * 4):          # bounded: each new message costs one pass, re-reads a few more
        if len(out) >= LIMIT:
            break
        img = shot()
        found_new = shifted = False
        for top, bottom in reversed(bands(img)):
            result = copy_bubble(img, top, bottom)
            if result is None:
                shifted = True; break   # the view moved — take a fresh screenshot
            text, tm = result
            if not text or text in seen:
                continue                # a photo, or one we already have: look further up
            seen.add(text)
            out.append({'text': text, 'time': tm, 'chat': CHAT, 'phone': PHONE})
            found_new = True; break     # emit, then re-read from a fresh screenshot
        if not found_new and not shifted:
            break                       # nothing new on this screen
    for item in out:
        print(json.dumps(item, ensure_ascii=False))


if __name__ == '__main__':
    main()
