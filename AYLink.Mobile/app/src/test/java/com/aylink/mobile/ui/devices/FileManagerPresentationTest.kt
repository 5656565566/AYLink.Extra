package com.aylink.mobile.ui.devices

import com.aylink.mobile.data.model.FileEntry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FileManagerPresentationTest {
    @Test
    fun navigationPreservesRemoteNamesAndStopsAtRoot() {
        assertEquals("/", parentFilePath("/"))
        assertEquals("/", parentFilePath("/sdcard/"))
        assertEquals("/sdcard/", parentFilePath("/sdcard/Download/"))
        assertEquals("/sdcard/folder with spaces /", normalizeFilePath("/sdcard//folder with spaces "))
        assertEquals("/sdcard/ notes.txt ", fileEntryPath("/sdcard", FileEntry(" notes.txt ", false, 0)))
        assertEquals("/sdcard/folder/", fileEntryPath("/sdcard/", FileEntry("folder", true, 0)))
    }

    @Test
    fun breadcrumbsKeepAbsoluteTargetsForEveryAncestor() {
        assertEquals(listOf(FileBreadcrumb("/", "/")), fileBreadcrumbs("/"))
        assertEquals(
            listOf(
                FileBreadcrumb("/", "/"),
                FileBreadcrumb("共享存储", "/sdcard/"),
                FileBreadcrumb("Download", "/sdcard/Download/"),
                FileBreadcrumb("日志", "/sdcard/Download/日志/"),
            ),
            fileBreadcrumbs("/sdcard/Download/日志/"),
        )
    }

    @Test
    fun everySortKeepsDirectoriesFirstAndUsesDeterministicTies() {
        val entries =
            listOf(
                FileEntry("z.txt", false, 5),
                FileEntry("b", true, 0),
                FileEntry("a.txt", false, 20),
                FileEntry("a", true, 0),
                FileEntry("A.txt", false, 20),
            )
        assertEquals(listOf("a", "b", "A.txt", "a.txt", "z.txt"), sortFileEntries(entries, FileSortOrder.NAME_ASC).map { it.name })
        assertEquals(listOf("b", "a", "z.txt", "a.txt", "A.txt"), sortFileEntries(entries, FileSortOrder.NAME_DESC).map { it.name })
        assertEquals(listOf("a", "b", "A.txt", "a.txt", "z.txt"), sortFileEntries(entries, FileSortOrder.SIZE_DESC).map { it.name })
        assertEquals("z.txt", entries.first().name)
    }

    @Test
    fun emptyDirectoryRequiresSuccessfulLoadingWithoutAnError() {
        assertFalse(FileManagerListUiState().showEmpty)
        assertFalse(FileManagerListUiState(hasLoaded = true, loading = true).showEmpty)
        assertFalse(FileManagerListUiState(hasLoaded = true, errorMessage = "permission denied").showEmpty)
        assertFalse(FileManagerListUiState(hasLoaded = true, files = listOf(FileEntry("file", false, 1))).showEmpty)
        assertTrue(FileManagerListUiState(hasLoaded = true).showEmpty)
    }

    @Test
    fun renameRejectsPathsAndSpecialEntriesWithoutRewritingTheName() {
        listOf("", " ", ".", "..", "folder/file", "bad\u0000name").forEach { assertTrue(fileNameError(it) != null) }
        listOf("archive.tar.gz", "资料.txt", " notes.txt ", "a\\b").forEach { assertNull(fileNameError(it)) }
    }
}
