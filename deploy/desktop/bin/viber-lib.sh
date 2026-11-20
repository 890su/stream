# Shared steps of the Viber scripts (sourced by viber-send, viber-whois): one script at a time, human pauses,
# clipboard paste, open a chat by search (phone preferred, or name) and check it is the right one.
# Name and phone come exactly from the chat title's right-click menu ("Копировать имя", "Скопировать номер");
# OCR of the header is the fallback (groups have no such menu). Places on screen come from viber-ui.env.
export DISPLAY=${DISPLAY:-:1} LC_ALL=ru_RU.UTF-8
source /usr/local/bin/viber-ui.env

viber_lock() { exec 9>/tmp/viber-send.lock; flock -w 60 9 || { echo "busy" >&2; exit 4; }; }
pause() { sleep "$(awk -v a="$1" -v b="$2" 'BEGIN{srand(); printf "%.2f", a+rand()*(b-a)}')"; }
# xclip stays in the background to serve the clipboard: it must not hold the lock (fd 9) nor the output of a
# $(...) it runs in (that would never end).
clip() { printf '%s' "$1" | xclip -selection clipboard 9>&- >/dev/null 2>&1; }
clip_out() { xclip -o -selection clipboard 2>/dev/null || true; }
paste() { clip "$1"; xdotool key --clearmodifiers ctrl+v; }
# Bash patterns are multibyte-aware under the UTF-8 locale (tr is not: it drops Cyrillic letters).
norm() { local s=${1,,}; printf '%s' "${s//[^[:alnum:]]/}"; }
digits() { printf '%s' "${1//[^0-9]/}"; }
is_phone() { local d; d=$(digits "$1"); [[ "$1" =~ ^[+0-9\ ()-]+$ ]] && [ ${#d} -ge 9 ]; }
# same_phone a b: equal digits, or one ends with the other (a number written without the country code).
same_phone() {
  local a b; a=$(digits "$1"); b=$(digits "$2")
  [ ${#a} -ge 9 ] && [ ${#b} -ge 9 ] && { [[ "$a" == *"$b" ]] || [[ "$b" == *"$a" ]]; }
}

ocr() { # ocr <x> <y> <w> <h> [lang] [image]: text lines in a box of the image (default: the screen now)
  local src=${6:-}
  [ -n "$src" ] || { import -window root /tmp/viber-now.png; src=/tmp/viber-now.png; }
  convert "$src" -crop "${3}x${4}+${1}+${2}" +repage -resize 300% -colorspace Gray /tmp/viber-ocr3.png
  tesseract /tmp/viber-ocr3.png - -l "${5:-rus+eng}" --psm 6 2>/dev/null | tr -d '\f' | sed 's/[[:space:]]*$//; /^$/d'
}
# phone_in <text>: the first line that is a phone number (9-15 digits, optional +), digits only
phone_in() {
  local line d
  while IFS= read -r line; do
    d=$(printf '%s' "$line" | tr -cd '+0-9')
    [[ "$d" =~ ^\+?[0-9]{9,15}$ ]] && { printf '%s' "$d"; return 0; }
  done <<< "$1"
  return 0
}

# What the self-check is tied to: the package version and the binary (a new Viber may move things on screen).
viber_version() { printf '%s %s' "$(dpkg-query -W -f '${Version}' viber 2>/dev/null)" "$(stat -c '%Y-%s' /opt/viber/Viber 2>/dev/null)"; }

viber_focus() {
  local win; win=$(xdotool search --onlyvisible --class "$VIBER_CLASS" | tail -1 || true)
  [ -n "$win" ] || { echo "Viber window not found" >&2; exit 2; }
  xdotool windowactivate --sync "$win" 2>/dev/null || xdotool windowfocus --sync "$win"
  xdotool key Escape; pause 0.3 0.6
}

# viber_park: leave the owner's own notes open. Viber may not notify about a chat that is open on screen, so after
# every scenario the open chat is one nobody writes to. Best effort: no checks, errors ignored.
viber_park() {
  { xdotool key Escape; xdotool mousemove "$SEARCH_X" "$SEARCH_Y" click 1; sleep 0.4; xdotool key ctrl+a BackSpace
    paste "Мои заметки"; sleep 1.5; xdotool mousemove "$RESULT_X" "$RESULT_Y" click 1; sleep 0.5; xdotool key Escape; } >/dev/null 2>&1 || true
}

# menu_copy name|number: right-click the chat title, pick the item, print what it put on the clipboard.
# Returns 1 (nothing clicked) when the menu does not appear, e.g. in a group.
menu_copy() {
  local dy menu
  [ "$1" = number ] && dy=$MENU_NUMBER_DY || dy=$MENU_NAME_DY
  clip ""
  xdotool mousemove "$MENU_X" "$MENU_Y" click 3; sleep 0.6
  menu=$(ocr "$MENU_X" "$MENU_Y" 260 90 rus)
  if [[ "$menu" != *опировать* ]]; then xdotool key Escape; return 1; fi
  xdotool mousemove $((MENU_X + MENU_ITEM_DX)) $((MENU_Y + dy)) click 1; sleep 0.4
  clip_out
}

# viber_open <phone or name>: search, open the first result, check it. Sets TITLE (the chat's name) and PHONE
# (empty if Viber does not show it: groups, numbers hidden for people not in contacts). Exits 3 (screenshot kept)
# if the chat is not the one searched for.
viber_open() {
  local who=$1 header
  xdotool mousemove "$SEARCH_X" "$SEARCH_Y" click 1; pause 0.4 0.8
  xdotool key ctrl+a BackSpace
  paste "$who"; pause 1.5 2.2
  xdotool mousemove "$RESULT_X" "$RESULT_Y" click 1; sleep 1.0
  header=$(ocr "$HEADER_X" "$HEADER_Y" "$HEADER_W" "$HEADER_H")
  TITLE=$(menu_copy name || true); PHONE=""
  if [ -n "$TITLE" ]; then
    PHONE=$(menu_copy number || true)
  else
    TITLE=$(printf '%s\n' "$header" | head -1)   # groups: no menu, the header's first line
  fi
  [ -n "$PHONE" ] || PHONE=$(phone_in "$header")
  if is_phone "$who"; then
    same_phone "$who" "$PHONE" && return 0
  else
    local want got; want=$(norm "$who"); got=$(norm "$TITLE")
    [ ${#want} -ge 2 ] && [ -n "$got" ] && [[ "$got" == *"$want"* ]] && return 0
  fi
  mkdir -p ~/sent; import -window root ~/sent/"$(date +%Y%m%d-%H%M%S)"-mismatch.png
  echo "opened chat \"$TITLE\" ${PHONE:+($PHONE) }does not match \"$who\"" >&2; exit 3
}
