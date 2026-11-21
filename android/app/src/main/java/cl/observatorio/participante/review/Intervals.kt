package cl.observatorio.participante.review

// Trimming math for the clip detail screen. Seconds from the start of the clip; selections are floats
// because that's what the slider reports.

/** Merges overlapping or touching spans into a sorted list. */
private fun List<Interval>.merged(): List<Interval> =
    sortedBy { it.start }.fold(mutableListOf()) { acc, next ->
        val last = acc.lastOrNull()
        if (last != null && next.start <= last.end) acc[acc.lastIndex] = Interval(last.start, maxOf(last.end, next.end))
        else acc += next
        acc
    }

/** The parts of the clip that are not excluded, sorted. */
fun freeGaps(duration: Int, excluded: List<Interval>): List<Interval> {
    val gaps = mutableListOf<Interval>()
    var cursor = 0
    for (span in excluded.merged()) {
        if (span.start > cursor) gaps += Interval(cursor, span.start)
        cursor = maxOf(cursor, span.end)
    }
    if (cursor < duration) gaps += Interval(cursor, duration)
    return gaps
}

/** Adds a span and merges it with any span it touches, so adjacent exclusions show as one row. */
fun addExcluded(excluded: List<Interval>, new: Interval): List<Interval> = (excluded + new).merged()

/** Seconds that will still be shared. */
fun sharedSeconds(duration: Int, excluded: List<Interval>): Int = freeGaps(duration, excluded).sumOf { it.end - it.start }

/** First free gap, up to a quarter of the clip long. Null when everything is excluded. */
fun defaultSelection(duration: Int, gaps: List<Interval>): ClosedFloatingPointRange<Float>? {
    val gap = gaps.firstOrNull() ?: return null
    return gap.start.toFloat()..minOf(gap.end, gap.start + maxOf(1, duration / 4)).toFloat()
}

private operator fun Interval.contains(x: Float) = x >= start && x <= end

/**
 * Keeps the selection out of excluded spans. Thumbs are clamped to the free gap the selection is in;
 * if the moved thumb lands in another free gap (a tap there), the whole selection jumps into that gap.
 */
fun constrain(
    previous: ClosedFloatingPointRange<Float>,
    proposed: ClosedFloatingPointRange<Float>,
    gaps: List<Interval>,
): ClosedFloatingPointRange<Float> {
    val home = gaps.firstOrNull { previous.start in it && previous.endInclusive in it } ?: return previous
    val moved = if (proposed.start != previous.start) proposed.start else proposed.endInclusive
    val target = gaps.firstOrNull { moved in it }
    if (target == null || target == home) {
        return proposed.start.coerceIn(home.start.toFloat(), home.end.toFloat())..
            proposed.endInclusive.coerceIn(home.start.toFloat(), home.end.toFloat())
    }
    val length = previous.endInclusive - previous.start
    val end = minOf(target.end.toFloat(), moved + length)
    return maxOf(target.start.toFloat(), end - length)..end
}
