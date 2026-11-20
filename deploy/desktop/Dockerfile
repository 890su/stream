# Agent desktop: a light virtual computer on srv-150 for agent sessions (Viber first, other GUI apps later).
# X server with VNC (TigerVNC), Openbox + tint2, noVNC in the browser, xdotool for scripted input,
# our own notification daemon that logs every desktop notification. Owner's decision 2026-11-20.
FROM ubuntu:22.04

ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      tigervnc-standalone-server openbox tint2 xterm novnc websockify supervisor \
      dbus-x11 xdotool xclip x11-utils x11-xserver-utils imagemagick \
      python3 python3-dbus python3-gi gir1.2-glib-2.0 python3-numpy python3-pil \
      fonts-dejavu locales tzdata ca-certificates curl \
 && sed -i 's/^# *ru_RU.UTF-8/ru_RU.UTF-8/; s/^# *en_US.UTF-8/en_US.UTF-8/' /etc/locale.gen && locale-gen \
 && rm -rf /var/lib/apt/lists/*

# Viber for Linux, official package from Viber's CDN; apt resolves its libraries.
RUN curl -fsSL -o /tmp/viber.deb https://download.cdn.viber.com/cdn/desktop/Linux/viber.deb \
 && apt-get update && apt-get install -y --no-install-recommends /tmp/viber.deb \
 && rm -rf /tmp/viber.deb /var/lib/apt/lists/*

# OCR for scripts that check what is on screen (viber-send checks the opened chat's title).
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-rus \
 && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 1000 --shell /bin/bash agent
COPY supervisord.conf /etc/supervisor/conf.d/desktop.conf
COPY bin/ /usr/local/bin/
# Normal windows open maximized: scripts click at stable places on a fixed 1280x800 screen.
RUN chmod 755 /usr/local/bin/* && ln -sf /usr/share/novnc/vnc.html /usr/share/novnc/index.html \
 && sed -i 's#</applications>#<application class="*" type="normal"><maximized>yes</maximized></application></applications>#' /etc/xdg/openbox/rc.xml

ENV LANG=ru_RU.UTF-8 LC_ALL=ru_RU.UTF-8 DISPLAY=:1 \
    DBUS_SESSION_BUS_ADDRESS=unix:path=/tmp/dbus-session \
    QTWEBENGINE_DISABLE_SANDBOX=1 QT_X11_NO_MITSHM=1
EXPOSE 6080
CMD ["/usr/local/bin/desktop-start"]
