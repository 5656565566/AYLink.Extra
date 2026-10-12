package com.aylink.mobile.data.api

import org.junit.Assert.assertEquals
import org.junit.Test

class DownloadFilenameTest {
    @Test
    fun readsGoUnquotedAndUtf8ExtendedNames() {
        assertEquals("hello.txt", downloadFilename("attachment; filename=hello.txt", "fallback"))
        assertEquals("测试+文件.txt", downloadFilename("attachment; filename*=utf-8''%E6%B5%8B%E8%AF%95+%E6%96%87%E4%BB%B6.txt", "fallback"))
        assertEquals("quoted name.txt", downloadFilename("attachment; filename=\"quoted name.txt\"", "fallback"))
        assertEquals("中文.txt", downloadFilename("attachment; filename=old.txt; filename*=utf-8''%E4%B8%AD%E6%96%87.txt", "fallback"))
    }

    @Test
    fun malformedHeadersKeepTheExistingFallback() {
        assertEquals("fallback", downloadFilename(null, "fallback"))
        assertEquals("fallback", downloadFilename("attachment; filename*=bad''%XX", "fallback"))
        assertEquals("fallback", downloadFilename("attachment; filename=\"\"", "fallback"))
    }
}
