package com.aylink.mobile.ui.terminal

import android.content.pm.ActivityInfo
import com.aylink.mobile.data.model.Device
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class TerminalDisplayModeTest {
    @Test
    fun orientationCyclesThroughThreeStates() {
        assertEquals(TerminalOrientation.LANDSCAPE, TerminalOrientation.FOLLOW_SYSTEM.next())
        assertEquals(TerminalOrientation.PORTRAIT, TerminalOrientation.LANDSCAPE.next())
        assertEquals(TerminalOrientation.FOLLOW_SYSTEM, TerminalOrientation.PORTRAIT.next())
        // 三步回到起点，确认没有遗漏档位。
        assertEquals(
            TerminalOrientation.FOLLOW_SYSTEM,
            TerminalOrientation
                .FOLLOW_SYSTEM
                .next()
                .next()
                .next(),
        )
    }

    @Test
    fun orientationMapsToRequestedActivityValues() {
        // 跟随系统必须保持用户自己的方向偏好，不能用 LOCKED 之类的固定值。
        assertEquals(ActivityInfo.SCREEN_ORIENTATION_USER, TerminalOrientation.FOLLOW_SYSTEM.activityValue())
        assertEquals(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE, TerminalOrientation.LANDSCAPE.activityValue())
        assertEquals(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT, TerminalOrientation.PORTRAIT.activityValue())
    }

    @Test
    fun defaultUiStateKeepsSystemOrientationAndWindowed() {
        val state = TerminalUiState(device = Device(id = 1, name = "test"))
        assertEquals(TerminalOrientation.FOLLOW_SYSTEM, state.screenOrientation)
        assertFalse(state.fullscreen)
    }
}
