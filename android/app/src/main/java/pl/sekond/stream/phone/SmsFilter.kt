package pl.sekond.stream.phone

/**
 * Which SMS go to the journal: only those from real phone numbers. Senders with letters (banks, couriers,
 * services) and short codes carry one-time codes and account data, so they stay on the phone (CONCEPT.md §8.1).
 */
object SmsFilter {
    private val PHONE = Regex("^[+0-9 ()\\-]+$")
    private const val MIN_DIGITS = 7

    fun accept(address: String, exclusions: Set<String>): Boolean {
        val trimmed = address.trim()
        if (!PHONE.matches(trimmed)) return false
        val digits = trimmed.filter(Char::isDigit)
        if (digits.length < MIN_DIGITS) return false
        // "+48 500 000 001" and "500000001" are the same number: compare by the shorter tail.
        return exclusions.none { excluded -> digits.endsWith(excluded) || excluded.endsWith(digits) }
    }

    /** Numbers typed in settings, separated by commas, semicolons or new lines; only digits are kept. */
    fun parseExclusions(text: String): Set<String> =
        text.split(',', '\n', ';').map { it.filter(Char::isDigit) }.filter { it.length >= MIN_DIGITS }.toSet()
}
