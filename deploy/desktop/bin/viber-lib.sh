# Shared steps of the Viber scripts (sourced by viber-send, viber-whois): one script at a time, human pauses,
# clipboard paste, open a chat by search and check its title by OCR, read the line under the title.
# Places on screen come from viber-ui.env.
export DISPLAY=${DISPLAY:-:1} LC_ALL=ru_RU.UTF-8
source /usr/local/bin/viber-ui.env

viber_lock() { exec 9>/tmp/viber-send.lock; flock -w 60 9 || { echo "busy" >&2; exit 4; }; }
pause() { sleep "$(awk -v a="$1" -v b="$2" 'BEGIN{srand(); printf "%.2f", a+rand()*(b-a)}')"; }
# xclip stays in the background to serve the clipboard: it must not inherit the lock (fd 9).
clip() { printf '%s' "$1" | xclip -selection clipboard 9>&-; }
paste() { clip "$1"; xdotool key --clearmodifiers ctrl+v; }
# Bash patterns are multibyte-aware under the UTF-8 locale (tr is not: it drops Cyrillic letters).
norm() { local s=${1,,}; printf '%s' "${s//[^[:alnum:]]/}"; }
ocr() { # ocr <x> <y> <w> <h> [lang] [image]: text lines in a box of the image (default: the screen now)
  local src=${6:-}
  [ -n "$src" ] || { import -window root /tmp/viber-now.png; src=/tmp/viber-now.png; }
  convert "$src" -crop "${3}x${4}+${1}+${2}" +repage -resize 300% -colorspace Gray /tmp/viber-ocr3.png
  tesseract /tmp/viber-ocr3.png - -l "${5:-rus+eng}" --psm 6 2>/dev/null | tr -d '\f' | sed 's/[[:space:]]*$//; /^$/d'
}
# phone_in <text>: the first line that is a phone number (9-15 digits, optional +), digits only
phone_in() {
  local line digits
  while IFS= read -r line; do
    digits=$(printf '%s' "$line" | tr -cd '+0-9')
    [[ "$digits" =~ ^\+?[0-9]{9,15}$ ]] && { printf '%s' "$digits"; return; }
  done <<< "$1"
}

viber_focus() {
  local win; win=$(xdotool search --onlyvisible --class "$VIBER_CLASS" | tail -1 || true)
  [ -n "$win" ] || { echo "Viber window not found" >&2; exit 2; }
  xdotool windowactivate --sync "$win" 2>/dev/null || xdotool windowfocus --sync "$win"
  xdotool key Escape; pause 0.3 0.6
}

# viber_open <name>: search, open the first result; sets HEADER (all lines) and TITLE (first); exits 3 (screenshot kept) if the title differs.
viber_open() {
  local who=$1 want got
  xdotool mousemove "$SEARCH_X" "$SEARCH_Y" click 1; pause 0.4 0.8
  xdotool key ctrl+a BackSpace
  paste "$who"; pause 1.5 2.2
  xdotool mousemove "$RESULT_X" "$RESULT_Y" click 1; sleep 0.8
  import -window root /tmp/viber-open.png   # one shot right after opening: the phone line is still shown
  HEADER=$(ocr "$HEADER_X" "$HEADER_Y" "$HEADER_W" "$HEADER_H" rus+eng /tmp/viber-open.png)
  TITLE=$(printf '%s
' "$HEADER" | head -1)   # the name; the line under it is the phone or the status
  want=$(norm "$who"); got=$(norm "$TITLE")
  if [ ${#want} -lt 2 ] || [ -z "$got" ] || [[ "$got" != *"$want"* ]]; then
    mkdir -p ~/sent; import -window root ~/sent/"$(date +%Y%m%d-%H%M%S)"-mismatch.png
    echo "opened chat \"$TITLE\" does not match \"$who\"" >&2; exit 3
  fi
}

# viber_phone: the phone in the chat header: the title itself for a number not in contacts, else the line under
# the title (shown ~2 s after opening, then the status). Empty if none seen.
viber_phone() {
  local found i
  found=$(phone_in "$HEADER")
  for i in 1 2 3; do
    [ -n "$found" ] && break
    sleep 0.4; found=$(phone_in "$(ocr "$HEADER_X" "$HEADER_Y" "$HEADER_W" "$HEADER_H" eng)")
  done
  printf '%s' "$found"
}
