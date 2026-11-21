package cl.observatorio.participante.review

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class IntervalsTest {

    @Test fun freeGapsIsTheComplement() {
        assertEquals(listOf(Interval(0, 300)), freeGaps(300, emptyList()))
        assertEquals(
            listOf(Interval(0, 60), Interval(120, 200), Interval(250, 300)),
            freeGaps(300, listOf(Interval(200, 250), Interval(60, 120))),
        )
        assertEquals(emptyList<Interval>(), freeGaps(300, listOf(Interval(0, 300))))
    }

    @Test fun addExcludedMergesTouchingAndOverlappingSpans() {
        assertEquals(listOf(Interval(0, 150)), addExcluded(listOf(Interval(0, 75)), Interval(75, 150)))
        assertEquals(listOf(Interval(10, 90)), addExcluded(listOf(Interval(10, 50)), Interval(40, 90)))
        assertEquals(
            listOf(Interval(0, 10), Interval(20, 30)),
            addExcluded(listOf(Interval(20, 30)), Interval(0, 10)),
        )
    }

    @Test fun sharedSecondsSubtractsExcluded() {
        assertEquals(225, sharedSeconds(300, listOf(Interval(0, 75))))
        assertEquals(0, sharedSeconds(300, listOf(Interval(0, 300))))
    }

    @Test fun defaultSelectionStartsInFirstGap() {
        assertEquals(75f..150f, defaultSelection(300, listOf(Interval(75, 300))))
        assertEquals(75f..90f, defaultSelection(300, listOf(Interval(75, 90), Interval(200, 300))))
        assertNull(defaultSelection(300, emptyList()))
    }

    private val gaps = listOf(Interval(0, 100), Interval(150, 300)) // 100..150 excluded

    @Test fun thumbIsClampedAtTheExcludedEdge() {
        assertEquals(20f..100f, constrain(20f..60f, 20f..130f, gaps))
        assertEquals(150f..200f, constrain(170f..200f, 120f..200f, gaps))
    }

    @Test fun movingInsideTheSameGapIsUntouched() {
        assertEquals(10f..80f, constrain(20f..60f, 10f..80f, gaps))
    }

    @Test fun landingInAnotherGapJumpsTheSelectionThere() {
        assertEquals(200f..240f, constrain(20f..60f, 20f..200f, gaps))
        // Near the end of the target gap the selection keeps its length and stays inside.
        assertEquals(260f..300f, constrain(20f..60f, 20f..290f, gaps))
    }
}
