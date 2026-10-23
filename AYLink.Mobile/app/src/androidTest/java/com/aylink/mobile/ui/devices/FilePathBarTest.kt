package com.aylink.mobile.ui.devices

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.click
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.aylink.mobile.data.repo.LocalUiSettings
import com.aylink.mobile.data.repo.ThemeMode
import com.aylink.mobile.ui.theme.AYLinkTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class FilePathBarTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private var editRequests = 0
    private var upRequests = 0
    private val openedPaths = mutableListOf<String>()

    @Test
    fun blankSpaceAfterShortPathAndAtRightEdgeOpensEditor() {
        showPath("/sdcard/a/")
        val bar = compose.onNodeWithTag("pathBar")
        val bounds = bar.fetchSemanticsNode().boundsInRoot
        val currentNode = visibleText("a")
        val current = currentNode.fetchSemanticsNode().boundsInRoot
        val textLayouts = mutableListOf<TextLayoutResult>()
        currentNode.performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(textLayouts) }
        val glyphRight = current.left + textLayouts.single().getBoundingBox(0).right
        val blankX = (glyphRight + bounds.right) / 2
        bar.performTouchInput {
            click(Offset(blankX - bounds.left, current.center.y - bounds.top))
        }
        compose.runOnIdle { assertEquals(1, editRequests) }
        bar.performTouchInput { click(Offset(width - 2f, centerY)) }
        compose.runOnIdle { assertEquals(2, editRequests) }
    }

    @Test
    fun pressingBlankSpaceHasNoVisualFeedback() {
        showPath("/sdcard/a/")
        val bar = compose.onNodeWithTag("pathBar")
        val before = bar.captureToImage().toPixelMap()
        val point = Offset(before.width - with(compose.density) { 20.dp.toPx() }, before.height / 2f)
        compose.mainClock.autoAdvance = false
        try {
            bar.performTouchInput { down(point) }
            compose.mainClock.advanceTimeBy(160)
            val pressed = bar.captureToImage().toPixelMap()
            assertEquals(before[point.x.toInt(), point.y.toInt()], pressed[point.x.toInt(), point.y.toInt()])
        } finally {
            bar.performTouchInput { up() }
            compose.mainClock.autoAdvance = true
        }
    }

    @Test
    fun shortSegmentsUseAvailableWidthAndAncestorsStillNavigate() {
        showPath("/sdcard/a/b/c/")
        listOf("共享存储", "a", "b", "c").forEach { visibleText(it).assertIsDisplayed() }
        compose.onNodeWithContentDescription("选择上级目录").assertDoesNotExist()
        savePathBar("wide")
        visibleText("a").performTouchInput { click() }
        compose.runOnIdle {
            assertEquals(listOf("/sdcard/a/"), openedPaths)
            assertEquals(0, editRequests)
        }
        visibleText("c").performTouchInput { click() }
        compose.runOnIdle { assertEquals(0, editRequests) }
        compose.onNodeWithContentDescription("返回上级目录").performTouchInput { click() }
        compose.runOnIdle {
            assertEquals(1, upRequests)
            assertEquals(0, editRequests)
        }
    }

    @Test
    fun shrinkingWidthCollapsesOnlyAncestorsThatDoNotFit() {
        val width = mutableStateOf(340.dp)
        showPath("/sdcard/a/b/c/", width)
        visibleText("共享存储").assertIsDisplayed()
        visibleText("a").assertIsDisplayed()
        compose.runOnIdle { width.value = 240.dp }
        visibleText("c").assertIsDisplayed()
        savePathBar("narrow")
        compose.onNodeWithContentDescription("选择上级目录").performTouchInput { click() }
        visibleText("共享存储").assertIsDisplayed()
        visibleText("a").performTouchInput { click() }
        compose.runOnIdle {
            assertEquals(listOf("/sdcard/a/"), openedPaths)
            assertEquals(0, editRequests)
        }
        compose.runOnIdle { width.value = 340.dp }
        visibleText("共享存储").assertIsDisplayed()
        compose.onNodeWithContentDescription("选择上级目录").assertDoesNotExist()
    }

    @Test
    fun longCurrentDirectoryStaysWithinBarAndKeepsBlankSpaceClickable() {
        val name = "a-very-long-current-directory-name-that-does-not-fit"
        showPath("/sdcard/a/b/$name/", mutableStateOf(240.dp))
        val bar = compose.onNodeWithTag("pathBar")
        val bounds = bar.fetchSemanticsNode().boundsInRoot
        val current = visibleText(name).fetchSemanticsNode().boundsInRoot
        assertTrue(current.width > 0)
        assertTrue(current.right < bounds.right)
        savePathBar("long")
        bar.performTouchInput { click(Offset(width - 2f, centerY)) }
        compose.runOnIdle { assertEquals(1, editRequests) }
    }

    @Test
    fun rootLabelAndDisabledUpButtonDoNotOpenEditor() {
        showPath("/")
        visibleText("/").performTouchInput { click() }
        compose.onNodeWithContentDescription("返回上级目录").performTouchInput { click() }
        compose.runOnIdle {
            assertEquals(0, editRequests)
            assertEquals(0, upRequests)
        }
        compose.onNodeWithTag("pathBar").performTouchInput { click(Offset(width - 2f, centerY)) }
        compose.runOnIdle { assertEquals(1, editRequests) }
    }

    private fun visibleText(text: String): SemanticsNodeInteraction =
        compose.onNode(hasText(text) and SemanticsMatcher("placed") { it.layoutInfo.isPlaced }, useUnmergedTree = true)

    private fun savePathBar(name: String) {
        val directory = checkNotNull(InstrumentationRegistry.getInstrumentation().targetContext.getExternalFilesDir(null))
        File(directory, "pathbar-$name.png").outputStream().use { output ->
            compose
                .onNodeWithTag("pathBar")
                .captureToImage()
                .asAndroidBitmap()
                .compress(Bitmap.CompressFormat.PNG, 100, output)
        }
    }

    private fun showPath(
        path: String,
        width: MutableState<Dp> = mutableStateOf(340.dp),
    ) {
        compose.setContent {
            AYLinkTheme(settings = LocalUiSettings(themeMode = ThemeMode.DARK, useDynamicColor = false)) {
                Surface(
                    modifier = Modifier.width(width.value).testTag("pathBar"),
                    color = MaterialTheme.colorScheme.background,
                ) {
                    FilePathBar(
                        path = path,
                        loading = false,
                        editing = false,
                        onEditPath = { editRequests++ },
                        onCancelEditing = {},
                        onGoUp = { upRequests++ },
                        onOpenPath = { openedPaths.add(it) },
                    )
                }
            }
        }
    }
}
