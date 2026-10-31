package com.aylink.mobile.ui.remote

import androidx.compose.ui.geometry.Size
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class RemoteControlLayoutTest {
    @Test
    fun controlsStayInsideViewportAndDoNotOverlapNearEitherEdge() {
        val viewports = listOf(Size(736f, 320f), Size(320f, 736f), Size(320f, 260f))
        for (viewport in viewports) {
            for (right in listOf(false, true)) {
                for (fraction in listOf(0f, 0.15f, 0.5f, 0.85f, 1f)) {
                    for (count in 2..5) {
                        val anchor = remoteControlAnchor(viewport, right, fraction)
                        val buttons = remoteControlOffsets(viewport, anchor, right, count)
                        assertEquals(count, buttons.size)
                        assertTrue(buttons.zipWithNext().all { (a, b) -> a.y <= b.y })
                        val circles = buttons.map { it to REMOTE_CONTROL_BUTTON_SIZE / 2 } + (anchor to REMOTE_CONTROL_ANCHOR_SIZE / 2)
                        circles.forEach { (center, radius) ->
                            assertTrue(center.x - radius >= 0f && center.x + radius <= viewport.width)
                            assertTrue(center.y - radius >= 0f && center.y + radius <= viewport.height)
                        }
                        circles.forEachIndexed { index, (center, radius) ->
                            circles.drop(index + 1).forEach { (other, otherRadius) ->
                                assertTrue((center - other).getDistance() >= radius + otherRadius + 4f)
                            }
                        }
                    }
                }
            }
        }
    }

    @Test
    fun dockingMirrorsButtonsAndPreservesVerticalPositionAfterRotation() {
        val landscape = Size(736f, 320f)
        val left = remoteControlAnchor(landscape, false, 0.7f)
        val right = remoteControlAnchor(landscape, true, 0.7f)
        remoteControlOffsets(landscape, left, false, 5)
            .zip(remoteControlOffsets(landscape, right, true, 5))
            .forEach { (a, b) ->
                assertEquals(landscape.width, a.x + b.x, 0.001f)
                assertEquals(a.y, b.y, 0.001f)
            }
        val portrait = Size(320f, 736f)
        assertEquals(0.7f, remoteControlAnchor(portrait, true, right.y / landscape.height).y / portrait.height, 0.001f)
    }
}
