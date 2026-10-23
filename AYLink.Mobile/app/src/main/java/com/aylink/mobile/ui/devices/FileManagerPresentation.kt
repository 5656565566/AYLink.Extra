package com.aylink.mobile.ui.devices

import com.aylink.mobile.data.model.FileEntry

enum class FileSortOrder(
    val label: String,
) {
    NAME_ASC("名称 A–Z"),
    NAME_DESC("名称 Z–A"),
    SIZE_DESC("大小从大到小"),
}

internal data class FileBreadcrumb(
    val label: String,
    val path: String,
)

internal fun normalizeFilePath(path: String): String {
    val normalized = path.replace(Regex("/+"), "/")
    return if (normalized.endsWith('/')) normalized else "$normalized/"
}

internal fun parentFilePath(path: String): String =
    normalizeFilePath(path).trimEnd('/').substringBeforeLast('/', "").let { if (it.isEmpty()) "/" else "$it/" }

internal fun fileEntryPath(
    basePath: String,
    file: FileEntry,
): String = normalizeFilePath(basePath) + file.name + if (file.isDirectory) "/" else ""

internal fun fileBreadcrumbs(path: String): List<FileBreadcrumb> =
    buildList {
        add(FileBreadcrumb("/", "/"))
        var current = "/"
        normalizeFilePath(path).split('/').filter { it.isNotEmpty() }.forEach { segment ->
            current += "$segment/"
            add(FileBreadcrumb(if (current == "/sdcard/") "共享存储" else segment, current))
        }
    }

internal fun sortFileEntries(
    files: List<FileEntry>,
    order: FileSortOrder,
): List<FileEntry> {
    val byName = compareBy<FileEntry, String>(String.CASE_INSENSITIVE_ORDER) { it.name }.thenBy { it.name }
    val withinGroup =
        when (order) {
            FileSortOrder.NAME_ASC -> byName
            FileSortOrder.NAME_DESC -> byName.reversed()
            FileSortOrder.SIZE_DESC -> compareByDescending<FileEntry> { if (it.isDirectory) 0 else it.size }.then(byName)
        }
    return files.sortedWith(compareBy<FileEntry> { !it.isDirectory }.then(withinGroup))
}

internal fun fileNameError(name: String): String? =
    when {
        name.isBlank() -> "名称不能为空"
        name == "." || name == ".." || '/' in name || '\u0000' in name -> "名称不能包含 /、空字符，也不能是 . 或 .."
        else -> null
    }
