"""Gateway decisions without Telegram or network. Run: python -m unittest discover -s tests"""
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from stream_gateway import logic
from stream_gateway.state import State

UTC = timezone.utc
NOON = datetime(2026, 11, 17, 10, 0, tzinfo=UTC)


def chat(id, kind, last_id=5, last_date=NOON):
    return logic.Chat(id, kind, "Чат", last_id, last_date)


class Tracking(unittest.TestCase):
    def test_people_all_groups_from_folder_never_channels_bots_self_service(self):
        chats = [chat("1", "user"), chat("2", "user"), chat("3", "bot"), chat("4", "self"), chat("777000", "service"),
                 chat("-10", "group"), chat("-11", "group"), chat("-1001", "channel")]
        result = logic.tracked(chats, folder_ids={"-10", "-1001", "3"}, excluded={"2"})
        self.assertEqual(sorted(result), ["-10", "1"])

    def test_chat_kind(self):
        self.assertEqual(logic.chat_kind(is_user=True, is_bot=False, is_self=False, is_group=False, peer_id="777000"), "service")
        self.assertEqual(logic.chat_kind(is_user=True, is_bot=False, is_self=True, is_group=False, peer_id="5"), "self")
        self.assertEqual(logic.chat_kind(is_user=False, is_bot=False, is_self=False, is_group=True, peer_id="-5"), "group")
        self.assertEqual(logic.chat_kind(is_user=False, is_bot=False, is_self=False, is_group=False, peer_id="-1005"), "channel")


class Today(unittest.TestCase):
    def test_local_midnight_per_account(self):
        late = datetime(2026, 11, 17, 22, 30, tzinfo=UTC)  # already 18 Nov in Minsk (UTC+3), still 17 Nov in Warsaw (UTC+1)
        self.assertEqual(logic.today_start("Europe/Minsk", late), datetime(2026, 11, 17, 21, 0, tzinfo=UTC))
        self.assertEqual(logic.today_start("Europe/Warsaw", late), datetime(2026, 11, 16, 23, 0, tzinfo=UTC))


class Plan(unittest.TestCase):
    since = datetime(2026, 11, 17, 0, 0, tzinfo=UTC)

    def test_new_chat_with_messages_today_reads_today(self):
        self.assertEqual(logic.plan(chat("1", "user"), None, self.since), logic.Fetch("today", self.since))

    def test_new_chat_quiet_today_only_remembers_newest(self):
        old = chat("1", "user", last_id=40, last_date=datetime(2026, 11, 10, tzinfo=UTC))
        self.assertEqual(logic.plan(old, None, self.since), logic.Fetch("mark", 40))

    def test_known_chat_catches_up_after_pointer(self):
        self.assertEqual(logic.plan(chat("1", "user", last_id=9), 5, self.since), logic.Fetch("after", 5))
        self.assertEqual(logic.plan(chat("1", "user", last_id=5), 5, self.since), logic.Fetch("skip"))


class Media(unittest.TestCase):
    allowed = ["image/*", "audio/*", "video/*", "application/pdf"]

    def test_download_or_note(self):
        self.assertIsNone(logic.media_problem("image/jpeg", 1000, self.allowed, 20_000_000))
        self.assertEqual(logic.media_problem("video/mp4", 90_000_000, self.allowed, 20_000_000), "too_large")
        self.assertEqual(logic.media_problem("application/zip", 10, self.allowed, 20_000_000), "unsupported")

    def test_kind(self):
        self.assertEqual(logic.message_kind("image/jpeg", voice=False, photo=True), "photo")
        self.assertEqual(logic.message_kind("audio/ogg", voice=True, photo=False), "voice")
        self.assertEqual(logic.message_kind("application/pdf", voice=False, photo=False), "file")
        self.assertEqual(logic.message_kind(None, voice=False, photo=False), "text")


class Sending(unittest.TestCase):
    def test_random_id_is_stable_and_signed_64_bit(self):
        first = logic.random_id("6f1c0b9e-0000-5000-8000-000000000001")
        self.assertEqual(first, logic.random_id("6f1c0b9e-0000-5000-8000-000000000001"))
        self.assertNotEqual(first, logic.random_id("6f1c0b9e-0000-5000-8000-000000000002"))
        self.assertTrue(-(2 ** 63) <= first < 2 ** 63)

    def test_iso(self):
        self.assertEqual(logic.iso(NOON), "2026-11-17T10:00:00.000Z")


class Pointers(unittest.TestCase):
    def test_pointers_only_grow_survive_restart_and_are_forgotten_for_untracked_chats(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "pointers.json"
            state = State(path)
            state.advance("1", 10)
            state.advance("1", 7)
            state.advance("2", 3)
            self.assertEqual(State(path).pointer("1"), 10)
            state.keep_only({"1"})
            self.assertIsNone(State(path).pointer("2"))


if __name__ == "__main__":
    unittest.main()
